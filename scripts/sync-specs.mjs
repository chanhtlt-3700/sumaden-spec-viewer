#!/usr/bin/env node
/**
 * Sync specs from GitHub -> parse Markdown -> JSON in public/data.
 *
 * Auth: GITHUB_TOKEN env var, or falls back to `gh auth token`.
 * Usage: npm run sync                 download + parse
 *        npm run sync -- --offline    re-parse the local cache in data/raw
 *        npm run sync -- --no-images  skip the mockup images
 *        npm run sync -- --clean      wipe every local cache first
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRANCH, REPO, SPEC_PATH, ghFetch, ghJson, ghRaw } from '../shared/gh-node.mjs';
import { makeSlug, parseSpec, sortSpecs, summarize } from '../shared/spec-parser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const SPEC_OUT_DIR = path.join(OUT_DIR, 'specs');
const IMG_DIR = path.join(ROOT, 'public', 'spec-images');
const HEAD_FILE = path.join(ROOT, 'data', 'head.json');

const OFFLINE = process.argv.includes('--offline');
const NO_IMAGES = process.argv.includes('--no-images');
const CLEAN = process.argv.includes('--clean');
const SOURCE = { repo: REPO, branch: BRANCH, specPath: SPEC_PATH };

/* ------------------------------------------------------------------ fetch */

/** The commit that last touched the spec folder — live mode diffs against it. */
export async function latestSpecCommit() {
  const [commit] = await ghJson(
    `/repos/${REPO}/commits?sha=${BRANCH}&path=${encodeURIComponent(SPEC_PATH)}&per_page=1`
  );
  if (!commit) return null;
  return {
    sha: commit.sha,
    message: commit.commit.message.split('\n')[0],
    author: commit.commit.author?.name ?? '',
    date: commit.commit.author?.date ?? '',
  };
}

async function download() {
  const listing = await ghJson(
    `/repos/${REPO}/contents/${encodeURI(SPEC_PATH)}?ref=${BRANCH}`
  );
  const files = listing.filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.md'));
  console.log(`Found ${files.length} spec files in ${REPO}/${SPEC_PATH}`);

  fs.mkdirSync(RAW_DIR, { recursive: true });
  let done = 0;
  const queue = [...files];
  const workers = Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      fs.writeFileSync(path.join(RAW_DIR, f.name), await ghRaw(f.url), 'utf8');
      done += 1;
      process.stdout.write(`\r  downloaded ${done}/${files.length}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write('\n');

  // Drop cached files that no longer exist upstream.
  const keep = new Set(files.map((f) => f.name));
  for (const name of fs.readdirSync(RAW_DIR)) {
    if (!keep.has(name)) fs.unlinkSync(path.join(RAW_DIR, name));
  }
}

async function downloadImages() {
  const tree = await ghJson(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
  const prefix = `${SPEC_PATH}/images/`;
  const blobs = tree.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix));
  if (!blobs.length) return;
  console.log(`Syncing ${blobs.length} mockup images`);

  let done = 0;
  let skipped = 0;
  const queue = [...blobs];
  const workers = Array.from({ length: 6 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const dest = path.join(IMG_DIR, b.path.slice(prefix.length));
      // Blob SHAs are content hashes, so a same-size existing file is already current.
      if (fs.existsSync(dest) && fs.statSync(dest).size === b.size) {
        skipped += 1;
        done += 1;
        continue;
      }
      const res = await ghFetch(
        `/repos/${REPO}/git/blobs/${b.sha}`,
        'application/vnd.github.raw'
      );
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      done += 1;
      process.stdout.write(`\r  images ${done}/${blobs.length}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write(`\r  images ${done}/${blobs.length} (${skipped} cached)\n`);

  // Anything still local that upstream no longer has is a stale cache entry.
  const upstream = new Set(blobs.map((b) => b.path.slice(prefix.length)));
  const stale = listFiles(IMG_DIR).filter((rel) => !upstream.has(rel));
  for (const rel of stale) fs.rmSync(path.join(IMG_DIR, rel));
  pruneEmptyDirs(IMG_DIR);
  if (stale.length) console.log(`  gỡ ${stale.length} ảnh không còn trên repo`);
}

/* ------------------------------------------------------------------ clean */

/** Relative paths of every file under `dir`, '/'-separated. */
function listFiles(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(path.join(dir, e.name), `${prefix}${e.name}/`)
      : [`${prefix}${e.name}`]
  );
}

function pruneEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    pruneEmptyDirs(child);
    if (!fs.readdirSync(child).length) fs.rmdirSync(child);
  }
}

/** Drop every local cache so the next sync starts from nothing. */
function clean() {
  for (const dir of [RAW_DIR, OUT_DIR, IMG_DIR]) {
    if (!fs.existsSync(dir)) continue;
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`Đã xoá ${path.relative(ROOT, dir)}`);
  }
  fs.rmSync(HEAD_FILE, { force: true });
}

/* ------------------------------------------------------------------ build */

function build(head) {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`No cache at ${RAW_DIR}. Run without --offline first.`);
    process.exit(1);
  }
  fs.rmSync(SPEC_OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SPEC_OUT_DIR, { recursive: true });

  const names = fs.readdirSync(RAW_DIR).filter((n) => n.toLowerCase().endsWith('.md'));
  const parsed = names.map((n) =>
    parseSpec(n, fs.readFileSync(path.join(RAW_DIR, n), 'utf8'), SOURCE)
  );

  const taken = new Set();
  for (const s of parsed) {
    s.slug = makeSlug(s, taken);
    taken.add(s.slug);
  }
  const specs = sortSpecs(parsed);

  for (const s of specs) {
    fs.writeFileSync(path.join(SPEC_OUT_DIR, `${s.slug}.json`), JSON.stringify(s), 'utf8');
  }

  const index = {
    repo: REPO,
    branch: BRANCH,
    specPath: SPEC_PATH,
    generatedAt: new Date().toISOString(),
    head: head ?? readHead(),
    specs: specs.map(summarize),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');
  if (head) fs.writeFileSync(HEAD_FILE, JSON.stringify(head, null, 2), 'utf8');

  const totalItems = specs.reduce((a, s) => a + s.itemCount, 0);
  console.log(`Built ${specs.length} specs, ${totalItems} items -> public/data`);
  if (index.head) console.log(`HEAD ${index.head.sha.slice(0, 8)} — ${index.head.message}`);

  const missing = [
    ...new Set(specs.flatMap((s) => s.localImages ?? [])),
  ].filter((rel) => !fs.existsSync(path.join(IMG_DIR, rel)));
  if (missing.length) console.log(`Missing local images (chạy sync online): ${missing.length}`);
  const noItems = specs.filter((s) => !s.itemCount).map((s) => s.fileName);
  if (noItems.length) console.log(`Specs without an Items table:\n  ${noItems.join('\n  ')}`);
}

function readHead() {
  try {
    return JSON.parse(fs.readFileSync(HEAD_FILE, 'utf8'));
  } catch {
    return null;
  }
}

if (CLEAN) clean();

let head = null;
if (!OFFLINE) {
  head = await latestSpecCommit();
  await download();
  if (!NO_IMAGES) await downloadImages();
}
build(head);
