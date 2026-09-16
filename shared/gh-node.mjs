/** GitHub access for Node-side tooling (sync script + dev proxy). */
import { execFileSync } from 'node:child_process';

export const REPO = process.env.SPEC_REPO || 'framgia/2116-mng';
export const BRANCH = process.env.SPEC_BRANCH || 'main';
export const SPEC_PATH = process.env.SPEC_PATH || 'docs/specification';

let cached = null;

/** GITHUB_TOKEN if set, otherwise whatever `gh auth` holds. */
export function ghToken() {
  if (cached) return cached;
  if (process.env.GITHUB_TOKEN) {
    cached = process.env.GITHUB_TOKEN;
    return cached;
  }
  try {
    cached = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: true }).trim();
    return cached;
  } catch {
    return null;
  }
}

export async function ghFetch(url, accept = 'application/vnd.github+json') {
  const token = ghToken();
  if (!token) throw new Error('Không có GITHUB_TOKEN và `gh auth token` cũng thất bại.');
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept, 'User-Agent': 'spec-view' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res;
}

export const ghJson = (url) => ghFetch(url).then((r) => r.json());
export const ghRaw = (url) => ghFetch(url, 'application/vnd.github.raw').then((r) => r.text());
