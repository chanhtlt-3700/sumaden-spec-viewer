#!/usr/bin/env node
/**
 * Sync specs from GitHub -> parse Markdown -> JSON in public/data.
 *
 * Auth: GITHUB_TOKEN env var, or falls back to `gh auth token`.
 * Usage: npm run sync            download + parse
 *        npm run sync -- --offline   re-parse the local cache in data/raw
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'data', 'raw');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const SPEC_OUT_DIR = path.join(OUT_DIR, 'specs');
const IMG_DIR = path.join(ROOT, 'public', 'spec-images');

const REPO = process.env.SPEC_REPO || 'framgia/2116-mng';
const BRANCH = process.env.SPEC_BRANCH || 'main';
const SPEC_PATH = process.env.SPEC_PATH || 'docs/specification';
const OFFLINE = process.argv.includes('--offline');
const NO_IMAGES = process.argv.includes('--no-images');

/* ------------------------------------------------------------------ fetch */

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', shell: true }).trim();
  } catch {
    console.error('No GITHUB_TOKEN and `gh auth token` failed. Run `gh auth login` or set GITHUB_TOKEN.');
    process.exit(1);
  }
}

async function gh(url, tk, accept = 'application/vnd.github+json') {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${tk}`, Accept: accept, 'User-Agent': 'spec-view-sync' },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return accept.includes('json') ? res.json() : res.text();
}

async function download() {
  const tk = token();
  const listing = await gh(
    `https://api.github.com/repos/${REPO}/contents/${encodeURI(SPEC_PATH)}?ref=${BRANCH}`,
    tk
  );
  const files = listing.filter((e) => e.type === 'file' && e.name.toLowerCase().endsWith('.md'));
  console.log(`Found ${files.length} spec files in ${REPO}/${SPEC_PATH}`);

  fs.mkdirSync(RAW_DIR, { recursive: true });
  let done = 0;
  const queue = [...files];
  const workers = Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const text = await gh(f.url, tk, 'application/vnd.github.raw');
      fs.writeFileSync(path.join(RAW_DIR, f.name), text, 'utf8');
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
  const tk = token();
  const tree = await gh(
    `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`,
    tk
  );
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
      const res = await fetch(`https://api.github.com/repos/${REPO}/git/blobs/${b.sha}`, {
        headers: {
          Authorization: `Bearer ${tk}`,
          Accept: 'application/vnd.github.raw',
          'User-Agent': 'spec-view-sync',
        },
      });
      if (!res.ok) throw new Error(`${res.status} for image ${b.path}`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      done += 1;
      process.stdout.write(`\r  images ${done}/${blobs.length}`);
    }
  });
  await Promise.all(workers);
  process.stdout.write(`\r  images ${done}/${blobs.length} (${skipped} cached)\n`);
}

/* ----------------------------------------------------------------- parser */

const splitRow = (line) => {
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  // A markdown row is bounded by pipes, so the first/last chunks are empty.
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
};

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableRow = (line) => line.trim().startsWith('|');
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

/** Repo-relative image paths become local assets synced into public/spec-images. */
const localImages = new Set();
function resolveImage(url) {
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('/')) return url;
  const clean = url.replace(/^\.\//, '').replace(/^images\//, '');
  localImages.add(clean);
  return `spec-images/${clean}`;
}

