// LAWOSS alfa2 A3 (N-18, N-19): príprava dokumentov z pripojených priečinkov klienta. Zdroj mimo koreňa sa prijme len
// v práve pripojenom priečinku (overené pri každom čítaní); cudzí priečinok sa odmietne skôr, než sa čokoľvek prečíta.
import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import type { WorkspaceInfo } from "../../types.js";
import { LawossDocuments } from "./service.js";

async function pdf(text: string) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { font }); return doc.save();
}

async function fixture(run: (input: { service: LawossDocuments; client: WorkspaceInfo; other: WorkspaceInfo; linked: string; foreign: string; links: Map<string, string[]> }) => Promise<void>) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-documents-linked-")));
  const client: WorkspaceInfo = { id: "ws_a", name: "Tatran", path: join(root, "Klienti", "Tatran"), preset: "starter", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "a-storage" };
  const other: WorkspaceInfo = { id: "ws_b", name: "Hron", path: join(root, "Klienti", "Hron"), preset: "starter", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "b-storage" };
  const linked = join(root, "Zdieľané", "pripojený-A");
  const foreign = join(root, "Hron podklady");
  for (const folder of [client.path, other.path, linked, foreign]) await mkdir(folder, { recursive: true });
  await writeFile(join(linked, "Podklady.pdf"), await pdf("SYN obsah pripojeneho podkladu"));
  await writeFile(join(foreign, "Hron.pdf"), await pdf("SYN obsah ineho klienta"));
  const links = new Map<string, string[]>([["ws_a", [linked]], ["ws_b", [foreign]]]);
  const ocr = new OcrManager(join(root, "runtime"));
  const preparation = new DocumentPreparation(ocr, {});
  const service = new LawossDocuments({ configPath: join(root, "config.json") }, preparation, async (workspace) => links.get(workspace.id) ?? []);
  try { await run({ service, client, other, linked, foreign, links }); }
  finally { await service.stop(); preparation.stop(); ocr.stop(); await chmod(join(foreign, "Hron.pdf"), 0o644).catch(() => {}); await rm(root, { recursive: true, force: true }); }
}

async function settled(service: LawossDocuments, workspace: WorkspaceInfo) {
  for (let i = 0; i < 300; i++) {
    const records = await service.list(workspace);
    if (records.every(record => !["uploaded", "preparing"].includes(record.status))) return records;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not finish");
}

const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error && typeof error === "object" && "code" in error ? { code: error.code, message: String("message" in error ? error.message : "") } : { code: "unknown", message: String(error) });

test("klient pripraví a prečíta PDF z vlastného pripojeného priečinka; po odpojení sa čítanie odmietne", () => fixture(async ({ service, client, linked, links }) => {
  const [started] = await service.prepare(client, [join(linked, "Podklady.pdf")]);
  expect(started.path).toBe(join(linked, "Podklady.pdf").normalize("NFC"));
  const [record] = await settled(service, client);
  expect(record.status).toBe("readable");
  expect((await service.read(client, started.id)).text).toContain("SYN obsah pripojeneho podkladu");
  // Rovnaký zdroj sa pri ďalšej príprave použije znova (cesta je stabilná).
  expect((await service.prepare(client, [join(linked, "Podklady.pdf")]))[0].id).toBe(started.id);
  links.set("ws_a", []);
  expect(await failure(service.read(client, started.id))).toMatchObject({ code: "document_folder_not_linked" });
}));

test("iný klient: cudzí priečinok sa odmietne bez čítania a bez záznamu, text neuvádza meno klienta", () => fixture(async ({ service, client, other, linked, foreign }) => {
  // Nečitateľný súbor: keby ho služba otvorila, chyba by bola iná než odmietnutie.
  await chmod(join(foreign, "Hron.pdf"), 0o000);
  const refused = await failure(service.prepare(client, [join(foreign, "Hron.pdf")]));
  expect(refused).toMatchObject({ code: "document_folder_not_linked" });
  expect(refused?.message).not.toContain("Hron");
  expect(await failure(service.prepare(other, [join(linked, "Podklady.pdf")]))).toMatchObject({ code: "document_folder_not_linked" });
  expect(await failure(service.prepare(other, ["../../Zdieľané/pripojený-A/Podklady.pdf"]))).toMatchObject({ code: "document_folder_not_linked" });
  expect(await service.list(other)).toEqual([]);
  expect(await service.list(client)).toEqual([]);
}));

test("odkaz z pripojeného priečinka do iného priečinka sa vyrieši a odmietne", () => fixture(async ({ service, client, linked, foreign }) => {
  await symlink(join(foreign, "Hron.pdf"), join(linked, "odkaz.pdf"));
  await symlink(foreign, join(linked, "odkaz-priečinok"));
  expect(await failure(service.prepare(client, [join(linked, "odkaz.pdf")]))).toMatchObject({ code: "document_folder_not_linked" });
  expect(await failure(service.prepare(client, [join(linked, "odkaz-priečinok", "Hron.pdf")]))).toMatchObject({ code: "document_folder_not_linked" });
}));

test("zdroj v koreni klienta ostáva relatívny ako doteraz", () => fixture(async ({ service, client }) => {
  await writeFile(join(client.path, "zmluva.pdf"), await pdf("SYN zmluva"));
  const [started] = await service.prepare(client, [join(client.path, "zmluva.pdf")]);
  expect(started.path).toBe("zmluva.pdf");
  await settled(service, client);
  expect((await service.read(client, started.id)).text).toContain("SYN zmluva");
}));
