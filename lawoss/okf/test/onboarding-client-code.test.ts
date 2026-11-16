import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientExistsError, clientFolderSlug, newClientFolder, newClientFolderName } from "../src/onboarding/entities.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";

// #433: priečinok nového klienta podľa zvyklosti kancelárie (kód `C025-slug`, inak meno klienta).
setDefaultTimeout(30_000);
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }

/** Priečinky klientov syntetickej kancelárie (výber). */
const SYNTHETIC = ["C001-syn-tatran-automatika-s-r-o", "C002-syn-hron-technologie-a-s", "C017-syn-zuzana-simkova", "C021-syn-petra-zilinska-graficke-sluzby", "C024-syn-tomas-svec-remesla"];

test("slug follows the synthetic office: lowercase ASCII, hyphens, „s. r. o.“ → s-r-o", () => {
  expect(clientFolderSlug("SYN Tatran Automatika, s. r. o.")).toBe("syn-tatran-automatika-s-r-o");
  expect(clientFolderSlug("SYN Hron Technológie, a. s.")).toBe("syn-hron-technologie-a-s");
  expect(clientFolderSlug("SYN Zuzana Šimková")).toBe("syn-zuzana-simkova");
  expect(clientFolderSlug("SYN Petra Žilinská – grafické služby")).toBe("syn-petra-zilinska-graficke-sluzby");
  expect(clientFolderSlug("Ľubomír Ďurica, Čučoriedka & Ťava")).toBe("lubomir-durica-cucoriedka-tava");
  expect(clientFolderSlug("Müller & Straße GmbH")).toBe("muller-strasse-gmbh");
});

test("long names are cut at a word boundary, never mid-word or with a trailing hyphen", () => {
  const slug = clientFolderSlug("Spoločenstvo vlastníkov bytov a nebytových priestorov v bytovom dome Hlavná ulica 12, Bratislava");
  expect(slug.length).toBeLessThanOrEqual(60);
  expect(slug).toBe("spolocenstvo-vlastnikov-bytov-a-nebytovych-priestorov-v");
  expect(slug.endsWith("-")).toBe(false);
  expect(clientFolderSlug("a".repeat(80))).toBe("a".repeat(60));
});

test("coded office: next code after the highest, slug of the name, leading SYN kept", () => {
  expect(newClientFolderName("Novák Reality, s. r. o.", SYNTHETIC)).toBe("C025-novak-reality-s-r-o");
  expect(newClientFolderName("SYN Nová Firma, a. s.", SYNTHETIC)).toBe("C025-syn-nova-firma-a-s");
});

test("gaps in numbering are not filled: max + 1", () => {
  expect(newClientFolderName("Novák", ["C001-a", "C002-b", "C007-c", "C010-d"])).toBe("C011-novak");
});

test("prefix and padding come from the existing folders", () => {
  expect(newClientFolderName("Novák", ["K0041-alfa", "K0009-beta", "K0100-gama"])).toBe("K0101-novak");
  expect(newClientFolderName("Novák", ["KL07-alfa", "KL08-beta"])).toBe("KL09-novak");
});

test("without a clear majority of coded folders the folder is the client's name", () => {
  expect(newClientFolderName("Novák s. r. o.", ["C001-alfa", "C002-beta", "Horváth", "Kováč"])).toBe("Novák s. r. o");
  expect(newClientFolderName("Novák", ["C001-alfa", "Horváth"])).toBe("Novák");
  expect(newClientFolderName("Novák", ["C001-alfa"])).toBe("Novák");
  expect(newClientFolderName("Novák", ["C001-alfa", "K002-beta", "X003-gama"])).toBe("Novák");
  // Hidden and volatile entries do not count toward the majority.
  expect(newClientFolderName("Novák", ["C001-alfa", "C002-beta", "Horváth", ".git", "Thumbs.db"])).toBe("C003-novak");
});

test("empty clients folder: the client's name", () => {
  expect(newClientFolderName("Novák Reality, s. r. o.", [])).toBe("Novák Reality, s. r. o");
});

