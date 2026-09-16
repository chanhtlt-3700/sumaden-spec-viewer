import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Block, Spec, SpecIndex, TableBlock } from '../types';
import { loadAllSpecs, screenRefs, useSpec, useStored } from '../lib/data';
import { CellText, Highlighted, formatBytes, toPlain } from '../lib/text';
import { copyText, downloadMarkdown } from '../lib/export';
import { Empty, Spinner, useToast } from '../components/ui';
import { Markdown } from '../components/Markdown';
import { Mockups } from '../components/Mockups';
import { SheetTable } from '../components/SheetTable';

const SCREEN_REF = /(S-\d{1,3}[a-z]?)/gi;

export function SpecPage({ index }: { index: SpecIndex }) {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const state = useSpec(slug);
  const toast = useToast();
  const [favs, setFavs] = useStored<string[]>('favorites', []);
  const [activeSection, setActiveSection] = useState<string>('');

  const initialQuery = params.get('q') ?? '';

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [slug]);

  const slugByScreenId = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of index.specs) if (s.screenId) map.set(s.screenId.toUpperCase(), s.slug);
    return map;
  }, [index.specs]);

  // Track which section is in view for the sticky section nav.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActiveSection(visible.target.id);
      },
      { rootMargin: '-96px 0px -70% 0px' }
    );
    document.querySelectorAll('.spec-section').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [state.status, slug]);

  if (state.status === 'loading') return <Spinner label="Đang tải spec…" />;
  if (state.status === 'error')
    return <Empty title="Không tải được spec" hint={state.error.message} />;

  const spec = state.data;
  const pinned = favs.includes(spec.slug);
  const refs = screenRefs(spec);

  const renderCell = ({ column, value, query }: { column: string; value: string; query: string }) => {
    if (column !== 'Destination' || !value.trim()) return null;
    const parts = toPlain(value).split(SCREEN_REF).filter(Boolean);
    return (
      <span className="dest-cell">
        {parts.map((part, i) => {
          const target = slugByScreenId.get(part.toUpperCase());
          return target ? (
            <Link key={i} className="screen-chip" to={`/spec/${target}`}>
              {part}
            </Link>
          ) : (
            <span key={i}>
              <Highlighted text={part} query={query} />
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="page spec-page">
      <header className="spec-head">
        <div className="spec-title">
          <span className="spec-badge">{spec.screenId || 'No ID'}</span>
          <div>
            <h1>{spec.nameJa}</h1>
            <p className="page-sub">{spec.nameEn || spec.title}</p>
          </div>
        </div>

        <div className="spec-actions">
          <button
            type="button"
            className={`btn ${pinned ? 'is-active' : ''}`}
            onClick={() =>
              setFavs((prev) =>
                prev.includes(spec.slug) ? prev.filter((x) => x !== spec.slug) : [...prev, spec.slug]
              )
            }
          >
            {pinned ? '★ Đã ghim' : '☆ Ghim'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await copyText(window.location.href);
              toast.show('Đã copy link màn hình này');
            }}
          >
            Copy link
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => downloadMarkdown(spec.slug, rebuildMarkdown(spec))}
            title="Tải lại file markdown gốc"
          >
            Tải .md
          </button>
          {spec.designUrl && (
            <a className="btn" href={spec.designUrl} target="_blank" rel="noreferrer">
              Figma ↗
            </a>
          )}
          <a className="btn" href={spec.sourceUrl} target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
        </div>
      </header>

      <dl className="spec-meta-grid">
        {spec.phase && <Meta label="Phase" value={spec.phase} />}
        {spec.version && <Meta label="Version" value={spec.version} />}
        {spec.docNo && <Meta label="Doc No" value={spec.docNo} mono />}
        <Meta label="Người tạo" value={spec.createdBy.replace('@sun-asterisk.com', '')} />
        <Meta label="Ngày tạo" value={spec.createdDate || '—'} />
        <Meta label="Cập nhật" value={spec.lastChanged || '—'} />
        <Meta label="Số item" value={String(spec.itemCount)} />
        <Meta label="Kích thước" value={formatBytes(spec.bytes)} />
      </dl>

      <nav className="section-nav">
        {spec.overview && (
          <a className={activeSection === 'overview' ? 'is-on' : ''} href="#overview">
            Tổng quan
          </a>
        )}
        {spec.sections.map((s) => (
          <a key={s.id} className={activeSection === s.id ? 'is-on' : ''} href={`#${s.id}`}>
            {s.title}
          </a>
        ))}
        <a className={activeSection === 'links' ? 'is-on' : ''} href="#links">
          Liên kết màn hình
        </a>
      </nav>

      {spec.overview && (
        <section className="spec-section" id="overview">
          <h2>Tổng quan</h2>
          <Markdown text={spec.overview} className="overview" />
        </section>
      )}

      {spec.sections.map((section) => (
        <section className="spec-section" id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.blocks.map((block, i) => (
            <BlockView
              key={i}
              block={block}
              isItems={section.id === spec.itemsSectionId}
              storageKey={`${spec.slug}:${section.id}:${i}`}
              exportName={`${spec.screenId || spec.slug}-${section.id}`}
              initialQuery={section.id === spec.itemsSectionId ? initialQuery : ''}
              renderCell={renderCell}
            />
          ))}
        </section>
      ))}

      <section className="spec-section" id="links">
        <h2>Liên kết màn hình</h2>
        <ScreenLinks spec={spec} index={index} outgoing={refs} />
      </section>

      {initialQuery && (
        <div className="search-banner">
          Đang lọc theo “{initialQuery}”
          <button
            type="button"
            className="chip"
            onClick={() => {
              params.delete('q');
              setParams(params, { replace: true });
            }}
          >
            Xoá
          </button>
        </div>
      )}

      {toast.node}
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : ''}>{value}</dd>
    </div>
  );
}

