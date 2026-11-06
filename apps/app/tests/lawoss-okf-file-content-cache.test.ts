import { describe, expect, test } from "bun:test";
import { createFileContentCache, okfFileContents } from "../src/lawoss/okf/file-content-cache";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";

const OLD = 1_700_000_000_000;
const file = (path: string, content = "text", updatedAt = OLD) => ({ path, content, bytes: content.length, updatedAt });
const now = () => OLD + 60_000;

describe("cache obsahu súborov", () => {
  test("vráti obsah len pri rovnakej veľkosti a čase zmeny", () => {
    const cache = createFileContentCache({ now });
    cache.put("ws", file("a.md"));
    expect(cache.get("ws", "a.md", { size: 4, updatedAt: OLD })?.content).toBe("text");
    expect(cache.get("ws", "a.md", { size: 5, updatedAt: OLD })).toBeNull();
    cache.put("ws", file("a.md"));
    expect(cache.get("ws", "a.md", { size: 4, updatedAt: OLD + 1 })).toBeNull();
  });

  test("výpis bez metadát a iný klient cache nepoužijú", () => {
    const cache = createFileContentCache({ now });
    cache.put("ws", file("a.md"));
    expect(cache.get("ws2", "a.md", { size: 4, updatedAt: OLD })).toBeNull();
    expect(cache.get("ws", "a.md", {})).toBeNull();
  });

  test("práve zmenený súbor sa neuloží, zápis v tom istom tiku by sa inak stratil", () => {
    const cache = createFileContentCache({ now: () => OLD + 500 });
    cache.put("ws", file("a.md"));
    expect(cache.size).toBe(0);
  });

  test("drží hornú hranicu a veľký súbor neukladá", () => {
    const cache = createFileContentCache({ now, maxTotalBytes: 10, maxFileBytes: 6 });
    cache.put("ws", file("velky.md", "1234567"));
    expect(cache.size).toBe(0);
    cache.put("ws", file("a.md", "aaaaa"));
    cache.put("ws", file("b.md", "bbbbb"));
    expect(cache.get("ws", "a.md", { size: 5, updatedAt: OLD })?.content).toBe("aaaaa");
    cache.put("ws", file("c.md", "ccccc"));
    expect(cache.totalBytes).toBeLessThanOrEqual(10);
    expect(cache.get("ws", "b.md", { size: 5, updatedAt: OLD })).toBeNull();
    expect(cache.get("ws", "a.md", { size: 5, updatedAt: OLD })?.content).toBe("aaaaa");
  });
});

describe("readWorkspaceMemory s cache", () => {
  const CARD = "---\ntitle: Syntetický klient\nmatter_kind: advisory\n---\n";
  function client(state: Map<string, { content: string; updatedAt: number }>, reads: string[]): OkfReadClient {
    return {
      listWorkspaceDirectory: async (_ws, path) => {
        const prefix = path ? `${path}/` : "";
        const names = new Map<string, "file" | "dir">();
        for (const p of state.keys()) if (p.startsWith(prefix)) { const rest = p.slice(prefix.length); names.set(rest.split("/")[0], rest.includes("/") ? "dir" : "file"); }
        if (names.size === 0) throw new Error(`404 ${path}`);
        return { path, truncated: false, entries: [...names].map(([name, kind]) => {
          const full = `${prefix}${name}`;
          const item = state.get(full);
          return { name, kind, path: full, ...(item ? { size: item.content.length, updatedAt: item.updatedAt } : {}) };
        }) };
      },
      readWorkspaceFile: async (_ws, path) => {
        reads.push(path);
        const item = state.get(path);
        if (!item) throw new Error(`404 ${path}`);
        return { path, content: item.content, bytes: item.content.length, updatedAt: item.updatedAt };
      },
    };
  }

  test("druhé čítanie bez zmeny nesťahuje obsah a výsledok je rovnaký; zmenený súbor sa prečíta", async () => {
    const ws = `ws-${crypto.randomUUID()}`;
    const path = "AK/N/Novak/Spisy/M1/matter.md";
    const state = new Map([[path, { content: CARD, updatedAt: OLD }]]);
    const first: string[] = [];
    const a = await readWorkspaceMemory(client(state, first), ws, "2026-09-12");
    expect(first).toContain(path);
    const second: string[] = [];
    const b = await readWorkspaceMemory(client(state, second), ws, "2026-09-12");
    expect(second).not.toContain(path);
    expect(b.inputs).toEqual(a.inputs);
    state.set(path, { content: "---\ntitle: Zmenený klient\nmatter_kind: advisory\n---\n", updatedAt: OLD + 5000 });
    const third: string[] = [];
    const c = await readWorkspaceMemory(client(state, third), ws, "2026-09-12");
    expect(third).toContain(path);
    expect(JSON.stringify(c.inputs)).toContain("Zmenený klient");
    expect(okfFileContents.totalBytes).toBeGreaterThan(0);
  });
});
