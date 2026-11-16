import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFileContents } from "../content-search.js";
import { DocumentPreparation } from "../document-preparation/service.js";
import { OcrManager } from "../ocr/manager.js";
import type { WorkspaceInfo } from "../types.js";
import { fileNameMatches } from "./file-name-match.js";

const cleanups: Array<() => Promise<void>> = [];
const realNow = Date.now;
afterEach(async () => { Date.now = realNow; for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function office() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-name-search-")));
  for (let client = 0; client < 12; client++) for (let file = 0; file < 24; file++) {
    const dir = join(root, "Klienti", `Klient ${client}`, "Spisy", `Vec ${file % 3}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `dokument-${file}.txt`), "Obsah zmluvy ".repeat(200));
  }
  await writeFile(join(root, "Klienti", "Klient 11", "sken-2026-11-13.txt"), "naskenovaný text");
  await writeFile(join(root, "Klienti", "Klient 7", "Zmluva_o_nájme.docx"), "");
  const preparation = new DocumentPreparation(new OcrManager(join(root, ".ocr")));
  cleanups.push(async () => { preparation.stop(); await rm(root, { recursive: true, force: true }); });
  const workspace: WorkspaceInfo = { id: "office", name: "Office", path: root, preset: "starter", workspaceType: "local" };
  return { workspace, preparation };
}
const paths = (result: { items: Array<{ path?: string }> }) => result.items.map(item => item.path);

test("#465: názov súboru sa nájde podľa časti, bez diakritiky a s inými oddeľovačmi", () => {
  expect(fileNameMatches("Klienti/Klient 11/sken-2026-11-13.txt", "sken-2026")).toBe(true);
  expect(fileNameMatches("Klienti/Klient 11/sken-2026-11-13.txt", "sken 2026 11")).toBe(true);
  expect(fileNameMatches("Klienti/Klient 7/Zmluva_o_nájme.docx", "zmluva najme")).toBe(true);
  expect(fileNameMatches("Klienti/Klient 7/Zmluva_o_nájme.docx", "nájme")).toBe(true);
  expect(fileNameMatches("Klienti/Klient 7/Zmluva_o_nájme.docx", "kúpna")).toBe(false);
  expect(fileNameMatches("Klienti/Klient 7/Zmluva_o_nájme.docx", " - ")).toBe(false);
});

test("#465: zhoda názvu sa vráti aj vtedy, keď čas na prípravu obsahu už uplynul", async () => {
  const f = await office();
  // Server zaťažený prípravou obsahu (OCR, PDF): čas na obsah uplynie skôr, ako prechádzanie dôjde k súboru.
  let calls = 0;
  const start = realNow();
  Date.now = () => start + (calls++ > 0 ? 3_000 : 0);
  const result = await searchFileContents(f.workspace, "sken-2026", new AbortController().signal, f.preparation, "owner");
  Date.now = realNow;
  expect(paths(result)).toEqual(["Klienti/Klient 11/sken-2026-11-13.txt"]);
  expect(result.limited).toBe(true);
  expect(result.preparing).toBe(0);
});

test("#465: zhody názvu sú pred zhodami obsahu a bez diakritiky", async () => {
  const f = await office();
  const result = await searchFileContents(f.workspace, "zmluva najme", new AbortController().signal, f.preparation, "owner");
  expect(paths(result)[0]).toBe("Klienti/Klient 7/Zmluva_o_nájme.docx");
});
