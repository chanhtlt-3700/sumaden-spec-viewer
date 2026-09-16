import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Spec, SpecSummary } from '../types';
import { itemsTable, loadAllSpecs } from '../lib/data';
import { Highlighted, fold, oneLine } from '../lib/text';

interface ItemHit {
  slug: string;
  screenId: string;
  specName: string;
  no: string;
  label: string;
  type: string;
  haystack: string;
  snippetSource: string;
}

function buildItemIndex(specs: Spec[]): ItemHit[] {
  const out: ItemHit[] = [];
  for (const spec of specs) {
    const table = itemsTable(spec);
    if (!table) continue;
    const col = (name: string) => table.headers.findIndex((h) => h === name);
    const iNo = col('No');
    const iJp = col('Name JP');
    const iEn = col('Name EN/VN');
    const iFigma = col('Item Name (Figma)');
    const iType = col('Item Type');
    for (const row of table.rows) {
      const label =
        [iJp, iEn, iFigma].map((i) => (i >= 0 ? row[i] : '')).find((v) => v && v.trim()) ?? '';
      const joined = row.join(' · ');
      out.push({
        slug: spec.slug,
        screenId: spec.screenId || spec.nameJa,
        specName: `${spec.nameJa} ${spec.nameEn}`.trim(),
        no: iNo >= 0 ? row[iNo] : '',
        label: oneLine(label, 70),
        type: iType >= 0 ? oneLine(row[iType], 24) : '',
        haystack: fold(joined),
        snippetSource: joined,
      });
    }
  }
  return out;
}

function snippet(source: string, query: string): string {
  const at = fold(source).indexOf(fold(query));
  if (at < 0) return oneLine(source, 120);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? '…' : ''}${oneLine(source.slice(start, at + query.length + 90), 160)}`;
}

export function CommandPalette({
  open,
  onClose,
  specs,
}: {
  open: boolean;
  onClose: () => void;
  specs: SpecSummary[];
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<ItemHit[] | null>(null);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Item-level search needs every spec body, so pull them on first open.
  useEffect(() => {
    if (!open || items) return;
    let alive = true;
    loadAllSpecs((done, total) => alive && setProgress(Math.round((done / total) * 100)))
      .then((all) => alive && setItems(buildItemIndex(all)))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [open, items]);

  useEffect(() => {
    if (open) {
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const specHits = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return specs.slice(0, 8);
    return specs
      .filter((s) => fold(`${s.screenId} ${s.nameJa} ${s.nameEn} ${s.overview}`).includes(q))
      .slice(0, 8);
  }, [specs, query]);

  const itemHits = useMemo(() => {
    const q = fold(query.trim());
    if (!q || q.length < 2 || !items) return [];
    return items.filter((i) => i.haystack.includes(q)).slice(0, 40);
  }, [items, query]);

  const results = useMemo(
    () => [
      ...specHits.map((s) => ({ kind: 'spec' as const, spec: s })),
      ...itemHits.map((i) => ({ kind: 'item' as const, item: i })),
    ],
    [specHits, itemHits]
  );

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelectorAll('.result')
      [cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  if (!open) return null;

  const go = (index: number) => {
    const r = results[index];
    if (!r) return;
    const target =
      r.kind === 'spec'
        ? `/spec/${r.spec.slug}`
        : `/spec/${r.item.slug}?q=${encodeURIComponent(query)}&item=${encodeURIComponent(r.item.no)}`;
    navigate(target);
    onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Tìm màn hình, item, mô tả, tên cột DB…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(results.length - 1, c + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(cursor);
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />

        <div className="palette-status">
          {items === null
            ? `Đang nạp dữ liệu item… ${progress}%`
            : `${specHits.length} màn hình · ${itemHits.length} item khớp · tổng ${items.length} item`}
        </div>

        <div className="palette-list" ref={listRef}>
          {specHits.length > 0 && <div className="palette-group">Màn hình</div>}
          {specHits.map((s, i) => (
            <button
              type="button"
              key={s.slug}
              className={`result ${cursor === i ? 'is-cursor' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(i)}
            >
              <span className="result-id">{s.screenId || '—'}</span>
              <span className="result-main">
                <strong>
                  <Highlighted text={s.nameJa} query={query} />
                </strong>
                <span className="result-sub">
                  <Highlighted text={s.nameEn} query={query} />
                </span>
              </span>
              <span className="result-tag">{s.itemCount} item</span>
            </button>
          ))}

          {itemHits.length > 0 && <div className="palette-group">Item trong spec</div>}
          {itemHits.map((it, i) => {
            const index = specHits.length + i;
            return (
              <button
                type="button"
                key={`${it.slug}-${it.no}-${i}`}
                className={`result ${cursor === index ? 'is-cursor' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => go(index)}
              >
                <span className="result-id">{it.screenId}</span>
                <span className="result-main">
                  <strong>
                    {it.no && <em className="result-no">#{it.no}</em>}
                    <Highlighted text={it.label} query={query} />
                  </strong>
                  <span className="result-sub">
                    <Highlighted text={snippet(it.snippetSource, query)} query={query} />
                  </span>
                </span>
                {it.type && <span className="result-tag">{it.type}</span>}
              </button>
            );
          })}

          {!results.length && query && items !== null && (
            <p className="palette-empty">Không tìm thấy kết quả cho “{query}”.</p>
          )}
        </div>

        <footer className="palette-foot">
          <span>↑↓ di chuyển</span>
          <span>↵ mở</span>
          <span>Esc đóng</span>
        </footer>
      </div>
    </div>
  );
}
