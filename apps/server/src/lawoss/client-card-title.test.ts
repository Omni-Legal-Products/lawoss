import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardTitleFromMarkdown, registrationName } from "./client-card-title.js";
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
});
