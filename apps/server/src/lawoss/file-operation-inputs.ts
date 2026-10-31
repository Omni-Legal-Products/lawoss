/**
 * LAWOSS N-A7-6 (úplný UI test 28. 10. 2026, D2): schválený presun alebo kópia dokumentu z priečinka na nezaradené
 * (prípadu alebo klienta) do prípadu sa zapíše do `VSTUPY.md` cieľového prípadu, nezávisle od modelu.
 *
 * Rovnaký riadok ako pri vložení dokumentu v appke (`matter-intake.ts`, spoločné `lawoss/okf/inputs.ts`):
 * nové ID `IN-00N`, čas prijatia, zdroj, odkaz na súbor voči priečinku `VSTUPY.md` a stav `pending`. `processed`
 * nastaví až agent po prečítaní celého podkladu (šablóna `templates/spis/AGENTS.md`). Riadok, ktorý už súbor
 * v priečinku na nezaradené menuje (vložený appkou), sa nepridá druhý raz: v registri cieľového prípadu jeho Originál
 * ukáže na nové miesto. Riadok v inom prípade alebo u klienta sa uzavrie (`processed`, „presunuté do …, IN-00X“),
 * aby neostal `pending` s neplatnou cestou (review #292).
 *
 * N-A8-1 (regresia 30. 10. 2026): iný presun alebo premenovanie súboru (aj v rámci prípadu, aj v režime YOLO, kde
 * nástroj len nepýta kartu) nový riadok nepridá, ale riadok registra nad pôvodným miestom, ktorý súbor menuje, dostane
 * novú cestu (`followMovedInput`). Kópia register nemení, originál ostáva na mieste. Len súbory v tom istom koreni.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { withFileWriteLocks } from "../file-write-lock.js";
import { statWithAdvancedMtime } from "./advance-mtime.js";
import {
  appendInputRow, codeSpan, INBOX_FOLDERS, INPUT_REGISTER_FILE, inputRow, MATTER_CARD_FILES, moveInputOriginal, nextInputId, originalCell,
  parseWorkingProfile, PROFILE_FILE, receivedStamp,
} from "./input-register-runtime.js";
import { isPathWithin } from "./path-within.js";

/** Koreň, v ktorom súbor leží: priečinok klienta alebo pripojený priečinok (`label`). */
export type InputRoot = { canonical: string; label: string | null };
/**
 * Kam sa vstup zapísal: register (čitateľná cesta ako na karte), ID riadku a či sa existujúci riadok len presmeroval.
 * `handedOver`: riadok v inom registri (iný prípad, klient), ktorý sa uzavrel odkazom na tento.
 */
export type FiledInput = { register: string; id: string; updated?: true; handedOver?: { register: string; id: string } };
/** N-A8-1: každý register, ktorého riadok nasledoval presunutý súbor (len pre audit; `path` je skutočná cesta). */
export type Followed = { register: string; id: string; path: string };

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

type Register = { content: string; mtimeMs: number };

/** Review #292: len obyčajný súbor; odkaz (symlink) ani priečinok s menom registra sa nečíta ani neprepíše. */
async function readRegister(path: string): Promise<Register | null> {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (!info) return null;
  if (!info.isFile()) throw new Error(`${basename(path)} is not a regular file; the input register was not changed.`);
  return { content: await readFile(path, "utf8"), mtimeMs: info.mtimeMs };
}

/**
 * Celý obsah naraz: dočasný súbor vedľa a premenovanie, ako zápis súboru na serveri. Chýbajúci register sa len založí
 * (`wx`), nikdy neprepíše ten, ktorý medzitým vznikol. Čas zmeny sa posunie ako pri zápise cez server (Windows),
 * aby appka so starou revíziou dostala konflikt.
 */
async function writeRegister(path: string, content: string, before: Register | null): Promise<void> {
  if (!before) await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  else {
    const temporary = `${path}.tmp-${randomUUID().slice(0, 8)}`;
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    try { await rename(temporary, path); }
    catch (error) { await rm(temporary, { force: true }); throw error; }
  }
  await statWithAdvancedMtime(path, before?.mtimeMs ?? null);
}

/** Relatívna cesta vnútri priečinka, inak `null`. */
const inside = (dir: string, path: string): string | null => isPathWithin(dir, path) ? slash(relative(dir, path)) : null;

/** Cesta registra, ako ju ukazuje karta: relatívne ku koreňu, pripojený priečinok s menom. */
const shown = (root: InputRoot, path: string) => {
  const relativePath = slash(relative(root.canonical, path));
  return root.label ? `${root.label}/${relativePath}` : relativePath;
};

