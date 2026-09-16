import type { RepoRef } from './github';

/**
 * Where specs live when there is no snapshot to read it from — a cold start
 * has no index.json, so the repo coordinates have to come from somewhere else.
 * Override at build time with VITE_SPEC_REPO / VITE_SPEC_BRANCH / VITE_SPEC_PATH.
 */
export const DEFAULT_REF: RepoRef = {
  repo: import.meta.env.VITE_SPEC_REPO ?? 'framgia/2116-mng',
  branch: import.meta.env.VITE_SPEC_BRANCH ?? 'main',
  specPath: import.meta.env.VITE_SPEC_PATH ?? 'docs/specification',
};