/** Split raw section text into typed blocks: table | images | markdown. */
function parseBlocks(lines) {
  const blocks = [];
  let buf = [];
  const flushText = () => {
    const text = buf.join('\n').trim();
    if (text) blocks.push({ type: 'markdown', text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (isTableRow(line) && isTableSep(lines[i + 1] || '')) {
      flushText();
      const headers = splitRow(line);
      const align = splitRow(lines[i + 1]).map((s) =>
        s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : 'left'
      );
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && isTableRow(lines[j]); j += 1) {
        const cells = splitRow(lines[j]);
        while (cells.length < headers.length) cells.push('');
        rows.push(cells);
      }
      blocks.push({ type: 'table', headers, align, rows });
      i = j - 1;
      continue;
    }

    const img = line.match(IMAGE_ONLY);
    if (img) {
      flushText();
      const images = [];
      let j = i;
      for (; j < lines.length; j += 1) {
        const m = lines[j].match(IMAGE_ONLY);
        if (m) images.push({ alt: m[1], url: resolveImage(m[2]) });
        else if (lines[j].trim() !== '') break;
      }
      blocks.push({ type: 'images', images });
      i = j - 1;
      continue;
    }

    buf.push(line);
  }
  flushText();
  return blocks;
}

/** The `- **Key**: value` list at the top of the file, keeping indented continuations. */
function parseMeta(lines) {
  const meta = {};
  let key = null;
  for (const line of lines) {
    const m = line.match(/^[-*]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/);
    if (m) {
      key = m[1].trim();
      meta[key] = m[2].trim();
    } else if (key && line.trim() !== '') {
      meta[key] += (meta[key] ? '\n' : '') + line.replace(/^ {2}/, '');
    } else if (line.trim() === '') {
      key = null;
    }
  }
  return meta;
}

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

/** "S-49b" -> sortable key so S-2 < S-12 and S-49a < S-49b. */
function sortKey(screenId) {
  const m = /^[A-Za-z]*-?(\d+)([a-z]*)/.exec(screenId || '');
  if (!m) return [9999, screenId || ''];
  return [Number(m[1]), m[2] || ''];
}

function parseSpec(fileName, markdown) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const title =
    titleIdx >= 0 ? lines[titleIdx].replace(/^#\s+/, '').trim() : fileName.replace(/\.md$/, '');
  const bodyStart = titleIdx >= 0 ? titleIdx + 1 : 0;

  const firstHeading = lines.findIndex((l, i) => i >= bodyStart && /^#{2,6}\s+/.test(l));
  const metaEnd = firstHeading === -1 ? lines.length : firstHeading;
  const meta = parseMeta(lines.slice(bodyStart, metaEnd));

  const rawSections = [];
  if (firstHeading !== -1) {
    let cur = null;
    for (let i = firstHeading; i < lines.length; i += 1) {
      const h = lines[i].match(/^(#{2,6})\s+(.*)$/);
      if (h) {
        if (cur) rawSections.push(cur);
        cur = { level: h[1].length, title: h[2].trim(), lines: [] };
      } else if (cur) {
        cur.lines.push(lines[i]);
      }
    }
    if (cur) rawSections.push(cur);
  }

  const usedIds = new Set();
  const sections = rawSections.map((s) => {
    const base = slugify(s.title) || 'section';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return { id, level: s.level, title: s.title, blocks: parseBlocks(s.lines) };
  });

  // Filename shape: "[P2] [S-49b] 日本語名 - English Name.md"
  const fm = fileName.match(/^\s*(?:\[(P\d+)\]\s*)?(?:\[([^\]]+)\]\s*)?(.*)\.md$/i);
  const rest = fm ? fm[3] : title;
  const phase = (fm && fm[1]) || meta['Phase'] || '';
  const dashIdx = rest.indexOf(' - ');
  const nameJa = dashIdx >= 0 ? rest.slice(0, dashIdx).trim() : rest.trim();
  const nameEn = dashIdx >= 0 ? rest.slice(dashIdx + 3).trim() : '';
  const rawScreenId = (meta['Screen ID'] || (fm && fm[2]) || '').trim();
  // Some docs carry a prose placeholder instead of an ID ("— (không cấp ID...)").
  const screenId = /^[A-Za-z]{0,3}-?\d+[a-z]?$/.test(rawScreenId) ? rawScreenId : '';

  const items = sections.find((s) => /^items?\b/i.test(s.title));
  const itemsTable = items && items.blocks.find((b) => b.type === 'table');
  const history = sections.find((s) => /history/i.test(s.title));
  const historyTable = history && history.blocks.find((b) => b.type === 'table');
  const mockups = sections.flatMap((s) =>
    s.blocks.filter((b) => b.type === 'images').flatMap((b) => b.images)
  );

  const docNo = meta['Doc No/Version'] || meta['Doc No'] || '';
  const versionMatch = docNo.match(/Version:\s*([^/|]+)/i);
  const docNoMatch = docNo.match(/No:\s*([^/|]+)/i);
  const lastChanged =
    historyTable && historyTable.rows.length
      ? historyTable.rows[historyTable.rows.length - 1][0]
      : '';

  return {
    slug: '',
    fileName,
    phase,
    screenId,
    title,
    nameJa,
    nameEn,
    meta,
    designUrl: meta['Design URL'] || '',
    createdBy: meta['Created by'] || '',
    createdDate: meta['Created date'] || '',
    docNo: (docNoMatch ? docNoMatch[1] : '').trim(),
    version: (versionMatch ? versionMatch[1] : '').trim(),
    overview: meta['Overview'] || '',
    sections,
    itemsSectionId: items ? items.id : null,
    itemCount: itemsTable ? itemsTable.rows.length : 0,
    itemColumns: itemsTable ? itemsTable.headers : [],
    mockups,
    historyCount: historyTable ? historyTable.rows.length : 0,
    lastChanged,
    bytes: Buffer.byteLength(markdown, 'utf8'),
    sourceUrl: `https://github.com/${REPO}/blob/${BRANCH}/${SPEC_PATH}/${encodeURIComponent(fileName)}`,
  };
}

/* ------------------------------------------------------------------ build */

function build() {
  if (!fs.existsSync(RAW_DIR)) {
    console.error(`No cache at ${RAW_DIR}. Run without --offline first.`);
    process.exit(1);
  }
  fs.rmSync(SPEC_OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(SPEC_OUT_DIR, { recursive: true });

  const names = fs.readdirSync(RAW_DIR).filter((n) => n.toLowerCase().endsWith('.md'));
  const specs = names.map((n) => parseSpec(n, fs.readFileSync(path.join(RAW_DIR, n), 'utf8')));

  const used = new Set();
  for (const s of specs) {
    const base =
      [s.screenId, s.nameEn || s.nameJa].filter(Boolean).map(slugify).filter(Boolean).join('-') ||
      slugify(s.fileName);
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    s.slug = slug;
  }

  specs.sort((a, b) => {
    const [an, as] = sortKey(a.screenId);
    const [bn, bs] = sortKey(b.screenId);
    return an - bn || String(as).localeCompare(String(bs)) || a.fileName.localeCompare(b.fileName);
  });

  for (const s of specs) {
    fs.writeFileSync(path.join(SPEC_OUT_DIR, `${s.slug}.json`), JSON.stringify(s), 'utf8');
  }

  const index = {
    repo: REPO,
    branch: BRANCH,
    specPath: SPEC_PATH,
    generatedAt: new Date().toISOString(),
    specs: specs.map((s) => ({
      slug: s.slug,
      fileName: s.fileName,
      phase: s.phase,
      screenId: s.screenId,
      title: s.title,
      nameJa: s.nameJa,
      nameEn: s.nameEn,
      overview: s.overview.replace(/\s+/g, ' ').slice(0, 400),
      createdBy: s.createdBy,
      createdDate: s.createdDate,
      docNo: s.docNo,
      version: s.version,
      designUrl: s.designUrl,
      itemCount: s.itemCount,
      sectionTitles: s.sections.map((x) => x.title),
      mockupCount: s.mockups.length,
      historyCount: s.historyCount,
      lastChanged: s.lastChanged,
      bytes: s.bytes,
      sourceUrl: s.sourceUrl,
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf8');

  const totalItems = specs.reduce((a, s) => a + s.itemCount, 0);
  console.log(`Built ${specs.length} specs, ${totalItems} items -> public/data`);
  const colSets = new Set(specs.filter((s) => s.itemCount).map((s) => s.itemColumns.join(' | ')));
  console.log(`Distinct "Items" column layouts: ${colSets.size}`);
  for (const c of colSets) console.log(`  - ${c.slice(0, 160)}`);
  const missing = [...localImages].filter((rel) => !fs.existsSync(path.join(IMG_DIR, rel)));
  if (missing.length) console.log(`Missing local images (run sync online): ${missing.length}`);
  const noItems = specs.filter((s) => !s.itemCount).map((s) => s.fileName);
  if (noItems.length) console.log(`Specs without an Items table:\n  ${noItems.join('\n  ')}`);
}

if (!OFFLINE) {
  await download();
  if (!NO_IMAGES) await downloadImages();
}
build();
