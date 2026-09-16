import { useEffect, useState } from 'react';
import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { useIndex, useStored } from './lib/data';
import { Empty, Spinner } from './components/ui';
import { Sidebar } from './components/Sidebar';
import { CommandPalette } from './components/CommandPalette';
import { HomePage } from './pages/HomePage';
import { SpecPage } from './pages/SpecPage';
import type { SpecIndex } from './types';

type Theme = 'light' | 'dark';

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}

function Shell() {
  const state = useIndex();
  const [theme, setTheme] = useStored<Theme>('theme', 'dark');
  const [collapsed, setCollapsed] = useStored<boolean>('sidebar:collapsed', false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === '/' && !/input|textarea/i.test((e.target as HTMLElement).tagName)) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (state.status === 'loading') return <Spinner label="Đang nạp danh sách spec…" />;
  if (state.status === 'error')
    return (
      <Empty
        title="Không đọc được dữ liệu spec"
        hint={`${state.error.message} — hãy chạy "npm run sync" để tải spec từ GitHub.`}
      />
    );

  const index: SpecIndex = state.data;

  return (
    <div className={`app ${collapsed ? 'is-narrow' : ''}`}>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">SV</span>
          <span>
            <strong>Spec Viewer</strong>
            <em>{index.repo}</em>
          </span>
        </Link>

        <button type="button" className="global-search" onClick={() => setPaletteOpen(true)}>
          <span>⌕ Tìm màn hình, item, mô tả…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="topbar-actions">
          <span className="sync-time" title={`Đồng bộ lúc ${index.generatedAt}`}>
            {index.specs.length} spec · {index.branch}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Đổi giao diện sáng/tối"
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div className="body">
        <Sidebar
          specs={index.specs}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
        />
        <main className="content">
          <Routes>
            <Route path="/" element={<HomePage index={index} />} />
            <Route path="/spec/:slug" element={<SpecPage index={index} />} />
            <Route
              path="*"
              element={<Empty title="Không tìm thấy trang" hint="Quay lại danh sách spec." />}
            />
          </Routes>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        specs={index.specs}
      />
    </div>
  );
}
