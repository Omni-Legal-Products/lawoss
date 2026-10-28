/**
 * LAWOSS N-A7-6 (úplný UI test 28. 10. 2026, D2): schválený presun alebo kópia dokumentu z priečinka na nezaradené
 * (prípadu alebo klienta) do prípadu sa zapíše do `VSTUPY.md` cieľového prípadu, nezávisle od modelu.
 *
 * Rovnaký riadok ako pri vložení dokumentu v appke (`matter-intake.ts`, spoločné `lawoss/okf/inputs.ts`):
 * nové ID `IN-00N`, čas prijatia, zdroj, odkaz na súbor voči priečinku `VSTUPY.md` a stav `pending`. `processed`
 * nastaví až agent po prečítaní celého podkladu (šablóna `templates/spis/AGENTS.md`). Riadok, ktorý už súbor
 * v priečinku na nezaradené menuje (vložený appkou), sa nepridá druhý raz: jeho Originál ukáže na nové miesto.
 *
 * Len súbory; presun v rámci prípadu, do priečinka na nezaradené alebo mimo prípadu register nemení.
 */
import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { withFileWriteLocks } from "../file-write-lock.js";
import {
  appendInputRow, INBOX_FOLDERS, INPUT_REGISTER_FILE, inputRow, MATTER_CARD_FILES, moveInputOriginal, nextInputId, originalCell,
  parseWorkingProfile, PROFILE_FILE, receivedStamp,
} from "./input-register-runtime.js";
import { isPathWithin } from "./path-within.js";

/** Koreň, v ktorom súbor leží: priečinok klienta alebo pripojený priečinok (`label`). */
export type InputRoot = { canonical: string; label: string | null };
/** Kam sa vstup zapísal: register (čitateľná cesta ako na karte), ID riadku a či sa existujúci riadok len presmeroval. */
export type FiledInput = { register: string; id: string; updated?: true };

/** Zdroj nového riadku; za dvojbodkou pôvodné miesto súboru. */
export const FILED_INPUT_SOURCE = "presun z priečinka na nezaradené (LAWOSS)";

const CLIENT_CARD_FILES = ["client.md", "klient.md"];
const key = (name: string) => name.normalize("NFC").toLowerCase();
const names = async (dir: string) => (await readdir(dir).catch(() => [])).map(key);
const slash = (path: string) => path.split(sep).join("/");

/** Priečinky nad súborom až po koreň (vrátane), najbližší prvý. */
function ancestors(path: string, root: string): string[] {
  const list: string[] = [];
  for (let dir = dirname(path); isPathWithin(root, dir); dir = dirname(dir)) {
    list.push(dir);
    if (dir === root || dirname(dir) === dir) break;
  }
  return list;
}

async function customInbox(dir: string): Promise<string | undefined> {
  const entry = (await readdir(dir).catch(() => [])).find((name) => key(name) === key(PROFILE_FILE));
  if (!entry) return undefined;
  try { return parseWorkingProfile(await readFile(join(dir, entry), "utf8")).roles.inbox || undefined; }
  catch { return undefined; } // Neplatný profil: platia predvolené priečinky na nezaradené, ako v prehľade.
}

/** Súbor leží v priečinku na nezaradené: predvolené meno (`00_Na_zatriedenie`, …) alebo rola `inbox` pracovného profilu. */
async function inInbox(path: string, root: string): Promise<boolean> {
  for (const dir of ancestors(path, root)) {
    if (dir !== root && INBOX_FOLDERS.has(key(basename(dir)))) return true;
    const inbox = await customInbox(dir);
    if (inbox && isPathWithin(join(dir, inbox), path)) return true;
  }
  return false;
}

/** Najbližší priečinok s kartou veci; priečinok s kartou klienta hľadanie ukončí (súbor nie je v prípade). */
async function matterOf(path: string, root: string): Promise<string | undefined> {
  for (const dir of ancestors(path, root)) {
    const listed = await names(dir);
    if (MATTER_CARD_FILES.some((card) => listed.includes(card))) return dir;
    if (CLIENT_CARD_FILES.some((card) => listed.includes(card))) return undefined;
  }
  return undefined;
}

async function readRegister(path: string): Promise<string | null> {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
}

/** Celý obsah naraz: dočasný súbor vedľa a premenovanie, ako zápis súboru na serveri. */
async function writeRegister(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp-${randomUUID().slice(0, 8)}`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  try { await rename(temporary, path); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** Relatívna cesta vnútri priečinka, inak `null`. */
const inside = (dir: string, path: string): string | null => isPathWithin(dir, path) ? slash(relative(dir, path)) : null;

/**
 * Po overenom presune alebo kópii súboru: zapíše vstup, ak súbor prišiel z priečinka na nezaradené do prípadu.
 * `null` = nejde o zaradenie. Chyba čítania alebo zápisu registra sa vyhodí; súbor ostáva tam, kam ho zmena dala.
 */
export async function recordFiledInput(
  item: { operation: "move" | "copy"; kind: "file" | "folder"; source: string; target: string }, roots: readonly InputRoot[], now = new Date(),
): Promise<FiledInput | null> {
  if (item.kind !== "file") return null;
  const rootOf = (path: string) => roots.find((root) => isPathWithin(root.canonical, path));
  const sourceRoot = rootOf(item.source), targetRoot = rootOf(item.target);
  if (!sourceRoot || !targetRoot) return null;
  if (!await inInbox(item.source, sourceRoot.canonical) || await inInbox(item.target, targetRoot.canonical)) return null;
  const matter = await matterOf(item.target, targetRoot.canonical);
  if (!matter) return null;
  const shown = (root: InputRoot, path: string) => {
    const relativePath = slash(relative(root.canonical, path));
    return root.label ? `${root.label}/${relativePath}` : relativePath;
  };
  const register = join(matter, INPUT_REGISTER_FILE);
  // Riadok, ktorý súbor už menuje: najprv register cieľového prípadu, potom registre nad pôvodným miestom v tom istom koreni.
  const candidates = [register, ...(sourceRoot === targetRoot ? ancestors(item.source, sourceRoot.canonical).map((dir) => join(dir, INPUT_REGISTER_FILE)) : [])]
    .filter((path, index, all) => all.indexOf(path) === index);
  return withFileWriteLocks(candidates, async () => {
    // Kópia nechá originál na mieste: jeho riadok ostáva a kópia dostane vlastný.
    for (const candidate of item.operation === "move" ? candidates : []) {
      const content = await readRegister(candidate);
      const from = inside(dirname(candidate), item.source), to = inside(dirname(candidate), item.target);
      if (content === null || from === null || to === null) continue;
      const moved = moveInputOriginal(content, from, originalCell(to));
      if (!moved) continue;
      await writeRegister(candidate, moved.content);
      return { register: shown(targetRoot, candidate), id: moved.id, updated: true };
    }
    const content = await readRegister(register);
    const id = nextInputId(content);
    const origin = inside(matter, item.source) ?? shown(sourceRoot, item.source);
    const row = inputRow(id, receivedStamp(now), originalCell(slash(relative(matter, item.target))), `${FILED_INPUT_SOURCE}: ${origin}`);
    await writeRegister(register, appendInputRow(content, row, basename(matter)));
    return { register: shown(targetRoot, register), id };
  });
}
