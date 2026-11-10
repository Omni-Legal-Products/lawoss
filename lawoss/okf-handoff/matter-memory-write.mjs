import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeRecord } from "../okf-pamat/src/cli.ts";
import { canonicalValue, parseRecord, serializeRecord } from "../okf-pamat/src/record.ts";
import { findClientDir, findOfficeDir, hasMatterCard, jurisdictionFromCard, readScope } from "../okf-pamat/src/store.ts";
import { workspaceProfilePresent } from "./workspace-checkpoint.mjs";

/** Polia, ktoré karta ukazuje inak (text, história) alebo ktoré sa odvodzujú pri zápise. */
const SHOWN_APART = new Set(["okf", "title", "truth", "timeline", "truth_digest", "updated"]);

const empty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
const shown = (value) => typeof value === "string" ? value : canonicalValue(value) ?? "";

/**
 * LAWOSS (N-A7-10, MČ 23. 10. 2026: zápis s kartou „čo a kam“): zápis jedného záznamu pamäte spisu
 * bez shellu a bez dočasného súboru v priečinku klienta. Ten istý kód ako `okf-memory write`
 * (`writeRecord`), v procese servera; bez `apply` iba náhľad. Meno schvaľujúceho (`--approve-as`)
 * sem nikdy nejde: hostiteľ zapisuje len to, čo brána pustí bez neho. Hranicu klienta overí volajúci;
 * tu sa odmietne kancelária (jej pamäť čítajú všetci klienti) a priečinok bez karty veci.
 */
export function writeMatterMemory(directory, text, { reason, expectedRevision, apply = false }) {
  const office = findOfficeDir(directory);
  if (office && resolve(office) === resolve(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this is the office memory, shared by every client; write only to this client's case." };
  }
  if (!hasMatterCard(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this folder is not a case (no matter.md); write to the case folder, not the client root, an inbox or memory/." };
  }
  if (workspaceProfilePresent(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: write uses typed OKF memory, but .lawoss/memory-profile.json is present." };
  }
  return described(writeRecord(directory, text, { reason, expectedRevision, apply }));
}

/** Výsledok `writeRecord` s plánom pre kartu hostiteľa. */
function described(result) {
  if (!result.plan) return { code: result.code, out: result.out };
  const { diff, targetDir, file } = result.plan;
  const record = diff.after ?? diff.before;
  const history = diff.after ? diff.after.timeline.slice(diff.before?.timeline.length ?? 0).map((entry) => `${entry.date} — ${entry.text}`) : [];
  // Nový záznam: každé neprázdne pole (aj citlivé údaje subjektu), aby karta ukázala všetko, čo sa zapíše.
  // Úprava: zmenené polia, ako ich ukazuje diff CLI (`~ pole: pred → po`).
  const fields = diff.kind === "create" && diff.after
    ? Object.entries(diff.after).filter(([key, value]) => !SHOWN_APART.has(key) && !empty(value)).map(([key, value]) => `${key}: ${shown(value)}`)
    : diff.lines.filter((line) => line.startsWith("~ ") && !line.startsWith("~ Truth") && !line.startsWith("~ updated:")).map((line) => line.slice(2));
  return {
    code: result.code, out: result.out,
    plan: {
      kind: diff.kind, id: diff.id, layer: diff.layer, requiresApproval: diff.requiresApproval, targetDir, file,
      title: record?.title ?? diff.id, type: record?.type ?? "", truth: diff.after?.truth ?? "",
      ...(diff.kind === "update" && diff.before && diff.before.truth !== diff.after?.truth ? { previousTruth: diff.before.truth } : {}),
      history, fields,
      // Bajty zapisovaného záznamu: schválenie karty sa viaže na ne, nie len na výpis náhľadu.
      recordHash: createHash("sha256").update(diff.after ? serializeRecord(diff.after) : "").digest("hex"),
    },
  };
}

const CLIENT_CARDS = ["client.md", "klient.md"];
const hasClientCard = (dir) => CLIENT_CARDS.some((name) => lstatSync(join(dir, name), { throwIfNoEntry: false })?.isFile() === true);

/**
 * Typy, ktoré smú žiť u klienta: `subject` a `screening` podľa pravidiel OKF (SKILL.md „Tri úrovne pamäte“) a
 * `client_note` (vlastný typ, vždy L2) pre pracovnú poznámku platnú pre celého klienta, napr. spôsob komunikácie.
 */
export const CLIENT_RECORD_TYPES = ["subject", "screening", "client_note"];
/** ID poznámky klienta: vlastný prefix, aby sa nezrazil s ID v prípadoch (duplicitné ID robí čítanie neúplným). */
const CLIENT_NOTE_ID = /^CN-\d{3,}$/;
/** Koľko priečinkov sa najviac prejde pri hľadaní prípadov klienta (ohraničené, RAM/čas). */
const CASE_SCAN_LIMIT = 2000, CASE_SCAN_DEPTH = 5;

/** Priečinok klienta, do ktorého patrí `directory`: sám (má kartu klienta), inak klient nad prípadom. */
export function clientMemoryDir(directory) {
  if (hasClientCard(directory)) return directory;
  try { return findClientDir(directory); } catch { return undefined; }
}

/** Súbor záznamu s daným ID v `<dir>/memory/` (meno `<id>.md` alebo `<id>-…`), bez čítania obsahu. */
function holdsId(dir, id) {
  try { return readdirSync(join(dir, "memory")).some((name) => name === `${id}.md` || name.startsWith(`${id}-`)); }
  catch { return false; }
}

/** Prípady pod klientom (priečinky s kartou veci), ohraničene; do prípadu, iného klienta a skrytých priečinkov sa nevchádza. */
function casesBelow(client) {
  const cases = [];
  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > CASE_SCAN_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "memory" || entry.name === "node_modules") continue;
      if (++visited > CASE_SCAN_LIMIT) return;
      const path = join(dir, entry.name);
      if (hasMatterCard(path)) { cases.push(path); continue; }
      if (hasClientCard(path)) continue;
      walk(path, depth + 1);
    }
  };
  walk(client, 1);
  return cases;
}

