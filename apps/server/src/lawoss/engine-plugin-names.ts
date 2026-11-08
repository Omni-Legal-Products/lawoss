/**
 * LAWOSS: engine plugins of LAWOSS, built next to the upstream ones by `scripts/build-opencode-plugins.ts`
 * (`dist/opencode-plugins/<name>/index.js`) and registered by `legalwork-runtime-config.ts`. The upstream
 * builder deletes `dist/opencode-plugins` and builds only its own list; without this one a build drops them.
 *
 * Helpers (`lawoss-editor-approval`, `lawoss-file-paths`, `lawoss-file-operations-text`,
 * `provider-failure-observer`, `wiki-agent-secret`) are not entries: they are bundled into the plugins
 * that import them.
 */
export const LAWOSS_PLUGIN_NAMES = [
  "lawoss-okf-handoff",
  "lawoss-linked-folders",
  "lawoss-file-operations",
  "lawoss-memory-tools",
  "lawoss-view-tools",
] as const;