function BlockView({
  block,
  isItems,
  storageKey,
  exportName,
  initialQuery,
  renderCell,
}: {
  block: Block;
  isItems: boolean;
  storageKey: string;
  exportName: string;
  initialQuery: string;
  renderCell: (ctx: { column: string; value: string; query: string }) => React.ReactNode | null;
}) {
  if (block.type === 'markdown') return <Markdown text={block.text} />;
  if (block.type === 'images') return <Mockups images={block.images} />;
  if (isItems || block.rows.length > 8)
    return (
      <SheetTable
        headers={block.headers}
        rows={block.rows}
        storageKey={storageKey}
        exportName={exportName}
        initialQuery={initialQuery}
        renderCell={isItems ? renderCell : undefined}
      />
    );
  return <SimpleTable table={block} />;
}

function SimpleTable({ table }: { table: TableBlock }) {
  return (
    <div className="simple-table-wrap">
      <table className="simple-table">
        <thead>
          <tr>
            {table.headers.map((h, i) => (
              <th key={i} style={{ textAlign: table.align[i] }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td key={c} style={{ textAlign: table.align[c] }}>
                  <CellText value={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Screens this spec points at, plus the specs that point back at it. */
function ScreenLinks({
  spec,
  index,
  outgoing,
}: {
  spec: Spec;
  index: SpecIndex;
  outgoing: string[];
}) {
  const [incoming, setIncoming] = useState<{ slug: string; label: string }[] | null>(null);

  useEffect(() => {
    if (!spec.screenId) {
      setIncoming([]);
      return;
    }
    let alive = true;
    loadAllSpecs()
      .then((all) => {
        if (!alive) return;
        const me = spec.screenId.toUpperCase();
        setIncoming(
          all
            .filter((other) => other.slug !== spec.slug && screenRefs(other).includes(me))
            .map((other) => ({
              slug: other.slug,
              label: `${other.screenId} ${other.nameJa}`,
            }))
        );
      })
      .catch(() => alive && setIncoming([]));
    return () => {
      alive = false;
    };
  }, [spec.slug, spec.screenId]);

  const byId = useMemo(() => {
    const map = new Map<string, (typeof index.specs)[number]>();
    for (const s of index.specs) if (s.screenId) map.set(s.screenId.toUpperCase(), s);
    return map;
  }, [index.specs]);

  return (
    <div className="links-grid">
      <div>
        <h3>Màn hình được nhắc tới ({outgoing.length})</h3>
        <div className="chip-row">
          {outgoing.map((id) => {
            const target = byId.get(id);
            return target ? (
              <Link key={id} to={`/spec/${target.slug}`} className="screen-chip is-big">
                <strong>{id}</strong>
                <span>{target.nameJa}</span>
              </Link>
            ) : (
              <span key={id} className="screen-chip is-big is-dead" title="Chưa có spec trong repo">
                <strong>{id}</strong>
                <span>chưa có spec</span>
              </span>
            );
          })}
          {!outgoing.length && <p className="is-dim">Không tham chiếu màn hình nào.</p>}
        </div>
      </div>

      <div>
        <h3>Được tham chiếu từ {incoming ? `(${incoming.length})` : '…'}</h3>
        <div className="chip-row">
          {incoming === null && <p className="is-dim">Đang quét toàn bộ spec…</p>}
          {incoming?.map((x) => (
            <Link key={x.slug} to={`/spec/${x.slug}`} className="screen-chip is-big">
              <strong>{x.label.split(' ')[0]}</strong>
              <span>{x.label.split(' ').slice(1).join(' ')}</span>
            </Link>
          ))}
          {incoming?.length === 0 && <p className="is-dim">Chưa có spec nào trỏ tới màn này.</p>}
        </div>
      </div>
    </div>
  );
}

/** Reassemble a markdown file from the parsed spec, for offline sharing. */
function rebuildMarkdown(spec: Spec): string {
  const out: string[] = [`# ${spec.title}`, ''];
  for (const [k, v] of Object.entries(spec.meta)) out.push(`- **${k}**: ${v}`);
  out.push('');
  for (const section of spec.sections) {
    out.push(`${'#'.repeat(section.level)} ${section.title}`, '');
    for (const block of section.blocks) {
      if (block.type === 'markdown') out.push(block.text, '');
      else if (block.type === 'images')
        out.push(...block.images.map((i) => `![${i.alt}](${i.url})`), '');
      else {
        out.push(`| ${block.headers.join(' | ')} |`);
        out.push(`|${block.headers.map(() => '---').join('|')}|`);
        out.push(...block.rows.map((r) => `| ${r.join(' | ')} |`));
        out.push('');
      }
    }
  }
  return out.join('\n');
}