test("collision: never overwrite, take the next number", () => {
  // A file (not counted as a client folder) or a folder that only differs in case holds the computed name.
  expect(newClientFolderName("Novák", ["C001-a", "C002-b"], ["C001-a", "C002-b", "c003-novak"])).toBe("C004-novak");
  // The same code with another slug is also taken.
  expect(newClientFolderName("Novák", ["C001-a", "C002-b"], ["C001-a", "C002-b", "C003-ine.pdf"])).toBe("C004-novak");
  // A genuine number collision: another client already holds C003, so the new one moves on.
  expect(newClientFolderName("Novák", ["C001-a", "C002-b"], ["C001-a", "C002-b", "C003-horvath"])).toBe("C004-novak");
});

test("the same client again in a coded office is refused, naming the existing folder", () => {
  const same = () => newClientFolderName("SYN Tomáš Švec – remeslá", SYNTHETIC);
  expect(same).toThrow(ClientExistsError);
  try { same(); } catch (error) { expect(error).toMatchObject({ code: "client_exists", folder: "C024-syn-tomas-svec-remesla" }); }
  // Punctuation, case and diacritics do not make it a new client.
  expect(() => newClientFolderName("syn tatran automatika s.r.o.", SYNTHETIC)).toThrow(ClientExistsError);
  // The client card's name counts even when the folder slug differs (e.g. a renamed folder).
  const cards = new Map([["C002-hron", "Hron Technológie, a. s."]]);
  expect(() => newClientFolderName("HRON technologie a.s.", ["C001-a", "C002-hron"], undefined, cards)).toThrow(ClientExistsError);
  expect(newClientFolderName("Hron Stavby, a. s.", ["C001-a", "C002-hron"], undefined, cards)).toBe("C003-hron-stavby-a-s");
});

test("the same client again is found also by the card on disk", async () => {
  const parent = await directory("okf-klienti-");
  for (const name of ["C001-a", "C002-b"]) await mkdir(join(parent, name));
  await writeFile(join(parent, "C002-b", "client.md"), '---\ntype: client\ntitle: "SYN Novák Reality, s. r. o."\n---\n');
  await expect(newClientFolder(parent, "SYN Novák Reality s.r.o.")).rejects.toMatchObject({ code: "client_exists", folder: "C002-b" });
  expect(await newClientFolder(parent, "SYN Iná Firma")).toBe("C003-syn-ina-firma");
});

test("a name without letters or digits still gets a code", () => {
  expect(newClientFolderName("東京", ["C001-a", "C002-b"])).toBe("C003-klient");
});

test("invalid names are refused also in a coded office", () => {
  expect(() => newClientFolderName("..", ["C001-a", "C002-b"])).toThrow();
  expect(() => newClientFolderName("a:b", ["C001-a", "C002-b"])).toThrow();
});

test("form plan in a coded office creates the coded folder, the card keeps the real name", async () => {
  const parent = await directory("okf-klienti-");
  for (const name of SYNTHETIC) await mkdir(join(parent, name));
  await writeFile(join(parent, "C030-poznamka.txt"), "x"); // súbor nie je priečinok klienta: najvyšší kód ostáva C024
  expect(await newClientFolder(parent, "Novák Reality, s. r. o.")).toBe("C025-novak-reality-s-r-o");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "client", parent, name: "Novák Reality, s. r. o.", title: "Novák Reality, s. r. o.", clientType: "po", jurisdiction: "sk", date: "2026-11-16", language: "sk" }));
  if (preview.mode !== "new") throw new Error("Expected new client plan.");
  expect(preview.target).toBe(join(parent, "C025-novak-reality-s-r-o"));
  expect(preview.clientRoot).toBe(preview.target);
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  expect(await readFile(join(parent, "C025-novak-reality-s-r-o", "client.md"), "utf8")).toContain("Novák Reality, s. r. o.");
});

test("form plan in an uncoded office keeps the client's name as the folder", async () => {
  const parent = await directory("okf-klienti-");
  await mkdir(join(parent, "Horváth"));
  const preview = await planOnboarding(parseOnboardingRequest({ action: "client", parent, name: "Novák", title: "Novák", clientType: "fo", jurisdiction: "sk", date: "2026-11-16", language: "sk" }));
  if (preview.mode !== "new") throw new Error("Expected new client plan.");
  expect(preview.target).toBe(join(parent, "Novák"));
});
