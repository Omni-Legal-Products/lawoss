import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { buildWordAddinManifest } from "./word-addin.js";
import { buildWordAddinRedirectorHtml, buildWordAddinShellHtml, WORD_ADDIN_SHELL_VERSION } from "./word-addin-shell.js";

function script(html: string) {
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error("Missing inline script");
  return match[1];
}

type Element = { textContent: string; addEventListener(): void; classList: { add(): void; remove(): void } };
function elements() {
  const map = new Map<string, Element>();
  return (id: string) => {
    if (!map.has(id)) map.set(id, { textContent: "", addEventListener() {}, classList: { add() {}, remove() {} } });
    return map.get(id)!;
  };
}

test("the private manifest sends its credential only in a fragment, with no credential in the public manifest", () => {
  const connectionToken = "a".repeat(64);
  const xml = buildWordAddinManifest({ baseUrl: "https://localhost:47443", connectionToken });
  const source = xml.match(/<SourceLocation DefaultValue="([^"]+)"/u)?.[1];
  if (!source) throw new Error("Manifest task pane source missing");
  const url = new URL(source);
  expect(url.pathname).toBe(`/word-addin/shell-v${WORD_ADDIN_SHELL_VERSION}.html`);
  expect(url.search).toBe("");
  expect(new URLSearchParams(url.hash.slice(1)).get("office_launch")).toBe(connectionToken);
  expect(buildWordAddinManifest({ baseUrl: url.origin })).not.toContain("office_launch");
});

// 🟡 LAWOSS (MČ 8. 11. 2026): the installation key stays in sessionStorage, never in localStorage.
test("the shell keeps the installed credential only in sessionStorage and out of HTTP requests", async () => {
  for (const blockedSession of [false, true]) {
    const connectionToken = "a".repeat(64);
    const local = new Map<string, string>(), session = new Map<string, string>();
    const navigation: string[] = [], history: string[] = [], requests: Array<{ url: string; init?: { headers?: Record<string, string> } }> = [];
    runInNewContext(script(buildWordAddinShellHtml()), {
      URLSearchParams, AbortController,
      localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value) },
      sessionStorage: { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { if (blockedSession) throw new Error("blocked"); session.set(key, value); } },
      location: { hash: `#office_launch=${connectionToken}`, pathname: `/word-addin/shell-v${WORD_ADDIN_SHELL_VERSION}.html`, search: "", replace: (url: string) => navigation.push(url) },
      history: { replaceState: (_state: unknown, _title: string, url: string) => history.push(url) },
      document: { documentElement: { lang: "" }, getElementById: elements() },
      fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
        requests.push({ url, init });
        return { ok: true, json: async () => ({ shellVersion: WORD_ADDIN_SHELL_VERSION }) };
      },
      setInterval() {}, clearInterval() {}, setTimeout, clearTimeout,
    });
    for (let attempt = 0; attempt < 10 && !navigation.length; attempt++) await new Promise(resolve => setImmediate(resolve));
    expect(requests.map(request => request.url)).toEqual(["bootstrap"]);
    expect(JSON.stringify(requests)).not.toContain(connectionToken);
    expect(navigation).toEqual(["app.html"]);
    expect(history).toEqual([`/word-addin/shell-v${WORD_ADDIN_SHELL_VERSION}.html`]);
    expect([...local.values()]).not.toContain(connectionToken);
    expect(session.get("legalwork.office.launch")).toBe(blockedSession ? undefined : connectionToken);
  }
});

test("the redirector of older manifests forwards the launch fragment to the current shell", () => {
  const navigations: string[] = [];
  runInNewContext(script(buildWordAddinRedirectorHtml()), {
    location: { hash: `#office_launch=${"b".repeat(64)}`, replace: (url: string) => navigations.push(url) },
  });
  expect(navigations).toEqual([`shell-v${WORD_ADDIN_SHELL_VERSION}.html#office_launch=${"b".repeat(64)}`]);
});

test("offline Office shell uses cached Czech, otherwise the supported system language", async () => {
  for (const [cached, system, expected] of [["cs", "sk-SK", "LAWOSS není spuštěný"], ["system", "cs-CZ", "LAWOSS není spuštěný"], ["sk", "cs-CZ", "LAWOSS nie je spustený"]]) {
    const element = elements();
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

test("shell shows neutral initial markup until its cached or system language is resolved", () => {
  const markup = buildWordAddinShellHtml().split("<script>\n")[0];
  expect(markup).not.toContain("Connecting to LegalWork");
  expect(markup).not.toContain("LegalWork is not running");
});
