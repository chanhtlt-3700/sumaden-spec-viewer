import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** Close on outside click or Escape. */
export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, close]);
  return ref;
}

export function Dropdown({
  label,
  title,
  children,
  align = 'left',
  active = false,
  width,
}: {
  label: ReactNode;
  title?: string;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  active?: boolean;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const panelRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);

  // Keep the panel inside the viewport when it opens near an edge.
  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    setShift(0);
    const box = panelRef.current.getBoundingClientRect();
    const overflow = box.right - (window.innerWidth - 8);
    if (overflow > 0) setShift(-overflow);
    if (box.left < 8) setShift(8 - box.left);
  }, [open]);

  return (
    <div className="dd" ref={ref}>
      <button
        type="button"
        className={`btn ${active ? 'is-active' : ''}`}
        title={title}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={panelRef}
          className={`dd-panel dd-${align}`}
          style={{ width, transform: shift ? `translateX(${shift}px)` : undefined }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  title,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  title?: string;
}) {
  return (
    <div className="segmented" title={title} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  children,
  indeterminate = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  indeterminate?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="check">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap">
      <div className="spinner" />
      {label && <p>{label}</p>}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

/** Small transient toast used for copy/export feedback. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const show = (text: string) => {
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), 2200);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const node = message ? <div className="toast">{message}</div> : null;
  return { show, node };
}
