import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { SpecSummary } from '../types';
import { Highlighted, fold } from '../lib/text';
import { useStored } from '../lib/data';

type SortMode = 'id' | 'name' | 'items' | 'updated';

export function Sidebar({
  specs,
  collapsed,
  onToggle,
}: {
  specs: SpecSummary[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useStored<SortMode>('sidebar:sort', 'id');
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [favs, setFavs] = useStored<string[]>('favorites', []);

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    let list = specs.filter(
      (s) =>
        !q ||
        fold(`${s.screenId} ${s.nameJa} ${s.nameEn} ${s.fileName} ${s.overview}`).includes(q)
    );
    if (onlyFavs) list = list.filter((s) => favs.includes(s.slug));
    if (sortMode === 'name') list = [...list].sort((a, b) => a.nameJa.localeCompare(b.nameJa, 'ja'));
    if (sortMode === 'items') list = [...list].sort((a, b) => b.itemCount - a.itemCount);
    if (sortMode === 'updated')
      list = [...list].sort((a, b) => parseDate(b.lastChanged) - parseDate(a.lastChanged));
    return list;
  }, [specs, query, sortMode, onlyFavs, favs]);

  if (collapsed) {
    return (
      <aside className="sidebar is-collapsed">
        <button type="button" className="collapse-btn" onClick={onToggle} title="Mở danh sách spec">
          ›
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <input
          className="sidebar-search"
          placeholder="Lọc màn hình…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Lọc danh sách màn hình"
        />
        <button type="button" className="collapse-btn" onClick={onToggle} title="Thu gọn">
          ‹
        </button>
      </div>

      <div className="sidebar-tools">
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          aria-label="Sắp xếp"
        >
          <option value="id">Theo Screen ID</option>
          <option value="name">Theo tên</option>
          <option value="items">Nhiều item nhất</option>
          <option value="updated">Cập nhật gần nhất</option>
        </select>
        <button
          type="button"
          className={`chip ${onlyFavs ? 'is-on' : ''}`}
          onClick={() => setOnlyFavs((v) => !v)}
          title="Chỉ hiện spec đã ghim"
        >
          ★ {favs.length}
        </button>
      </div>

      <nav className="spec-list">
        {filtered.map((s) => (
          <NavLink
            key={s.slug}
            to={`/spec/${s.slug}`}
            className={({ isActive }) => `spec-link ${isActive ? 'is-active' : ''}`}
          >
            <span className="spec-id">{s.screenId || '—'}</span>
            <span className="spec-names">
              <span className="spec-ja">
                <Highlighted text={s.nameJa} query={query} />
              </span>
              <span className="spec-en">
                <Highlighted text={s.nameEn} query={query} />
              </span>
            </span>
            <span className="spec-meta">{s.itemCount}</span>
            <button
              type="button"
              className={`fav ${favs.includes(s.slug) ? 'is-on' : ''}`}
              title={favs.includes(s.slug) ? 'Bỏ ghim' : 'Ghim spec'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setFavs((prev) =>
                  prev.includes(s.slug) ? prev.filter((x) => x !== s.slug) : [...prev, s.slug]
                );
              }}
            >
              ★
            </button>
          </NavLink>
        ))}
        {!filtered.length && <p className="sidebar-empty">Không có spec nào khớp.</p>}
      </nav>

      <footer className="sidebar-foot">
        {filtered.length}/{specs.length} màn hình
      </footer>
    </aside>
  );
}

/** Dates in these docs are dd/mm/yyyy. */
export function parseDate(value: string): number {
  const m = value?.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!m) return 0;
  const year = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
  return new Date(year, Number(m[2]) - 1, Number(m[1])).getTime();
}
