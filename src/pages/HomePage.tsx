import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SpecIndex, SpecSummary } from '../types';
import { Highlighted, fold, formatBytes } from '../lib/text';
import { parseDate } from '../components/Sidebar';
import { downloadCsv } from '../lib/export';

type Key = 'screenId' | 'nameJa' | 'itemCount' | 'mockupCount' | 'lastChanged' | 'bytes';

const COLUMNS: { key: Key; label: string; numeric?: boolean }[] = [
  { key: 'screenId', label: 'Screen ID' },
  { key: 'nameJa', label: 'Tên màn hình' },
  { key: 'itemCount', label: 'Items', numeric: true },
  { key: 'mockupCount', label: 'Mockup', numeric: true },
  { key: 'lastChanged', label: 'Cập nhật' },
  { key: 'bytes', label: 'Dung lượng', numeric: true },
];

const idOrder = (id: string) => {
  const m = /^[A-Za-z]*-?(\d+)([a-z]*)/.exec(id || '');
  return m ? Number(m[1]) * 100 + (m[2] ? m[2].charCodeAt(0) - 96 : 0) : 99999;
};

export function HomePage({ index }: { index: SpecIndex }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'screenId', dir: 1 });

  const rows = useMemo(() => {
    const q = fold(query.trim());
    const list = index.specs.filter(
      (s) => !q || fold(`${s.screenId} ${s.nameJa} ${s.nameEn} ${s.overview} ${s.createdBy}`).includes(q)
    );
    const { key, dir } = sort;
    return [...list].sort((a, b) => {
      if (key === 'screenId') return (idOrder(a.screenId) - idOrder(b.screenId)) * dir;
      if (key === 'lastChanged') return (parseDate(a.lastChanged) - parseDate(b.lastChanged)) * dir;
      if (typeof a[key] === 'number') return ((a[key] as number) - (b[key] as number)) * dir;
      return String(a[key]).localeCompare(String(b[key]), 'ja') * dir;
    });
  }, [index.specs, query, sort]);

  const stats = useMemo(() => {
    const totalItems = index.specs.reduce((a, s) => a + s.itemCount, 0);
    const owners = new Set(index.specs.map((s) => s.createdBy).filter(Boolean));
    const latest = index.specs.reduce(
      (best, s) => (parseDate(s.lastChanged) > parseDate(best.lastChanged) ? s : best),
      index.specs[0]
    );
    return {
      totalItems,
      owners: owners.size,
      mockups: index.specs.reduce((a, s) => a + s.mockupCount, 0),
      latest,
    };
  }, [index.specs]);

  const toggleSort = (key: Key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  return (
    <div className="page home">
      <header className="page-head">
        <div>
          <h1>Đặc tả màn hình</h1>
          <p className="page-sub">
            {index.repo} · <code>{index.specPath}</code> · đồng bộ{' '}
            {new Date(index.generatedAt).toLocaleString('vi-VN')}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadCsv(
              'danh-sach-spec',
              ['Screen ID', 'Tên JP', 'Tên EN', 'Items', 'Mockup', 'Version', 'Người tạo', 'Cập nhật'],
              rows.map((s) => [
                s.screenId,
                s.nameJa,
                s.nameEn,
                String(s.itemCount),
                String(s.mockupCount),
                s.version,
                s.createdBy,
                s.lastChanged,
              ])
            )
          }
        >
          Xuất danh sách CSV
        </button>
      </header>

      <div className="stat-grid">
        <Stat value={index.specs.length} label="màn hình" />
        <Stat value={stats.totalItems} label="item đặc tả" />
        <Stat value={stats.mockups} label="ảnh mockup" />
        <Stat value={stats.owners} label="người biên soạn" />
        <Stat
          value={stats.latest?.lastChanged || '—'}
          label={`cập nhật gần nhất · ${stats.latest?.screenId ?? ''}`}
          small
        />
      </div>

      <div className="home-tools">
        <input
          className="home-search"
          placeholder="Tìm nhanh theo ID, tên màn hình, mô tả…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="is-dim">
          {rows.length}/{index.specs.length} màn hình
        </span>
      </div>

      <div className="home-table-wrap">
        <table className="home-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  className={c.numeric ? 'num' : ''}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {sort.key === c.key && <i className="sort">{sort.dir === 1 ? '▲' : '▼'}</i>}
                </th>
              ))}
              <th>Người tạo</th>
              <th>Version</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <SpecRow key={s.slug} spec={s} query={query} />
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="is-dim pad">Không có màn hình nào khớp “{query}”.</p>}
      </div>
    </div>
  );
}

function SpecRow({ spec, query }: { spec: SpecSummary; query: string }) {
  return (
    <tr>
      <td className="mono">
        <Link to={`/spec/${spec.slug}`} className="id-link">
          {spec.screenId || '—'}
        </Link>
      </td>
      <td>
        <Link to={`/spec/${spec.slug}`} className="name-link">
          <strong>
            <Highlighted text={spec.nameJa} query={query} />
          </strong>
          <span className="is-dim">
            <Highlighted text={spec.nameEn} query={query} />
          </span>
        </Link>
      </td>
      <td className="num">{spec.itemCount}</td>
      <td className="num">{spec.mockupCount}</td>
      <td className="mono">{spec.lastChanged || '—'}</td>
      <td className="num is-dim">{formatBytes(spec.bytes)}</td>
      <td className="is-dim">{spec.createdBy.replace('@sun-asterisk.com', '')}</td>
      <td className="mono is-dim">{spec.version || '—'}</td>
    </tr>
  );
}

function Stat({ value, label, small }: { value: number | string; label: string; small?: boolean }) {
  return (
    <div className="stat">
      <span className={`stat-value ${small ? 'is-small' : ''}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
