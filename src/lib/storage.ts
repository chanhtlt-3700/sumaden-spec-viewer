/**
 * localStorage housekeeping.
 *
 * Table layouts (column widths, hidden columns) are keyed per spec+section, so
 * they pile up and go stale when a spec is renamed, removed, or reshaped
 * upstream. Widths in particular are derived from the data, so a layout saved
 * against an old version of a table is actively wrong.
 */

export const PREFIX = 'spec-view:';

/** Bump when a change makes previously saved view settings wrong. */
const CACHE_VERSION = '2';
const VERSION_KEY = `${PREFIX}cache-version`;

/** Settings that belong to the person, not to a snapshot of the data. */
const KEEP = new Set([
  'theme',
  'favorites',
  'sidebar:collapsed',
  'sidebar:sort',
  'gh-token',
  'live-enabled',
  'live-interval',
  'cache-version',
]);

function allKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return [];
  }
}

const shortKey = (key: string) => key.slice(PREFIX.length);

/** Per-table layout and the shared sheet view preferences. */
export const isViewKey = (key: string) => {
  const name = shortKey(key);
  if (KEEP.has(name)) return false;
  return name.startsWith('sheet:') || name.endsWith(':widths') || name.endsWith(':hidden');
};

function drop(keys: string[]): number {
  let removed = 0;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/** How many table-layout entries are currently cached. */
export const viewCacheSize = () => allKeys().filter(isViewKey).length;

/** Forget every saved table layout — the "Xoá cache" action. */
export const clearViewCache = () => drop(allKeys().filter(isViewKey));

/** Wipe stale layouts once after an upgrade that changes table defaults. */
export function ensureCacheVersion(): number {
  let current: string | null = null;
  try {
    current = localStorage.getItem(VERSION_KEY);
  } catch {
    return 0;
  }
  if (current === CACHE_VERSION) return 0;
  const removed = clearViewCache();
  try {
    localStorage.setItem(VERSION_KEY, CACHE_VERSION);
  } catch {
    /* ignore */
  }
  return removed;
}

/** Drop layouts belonging to specs that no longer exist in the index. */
export function pruneOrphanLayouts(validSlugs: Set<string>): number {
  const orphans = allKeys().filter((key) => {
    if (!isViewKey(key)) return false;
    const name = shortKey(key);
    if (name.startsWith('sheet:')) return false; // shared prefs, not per-spec
    const slug = name.slice(0, name.indexOf(':'));
    return slug !== '' && !validSlugs.has(slug);
  });
  return drop(orphans);
}
