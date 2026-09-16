import { useSyncExternalStore } from 'react';
import type { Commit, Spec } from '../types';
import { makeSlug, parseSpec } from '../../shared/spec-parser.mjs';
import {
  currentIndex,
  findByFileName,
  knownSlugs,
  loadIndex,
  removeSpec,
  setHead,
  upsertSpec,
} from './data';
import {
  changedFiles,
  detectChannel,
  fileContent,
  latestSpecCommit,
  listSpecFiles,
  requestResync,
} from './github';
import type { Channel, RepoRef } from './github';

export type LiveStatus = 'off' | 'idle' | 'checking' | 'updating' | 'error';

export interface ChangeReport {
  at: number;
  commit: Commit;
  updated: string[];
  removed: string[];
  /** Mockup images changed upstream; the local copies are now stale. */
  imagesChanged: number;
}

export interface LiveState {
  enabled: boolean;
  channel: Channel;
  status: LiveStatus;
  intervalMs: number;
  lastChecked: number | null;
  head: Commit | null;
  error: string | null;
  lastChange: ChangeReport | null;
  resyncing: boolean;
}

const ENABLED_KEY = 'spec-view:live-enabled';
const INTERVAL_KEY = 'spec-view:live-interval';

const readBool = (key: string, fallback: boolean) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
};

const readInt = (key: string, fallback: number) => {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw >= 15000 ? raw : fallback;
  } catch {
    return fallback;
  }
};

let state: LiveState = {
  enabled: readBool(ENABLED_KEY, true),
  channel: 'none',
  status: 'off',
  intervalMs: readInt(INTERVAL_KEY, 60_000),
  lastChecked: null,
  head: null,
  error: null,
  lastChange: null,
  resyncing: false,
};

const listeners = new Set<() => void>();
const changeHandlers = new Set<(report: ChangeReport) => void>();

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export const useLive = () => useSyncExternalStore(subscribe, () => state);

/** Notified after each successful live patch — used to toast the user. */
export function onLiveChange(fn: (report: ChangeReport) => void) {
  changeHandlers.add(fn);
  return () => {
    changeHandlers.delete(fn);
  };
}

/* ---------------------------------------------------------------- polling */

let timer = 0;
let inFlight: Promise<void> | null = null;

function repoRef(): RepoRef | null {
  const index = currentIndex();
  if (!index) return null;
  return { repo: index.repo, branch: index.branch, specPath: index.specPath };
}

export async function start() {
  const index = await loadIndex();
  const channel = await detectChannel();
  set({ channel, head: index.head, status: state.enabled && channel !== 'none' ? 'idle' : 'off' });
  schedule();
  if (state.enabled && channel !== 'none') void check();
}

function schedule() {
  window.clearInterval(timer);
  if (!state.enabled || state.channel === 'none') return;
  timer = window.setInterval(() => void check(), state.intervalMs);
}

export function setEnabled(enabled: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled));
  } catch {
    /* ignore */
  }
  set({ enabled, status: enabled && state.channel !== 'none' ? 'idle' : 'off', error: null });
  schedule();
  if (enabled) void check();
}

export function setIntervalMs(intervalMs: number) {
  try {
    localStorage.setItem(INTERVAL_KEY, String(intervalMs));
  } catch {
    /* ignore */
  }
  set({ intervalMs });
  schedule();
}

/** Re-probe after the user pastes a token. */
export async function refreshChannel() {
  const channel = await detectChannel();
  set({ channel, status: state.enabled && channel !== 'none' ? 'idle' : 'off' });
  schedule();
  if (state.enabled && channel !== 'none') void check();
}

