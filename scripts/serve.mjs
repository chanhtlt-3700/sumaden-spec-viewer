#!/usr/bin/env node
/**
 * Standalone server for a deployed instance: serves `dist/` and signs GitHub
 * requests with the server's own credentials.
 *
 * This is the answer to "live updates without a token in the browser". A pure
 * static host cannot do it for a private repo — GitHub's OAuth token exchange
 * requires a client secret, and the device-flow endpoints send no CORS headers,
 * so a browser cannot obtain a token on its own. One small server removes the
 * problem entirely: viewers need no token and no GitHub account.
 *
 * Usage: npm run serve            (PORT=5190 by default)
 *        SPEC_ALLOW_SYNC=1 npm run serve   also expose the re-sync button
 *
 * Auth: GITHUB_TOKEN, else `gh auth token`.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, ghToken } from '../shared/gh-node.mjs';
import { createGhHandler } from '../shared/gh-proxy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5190);
const HOST = process.env.HOST ?? '0.0.0.0';
const ALLOW_SYNC = process.env.SPEC_ALLOW_SYNC === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const gh = createGhHandler({ allowSync: ALLOW_SYNC });

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  // Hashed asset filenames are safe to cache hard; everything else must revalidate
  // so a fresh sync shows up on the next load.
  res.setHeader(
    'Cache-Control',
    /\/assets\/.+-[A-Za-z0-9_-]{8,}\./.test(filePath.replace(/\\/g, '/'))
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
  );
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/__gh/')) {
    req.url = url.pathname.slice('/__gh'.length) + url.search;
    void gh(req, res);
    return;
  }

  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';

  const target = path.join(DIST, rel);
  // Keep traversal (`../`) from escaping the build directory.
  if (!target.startsWith(DIST)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) return serveFile(res, target);
    // Unknown path: hand back the SPA shell so client routing works.
    return serveFile(res, path.join(DIST, 'index.html'));
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err instanceof Error ? err.message : err));
  }
});

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('Chưa có dist/. Chạy `npm run build` trước.');
  process.exit(1);
}
if (!ghToken()) {
  console.warn('Cảnh báo: không có GITHUB_TOKEN và `gh auth token` cũng thất bại.');
  console.warn('App vẫn chạy với snapshot kèm trong dist/, nhưng live update sẽ tắt.');
}

server.listen(PORT, HOST, () => {
  console.log(`Spec Viewer đang chạy: http://localhost:${PORT}`);
  console.log(`  repo      ${REPO}`);
  console.log(`  proxy     /__gh/* (ký bằng token phía máy chủ, trình duyệt không cần token)`);
  console.log(`  đồng bộ   ${ALLOW_SYNC ? 'bật' : 'tắt (đặt SPEC_ALLOW_SYNC=1 để bật)'}`);
});
