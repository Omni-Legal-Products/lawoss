import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardTitleFromMarkdown, registrationName, withClientCardTitles } from "./client-card-title.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await removeTestDir(root); });

test("názov z frontmatteru karty: úvodzovky, apostrofy, bez názvu a mimo frontmatteru nič", () => {
  expect(cardTitleFromMarkdown("---\ntype: klient\ntitle: \"SYN Tatran Automatika, s. r. o.\"\n---\n# x")).toBe("SYN Tatran Automatika, s. r. o.");
  expect(cardTitleFromMarkdown("﻿---\r\ntitle: 'O''Brien s.r.o.'\r\n---\r\n")).toBe("O'Brien s.r.o.");
  expect(cardTitleFromMarkdown("---\ntitle: Novák Ján\n---\n")).toBe("Novák Ján");
  expect(cardTitleFromMarkdown("---\ntitle: \"\"\n---\n")).toBeUndefined();
  expect(cardTitleFromMarkdown("---\ntype: klient\n---\ntitle: telo\n")).toBeUndefined();
  expect(cardTitleFromMarkdown("title: bez frontmatteru\n")).toBeUndefined();
  for (const block of [">", "|", ">-", "[SYN]", "{a: b}", "&kotva", "*odkaz", "!!str x"]) expect(cardTitleFromMarkdown(`---\ntitle: ${block}\n---\n`)).toBeUndefined();
});

test("meno registrácie: len meno priečinka sa nahradí názvom karty (client.md aj klient.md); vlastné meno a priečinok bez karty ostanú", async () => {
  const base = await mkdtemp(join(tmpdir(), "lawoss-card-title-")); roots.push(base);
  const card = join(base, "C001-syn-alfa"), legacy = join(base, "C002-beta"), none = join(base, "C003");
  for (const dir of [card, legacy, none]) await mkdir(dir);
  await writeFile(join(card, "client.md"), "---\ntitle: \"SYN Alfa, s. r. o.\"\n---\n");
  await writeFile(join(legacy, "klient.md"), "---\ntitle: SYN Beta, a. s.\n---\n");
  expect(await registrationName(card, "C001-syn-alfa")).toBe("SYN Alfa, s. r. o.");
  expect(await registrationName(legacy, "C002-beta")).toBe("SYN Beta, a. s.");
  expect(await registrationName(card, "Môj názov")).toBe("Môj názov");
  expect(await registrationName(none, "C003")).toBe("C003");
  // Meno priečinka v inom tvare (veľké/malé písmená, NFD) je stále len meno priečinka.
  expect(await registrationName(card, "c001-SYN-alfa")).toBe("SYN Alfa, s. r. o.");
  const nfd = join(base, "Šimková"); await mkdir(nfd);
  await writeFile(join(nfd, "client.md"), "---\ntitle: SYN Zuzana Šimková\n---\n");
  expect(await registrationName(nfd, "Šimková".normalize("NFD"))).toBe("SYN Zuzana Šimková");
});

test("N-A4-2: návrh onboardingu nesie názov z karty klienta; bez karty, symlink a cesta mimo koreňa nič", async () => {
  const base = await mkdtemp(join(tmpdir(), "lawoss-card-suggest-")); roots.push(base);
  const office = join(base, "kancelaria"), outside = join(base, "mimo");
  for (const dir of [join(office, "Klienti/C001-syn-tatran"), join(office, "Klienti/C002-syn-hron"), join(office, "Klienti/C003"), join(office, "Klienti/C004-link"), outside]) await mkdir(dir, { recursive: true });
  await writeFile(join(office, "Klienti/C001-syn-tatran/client.md"), "---\ntitle: \"SYN Tatran Automatika, s. r. o.\"\n---\n");
  await writeFile(join(office, "Klienti/C002-syn-hron/klient.md"), "---\ntitle: SYN Hron, a. s.\n---\n");
  await writeFile(join(outside, "client.md"), "---\ntitle: Cudzí klient\n---\n");
  // Symlink na kartu mimo klienta sa nečíta (na Windows bez oprávnenia na symlinky ostane priečinok bez karty).
  if (process.platform !== "win32") await symlink(join(outside, "client.md"), join(office, "Klienti/C004-link/client.md"));
  const clients = ["Klienti/C001-syn-tatran", "Klienti/C002-syn-hron", "Klienti/C003", "Klienti/C004-link", "../mimo"].map((path) => ({ path, name: path.split("/").pop() ?? path }));
  const suggestion = await withClientCardTitles({ root: office, level: "practice", clients, practiceCandidates: clients });
  expect(suggestion.clients).toEqual([
    { path: "Klienti/C001-syn-tatran", name: "C001-syn-tatran", title: "SYN Tatran Automatika, s. r. o." },
    { path: "Klienti/C002-syn-hron", name: "C002-syn-hron", title: "SYN Hron, a. s." },
    { path: "Klienti/C003", name: "C003" },
    { path: "Klienti/C004-link", name: "C004-link" },
    { path: "../mimo", name: "mimo" },
  ]);
  expect(suggestion.practiceCandidates).toEqual(suggestion.clients);
  expect(suggestion.level).toBe("practice");
  expect("rootTitle" in suggestion).toBe(false);
  // Klient otvorený priamo: názov z karty v koreni.
  expect((await withClientCardTitles({ root: join(office, "Klienti/C001-syn-tatran"), clients: [], practiceCandidates: [] })).rootTitle).toBe("SYN Tatran Automatika, s. r. o.");
});
