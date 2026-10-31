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
 * N-A8-1 (regresia 30. 10. 2026, MČ 31. 10.): iný presun alebo premenovanie (aj v rámci prípadu, aj v režime YOLO, kde
 * nástroj len nepýta kartu) nový riadok nepridá, ale riadky registrov nad pôvodným miestom (prípad, klient), ktoré
 * súbor menujú, dostanú novú cestu (`followInputs`). Pri priečinku všetky riadky súborov v ňom. Presun do pripojeného
 * priečinka (NAS) zapíše absolútnu cestu, ako ju advokát pripojil; appka ju nečíta ako cestu v prehľade. Presun do
 * Koša riadok neodstráni: uzavrie ho ako pri #292 (`processed`, „presunuté do Koša“) a pri priečinku `.lawoss-kos`
 * mu dá cestu tam. Kópia register nemení, originál ostáva na mieste.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { withFileWriteLocks } from "../file-write-lock.js";
import { statWithAdvancedMtime } from "./advance-mtime.js";
import {
  appendInputRow, codeSpan, INBOX_FOLDERS, INPUT_REGISTER_FILE, inputRow, MATTER_CARD_FILES, moveInputOriginal, moveInputOriginals, nextInputId, originalCell,
  parseWorkingProfile, PROFILE_FILE, receivedStamp,
} from "./input-register-runtime.js";
import { isPathWithin } from "./path-within.js";

/** Koreň, v ktorom súbor leží: priečinok klienta alebo pripojený priečinok (`label`); `path` ako ho advokát pripojil. */
export type InputRoot = { canonical: string; label: string | null; path?: string };
/**
 * Kam sa vstup zapísal: register (čitateľná cesta ako na karte), ID riadku a či sa existujúci riadok len presmeroval.
 * `handedOver`: riadok v inom registri (iný prípad, klient), ktorý sa uzavrel odkazom na tento.
 * N-A8-1: `trashed` = riadok sa uzavrel, lebo súbor išiel do Koša; `also` = ďalšie riadky, ktoré sa zmenili s ním.
 */
export type FiledInput = {
  register: string; id: string; updated?: true; trashed?: true; handedOver?: { register: string; id: string }; also?: { register: string; id: string }[];
};
/** N-A8-1: každý riadok, ktorý nasledoval presunutý súbor alebo priečinok (len pre audit; `path` je skutočná cesta). */
export type Followed = { register: string; id: string; path: string };
/** Výsledok zápisu; `paths` a `followed` sú skutočné cesty len pre audit. */
export type RecordedInput = FiledInput & { paths: string[]; followed?: Followed[] };

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

/** Absolútna cesta, ako koreň pripojil advokát (NAS pod jeho menom), nie jeho kanonický tvar. */
const configured = (root: InputRoot, path: string) => root.path ? join(root.path, relative(root.canonical, path)) : path;

/** Zvyšok cesty za presunutým priečinkom (`a/b.pdf`) pripojený k novému miestu; `""` = to isté miesto. */
const under = (place: string, rest: string) => rest ? join(place, ...rest.split("/")) : place;

/**
 * Nová bunka Originál pre riadok registra v priečinku `dir` (koreň zdroja). V tom istom koreni cesta voči registru, ako
 * ju píše appka (aj `../…` pri inom prípade, ako pri #292). N-A8-1 (b): v inom koreni (pripojený priečinok, NAS)
 * absolútna cesta v kódovom spane: advokát ju nájde a appka ju neprečíta ako cestu v priečinku klienta.
 */
const placeCell = (sourceRoot: InputRoot, targetRoot: InputRoot, target: string) => (dir: string, rest: string) =>
  sourceRoot === targetRoot ? originalCell(slash(relative(dir, under(target, rest)))) : codeSpan(configured(targetRoot, under(target, rest)));

/**
 * N-A8-1: presunutý, premenovaný alebo do Koša poslaný súbor či priečinok, ktorý registre nad pôvodným miestom (prípad,
 * klient) už evidujú: ich riadky dostanú novú bunku Originál (`cell`, `null` ju nechá); s `handedOver` sa uzavrú ako
 * pri #292. ID, zdroj a výsledné záznamy ostanú, nič sa nepridá. Register, ktorý nie je obyčajný súbor (odkaz, priečinok),
 * sa pri tomto sledovaní ani nečíta, ani nehlási ako chyba: bežné premenovanie neevidovaného súboru nesmie zlyhať pre
 * cudzí register vyššie. Výsledok menuje prvý zmenený riadok (najbližší register), ďalšie v `also`; audit dostane všetky.
 */
