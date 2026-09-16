import { useState } from 'react';
import { Dropdown } from './ui';
import { useLive } from '../lib/live';
import * as live from '../lib/live';
import { canServerSync, readToken, resetChannel, verifyToken, writeToken } from '../lib/github';
import { clearViewCache, viewCacheSize } from '../lib/storage';

const INTERVALS = [
  { ms: 30_000, label: '30 giây' },
  { ms: 60_000, label: '1 phút' },
  { ms: 300_000, label: '5 phút' },
  { ms: 900_000, label: '15 phút' },
];

const STATUS_TEXT: Record<string, string> = {
  off: 'Đã tắt',
  idle: 'Đang theo dõi',
  checking: 'Đang kiểm tra…',
  updating: 'Đang cập nhật…',
  error: 'Lỗi',
};

const ago = (ts: number | null) => {
  if (!ts) return 'chưa kiểm tra';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s trước`;
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  return new Date(ts).toLocaleTimeString('vi-VN');
};

export function LiveStatus() {
  const state = useLive();
  const status = state.enabled ? state.status : 'off';

  return (
    <Dropdown
      align="right"
      width={340}
      active={status === 'error'}
      title="Trạng thái đồng bộ real-time"
      label={
        <span className="live-pill">
          <i className={`live-dot is-${status}`} />
          {status === 'off' ? 'Realtime tắt' : STATUS_TEXT[status]}
        </span>
      }
    >
      {() => <LivePanel />}
    </Dropdown>
  );
}

function LivePanel() {
  const state = useLive();
  const [token, setToken] = useState(readToken());
  const [tokenNote, setTokenNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [cacheSize, setCacheSize] = useState(() => viewCacheSize());
  const [cacheNote, setCacheNote] = useState('');

  const saveToken = async () => {
    setBusy(true);
    setTokenNote('');
    try {
      if (token) {
        const login = await verifyToken(token);
        writeToken(token);
        setTokenNote(`Đã lưu — đăng nhập với ${login}`);
      } else {
        writeToken('');
        setTokenNote('Đã xoá token');
      }
      resetChannel();
      await live.refreshChannel();
    } catch (err) {
      setTokenNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu live-menu">
      <label className="live-toggle">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => live.setEnabled(e.target.checked)}
        />
        <span>Tự động theo dõi GitHub</span>
      </label>

      <div className="live-row">
        <span>Chu kỳ</span>
        <select
          value={state.intervalMs}
          onChange={(e) => live.setIntervalMs(Number(e.target.value))}
          disabled={!state.enabled}
        >
          {INTERVALS.map((i) => (
            <option key={i.ms} value={i.ms}>
              {i.label}
            </option>
          ))}
        </select>
      </div>

      <div className="live-row">
        <span>Kênh</span>
        <strong>
          {state.channel === 'proxy'
            ? 'Server nội bộ (gh auth)'
            : state.channel === 'token'
              ? 'Token cá nhân'
              : 'Chưa cấu hình'}
        </strong>
      </div>

      <div className="live-row">
        <span>Kiểm tra lần cuối</span>
        <strong>{ago(state.lastChecked)}</strong>
      </div>

      {state.head && (
        <div className="live-commit">
          <code>{state.head.sha.slice(0, 8)}</code>
          <span>{state.head.message}</span>
          <em>
            {state.head.author}
            {state.head.date && ` · ${new Date(state.head.date).toLocaleString('vi-VN')}`}
          </em>
        </div>
      )}

      {state.error && <p className="live-error">{state.error}</p>}

      {state.lastChange && (
        <p className="live-note">
          Lần cập nhật gần nhất: {state.lastChange.updated.length} spec sửa,{' '}
          {state.lastChange.removed.length} xoá
          {state.lastChange.imagesChanged > 0 && `, ${state.lastChange.imagesChanged} ảnh đổi`}.
        </p>
      )}

      <div className="menu-sep" />

      <div className="live-row">
        <span>Cache bố cục bảng</span>
        <strong>{cacheSize} mục</strong>
      </div>
      <div className="menu-row">
        <button
          type="button"
          className="chip"
          disabled={cacheSize === 0}
          title="Quên độ rộng cột, cột đang ẩn và chiều cao dòng đã lưu"
          onClick={() => {
            const removed = clearViewCache();
            setCacheSize(viewCacheSize());
            setCacheNote(`Đã xoá ${removed} mục — tải lại trang để áp dụng`);
          }}
        >
          Xoá cache bố cục
        </button>
        <button
          type="button"
          className="chip"
          onClick={() => window.location.reload()}
          title="Tải lại trang"
        >
          Tải lại trang
        </button>
      </div>
      {cacheNote && <p className="live-note">{cacheNote}</p>}

      <div className="menu-sep" />

      <div className="menu-row">
        <button
          type="button"
          className="chip"
          onClick={() => void live.check()}
          disabled={state.channel === 'none'}
        >
          Kiểm tra ngay
        </button>
        {state.channel === 'proxy' && canServerSync() && (
          <button
            type="button"
            className="chip"
            disabled={state.resyncing}
            onClick={() => void live.fullResync(true).catch(() => {})}
            title="Chạy lại npm run sync trên dev server (tải cả ảnh mockup) rồi reload"
          >
            {state.resyncing ? 'Đang đồng bộ…' : 'Đồng bộ toàn bộ + ảnh'}
          </button>
        )}
      </div>

      {state.channel !== 'proxy' && (
        <>
          <div className="menu-sep" />
          <div className="menu-title">GitHub token (repo: read)</div>
          <input
            className="menu-input"
            type="password"
            placeholder="ghp_… hoặc github_pat_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="menu-row">
            <button type="button" className="chip" onClick={() => void saveToken()} disabled={busy}>
              {busy ? 'Đang kiểm tra…' : 'Lưu & kiểm tra'}
            </button>
          </div>
          {tokenNote && <p className="live-note">{tokenNote}</p>}
          <p className="live-hint">
            Token chỉ nằm trong localStorage của trình duyệt này và chỉ gửi tới api.github.com. Khi
            chạy <code>npm run dev</code> thì không cần token — dev server tự ký bằng <code>gh</code>.
          </p>
        </>
      )}
    </div>
  );
}
