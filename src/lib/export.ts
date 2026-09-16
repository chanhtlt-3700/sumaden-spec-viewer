import { toPlain } from './text';

function download(name: string, mime: string, body: BlobPart) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string) => `"${toPlain(v).replace(/"/g, '""')}"`;

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  // BOM keeps Excel from mangling Japanese/Vietnamese text.
  return `﻿${lines.join('\r\n')}`;
}

export const downloadCsv = (name: string, headers: string[], rows: string[][]) =>
  download(`${name}.csv`, 'text/csv;charset=utf-8', toCsv(headers, rows));

export const downloadJson = (name: string, data: unknown) =>
  download(`${name}.json`, 'application/json', JSON.stringify(data, null, 2));

export const downloadMarkdown = (name: string, text: string) =>
  download(`${name}.md`, 'text/markdown;charset=utf-8', text);

/** TSV, so a paste lands in Google Sheets / Excel as real cells. */
export function toTsv(headers: string[], rows: string[][]): string {
  const cell = (v: string) => toPlain(v).replace(/\t/g, ' ').replace(/\n/g, ' • ');
  return [headers.map(cell).join('\t'), ...rows.map((r) => r.map(cell).join('\t'))].join('\n');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs a secure context; fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Rebuild a GitHub-flavoured markdown table from the visible rows/columns. */
export function toMarkdownTable(headers: string[], rows: string[][]): string {
  const esc = (v: string) => v.replace(/\|/g, '\\|');
  return [
    `| ${headers.map(esc).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}
