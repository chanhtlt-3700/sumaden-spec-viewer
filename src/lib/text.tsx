import type { ReactNode } from 'react';
import { Fragment } from 'react';

/* --------------------------------------------------------------- folding */

const SPECIAL: Record<string, string> = { đ: 'd', Đ: 'd', ð: 'd', ø: 'o', Ø: 'o', ß: 'ss' };

/**
 * Lowercase + strip diacritics, one output char per input char so match
 * offsets stay usable for highlighting. Vietnamese "ệ" -> "e", "Đ" -> "d".
 */
export function fold(input: string): string {
  let out = '';
  for (const ch of input) {
    if (ch < '') {
      out += ch.toLowerCase();
      continue;
    }
    const special = SPECIAL[ch];
    if (special) {
      out += special[0];
      continue;
    }
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += (base || ch).toLowerCase()[0] ?? ch;
  }
  return out;
}

/** Match positions of `query` inside `text`, diacritic- and case-insensitive. */
export function findMatches(text: string, query: string): [number, number][] {
  if (!query) return [];
  const haystack = fold(text);
  const needle = fold(query);
  if (!needle) return [];
  const spans: [number, number][] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    spans.push([at, at + needle.length]);
    from = at + needle.length;
  }
  return spans;
}

export const matches = (text: string, query: string) =>
  !query || fold(text).includes(fold(query));

/* ------------------------------------------------------------ cell text */

/** Markdown cell source -> plain text (for search, export, sorting). */
export function toPlain(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .trim();
}

/** Single-line preview used in tight rows and search results. */
export const oneLine = (cell: string, max = 220) => {
  const flat = toPlain(cell).replace(/\n+/g, ' · ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/* -------------------------------------------------------------- rendering */

const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;

function highlight(text: string, query: string, keyPrefix: string): ReactNode[] {
  const spans = findMatches(text, query);
  if (!spans.length) return [text];
  const out: ReactNode[] = [];
  let cursor = 0;
  spans.forEach(([start, end], i) => {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(
      <mark key={`${keyPrefix}-m${i}`} className="hl">
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function inline(text: string, query: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...highlight(text.slice(last, at), query, `${keyPrefix}-t${i}`));
    const token = m[0];
    const key = `${keyPrefix}-i${i++}`;
    if (token.startsWith('`')) {
      out.push(
        <code key={key}>{highlight(token.slice(1, -1), query, key)}</code>
      );
    } else if (token.startsWith('[')) {
      const cut = token.indexOf('](');
      const label = token.slice(1, cut);
      const href = token.slice(cut + 2, -1);
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {highlight(label, query, key)}
        </a>
      );
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{highlight(token.slice(2, -2), query, key)}</strong>);
    } else {
      out.push(<em key={key}>{highlight(token.slice(1, -1), query, key)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(...highlight(text.slice(last), query, `${keyPrefix}-tail`));
  return out;
}

/**
 * Cell renderer: keeps `<br>` line breaks and bullet structure, applies inline
 * markdown and search highlighting. Deliberately lighter than react-markdown,
 * which is far too slow across thousands of cells.
 */
export function CellText({ value, query = '' }: { value: string; query?: string }) {
  const lines = value.replace(/<br\s*\/?>/gi, '\n').replace(/&nbsp;/gi, ' ').split('\n');
  const trimmed = lines.map((l) => l.trimEnd());
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  while (trimmed.length && trimmed[0].trim() === '') trimmed.shift();

  return (
    <>
      {trimmed.map((line, i) => {
        const bullet = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          const depth = Math.min(3, Math.floor(bullet[1].length / 2));
          return (
            <span key={i} className="cell-line cell-bullet" style={{ paddingLeft: depth * 12 }}>
              <span className="cell-dot">{/^\d/.test(bullet[2]) ? bullet[2] : '•'}</span>
              <span>{inline(bullet[3], query, `l${i}`)}</span>
            </span>
          );
        }
        if (line.trim() === '') return <span key={i} className="cell-gap" />;
        return (
          <span key={i} className="cell-line">
            {inline(line, query, `l${i}`)}
          </span>
        );
      })}
    </>
  );
}

/** Inline text with highlighting only — for headers, names, list rows. */
export function Highlighted({ text, query = '' }: { text: string; query?: string }) {
  return <Fragment>{highlight(text, query, 'h')}</Fragment>;
}

export const formatBytes = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
