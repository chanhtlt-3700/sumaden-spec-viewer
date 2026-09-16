import { useEffect, useState } from 'react';
import { asset, currentIndex } from '../lib/data';
import { fileBlob } from '../lib/github';

/** path inside the repo -> object URL, so each image is fetched once per session. */
const blobCache = new Map<string, string>();

async function fetchFromRepo(url: string): Promise<string | null> {
  const index = currentIndex();
  if (!index) return null;
  const rel = url.replace(/^spec-images\//, '');
  const repoPath = `${index.specPath}/images/${rel}`;
  const cached = blobCache.get(repoPath);
  if (cached) return cached;
  try {
    const blob = await fileBlob(
      { repo: index.repo, branch: index.branch, specPath: index.specPath },
      repoPath
    );
    const objectUrl = URL.createObjectURL(blob);
    blobCache.set(repoPath, objectUrl);
    return objectUrl;
  } catch {
    return null;
  }
}

/**
 * Mockup image. Normally served from the synced copy in public/spec-images; if
 * that file is missing — a spec added upstream since the last full sync — it
 * falls back to fetching the blob straight from GitHub.
 */
export function SpecImage({
  url,
  alt,
  className,
  style,
  loading,
}: {
  url: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
}) {
  const external = /^(https?:)?\/\//.test(url) || url.startsWith('data:');
  const [src, setSrc] = useState(external ? url : asset(url));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSrc(external ? url : asset(url));
    setFailed(false);
  }, [url, external]);

  if (failed) {
    return (
      <span className="img-missing" title={url}>
        Không tải được ảnh
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading={loading}
      onError={() => {
        if (external) {
          setFailed(true);
          return;
        }
        void fetchFromRepo(url).then((objectUrl) => {
          if (objectUrl) setSrc(objectUrl);
          else setFailed(true);
        });
      }}
    />
  );
}
