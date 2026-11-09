import chromeDevtools from "opencode-chrome-devtools";

// The pinned upstream version reads ../package.json for this one tool. Bundles
// live in content-addressed directories, so supply its version without that file.
export default async function chromeDevtoolsPlugin() {
  const hooks = await chromeDevtools();
  return {
    ...hooks,
    tool: {
      ...hooks.tool,
      browser_version: {
        description: "Return the bundled browser automation plugin version.",
        args: {},
        execute: async () => "opencode-chrome-devtools@1.0.4",
      },
    },
  };
}
