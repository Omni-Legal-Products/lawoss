import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workingProfile } from "../../../lawoss/okf/src/profile";
import { readManualStatus } from "../../../lawoss/okf-pamat/src/manual-status";
import { hasWindowsPowerShell, writeWithWindowsPowerShell } from "../../../lawoss/tests/windows-powershell.mts";
import { readOfficeProfile, updateOfficeProfile } from "../src/lawoss/okf/office-profile";
import { loadProfilePreview } from "../src/lawoss/okf/load-profile";
import { loadMemoryProfile, parseWorkspaceMemoryProfileText, type MemoryProfileClient } from "../src/lawoss/okf/workspace-memory-profile";
import { readWorkspaceMemory, type OkfReadClient } from "../src/lawoss/okf/read-model";

// Server číta textové súbory ako UTF-8 a BOM z Windows (Poznámkový blok, Set-Content -Encoding UTF8)
// nechá na začiatku obsahu. Appka ho musí preniesť cez rovnaké parsery ako CLI.
const BOM = "﻿";
const TODAY = "2026-10-05";

/** Server API nad slovníkom súborov: zoznam priečinkov a obsah tak, ako ho vráti /files/content. */
function files(entries: Record<string, string>) {
  const paths = Object.keys(entries);
  const kind = (path: string) => paths.includes(path) ? "file" as const : paths.some((p) => p.startsWith(`${path}/`)) ? "dir" as const : undefined;
  const client: OkfReadClient & MemoryProfileClient = {
    listWorkspaceDirectory: async (_ws: string, path: string) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of paths) if (p.startsWith(prefix)) names.set(p.slice(prefix.length).split("/")[0]!, p.slice(prefix.length).includes("/") ? "dir" : "file");
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, k]) => ({ name, kind: k, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (_ws: string, path: string) => {
      const content = entries[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
    statWorkspaceFile: async (_ws: string, path: string) => ({ ok: true, path, exists: kind(path) !== undefined, kind: kind(path) }),
  } as unknown as OkfReadClient & MemoryProfileClient;
  return client;
}

test("office profile s BOM: prvý kľúč sa počíta do kontroly duplicít a prepis ho nezdvojí", () => {
  const content = `${BOM}client_path: "AK/*"\r\nstanding_authorization: "Test Advokát"\r\n`;
  expect(readOfficeProfile(content).clientPath).toBe("AK/*");
  expect(() => readOfficeProfile(`${content}client_path: "Iné/*"\n`)).toThrow();
  const output = updateOfficeProfile(content, { profile: workingProfile(), clientPath: "Klienti/*" });
  expect(output.startsWith(BOM)).toBe(false);
  expect(output.match(/^client_path:/gm)).toHaveLength(1);
  expect(output).toContain('standing_authorization: "Test Advokát"');
  expect(readOfficeProfile(output).clientPath).toBe("Klienti/*");
});

test("náhľad profilu pre nový spis číta okf.config s BOM rovnako ako CLI", async () => {
  const config = `${BOM}document_naming: "{date}_{description}"\nmatter_folders: ["Podklady", "Drafty"]\nfolder_roles: { drafts: "Drafty" }\n`;
  const preview = await loadProfilePreview(files({ "Office/okf.config": config, "Klient/Spisy/vec/.keep": "" }), "ws", "Klient/Spisy/vec", true, "sk");
  expect(preview.source).toBe("Office/okf.config");
  expect(preview.profile).toEqual(workingProfile(["Podklady", "Drafty"], { drafts: "Drafty" }, "{date}_{description}"));
  // Duplicitný prvý kľúč sa za BOM neskryje a neprepíše potichu druhým.
  await expect(loadProfilePreview(files({ "Office/okf.config": `${config}document_naming: "{description}"\n`, "Klient/Spisy/vec/.keep": "" }), "ws", "Klient/Spisy/vec", true, "sk")).rejects.toThrow("Duplicitný kľúč");
});

test("pamäťový profil s BOM sa načíta a hash ostáva z uložených bajtov", async () => {
  const profile = { version: 1, matterId: "synthetic-01", roots: [{ id: "matter", path: "." }], sources: [{ id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-01"] }] };
  const content = `${BOM}${JSON.stringify(profile, null, 2)}\r\n`;
  expect(parseWorkspaceMemoryProfileText(content).matterId).toBe("synthetic-01");
  const snapshot = await loadMemoryProfile(files({ ".lawoss/memory-profile.json": content }), "ws");
  expect(snapshot.content).toBe(content);
  expect(snapshot.profile.sources[0]?.id).toBe("memory");
});

test("read model: okf.config a _STATUS.md s BOM — vzor klienta platí a manual_updated sa nestratí", async () => {
  const matter = "AK/N/Novák Jan/vec";
  const out = await readWorkspaceMemory(files({
    [`${matter}/matter.md`]: `${BOM}---\r\ntype: matter\r\ntitle: Synthetic\r\n---\r\n`,
    [`${matter}/_STATUS.md`]: `${BOM}---\r\ntype: status\r\nmanual_updated: 2026-09-01\r\n---\r\n\r\n> **Fáza:** Čakáme na súd.\r\n`,
    "AK/N/Novák Jan/VSTUPY.md": "| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |\n| --- | --- | --- | --- | --- | --- |\n| IN-001 | 2026-09-12 | e-mail | klient.eml | pending | |\n",
    "Office/okf.config": `${BOM}client_path: AK/*/*\r\n`,
  }), "ws", TODAY);
  expect(out.problems.filter((problem) => problem.path.endsWith("okf.config") || problem.path.endsWith("_STATUS.md"))).toEqual([]);
  const input = out.inputs.find((entry) => entry.path === matter);
  expect(input?.manualStatus).toMatchObject({ state: "dated", updated: "2026-09-01" });
  expect(input?.inheritedIntakes?.[0]?.path).toBe("AK/N/Novák Jan/VSTUPY.md");
});

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test.skipIf(!hasWindowsPowerShell)("Windows PowerShell 5.1: okf.config a _STATUS.md cez Set-Content -Encoding UTF8 prečíta appka ako server", () => {
  const dir = mkdtempSync(join(tmpdir(), "lawoss-app-bom-")); temporary.push(dir);
  const config = join(dir, "okf.config"), status = join(dir, "_STATUS.md");
  expect(writeWithWindowsPowerShell(config, ['client_path: "AK/*"', 'standing_authorization: "JUDr. Vojtěch Říha"'], "Set-Content -Encoding UTF8")[0]).toBe(0xef);
  writeWithWindowsPowerShell(status, ["---", "type: status", "manual_updated: 2026-09-01", "---", "", "> **Fáza:** Čakáme na súd."], "Set-Content -Encoding UTF8");
  // Rovnako ako GET /workspace/:id/files/content: readFile(…, "utf8") ponechá U+FEFF.
  expect(readOfficeProfile(readFileSync(config, "utf8")).clientPath).toBe("AK/*");
  expect(readManualStatus(readFileSync(status, "utf8"), [], TODAY)).toMatchObject({ state: "dated", updated: "2026-09-01" });
});
