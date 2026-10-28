// LAWOSS: cesty `lawoss_files` v chate prípadu (N-A2-1, 23. 10. 2026). Pred opravou sa cesta od koreňa
// klienta zložila s priečinkom prípadu: „Spisy/M001…/Spisy/M001…/01_Podklady/IN-001/01-zmluva.docx does not exist“.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { chatFilePath, chatWorkspace } from "./lawoss-file-paths.js";

const client = join("/prax", "C001 SYN Tatran"), matter = join(client, "Spisy", "M001-uhrada-dodavok");

test("cesta od priečinka prípadu ostáva v prípade", () => {
  expect(chatFilePath("01_Podklady/IN-001/01-zmluva.docx", matter, client)).toBe(join(matter, "01_Podklady", "IN-001", "01-zmluva.docx"));
  expect(chatFilePath("./01_Podklady/a.docx", matter, client)).toBe(join(matter, "01_Podklady", "a.docx"));
});

test("cesta od koreňa klienta, ktorá začína prípadom, sa nezdvojí", () => {
  expect(chatFilePath("Spisy/M001-uhrada-dodavok/01_Podklady/IN-001/01-zmluva.docx", matter, client))
    .toBe(join(matter, "01_Podklady", "IN-001", "01-zmluva.docx"));
  expect(chatFilePath("./Spisy/M001-uhrada-dodavok/01_Podklady/IN-001/2025-02-09 Zmluva o dodávke.docx", matter, client))
    .toBe(join(matter, "01_Podklady", "IN-001", "2025-02-09 Zmluva o dodávke.docx"));
  // Iný prípad s rovnakou predponou mena nie je tento prípad.
  expect(chatFilePath("Spisy/M001-uhrada-dodavok-2/x.docx", matter, client)).toBe(join(matter, "Spisy", "M001-uhrada-dodavok-2", "x.docx"));
});

test("cesta od koreňa klienta sa nezdvojí ani pri inej veľkosti písmen alebo NFD (#223)", () => {
  const accented = join(client, "Spisy", "M002-úhrada");
  // Predpona sa nahradí presným zápisom priečinka chatu: na Linuxe by „spisy/m001…“ bol iný priečinok.
  expect(chatFilePath("spisy/m001-UHRADA-dodavok/01_Podklady/a.docx", matter, client)).toBe(join(matter, "01_Podklady", "a.docx"));
  expect(chatFilePath("Spisy/M002-úhrada/a.docx".normalize("NFD"), accented, client)).toBe(join(accented, "a.docx"));
  expect(chatFilePath("Spisy/M002-úhrada-2/a.docx".normalize("NFD"), accented, client)).toBe(join(accented, "Spisy/M002-úhrada-2/a.docx".normalize("NFD")));
});

test("chat klienta a absolútne cesty sa nemenia", () => {
  expect(chatFilePath("Spisy/M001-uhrada-dodavok/a.docx", client, client)).toBe(join(client, "Spisy", "M001-uhrada-dodavok", "a.docx"));
  const absolute = join("/iny", "a.docx");
  expect(chatFilePath(absolute, matter, client)).toBe(absolute);
  // `..` ostáva na serveri: hranicu klienta overí on.
  expect(chatFilePath("../M002/a.docx", matter, client)).toBe(join(client, "Spisy", "M002", "a.docx"));
});

test("priečinok chatu patrí najbližšiemu klientovi", () => {
  const workspaces = [{ id: "ws_prax", path: "/prax" }, { id: "ws_c001", path: client }, { id: "ws_c0011", path: `${client}1` }];
  expect(chatWorkspace(workspaces, matter)?.id).toBe("ws_c001");
  expect(chatWorkspace(workspaces, `${client}1`)?.id).toBe("ws_c0011");
  expect(chatWorkspace(workspaces, "/ina")).toBeUndefined();
});
