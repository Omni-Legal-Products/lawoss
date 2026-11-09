// This pinned package ships JavaScript without TypeScript declarations.
declare module "opencode-chrome-devtools" {
  const plugin: () => Promise<{ tool: Record<string, unknown> }>;
  export default plugin;
}
