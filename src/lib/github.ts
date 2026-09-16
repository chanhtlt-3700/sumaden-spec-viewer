/**
 * Browser-side GitHub access for live mode.
 *
 * Two channels, picked automatically:
 *  - `proxy`  — `vite dev` signs requests with the local `gh` token (nothing
 *               sensitive reaches the browser). Preferred.
 *  - `token`  — a personal access token the user pastes, kept in localStorage
 *               only and sent to api.github.com and nowhere else. Needed when
 *               the built `dist/` is served without the dev server.
 */

const BASE = import.meta.env.BASE_URL || './';
const TOKEN_KEY = 'spec-view:gh-token';

export type Channel = 'proxy' | 'token' | 'none';

export interface RepoRef {
  repo: string;
  branch: string;
  specPath: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | string;
  previous_filename?: string;
}

let channel: Channel | null = null;
let proxyInfo: RepoRef | null = null;

export const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};

export const writeToken = (value: string) => {
  try {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode — live mode simply stays off */
  }
  channel = null;
};

/** Probe the dev proxy once, then fall back to a stored token. */
export async function detectChannel(): Promise<Channel> {
  if (channel) return channel;
  try {
    const res = await fetch(`${BASE}__gh/ping`, { cache: 'no-store' });
    if (res.ok) {
      const info = await res.json();
      if (info.ok) {
        proxyInfo = { repo: info.repo, branch: info.branch, specPath: info.specPath };
        channel = 'proxy';
        return channel;
      }
    }
  } catch {
    /* no dev server — try the token channel */
  }
  channel = readToken() ? 'token' : 'none';
  return channel;
}

export const proxyRepo = () => proxyInfo;

export const resetChannel = () => {
  channel = null;
  proxyInfo = null;
};

class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request(apiPath: string, raw: boolean): Promise<Response> {
  const mode = await detectChannel();
  if (mode === 'none') throw new GithubError('Chưa cấu hình quyền truy cập GitHub', 401);

  const clean = apiPath.replace(/^\//, '');
  const url =
    mode === 'proxy'
      ? `${BASE}__gh/${raw ? 'raw' : 'api'}/${clean}`
      : `https://api.github.com/${clean}`;

  const headers: Record<string, string> = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
  };
  if (mode === 'token') headers.Authorization = `Bearer ${readToken()}`;

  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) {
    const detail = res.status === 401 || res.status === 403 ? ' — token thiếu quyền đọc repo?' : '';
    throw new GithubError(`GitHub ${res.status} ${res.statusText}${detail}`, res.status);
  }
  return res;
}

export const ghJson = <T>(apiPath: string) => request(apiPath, false).then((r) => r.json() as Promise<T>);
export const ghText = (apiPath: string) => request(apiPath, true).then((r) => r.text());
export const ghBlob = (apiPath: string) => request(apiPath, true).then((r) => r.blob());

/* ------------------------------------------------------------- operations */

/** Newest commit that touched the spec folder. */
export async function latestSpecCommit(ref: RepoRef): Promise<Commit | null> {
  const list = await ghJson<
    { sha: string; commit: { message: string; author?: { name?: string; date?: string } } }[]
  >(
    `repos/${ref.repo}/commits?sha=${encodeURIComponent(ref.branch)}&path=${encodeURIComponent(
      ref.specPath
    )}&per_page=1`
  );
  const head = list[0];
  if (!head) return null;
  return {
    sha: head.sha,
    message: head.commit.message.split('\n')[0],
    author: head.commit.author?.name ?? '',
    date: head.commit.author?.date ?? '',
  };
}

/** Files changed between two commits, or null when the range is unusable. */
export async function changedFiles(
  ref: RepoRef,
  from: string,
  to: string
): Promise<ChangedFile[] | null> {
  try {
    const diff = await ghJson<{ files?: ChangedFile[] }>(
      `repos/${ref.repo}/compare/${from}...${to}`
    );
    return diff.files ?? [];
  } catch (err) {
    // 404 after a force-push / rewritten history, 422 when the range is too big.
    if (err instanceof GithubError && (err.status === 404 || err.status === 422)) return null;
    throw err;
  }
}

export const fileContent = (ref: RepoRef, repoPath: string, at = ref.branch) =>
  ghText(`repos/${ref.repo}/contents/${encodeURI(repoPath)}?ref=${encodeURIComponent(at)}`);

export const fileBlob = (ref: RepoRef, repoPath: string, at = ref.branch) =>
  ghBlob(`repos/${ref.repo}/contents/${encodeURI(repoPath)}?ref=${encodeURIComponent(at)}`);

export const listSpecFiles = (ref: RepoRef) =>
  ghJson<{ name: string; type: string }[]>(
    `repos/${ref.repo}/contents/${encodeURI(ref.specPath)}?ref=${encodeURIComponent(ref.branch)}`
  ).then((all) => all.filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.md')));

/** Ask the dev server to run the full sync script (also refreshes images). */
export async function requestResync(withImages: boolean): Promise<{ ok: boolean; log: string }> {
  const res = await fetch(`${BASE}__gh/resync${withImages ? '?images=1' : ''}`, {
    method: 'POST',
    cache: 'no-store',
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? body.log ?? 'Sync thất bại');
  return body;
}

/** Cheap credential check for the settings panel. */
export async function verifyToken(token: string): Promise<string> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Token không hợp lệ (${res.status})`);
  const user = await res.json();
  return user.login as string;
}
