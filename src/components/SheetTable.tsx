import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStored } from '../lib/data';
import { CellText, fold, oneLine, toPlain } from '../lib/text';
import {
  copyText,
  downloadCsv,
  downloadJson,
  downloadMarkdown,
  toMarkdownTable,
  toTsv,
} from '../lib/export';
import { Check, Dropdown, Segmented, useDismiss, useToast } from './ui';
import { Markdown } from './Markdown';

type Density = 'compact' | 'cozy' | 'full';
type SortDir = 'asc' | 'desc';
type ColFilter = { text: string; values: string[] | null };

const DENSITY_ROWS: Record<Density, number> = { compact: 30, cozy: 92, full: 0 };

/** Column presets for the 20-column "Items" layout these specs share. */
const PRESETS: { id: string; label: string; columns: string[] }[] = [
  {
    id: 'basic',
    label: 'Cơ bản',
    columns: ['No', 'Item Name (Figma)', 'Name JP', 'Name EN/VN', 'Item Type', 'Description'],
  },
  {
    id: 'flow',
    label: 'Điều hướng',
    columns: ['No', 'Name JP', 'Name EN/VN', 'User Action', 'Destination', 'Transition Note'],
  },
  {
    id: 'validation',
    label: 'Dữ liệu & validate',
    columns: [
      'No',
      'Name JP',
      'Data type',
      'Required',
      'Format',
      'Min-Length/Size',
      'Max-Length/Size',
      'Default value',
      'Validation Note',
    ],
  },
  {
    id: 'db',
    label: 'Database',
    columns: ['No', 'Name JP', 'Name EN/VN', 'Table Name', 'Column Name', 'Database Note'],
  },
];

const NARROW = /^(no|required|data type|format|item type|min-|max-|default)/i;

function defaultWidth(header: string, samples: string[]): number {
  if (/^no$/i.test(header)) return 62;
  const avg = samples.length
    ? samples.reduce((a, s) => a + Math.min(s.length, 400), 0) / samples.length
    : 0;
  const longest = samples.reduce((a, s) => Math.max(a, s.split('\n')[0].length), 0);
  const est = 26 + Math.max(header.length * 7.6, Math.min(avg * 6.2, longest * 5.5));
  const cap = NARROW.test(header) ? 150 : 400;
  return Math.round(Math.max(96, Math.min(est, cap)));
}

export interface SheetTableProps {
  headers: string[];
  rows: string[][];
  /** Namespaces persisted layout (widths, hidden columns, density). */
  storageKey: string;
  exportName: string;
  /** Lets a caller decorate specific columns, e.g. turn "Destination" into links. */
  renderCell?: (ctx: { column: string; value: string; query: string }) => ReactNode | null;
  toolbarExtra?: ReactNode;
  /** Seeds the in-table find box, e.g. when arriving from global search. */
  initialQuery?: string;
}

