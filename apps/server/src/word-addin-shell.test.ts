import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildWordAddinManifest } from "./word-addin.js";
import { buildWordAddinRedirectorHtml, buildWordAddinShellHtml, WORD_ADDIN_SHELL_VERSION } from "./word-addin-shell.js";

function script(html: string) {
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Missing inline script");
  return match[1];
}

test("the paired manifest bypasses legacy caches and the redirector never selects an old cached shell", () => {
  const capability = "b".repeat(64);
  const manifest = buildWordAddinManifest({ baseUrl: "https://localhost:47443", capability });
  expect(manifest.match(/taskpane.html\?pairing=2#capability=/g)?.length).toBe(2);
  const navigations: string[] = [];
  runInNewContext(script(buildWordAddinRedirectorHtml()), {
    localStorage: { getItem: () => "5" },
    location: { hash: `#capability=${capability}`, replace: (url: string) => navigations.push(url) },
  });
  expect(navigations).toEqual([`shell-v${WORD_ADDIN_SHELL_VERSION}.html#capability=${capability}`]);
});

test("shell authenticates bootstrap and preserves pairing through handoff even when storage is blocked", async () => {
  for (const blockedStorage of [false, true]) {
    const capability = "c".repeat(64);
    const requests: Array<{ headers: Record<string, string> }> = [];
    const navigations: string[] = [];
    const stored = new Map<string, string>();
    runInNewContext(script(buildWordAddinShellHtml()), {
      URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: { getItem: () => "en", setItem: () => {} },
      sessionStorage: { getItem: (key: string) => stored.get(key), setItem: (key: string, value: string) => { if (blockedStorage) throw new Error("blocked"); stored.set(key, value); } },
      history: { replaceState: () => {} },
      location: { hash: `#capability=${capability}`, pathname: "/word-addin/shell.html", search: "", replace: (url: string) => navigations.push(url) },
      document: { getElementById: () => ({ addEventListener: () => {}, classList: { add: () => {}, remove: () => {} } }) },
      fetch: async (_url: string, init: { headers: Record<string, string> }) => { requests.push(init); return { ok: true, json: async () => ({ shellVersion: WORD_ADDIN_SHELL_VERSION }) }; },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests[0]?.headers["X-LegalWork-Office-Capability"]).toBe(capability);
    expect(navigations).toEqual([`app.html#capability=${capability}`]);
    if (!blockedStorage) expect(stored.get("legalwork.officeCapability")).toBe(capability);
  }
});
