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

test("offline Office shell uses cached Czech, otherwise the supported system language", async () => {
  for (const [cached, system, expected] of [["cs", "sk-SK", "LAWOSS není spuštěný"], ["system", "cs-CZ", "LAWOSS není spuštěný"], ["sk", "cs-CZ", "LAWOSS nie je spustený"]]) {
    const elements = new Map<string, { textContent: string; addEventListener: () => void; classList: { add: () => void; remove: () => void } }>();
    const element = (id: string) => { if (!elements.has(id)) elements.set(id, { textContent: "", addEventListener() {}, classList: { add() {}, remove() {} } }); return elements.get(id)!; };
    runInNewContext(script(buildWordAddinShellHtml()), {
      URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
      navigator: { languages: [system] },
      localStorage: { getItem: (key: string) => key === "legalwork.language" ? cached : null, setItem() {} },
      sessionStorage: { getItem: () => "", setItem() {} }, history: { replaceState() {} },
      location: { hash: "", pathname: "/word-addin/shell.html", search: "", replace() {} },
      document: { documentElement: { lang: "" }, getElementById: element },
      fetch: async () => { throw new Error("offline"); },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(element("offline-title").textContent).toBe(expected);
  }
});

test("shell invalidates a different pairing's cached language and clears presentation cache on 401", async () => {
  for (const rejected of [false, true]) {
    const capability = "d".repeat(64);
    const values = new Map([["legalwork.language", "sk"], ["legalwork.officeLocaleScope", "old-pairing"]]);
    const elements = new Map<string, { textContent: string; addEventListener(): void; classList: { add(): void; remove(): void } }>();
    const element = (id: string) => {
      if (!elements.has(id)) elements.set(id, { textContent: "", addEventListener() {}, classList: { add() {}, remove() {} } });
      return elements.get(id)!;
    };
    await runInNewContext(script(buildWordAddinShellHtml()), {
      crypto: globalThis.crypto, TextEncoder, Uint8Array, URLSearchParams, AbortController, setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
      navigator: { languages: ["cs-CZ"] },
      localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) },
      sessionStorage: { getItem: () => "", setItem() {} }, history: { replaceState() {} },
      location: { hash: `#capability=${capability}`, pathname: "/word-addin/shell-v7.html", search: "", replace() {} },
      document: { documentElement: { lang: "" }, getElementById: element },
      fetch: async () => { if (!rejected) throw new Error("offline"); return { ok: false, status: 401 }; },
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(element("offline-title").textContent).toBe(rejected ? "Otevřete doplněk Office znovu" : "LAWOSS není spuštěný");
    expect(values.has("legalwork.language")).toBe(false);
    expect(values.has("legalwork.officeLocaleScope")).toBe(!rejected);
    expect([...values.values()]).not.toContain(capability);
  }
});

test("shell shows neutral initial markup until its cached or system language is resolved", () => {
  const markup = buildWordAddinShellHtml().split("<script>\n")[0];
  expect(markup).not.toContain("Connecting to LegalWork");
  expect(markup).not.toContain("LegalWork is not running");
});
