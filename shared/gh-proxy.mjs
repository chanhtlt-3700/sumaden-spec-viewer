import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH, REPO, SPEC_PATH, ghFetch, ghToken } from './gh-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const send = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

function runSync(res, withImages) {
  const args = ['scripts/sync-specs.mjs'];
  if (!withImages) args.push('--no-images');
  const child = spawn(process.execPath, args, { cwd: ROOT });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  child.on('close', (code) =>
    send(res, code === 0 ? 200 : 500, { ok: code === 0, log: log.slice(-4000) })
  );
}

/**
 * Handler for the `/__gh/*` routes: a narrow GitHub proxy signed with the
 * server's own credentials, so no browser ever needs a token.
 *
 * Only paths under the configured repo are forwarded, so this is not an open
 * relay. `allowSync` gates the one route that writes to disk.
 */
export function createGhHandler({ allowSync = false } = {}) {
  return async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.replace(/^\/+/, '');

    try {
      if (route === 'ping') {
        return send(res, 200, {
          ok: Boolean(ghToken()),
          repo: REPO,
          branch: BRANCH,
          specPath: SPEC_PATH,
          canSync: allowSync,
        });
      }

      if (route === 'resync') {
        if (!allowSync) return send(res, 405, { error: 'Máy chủ này không cho phép đồng bộ' });
        return runSync(res, url.searchParams.has('images'));
      }

      const isRaw = route.startsWith('raw/');
      const apiPath = route.replace(/^(api|raw)\//, '');
      if (!apiPath.startsWith(`repos/${REPO}/`)) {
        return send(res, 403, { error: `Chỉ proxy cho repos/${REPO}` });
      }

      const upstream = await ghFetch(
        `/${apiPath}${url.search}`,
        isRaw ? 'application/vnd.github.raw' : 'application/vnd.github+json'
      );
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') ?? 'application/octet-stream'
      );
      res.setHeader('Cache-Control', 'no-store');
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (err) {
      send(res, 502, { error: String(err instanceof Error ? err.message : err) });
    }
  };
}