/**
 * N-A8-1: presunutý alebo premenovaný súbor, ktorý register nad pôvodným miestom (prípad, klient) už eviduje: jeho
 * riadok dostane novú cestu voči priečinku registra (aj `../…` pri inom prípade, ako pri #292). ID, zdroj, stav
 * a výsledné záznamy ostanú, nič sa nepridá. Register, ktorý nie je obyčajný súbor (odkaz, priečinok), sa pri tomto
 * sledovaní ani nečíta, ani nehlási ako chyba: bežné premenovanie neevidovaného súboru nesmie zlyhať pre cudzí
 * register vyššie. Výsledok menuje najbližší zmenený register; audit dostane všetky.
 */
async function followMovedInput(source: string, target: string, root: InputRoot): Promise<(FiledInput & { paths: string[]; followed: Followed[] }) | null> {
  const registers = ancestors(source, root.canonical).map((dir) => join(dir, INPUT_REGISTER_FILE));
  return withFileWriteLocks(registers, async () => {
    const followed: Followed[] = [];
    for (const path of registers) {
      const before = await readRegister(path).catch(() => null);
      const dir = dirname(path), was = inside(dir, source);
      if (!before || was === null) continue;
      const moved = moveInputOriginal(before.content, was, originalCell(slash(relative(dir, target))));
      if (!moved) continue;
      await writeRegister(path, moved.content, before);
      followed.push({ register: shown(root, path), id: moved.id, path });
    }
    const [first] = followed;
    return first ? { register: first.register, id: first.id, updated: true, paths: followed.map((item) => item.path), followed } : null;
  });
}

/**
 * Po overenom presune alebo kópii súboru: zapíše vstup, ak súbor prišiel z priečinka na nezaradené do prípadu.
 * `null` = nejde o zaradenie. Chyba čítania alebo zápisu registra sa vyhodí; súbor ostáva tam, kam ho zmena dala.
 * `paths`: skutočné cesty zapísaných registrov, len pre audit.
 */
export async function recordFiledInput(
  item: { operation: "move" | "copy"; kind: "file" | "folder"; source: string; target: string }, roots: readonly InputRoot[], now = new Date(),
): Promise<(FiledInput & { paths: string[]; followed?: Followed[] }) | null> {
  if (item.kind !== "file") return null;
  const rootOf = (path: string) => roots.find((root) => isPathWithin(root.canonical, path));
  const sourceRoot = rootOf(item.source), targetRoot = rootOf(item.target);
  if (!sourceRoot || !targetRoot) return null;
  const follow = () => item.operation === "move" && sourceRoot === targetRoot ? followMovedInput(item.source, item.target, sourceRoot) : null;
  if (!await inInbox(item.source, sourceRoot.canonical) || await inInbox(item.target, targetRoot.canonical)) return follow();
  const matter = await matterOf(item.target, targetRoot.canonical);
  if (!matter) return follow();
  const register = join(matter, INPUT_REGISTER_FILE);
  // Registre nad pôvodným miestom v tom istom koreni (iný prípad, klient), kde môže mať súbor riadok z appky.
  const earlier = sourceRoot === targetRoot
    ? ancestors(item.source, sourceRoot.canonical).map((dir) => join(dir, INPUT_REGISTER_FILE)).filter((path) => path !== register) : [];
  const target = originalCell(slash(relative(matter, item.target)));
  return withFileWriteLocks([register, ...earlier], async () => {
    const current = await readRegister(register);
    // Riadok v registri cieľového prípadu (vložené appkou do jeho priečinka na nezaradené): zmení sa len cesta.
    const from = inside(matter, item.source);
    const moved = item.operation === "move" && current && from !== null ? moveInputOriginal(current.content, from, target) : null;
    if (moved) {
      await writeRegister(register, moved.content, current);
      return { register: shown(targetRoot, register), id: moved.id, updated: true, paths: [register] };
    }
    const id = nextInputId(current?.content ?? null);
    const origin = from ?? shown(sourceRoot, item.source);
    const row = inputRow(id, receivedStamp(now), target, `${FILED_INPUT_SOURCE}: ${codeSpan(origin)}`);
    await writeRegister(register, appendInputRow(current?.content ?? null, row, basename(matter)), current);
    const filed: FiledInput & { paths: string[] } = { register: shown(targetRoot, register), id, paths: [register] };
    // Review #292: riadok v inom prípade alebo u klienta nesmie ostať `pending` s neplatnou cestou. Kópia ho nechá.
    for (const other of item.operation === "move" ? earlier : []) {
      const before = await readRegister(other);
      const was = inside(dirname(other), item.source);
      if (!before || was === null) continue;
      const handed = moveInputOriginal(before.content, was, originalCell(slash(relative(dirname(other), item.target))),
        `presunuté do ${codeSpan(filed.register)}, ${id}`);
      if (!handed) continue;
      await writeRegister(other, handed.content, before);
      return { ...filed, handedOver: { register: shown(sourceRoot, other), id: handed.id }, paths: [register, other] };
    }
    return filed;
  });
}
