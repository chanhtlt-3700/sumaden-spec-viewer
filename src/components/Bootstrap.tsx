import { useCallback, useEffect, useRef, useState } from 'react';
import { buildSnapshot } from '../lib/bootstrap';
import type { BootstrapProgress } from '../lib/bootstrap';
import { DEFAULT_REF } from '../lib/config';
import { seedStore } from '../lib/data';
import {
  detectChannel,
  proxyRepo,
  readToken,
  requestResync,
  resetChannel,
  verifyToken,
  writeToken,
} from '../lib/github';
import type { Channel } from '../lib/github';

type Phase = 'probing' | 'needs-token' | 'working' | 'error';

/**
 * Shown when there is no snapshot at all — no `public/data`, nothing cached.
 * Rather than telling the user to go run a script, fetch the specs here.
 *
 * With the dev server up we ask it to run the real sync, which also puts the
 * mockup images on disk. Otherwise the browser builds the snapshot itself from
 * the GitHub API and keeps it in IndexedDB.
 */
export function Bootstrap({ onReady }: { onReady: () => void }) {
  const [phase, setPhase] = useState<Phase>('probing');
  const [channel, setChannel] = useState<Channel>('none');
  const [progress, setProgress] = useState<BootstrapProgress>({ done: 0, total: 0, label: '' });
  const [error, setError] = useState('');
  const [token, setToken] = useState(readToken());
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const run = useCallback(
    async (mode: Channel) => {
      setPhase('working');
      setError('');
      try {
        if (mode === 'proxy') {
          setProgress({ done: 0, total: 0, label: 'Dev server đang tải spec và ảnh mockup…' });
          await requestResync(true);
          // The sync wrote public/data; reload so the app reads the real snapshot.
          window.location.reload();
          return;
        }
        const ref = proxyRepo() ?? DEFAULT_REF;
        const { index, specs } = await buildSnapshot(ref, setProgress);
        seedStore(index, specs, { fromBrowser: true });
        onReady();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    },
    [onReady]
  );

  // Probe once; if we already have a way in, just start — no extra click.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void detectChannel().then((mode) => {
      setChannel(mode);
      if (mode === 'none') setPhase('needs-token');
      else void run(mode);
    });
  }, [run]);

  const saveToken = async () => {
    setBusy(true);
    setError('');
    try {
      await verifyToken(token);
      writeToken(token);
      resetChannel();
      const mode = await detectChannel();
      setChannel(mode);
      await run(mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div className="bootstrap">
      <div className="bootstrap-card">
        <h1>Chưa có dữ liệu spec trên máy</h1>
        <p className="page-sub">
          {DEFAULT_REF.repo} · <code>{DEFAULT_REF.specPath}</code>
        </p>

        {phase === 'probing' && <p>Đang kiểm tra quyền truy cập GitHub…</p>}

        {phase === 'working' && (
          <>
            <p>{progress.label || 'Đang tải…'}</p>
            <div className="progress">
              <div
                className={`progress-bar ${pct === null ? 'is-indeterminate' : ''}`}
                style={pct === null ? undefined : { width: `${pct}%` }}
              />
            </div>
            {channel === 'proxy' && (
              <p className="live-hint">
                Lần đầu mất khoảng một phút vì tải cả 26MB ảnh mockup về đĩa. Những lần sau đọc thẳng
                từ máy nên mở là có ngay.
              </p>
            )}
          </>
        )}

        {(phase === 'needs-token' || phase === 'error') && (
          <>
            {error && <p className="live-error">{error}</p>}
            {channel === 'none' ? (
              <>
                <p>
                  Repo là private nên cần quyền đọc. Chạy <code>npm run dev</code> thì dev server tự
                  ký bằng <code>gh auth</code> — hoặc dán GitHub token (scope <code>repo: read</code>)
                  vào đây.
                </p>
                <input
                  className="menu-input"
                  type="password"
                  placeholder="ghp_… hoặc github_pat_…"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && void saveToken()}
                />
                <div className="menu-row">
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !token}
                    onClick={() => void saveToken()}
                  >
                    {busy ? 'Đang kiểm tra…' : 'Kết nối & tải spec'}
                  </button>
                </div>
                <p className="live-hint">
                  Token chỉ nằm trong localStorage của trình duyệt này và chỉ gửi tới api.github.com.
                </p>
              </>
            ) : (
              <div className="menu-row">
                <button type="button" className="btn" onClick={() => void run(channel)}>
                  Thử lại
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
