import { useCallback, useEffect, useRef, useState } from 'react';
import type { Spec, SpecIndex, TableBlock } from '../types';

const BASE = import.meta.env.BASE_URL || './';

export const asset = (p: string) => `${BASE}${p.replace(/^\//, '')}`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(asset(path));
  if (!res.ok) throw new Error(`Không tải được ${path} (${res.status})`);
  return res.json() as Promise<T>;
}

/* ---------------------------------------------------------------- caching */

const specCache = new Map<string, Spec>();
let indexPromise: Promise<SpecIndex> | null = null;

export function loadIndex(): Promise<SpecIndex> {
  if (!indexPromise) indexPromise = getJson<SpecIndex>('data/index.json');
  return indexPromise;
}

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

/* ------------------------------------------------------------------ hooks */

export type AsyncState<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: Error };

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', data: null, error: null });
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

export const useIndex = () => useAsync(() => loadIndex(), []);
export const useSpec = (slug: string) => useAsync(() => loadSpec(slug), [slug]);

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