export function check(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runCheck().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runCheck() {
  const ref = repoRef();
  if (!ref || state.channel === 'none') return;

  set({ status: 'checking', error: null });
  try {
    const latest = await latestSpecCommit(ref);
    set({ lastChecked: Date.now() });

    if (!latest) {
      set({ status: 'idle' });
      return;
    }
    if (!state.head) {
      // No baseline (snapshot predates head tracking) — adopt it silently.
      setHead(latest);
      set({ head: latest, status: 'idle' });
      return;
    }
    if (latest.sha === state.head.sha) {
      set({ status: 'idle' });
      return;
    }

    set({ status: 'updating' });
    const report = await applyUpdate(ref, state.head.sha, latest);
    setHead(latest);
    set({ head: latest, status: 'idle', lastChange: report });
    if (report.updated.length || report.removed.length || report.imagesChanged) {
      for (const fn of changeHandlers) fn(report);
    }
  } catch (err) {
    set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/* ----------------------------------------------------------------- update */

async function applyUpdate(ref: RepoRef, fromSha: string, to: Commit): Promise<ChangeReport> {
  const files = await changedFiles(ref, fromSha, to.sha);
  const report: ChangeReport = {
    at: Date.now(),
    commit: to,
    updated: [],
    removed: [],
    imagesChanged: 0,
  };

  // History was rewritten or the range is too wide — re-read the whole folder.
  if (files === null) {
    const all = await listSpecFiles(ref);
    const known = new Set(currentIndex()?.specs.map((s) => s.fileName) ?? []);
    for (const file of all) {
      const label = await refreshFile(ref, file.name, to.sha);
      if (label) report.updated.push(label);
      known.delete(file.name);
    }
    for (const gone of known) {
      const label = dropFile(gone);
      if (label) report.removed.push(label);
    }
    return report;
  }

  const prefix = `${ref.specPath}/`;
  for (const file of files) {
    const name = file.filename;
    if (!name.startsWith(prefix)) continue;

    if (name.startsWith(`${prefix}images/`)) {
      report.imagesChanged += 1;
      continue;
    }
    if (!name.toLowerCase().endsWith('.md')) continue;

    const baseName = name.slice(prefix.length);
    if (baseName.includes('/')) continue; // specs live flat in the folder

    if (file.status === 'removed') {
      const label = dropFile(baseName);
      if (label) report.removed.push(label);
      continue;
    }
    if (file.status === 'renamed' && file.previous_filename?.startsWith(prefix)) {
      dropFile(file.previous_filename.slice(prefix.length));
    }
    const label = await refreshFile(ref, baseName, to.sha);
    if (label) report.updated.push(label);
  }

  return report;
}

/** Fetch one markdown file at a commit, parse it, and patch the store. */
async function refreshFile(ref: RepoRef, fileName: string, at: string): Promise<string | null> {
  const markdown = await fileContent(ref, `${ref.specPath}/${fileName}`, at);
  const parsed = parseSpec(fileName, markdown, ref);

  // Keep the existing slug when the file is merely edited, so open links survive.
  const existing = findByFileName(fileName);
  const taken = knownSlugs();
  if (existing) taken.delete(existing.slug);
  const slug = existing?.slug ?? makeSlug(parsed, taken);

  const spec = { ...parsed, slug } as Spec;
  const before = currentIndex()?.specs.find((s) => s.slug === slug);
  upsertSpec(spec);
  return before && before.bytes === spec.bytes && before.lastChanged === spec.lastChanged
    ? null // identical content (e.g. only whitespace in the commit)
    : `${spec.screenId || spec.nameJa}`;
}

function dropFile(fileName: string): string | null {
  const existing = findByFileName(fileName);
  if (!existing) return null;
  removeSpec(existing.slug);
  return existing.screenId || existing.nameJa;
}

/* ------------------------------------------------------------ full resync */

/**
 * Runs the sync script on the dev server: refreshes markdown *and* mockup
 * images on disk, then reloads so the app reads the new snapshot.
 */
export async function fullResync(withImages = true) {
  if (state.channel !== 'proxy') throw new Error('Cần chạy `npm run dev` để đồng bộ toàn bộ');
  set({ resyncing: true, error: null });
  try {
    await requestResync(withImages);
    window.location.reload();
  } catch (err) {
    set({ resyncing: false, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/* ------------------------------------------------------------- visibility */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.enabled && state.channel !== 'none') {
    void check();
  }
});
window.addEventListener('focus', () => {
  if (state.enabled && state.channel !== 'none') void check();
});