async function followInputs(source: string, kind: "file" | "folder", root: InputRoot, cell: (dir: string, rest: string) => string | null, handedOver?: string): Promise<RecordedInput | null> {
  const registers = ancestors(source, root.canonical).map((dir) => join(dir, INPUT_REGISTER_FILE));
  return withFileWriteLocks(registers, async () => {
    const followed: Followed[] = [];
    for (const path of registers) {
      const before = await readRegister(path).catch(() => null);
      const dir = dirname(path), was = inside(dir, source);
      if (!before || was === null) continue;
      const moved = moveInputOriginals(before.content, was, (rest) => cell(dir, rest), { folder: kind === "folder", ...(handedOver === undefined ? {} : { handedOver }) });
      if (!moved) continue;
      await writeRegister(path, moved.content, before);
      for (const id of moved.ids) followed.push({ register: shown(root, path), id, path });
    }
    const [first, ...others] = followed;
    if (!first) return null;
    return { register: first.register, id: first.id, ...(handedOver === undefined ? { updated: true as const } : { trashed: true as const }),
      ...(others.length ? { also: others.map(({ register, id }) => ({ register, id })) } : {}), paths: [...new Set(followed.map((item) => item.path))], followed };
  });
}

/** Text vo Výsledných záznamoch pri Koši: systémový Kôš, alebo skrytý priečinok `.lawoss-kos`, kam ide Originál. */
export const TRASHED_INPUT_NOTE = "presunuté do Koša";

/**
 * N-A8-1 (c): položka išla do Koša. Riadky, ktoré ju (alebo súbor v priečinku) menujú, ostanú a uzavrú sa s dôvodom.
 * `destination` = skutočné miesto v `.lawoss-kos` (Originál ukáže tam); systémový Kôš miesto nehlási, Originál ostane
 * pôvodnou cestou, kam položku Kôš vráti („Vrátiť späť“).
 */
export async function recordTrashedInput(item: { kind: "file" | "folder"; source: string; sourceRoot: string; destination: string | null }, roots: readonly InputRoot[]): Promise<RecordedInput | null> {
  const root = roots.find((candidate) => candidate.canonical === item.sourceRoot);
  if (!root || !isPathWithin(root.canonical, item.source)) return null;
  const { destination } = item;
  return followInputs(item.source, item.kind, root, destination ? (dir, rest) => originalCell(slash(relative(dir, under(destination, rest)))) : () => null,
    destination ? `${TRASHED_INPUT_NOTE} (skrytý priečinok .lawoss-kos)` : TRASHED_INPUT_NOTE);
}

/**
 * Po overenom presune alebo kópii: zapíše vstup, ak súbor prišiel z priečinka na nezaradené do prípadu. Iný presun
 * (aj priečinka, aj do pripojeného priečinka) len posunie existujúce riadky (`followInputs`). `null` = register sa
 * nezmenil. Chyba čítania alebo zápisu registra pri zaradení sa vyhodí; súbor ostáva tam, kam ho zmena dala.
 * `paths`: skutočné cesty zapísaných registrov, len pre audit.
 */
export async function recordFiledInput(
  item: { operation: "move" | "copy"; kind: "file" | "folder"; source: string; target: string }, roots: readonly InputRoot[], now = new Date(),
): Promise<RecordedInput | null> {
  const rootOf = (path: string) => roots.find((root) => isPathWithin(root.canonical, path));
  const sourceRoot = rootOf(item.source), targetRoot = rootOf(item.target);
  if (!sourceRoot || !targetRoot) return null;
  const cell = placeCell(sourceRoot, targetRoot, item.target);
  const follow = () => item.operation === "move" ? followInputs(item.source, item.kind, sourceRoot, cell) : null;
  // Zaradenie z nezaradených je len pre súbor; priečinok nesie riadky svojich súborov (N-A8-1 a).
  if (item.kind !== "file") return follow();
  if (!await inInbox(item.source, sourceRoot.canonical) || await inInbox(item.target, targetRoot.canonical)) return follow();
  const matter = await matterOf(item.target, targetRoot.canonical);
  if (!matter) return follow();
  const register = join(matter, INPUT_REGISTER_FILE);
  // Registre nad pôvodným miestom (iný prípad, klient), kde môže mať súbor riadok z appky; N-A8-1 (b) aj z iného koreňa.
  const earlier = ancestors(item.source, sourceRoot.canonical).map((dir) => join(dir, INPUT_REGISTER_FILE)).filter((path) => path !== register);
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
    const filed: RecordedInput = { register: shown(targetRoot, register), id, paths: [register] };
    // Review #292: riadok v inom prípade alebo u klienta nesmie ostať `pending` s neplatnou cestou. Kópia ho nechá.
    for (const other of item.operation === "move" ? earlier : []) {
      const before = await readRegister(other);
      const was = inside(dirname(other), item.source);
      if (!before || was === null) continue;
      const handed = moveInputOriginal(before.content, was, cell(dirname(other), ""),
        `presunuté do ${codeSpan(filed.register)}, ${id}`);
      if (!handed) continue;
      await writeRegister(other, handed.content, before);
      return { ...filed, handedOver: { register: shown(sourceRoot, other), id: handed.id }, paths: [register, other] };
    }
    return filed;
  });
}
