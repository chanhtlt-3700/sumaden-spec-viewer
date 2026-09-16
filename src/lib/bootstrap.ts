import type { Spec, SpecIndex } from '../types';
import { makeSlug, parseSpec, sortSpecs, summarize } from '../../shared/spec-parser.mjs';
import { fileContent, latestSpecCommit, listSpecFiles } from './github';
import type { RepoRef } from './github';
import { writeSnapshot } from './idb';

export interface BootstrapProgress {
  done: number;
  total: number;
  label: string;
}

/**
 * Build a full snapshot from GitHub inside the browser, using the same parser
 * the sync script uses. This is what makes a cold start work with no
 * `npm run sync`: there is no index.json to read, so we produce one.
 */
export async function buildSnapshot(
  ref: RepoRef,
  onProgress: (p: BootstrapProgress) => void
): Promise<{ index: SpecIndex; specs: Spec[] }> {
  onProgress({ done: 0, total: 0, label: 'Đang lấy danh sách spec…' });
  const [files, head] = await Promise.all([listSpecFiles(ref), latestSpecCommit(ref)]);

  const total = files.length;
  if (!total) throw new Error(`Không tìm thấy file .md nào trong ${ref.repo}/${ref.specPath}`);

  const parsed: ReturnType<typeof parseSpec>[] = [];
  let done = 0;
  const queue = [...files];
  const workers = Array.from({ length: 8 }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const markdown = await fileContent(ref, `${ref.specPath}/${file.name}`, ref.branch);
      parsed.push(parseSpec(file.name, markdown, ref));
      done += 1;
      onProgress({ done, total, label: `Đang tải & phân tích spec… ${done}/${total}` });
    }
  });
  await Promise.all(workers);

  const taken = new Set<string>();
  for (const spec of parsed) {
    const slug = makeSlug(spec, taken);
    taken.add(slug);
    (spec as unknown as Spec).slug = slug;
  }

  const specs = sortSpecs(parsed as unknown as Spec[]);
  const index: SpecIndex = {
    ...ref,
    generatedAt: new Date().toISOString(),
    head,
    specs: specs.map(summarize),
  };

  onProgress({ done: total, total, label: 'Đang lưu vào bộ nhớ trình duyệt…' });
  await writeSnapshot(index, specs);

  return { index, specs };
}