export function SheetTable({
  headers,
  rows,
  storageKey,
  exportName,
  renderCell,
  toolbarExtra,
  initialQuery = '',
}: SheetTableProps) {
  const plain = useMemo(() => rows.map((r) => r.map(toPlain)), [rows]);
  const folded = useMemo(() => plain.map((r) => r.map(fold)), [plain]);

  const initialWidths = useMemo(
    () => headers.map((h, i) => defaultWidth(h, plain.map((r) => r[i] ?? ''))),
    [headers, plain]
  );

  const [widths, setWidths] = useStored<number[]>(`${storageKey}:widths`, initialWidths);
  const [hidden, setHidden] = useStored<string[]>(`${storageKey}:hidden`, []);
  const [density, setDensity] = useStored<Density>('sheet:density', 'cozy');
  const [freeze, setFreeze] = useStored<number>('sheet:freeze', 2);
  const [hideEmpty, setHideEmpty] = useStored<boolean>('sheet:hideEmpty', false);

  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null);
  const [filters, setFilters] = useState<Record<number, ColFilter>>({});
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // A stale persisted width array (spec changed shape) must not break layout.
  const colWidths = widths.length === headers.length ? widths : initialWidths;

  const emptyCols = useMemo(
    () => headers.map((_, i) => plain.every((r) => !(r[i] ?? '').trim())),
    [headers, plain]
  );

  const visible = useMemo(
    () =>
      headers
        .map((_, i) => i)
        .filter((i) => !hidden.includes(headers[i]) && !(hideEmpty && emptyCols[i])),
    [headers, hidden, hideEmpty, emptyCols]
  );

  /* ------------------------------------------------------------ filtering */

  const filteredRows = useMemo(() => {
    const q = fold(query.trim());
    const active_ = Object.entries(filters).filter(
      ([, f]) => f.text.trim() || (f.values && f.values.length)
    );
    const out: number[] = [];
    for (let r = 0; r < rows.length; r += 1) {
      if (q && !visible.some((c) => (folded[r][c] ?? '').includes(q))) continue;
      let ok = true;
      for (const [key, f] of active_) {
        const c = Number(key);
        if (f.text.trim() && !(folded[r][c] ?? '').includes(fold(f.text.trim()))) {
          ok = false;
          break;
        }
        if (f.values && !f.values.includes(plain[r][c] ?? '')) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(r);
    }
    return out;
  }, [rows.length, folded, plain, query, filters, visible]);

  const ordered = useMemo(() => {
    if (!sort) return filteredRows;
    const { col, dir } = sort;
    const sign = dir === 'asc' ? 1 : -1;
    return [...filteredRows].sort((a, b) => {
      const av = plain[a][col] ?? '';
      const bv = plain[b][col] ?? '';
      const an = Number(av.replace(',', '.'));
      const bn = Number(bv.replace(',', '.'));
      if (av !== '' && bv !== '' && !Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * sign;
      if (av === '') return 1;
      if (bv === '') return -1;
      return av.localeCompare(bv, 'ja') * sign;
    });
  }, [filteredRows, sort, plain]);

  const matchCount = useMemo(() => {
    if (!query.trim()) return 0;
    const q = fold(query.trim());
    let n = 0;
    for (const r of ordered) for (const c of visible) if ((folded[r][c] ?? '').includes(q)) n += 1;
    return n;
  }, [query, ordered, visible, folded]);

  /* --------------------------------------------------------------- layout */

  const leftOffsets = useMemo(() => {
    const map = new Map<number, number>();
    let x = 46; // row-number gutter
    visible.slice(0, freeze).forEach((c) => {
      map.set(c, x);
      x += colWidths[c];
    });
    return map;
  }, [visible, freeze, colWidths]);

  const totalWidth = useMemo(
    () => 46 + visible.reduce((a, c) => a + colWidths[c], 0),
    [visible, colWidths]
  );

  const resizing = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const onResizeStart = (col: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { col, startX: e.clientX, startW: colWidths[col] };
    const move = (ev: MouseEvent) => {
      const state = resizing.current;
      if (!state) return;
      const next = Math.max(56, Math.min(900, state.startW + ev.clientX - state.startX));
      setWidths((prev) => {
        const base = prev.length === headers.length ? [...prev] : [...initialWidths];
        base[state.col] = next;
        return base;
      });
    };
    const up = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const autoFit = (col: number) =>
    setWidths((prev) => {
      const base = prev.length === headers.length ? [...prev] : [...initialWidths];
      base[col] = defaultWidth(headers[col], plain.map((r) => r[col] ?? ''));
      return base;
    });

  const resetLayout = () => {
    setWidths(initialWidths);
    setHidden([]);
    setFilters({});
    setSort(null);
    setQuery('');
    setHideEmpty(false);
    toast.show('Đã đặt lại bố cục bảng');
  };

  /* ------------------------------------------------------------- keyboard */

  const move = useCallback(
    (dr: number, dc: number) => {
      setActive((cur) => {
        if (!cur) return { row: ordered[0] ?? 0, col: visible[0] ?? 0 };
        const rIdx = ordered.indexOf(cur.row);
        const cIdx = visible.indexOf(cur.col);
        const nr = Math.max(0, Math.min(ordered.length - 1, rIdx + dr));
        const nc = Math.max(0, Math.min(visible.length - 1, cIdx + dc));
        return { row: ordered[nr] ?? cur.row, col: visible[nc] ?? cur.col };
      });
    },
    [ordered, visible]
  );

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (!el.contains(target)) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          move(1, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          move(-1, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          move(0, 1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          move(0, -1);
          break;
        case 'Enter':
          if (active) {
            e.preventDefault();
            setDrawer(true);
          }
          break;
        case 'Escape':
          if (drawer) {
            e.preventDefault();
            setDrawer(false);
          }
          break;
        default:
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && active) {
            copyText(rows[active.row]?.[active.col] ?? '').then(() => toast.show('Đã copy ô'));
          }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move, active, drawer, rows, toast]);

  // Keep the keyboard cursor in view.
  useEffect(() => {
    if (!active) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${active.row}-${active.col}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFullscreen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [fullscreen]);

  /* --------------------------------------------------------------- export */

  const exportRows = () => ordered.map((r) => visible.map((c) => rows[r][c] ?? ''));
  const exportHeaders = () => visible.map((c) => headers[c]);

  const activeFilterCount =
    Object.values(filters).filter((f) => f.text.trim() || (f.values && f.values.length)).length +
    (hideEmpty ? 1 : 0);

  const rowHeight = DENSITY_ROWS[density];

  const grid = (
    <div
      className={`sheet ${fullscreen ? 'is-fullscreen' : ''}`}
      ref={gridRef}
      tabIndex={-1}
    >
      <div className="sheet-toolbar">
        <div className="find">
          <span className="find-icon">⌕</span>
          <input
            value={query}
            placeholder="Tìm trong bảng…"
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Tìm trong bảng"
          />
          {query && (
            <>
              <span className="find-count">{matchCount}</span>
              <button type="button" className="find-clear" onClick={() => setQuery('')}>
                ✕
              </button>
            </>
          )}
        </div>

        <Dropdown
          label={`Cột (${visible.length}/${headers.length})`}
          title="Ẩn/hiện cột"
          active={hidden.length > 0 || hideEmpty}
          width={290}
        >
          {() => (
            <div className="menu">
              <div className="menu-title">Bộ cột dựng sẵn</div>
              <div className="preset-row">
                <button type="button" className="chip" onClick={() => setHidden([])}>
                  Tất cả
                </button>
                {PRESETS.filter((p) => p.columns.every((c) => headers.includes(c))).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="chip"
                    onClick={() => setHidden(headers.filter((h) => !p.columns.includes(h)))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <Check checked={hideEmpty} onChange={setHideEmpty}>
                Ẩn cột rỗng ({emptyCols.filter(Boolean).length})
              </Check>
              <div className="menu-sep" />
              <div className="menu-scroll">
                {headers.map((h, i) => (
                  <Check
                    key={h + i}
                    checked={!hidden.includes(h)}
                    onChange={(on) =>
                      setHidden((prev) => (on ? prev.filter((x) => x !== h) : [...prev, h]))
                    }
                  >
                    <span className={emptyCols[i] ? 'is-dim' : ''}>{h || `Cột ${i + 1}`}</span>
                  </Check>
                ))}
              </div>
            </div>
          )}
        </Dropdown>

        <Segmented<Density>
          value={density}
          onChange={setDensity}
          title="Chiều cao dòng"
          options={[
            { value: 'compact', label: '≡', title: 'Gọn — 1 dòng' },
            { value: 'cozy', label: '☰', title: 'Vừa — tối đa 4 dòng' },
            { value: 'full', label: '▤', title: 'Đầy đủ — hiện hết nội dung' },
          ]}
        />

        <Segmented<string>
          value={String(freeze)}
          onChange={(v) => setFreeze(Number(v))}
          title="Số cột ghim bên trái"
          options={[
            { value: '0', label: '0', title: 'Không ghim cột' },
            { value: '1', label: '1', title: 'Ghim 1 cột' },
            { value: '2', label: '2', title: 'Ghim 2 cột' },
            { value: '3', label: '3', title: 'Ghim 3 cột' },
          ]}
        />

        <Dropdown label="Xuất ▾" title="Xuất dữ liệu đang hiển thị" align="right" width={230}>
          {(close) => (
            <div className="menu">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  downloadCsv(exportName, exportHeaders(), exportRows());
                  close();
                }}
              >
                Tải CSV (Excel/Sheets)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={async () => {
                  await copyText(toTsv(exportHeaders(), exportRows()));
                  toast.show('Đã copy — dán thẳng vào Google Sheets');
                  close();
                }}
              >
                Copy bảng (dán vào Sheets)
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  downloadMarkdown(exportName, toMarkdownTable(exportHeaders(), exportRows()));
                  close();
                }}
              >
                Tải Markdown
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  downloadJson(
                    exportName,
                    exportRows().map((r) =>
                      Object.fromEntries(exportHeaders().map((h, i) => [h, toPlain(r[i])]))
                    )
                  );
                  close();
                }}
              >
                Tải JSON
              </button>
            </div>
          )}
        </Dropdown>

        {toolbarExtra}

        <div className="toolbar-spacer" />

        <span className="row-count">
          {ordered.length === rows.length
            ? `${rows.length} mục`
            : `${ordered.length}/${rows.length} mục`}
          {activeFilterCount > 0 && <em> · {activeFilterCount} bộ lọc</em>}
        </span>

        {(activeFilterCount > 0 || sort || hidden.length > 0 || query) && (
          <button type="button" className="btn" onClick={resetLayout} title="Xoá lọc, sắp xếp, cột">
            Đặt lại
          </button>
        )}

        <button
          type="button"
          className={`btn ${fullscreen ? 'is-active' : ''}`}
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? 'Thoát toàn màn hình (Esc)' : 'Xem toàn màn hình'}
        >
          {fullscreen ? '⤡ Thoát' : '⤢ Toàn màn hình'}
        </button>
      </div>

      <div className={`sheet-scroll density-${density}`} ref={scrollRef}>
        <table style={{ width: totalWidth }}>
          <colgroup>
            <col style={{ width: 46 }} />
            {visible.map((c) => (
              <col key={c} style={{ width: colWidths[c] }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="gutter is-frozen" style={{ left: 0 }}>
                #
              </th>
              {visible.map((c, vi) => {
                const isFrozen = vi < freeze;
                const f = filters[c];
                const hasFilter = !!(f && (f.text.trim() || (f.values && f.values.length)));
                return (
                  <th
                    key={c}
                    className={`${isFrozen ? 'is-frozen' : ''} ${
                      active?.col === c ? 'is-col-active' : ''
                    }`}
                    style={isFrozen ? { left: leftOffsets.get(c) } : undefined}
                  >
                    <div className="th-inner">
                      <button
                        type="button"
                        className="th-label"
                        title={`${headers[c]} — bấm để sắp xếp`}
                        onClick={() =>
                          setSort((s) =>
                            !s || s.col !== c
                              ? { col: c, dir: 'asc' }
                              : s.dir === 'asc'
                                ? { col: c, dir: 'desc' }
                                : null
                          )
                        }
                      >
                        <span>{headers[c] || `Cột ${c + 1}`}</span>
                        {sort?.col === c && <i className="sort">{sort.dir === 'asc' ? '▲' : '▼'}</i>}
                      </button>
                      <ColumnFilter
                        header={headers[c]}
                        values={plain.map((r) => r[c] ?? '')}
                        rowIds={filteredRows}
                        filter={f}
                        active={hasFilter}
                        onChange={(next) =>
                          setFilters((prev) => {
                            const copy = { ...prev };
                            if (!next) delete copy[c];
                            else copy[c] = next;
                            return copy;
                          })
                        }
                        onHide={() => setHidden((prev) => [...prev, headers[c]])}
                        onAutoFit={() => autoFit(c)}
                      />
                    </div>
                    <span className="col-resizer" onMouseDown={onResizeStart(c)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.map((r, i) => (
              <tr key={r} className={active?.row === r ? 'is-row-active' : ''}>
                <td className="gutter is-frozen" style={{ left: 0 }} title={`Dòng gốc ${r + 1}`}>
                  {i + 1}
                </td>
                {visible.map((c, vi) => {
                  const isFrozen = vi < freeze;
                  const raw = rows[r][c] ?? '';
                  const custom = renderCell?.({ column: headers[c], value: raw, query });
                  return (
                    <td
                      key={c}
                      data-cell={`${r}-${c}`}
                      className={`${isFrozen ? 'is-frozen' : ''} ${
                        active?.row === r && active?.col === c ? 'is-active' : ''
                      } ${active?.col === c ? 'is-col-active' : ''}`}
                      style={isFrozen ? { left: leftOffsets.get(c) } : undefined}
                      onClick={() => setActive({ row: r, col: c })}
                      onDoubleClick={() => {
                        setActive({ row: r, col: c });
                        setDrawer(true);
                      }}
                    >
                      <div
                        className="cell"
                        style={rowHeight ? { maxHeight: rowHeight } : undefined}
                      >
                        {custom ?? <CellText value={raw} query={query} />}
                      </div>
                      {rowHeight > 0 && toPlain(raw).length > 60 && (
                        <button
                          type="button"
                          className="cell-more"
                          title="Xem đầy đủ (Enter)"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActive({ row: r, col: c });
                            setDrawer(true);
                          }}
                        >
                          ⤢
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {!ordered.length && (
              <tr>
                <td className="no-rows" colSpan={visible.length + 1}>
                  Không có dòng nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {drawer && active && (
        <CellDrawer
          header={headers[active.col]}
          value={rows[active.row]?.[active.col] ?? ''}
          rowLabel={`Dòng ${ordered.indexOf(active.row) + 1}/${ordered.length}`}
          rowSummary={headers
            .map((h, i) => ({ h, v: toPlain(rows[active.row]?.[i] ?? '') }))
            .filter((x) => x.v)}
          onClose={() => setDrawer(false)}
          onPrev={() => move(-1, 0)}
          onNext={() => move(1, 0)}
          onCopy={async () => {
            await copyText(rows[active.row]?.[active.col] ?? '');
            toast.show('Đã copy nội dung ô');
          }}
        />
      )}

      {toast.node}
    </div>
  );

  return fullscreen ? <div className="fullscreen-layer">{grid}</div> : grid;
}

/* ---------------------------------------------------------- column filter */

function ColumnFilter({
  header,
  values,
  rowIds,
  filter,
  active,
  onChange,
  onHide,
  onAutoFit,
}: {
  header: string;
  values: string[];
  rowIds: number[];
  filter?: ColFilter;
  active: boolean;
  onChange: (next: ColFilter | null) => void;
  onHide: () => void;
  onAutoFit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const [search, setSearch] = useState('');

  // Distinct values, ranked by how often they appear in the current result set.
  const distinct = useMemo(() => {
    if (!open) return [];
    const counts = new Map<string, number>();
    const inView = new Set(rowIds);
    values.forEach((v, i) => {
      const key = v.trim();
      if (key.length > 120) return; // free-text column: value picker is useless
      counts.set(key, (counts.get(key) ?? 0) + (inView.has(i) ? 1 : 0));
    });
    return [...counts.entries()]
      .filter(([v]) => !search || fold(v).includes(fold(search)))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
      .slice(0, 300);
  }, [open, values, rowIds, search]);

  const selected = filter?.values ?? null;

  const toggleValue = (value: string, on: boolean) => {
    const all = distinct.map(([v]) => v);
    const base = selected ?? all;
    const next = on ? [...new Set([...base, value])] : base.filter((v) => v !== value);
    onChange({
      text: filter?.text ?? '',
      values: next.length === all.length ? null : next,
    });
  };

  return (
    <div className="th-menu" ref={ref}>
      <button
        type="button"
        className={`th-menu-btn ${active ? 'is-active' : ''}`}
        title="Lọc cột"
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open && (
        <div className="dd-panel th-panel">
          <div className="menu">
            <div className="menu-title">{header || 'Cột'}</div>
            <input
              className="menu-input"
              placeholder="Chứa văn bản…"
              value={filter?.text ?? ''}
              onChange={(e) => {
                const text = e.target.value;
                onChange(text || filter?.values?.length ? { text, values: selected } : null);
              }}
            />
            {distinct.length > 1 && (
              <>
                <div className="menu-sep" />
                <input
                  className="menu-input"
                  placeholder="Tìm giá trị…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="menu-row">
                  <button
                    type="button"
                    className="chip"
                    onClick={() => onChange({ text: filter?.text ?? '', values: null })}
                  >
                    Chọn tất cả
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => onChange({ text: filter?.text ?? '', values: [] })}
                  >
                    Bỏ chọn
                  </button>
                </div>
                <div className="menu-scroll">
                  {distinct.map(([value, count]) => (
                    <Check
                      key={value}
                      checked={!selected || selected.includes(value)}
                      onChange={(on) => toggleValue(value, on)}
                    >
                      <span className="filter-value" title={value || '(trống)'}>
                        {value ? oneLine(value, 60) : <em>(trống)</em>}
                      </span>
                      <span className="filter-count">{count}</span>
                    </Check>
                  ))}
                </div>
              </>
            )}
            <div className="menu-sep" />
            <div className="menu-row">
              <button type="button" className="chip" onClick={onAutoFit}>
                Vừa nội dung
              </button>
              <button type="button" className="chip" onClick={onHide}>
                Ẩn cột
              </button>
              {active && (
                <button type="button" className="chip" onClick={() => onChange(null)}>
                  Xoá lọc
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ cell drawer */

function CellDrawer({
  header,
  value,
  rowLabel,
  rowSummary,
  onClose,
  onPrev,
  onNext,
  onCopy,
}: {
  header: string;
  value: string;
  rowLabel: string;
  rowSummary: { h: string; v: string }[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCopy: () => void;
}) {
  return (
    <aside className="drawer">
      <header className="drawer-head">
        <div>
          <span className="drawer-col">{header}</span>
          <span className="drawer-row">{rowLabel}</span>
        </div>
        <div className="drawer-actions">
          <button type="button" className="btn" onClick={onPrev} title="Dòng trước (↑)">
            ↑
          </button>
          <button type="button" className="btn" onClick={onNext} title="Dòng sau (↓)">
            ↓
          </button>
          <button type="button" className="btn" onClick={onCopy} title="Copy nội dung">
            Copy
          </button>
          <button type="button" className="btn" onClick={onClose} title="Đóng (Esc)">
            ✕
          </button>
        </div>
      </header>
      <div className="drawer-body">
        {value.trim() ? <Markdown text={value} /> : <p className="is-dim">(ô trống)</p>}
        <details className="drawer-context">
          <summary>Toàn bộ dòng ({rowSummary.length} trường)</summary>
          <dl>
            {rowSummary.map((x) => (
              <div key={x.h}>
                <dt>{x.h}</dt>
                <dd>{x.v}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </aside>
  );
}