/**
 * LAWOSS (rozhodnutie MČ 10. 11. 2026): záznam na úrovni klienta (`<klient>/memory/`), ktorý `readScope()` prečíta pri
 * každom prípade klienta. Ten istý kód a brány ako `writeMatterMemory`; priečinok musí mať kartu klienta a nesmie byť
 * prípadom ani kanceláriou. Len typy z `CLIENT_RECORD_TYPES` vo vrstve L2: L1/L3 (pravidlá a pramene kancelárie)
 * ostávajú za schválením človeka v CLI a klientske údaje sa do nich touto cestou nedostanú.
 */
export function writeClientMemory(directory, text, { reason, expectedRevision, apply = false }) {
  const office = findOfficeDir(directory);
  if (office && resolve(office) === resolve(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this is the office memory, shared by every client; write only to this client." };
  }
  if (!hasClientCard(directory) || hasMatterCard(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this folder is not a client's folder (no client.md, or it is a case); a client-level record goes to the client's own folder." };
  }
  if (workspaceProfilePresent(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: write uses typed OKF memory, but .lawoss/memory-profile.json is present." };
  }
  let record;
  try { record = parseRecord(text); }
  catch (error) { return { code: 2, out: `Návrh sa nedá prečítať: ${error instanceof Error ? error.message : String(error)}` }; }
  if (!CLIENT_RECORD_TYPES.includes(record.type) || record.layer !== "L2") {
    return { code: 1, out: `ODMIETNUTÉ: a client-level record is only ${CLIENT_RECORD_TYPES.join(", ")} in layer L2; ${record.type} (${record.layer}) belongs to a case or, for L1/L3, to the office with the lawyer's approval.` };
  }
  if (record.type === "client_note" && !CLIENT_NOTE_ID.test(record.id)) {
    return { code: 1, out: "ODMIETNUTÉ: a client note uses the ID CN-001, CN-002, … (the next free number in this client's memory)." };
  }
  // Nový záznam: to isté ID v prípade klienta alebo v kancelárii by urobilo čítanie každého prípadu neúplným.
  if (!holdsId(directory, record.id)) {
    const taken = [...casesBelow(directory), ...(office ? [office] : [])].find((dir) => holdsId(dir, record.id));
    if (taken) return { code: 1, out: `ODMIETNUTÉ: the ID ${record.id} is already used in one of this client's cases or in the office memory; choose the next free ID.` };
  }
  return described(writeRecord(directory, text, { reason, expectedRevision, apply }));
}

/** Značka lehoty zapísanej podľa pokynu advokáta, neoverenej z listiny; čitatelia (`lawoss/okf/read.ts`, kokpit) ju ukážu pri lehote. */
export const INSTRUCTION_DEADLINE_BASIS = "lawyer_instruction";

const DEADLINE_TEXT = {
  sk: {
    description: "Lehota podľa pokynu advokáta, neoverená z listiny.",
    truth: (date, what, input, instruction) => `Lehota ${date}: ${what}. Zapísané podľa pokynu advokáta v chate (${input}), neoverené z listiny.\n\nPokyn advokáta: „${instruction}“`,
    history: (date, input) => `Lehota ${date} zapísaná podľa pokynu advokáta v chate (${input}); neoverená z listiny.`,
  },
  cz: {
    description: "Lhůta podle pokynu advokáta, neověřená z listiny.",
    truth: (date, what, input, instruction) => `Lhůta ${date}: ${what}. Zapsáno podle pokynu advokáta v chatu (${input}), neověřeno z listiny.\n\nPokyn advokáta: „${instruction}“`,
    history: (date, input) => `Lhůta ${date} zapsána podle pokynu advokáta v chatu (${input}); neověřená z listiny.`,
  },
};

const oneLine = (text) => text.replace(/\s+/g, " ").trim();
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/**
 * LAWOSS (rozhodnutie MČ 10. 11. 2026): záznam lehoty, ktorú advokát povedal v chate s výslovným dátumom. Nová úloha
 * (`task`, L2) s lehotou v `deadlines` (nie `due`) a značkou `deadline_basis: lawyer_instruction`; bez `verified`, takže
 * lehota ostáva nepotvrdená (kandidát) a čitatelia ju ukážu ako „podľa pokynu advokáta, neoverené z listiny“. Dátum sa
 * nikdy neodvodzuje: iný tvar než skutočný deň `RRRR-MM-DD` sa odmietne. Jurisdikcia je z karty veci alebo zo záznamov
 * prípadu, nikdy predvolená. `inputId` je riadok `VSTUPY.md`, ktorým hostiteľ pokyn zaeviduje v tom istom kroku.
 */
export function instructionDeadlineRecord(directory, { date, what, instruction, inputId, today }) {
  if (!hasMatterCard(directory)) return { code: 1, out: "ODMIETNUTÉ: this folder is not a case (no matter.md); a deadline belongs to a case." };
  if (workspaceProfilePresent(directory)) return { code: 1, out: "ODMIETNUTÉ: write uses typed OKF memory, but .lawoss/memory-profile.json is present." };
  if (!isDay(date)) return { code: 1, out: "ODMIETNUTÉ: the deadline needs the explicit calendar date the lawyer stated (YYYY-MM-DD). Never derive or compute it; ask the lawyer for the date." };
  const scope = readScope(directory);
  if (scope.problems.length) return { code: 1, out: `ODMIETNUTÉ: the case memory could not be read completely (${scope.problems.map((problem) => problem.message).join("; ")}); no new record ID is assigned.` };
  const used = [...new Set(scope.matter.records.map((record) => record.jurisdiction))];
  const jurisdiction = jurisdictionFromCard(directory) ?? (used.length === 1 ? used[0] : undefined);
  if (jurisdiction !== "sk" && jurisdiction !== "cz") return { code: 1, out: "ODMIETNUTÉ: the case card does not state its jurisdiction (sk or cz); it is never assumed." };
  const numbers = scope.records.map((record) => /^T-(\d+)$/.exec(record.id)?.[1]).filter(Boolean).map(Number);
  const id = `T-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
  const text = DEADLINE_TEXT[jurisdiction], label = oneLine(what), said = oneLine(instruction);
  const record = {
    okf: 1, id, type: "task", title: label, description: text.description, layer: "L2", jurisdiction, status: "active", created: today, updated: today,
    state: "pending", deadlines: [`${date} ${label}`],
    truth: text.truth(date, label, inputId, said), timeline: [{ date: today, kind: "request", text: text.history(date, inputId) }],
    extra: { deadline_basis: INSTRUCTION_DEADLINE_BASIS },
  };
  return { code: 0, out: "", id, jurisdiction, text: serializeRecord(record) };
}
