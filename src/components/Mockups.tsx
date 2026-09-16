import { useEffect, useState } from 'react';
import type { SpecImage as SpecImageRef } from '../types';
import { asset } from '../lib/data';
import { SpecImage } from './SpecImage';

const kindOf = (img: SpecImageRef) => {
  const hay = `${img.alt} ${img.url}`.toLowerCase();
  if (hay.includes('annotated')) return 'Annotated';
  if (hay.includes('clean')) return 'Clean';
  return '';
};

export function Mockups({ images }: { images: SpecImageRef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === 'ArrowLeft')
        setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, images.length]);

  useEffect(() => setZoom(1), [open]);

  if (!images.length) return <p className="is-dim">Spec này chưa có ảnh mockup.</p>;

  return (
    <>
      <div className="mockups">
        {images.map((img, i) => (
          <figure key={`${img.url}-${i}`} className="mockup">
            <button type="button" onClick={() => setOpen(i)} title="Phóng to">
              <SpecImage url={img.url} alt={img.alt || `Mockup ${i + 1}`} loading="lazy" />
            </button>
            <figcaption>
              {kindOf(img) && <span className="badge">{kindOf(img)}</span>}
              <span>{img.alt || `Mockup ${i + 1}`}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {open !== null && (
        <div className="lightbox" onClick={() => setOpen(null)}>
          <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
            <span>
              {open + 1}/{images.length} — {images[open].alt || kindOf(images[open]) || 'Mockup'}
            </span>
            <div className="lightbox-actions">
              <button type="button" className="btn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
                −
              </button>
              <button type="button" className="btn" onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="btn" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
                +
              </button>
              <a className="btn" href={asset(images[open].url)} target="_blank" rel="noreferrer">
                Mở ảnh gốc
              </a>
              <button type="button" className="btn" onClick={() => setOpen(null)}>
                ✕
              </button>
            </div>
          </div>
          <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="lightbox-nav prev"
              onClick={() => setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length))}
            >
              ‹
            </button>
            <span
              className="lightbox-img"
              onWheel={(e) => {
                if (!e.ctrlKey) return;
                setZoom((z) => Math.max(0.25, Math.min(5, z - Math.sign(e.deltaY) * 0.15)));
              }}
            >
              <SpecImage
                url={images[open].url}
                alt={images[open].alt}
                style={{ width: `${zoom * 100}%` }}
              />
            </span>
            <button
              type="button"
              className="lightbox-nav next"
              onClick={() => setOpen((i) => (i === null ? i : (i + 1) % images.length))}
            >
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
