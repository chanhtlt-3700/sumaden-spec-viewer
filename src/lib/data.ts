import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Commit, Spec, SpecIndex, TableBlock } from '../types';
import { sortSpecs, summarize } from '../../shared/spec-parser.mjs';

const BASE = import.meta.env.BASE_URL || './';

export const asset = (p: string) => `${BASE}${p.replace(/^\//, '')}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Không tải được ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ store */

const specCache = new Map<string, Spec>();
let indexData: SpecIndex | null = null;
let indexPromise: Promise<SpecIndex> | null = null;

let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version += 1;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Re-renders anything reading store data when live mode patches it. */
export const useStoreVersion = () => useSyncExternalStore(subscribe, () => version);

export function loadIndex(): Promise<SpecIndex> {
  if (indexData) return Promise.resolve(indexData);
  if (!indexPromise) {
    indexPromise = getJson<SpecIndex>('data/index.json').then((data) => {
      indexData = data;
      return data;
    });
  }
  return indexPromise;
}

export const currentIndex = () => indexData;

export async function loadSpec(slug: string): Promise<Spec> {
  const hit = specCache.get(slug);
  if (hit) return hit;
  const spec = await getJson<Spec>(`data/specs/${slug}.json`);
  specCache.set(slug, spec);
  return spec;
}

/** Warm the cache for every spec — needed by cross-spec search. */
export async function loadAllSpecs(onProgress?: (done: number, total: number) => void) {
  const index = await loadIndex();
  const total = index.specs.length;
  let done = 0;
  const queue = [...index.specs];
  const workers = Array.from({ length: 8 }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      await loadSpec(s.slug);
      done += 1;
      onProgress?.(done, total);
    }
  });
  await Promise.all(workers);
  return index.specs.map((s) => specCache.get(s.slug)!).filter(Boolean);
}

export const getCachedSpec = (slug: string) => specCache.get(slug);

/* ------------------------------------------------------------- mutations */

/** Insert or replace a spec (live mode). Keeps index.specs sorted. */
export function upsertSpec(spec: Spec) {
  specCache.set(spec.slug, spec);
  if (indexData) {
    const summary = summarize(spec);
    const rest = indexData.specs.filter((s) => s.slug !== spec.slug);
    indexData = { ...indexData, specs: sortSpecs([...rest, summary]) };
  }
  emit();
}

export function removeSpec(slug: string) {
  specCache.delete(slug);
  if (indexData) {
    indexData = { ...indexData, specs: indexData.specs.filter((s) => s.slug !== slug) };
  }
  emit();
}

export function setHead(head: Commit | null) {
  if (!indexData) return;
  indexData = { ...indexData, head };
  emit();
}

export const findByFileName = (fileName: string) =>
  indexData?.specs.find((s) => s.fileName === fileName) ?? null;

export const knownSlugs = () => new Set(indexData?.specs.map((s) => s.slug) ?? []);

/* ------------------------------------------------------------------ hooks */

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: Error };

/**
 * `resetOn` marks a change of identity (a different spec): the state drops back
 * to loading. A bare `deps` change — a live-mode refresh — keeps the old data
 * on screen until the new data arrives, so updates don't flash a spinner.
 */
export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  resetOn: string
): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null });
  const identity = useRef(resetOn);
  if (identity.current !== resetOn) {
    identity.current = resetOn;
    setState({ status: 'loading', data: null, error: null });
  }
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    fnRef
      .current()
      .then((data) => alive && setState({ status: 'ready', data, error: null }))
      .catch((error: Error) => alive && setState({ status: 'error', data: null, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

export function useIndex() {
  const v = useStoreVersion();
  return useAsync(() => loadIndex(), [v], 'index');
}

export function useSpec(slug: string) {
  const v = useStoreVersion();
  return useAsync(() => loadSpec(slug), [slug, v], slug);
}

/* ------------------------------------------------------------ persistence */

export function useStored<T>(key: string, initial: T) {
  const storageKey = `spec-view:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          /* private mode / quota — keep working in memory */
        }
        return resolved;
      });
    },
    [storageKey]
  );

  return [value, set] as const;
}

/* ------------------------------------------------------------- spec utils */

export function itemsTable(spec: Spec): TableBlock | null {
  for (const section of spec.sections) {
    if (!/^items?\b/i.test(section.title)) continue;
    const table = section.blocks.find((b) => b.type === 'table');
    if (table) return table as TableBlock;
  }
  return null;
}

/** Every table in the spec, tagged with the section it came from. */
export function allTables(spec: Spec): { section: string; table: TableBlock }[] {
  return spec.sections.flatMap((s) =>
    s.blocks.filter((b): b is TableBlock => b.type === 'table').map((table) => ({ section: s.title, table }))
  );
}

const SCREEN_REF = /\b(S-\d{1,3}[a-z]?)\b/gi;

/** Screen IDs mentioned anywhere in the spec body, for the "liên kết màn hình" graph. */
export function screenRefs(spec: Spec): string[] {
  const found = new Set<string>();
  const scan = (text: string) => {
    for (const m of text.matchAll(SCREEN_REF)) found.add(m[1].toUpperCase());
  };
  for (const section of spec.sections) {
    for (const block of section.blocks) {
      if (block.type === 'table') block.rows.forEach((r) => r.forEach(scan));
      else if (block.type === 'markdown') scan(block.text);
    }
  }
  scan(spec.overview);
  found.delete(spec.screenId.toUpperCase());
  return [...found].sort();
}
