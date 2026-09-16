/**
 * Markdown -> Spec parser, shared by the Node sync script and the browser.
 *
 * Plain ESM with no platform APIs, so live mode can re-parse a file that just
 * changed on GitHub using exactly the same code that built the static JSON.
 */

/* ------------------------------------------------------------------ tables */

export function splitRow(line) {
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
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const isTableRow = (line) => line.trim().startsWith('|');
const IMAGE_ONLY = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/;

/* ------------------------------------------------------------------ blocks */

/** Split raw section text into typed blocks: table | images | markdown. */
function parseBlocks(lines, onLocalImage) {
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

    if (IMAGE_ONLY.test(line)) {
      flushText();
      const images = [];
      let j = i;
      for (; j < lines.length; j += 1) {
        const m = lines[j].match(IMAGE_ONLY);
        if (m) images.push({ alt: m[1], url: resolveImage(m[2], onLocalImage) });
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

/** Repo-relative image paths become assets under public/spec-images. */
function resolveImage(url, onLocalImage) {
  if (/^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('/')) return url;
  const clean = url.replace(/^\.\//, '').replace(/^images\//, '');
  onLocalImage?.(clean);
  return `spec-images/${clean}`;
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

/* ------------------------------------------------------------------ naming */

export const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);

/** "S-49b" -> sortable key so S-2 < S-12 and S-49a < S-49b. */
export function sortKey(screenId) {
  const m = /^[A-Za-z]*-?(\d+)([a-z]*)/.exec(screenId || '');
  if (!m) return [9999, screenId || ''];
  return [Number(m[1]), m[2] || ''];
}

const byteLength = (text) => new TextEncoder().encode(text).length;

/* ------------------------------------------------------------------- spec */

/**
 * @param {string} fileName  e.g. "[P2] [S-01] 伝票種別選択 - Receipt Type Selection.md"
 * @param {string} markdown  raw file contents
 * @param {{repo:string, branch:string, specPath:string}} source
 */
export function parseSpec(fileName, markdown, source) {
  const localImages = [];
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
  const onLocalImage = (rel) => localImages.push(rel);
  const sections = rawSections.map((s) => {
    const base = slugify(s.title) || 'section';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return { id, level: s.level, title: s.title, blocks: parseBlocks(s.lines, onLocalImage) };
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
    bytes: byteLength(markdown),
    localImages,
    sourceUrl: `https://github.com/${source.repo}/blob/${source.branch}/${source.specPath}/${encodeURIComponent(fileName)}`,
  };
}

/** Deterministic slug for one spec; `taken` guards against collisions. */
export function makeSlug(spec, taken = new Set()) {
  const base =
    [spec.screenId, spec.nameEn || spec.nameJa].filter(Boolean).map(slugify).filter(Boolean).join('-') ||
    slugify(spec.fileName);
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  return slug;
}

export function sortSpecs(specs) {
  return [...specs].sort((a, b) => {
    const [an, as] = sortKey(a.screenId);
    const [bn, bs] = sortKey(b.screenId);
    return an - bn || String(as).localeCompare(String(bs)) || a.fileName.localeCompare(b.fileName);
  });
}

/** The lightweight row stored in index.json. */
export function summarize(spec) {
  return {
    slug: spec.slug,
    fileName: spec.fileName,
    phase: spec.phase,
    screenId: spec.screenId,
    title: spec.title,
    nameJa: spec.nameJa,
    nameEn: spec.nameEn,
    overview: spec.overview.replace(/\s+/g, ' ').slice(0, 400),
    createdBy: spec.createdBy,
    createdDate: spec.createdDate,
    docNo: spec.docNo,
    version: spec.version,
    designUrl: spec.designUrl,
    itemCount: spec.itemCount,
    sectionTitles: spec.sections.map((x) => x.title),
    mockupCount: spec.mockups.length,
    historyCount: spec.historyCount,
    lastChanged: spec.lastChanged,
    bytes: spec.bytes,
    sourceUrl: spec.sourceUrl,
  };
}
