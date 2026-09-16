import { createGhHandler } from '../shared/gh-proxy.mjs';

/**
 * Local-only GitHub proxy so live mode works without putting a token in the
 * browser: the server signs requests with the local `gh` credentials.
 *
 * Runs for both `vite dev` and `vite preview` — otherwise previewing a build
 * would silently lose live updates and start asking for a token. `preview`
 * serves a finished build, so it may not rewrite that build via `resync`.
 *
 * For a deployed instance the same handler is served by `scripts/serve.mjs`.
 */
export function githubProxy() {
  return {
    name: 'spec-view-github-proxy',
    configureServer(server) {
      server.middlewares.use('/__gh', createGhHandler({ allowSync: true }));
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__gh', createGhHandler({ allowSync: false }));
    },
  };
}
