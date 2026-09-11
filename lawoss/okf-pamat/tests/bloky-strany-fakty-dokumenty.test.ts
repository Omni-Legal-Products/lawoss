/**
 * Strany, fakty a kľúčové dokumenty — sekcie 1, 2 a 6 šablóny Fázy A. Test
 * 10 vecí z ISIR (11. 9. 2026) ukázal, že ostávali prázdne, hoci pamäť dáta mala.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatus, retrofitStatus, statusSkeleton, RenderConflictError, BLOCKS, MARKER_ONLY, SOFT_HEADING, newRecord } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const T = "2026-09-11";
const rec = (id: string, type: OkfRecord["type"], title: string, over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id, type, jurisdiction: "cz", title, description: "d", created: T, updated: T, truth: "t",
    timeline: [{ date: T, text: "založeno" }] }), ...over });

const ZAZNAMY: OkfRecord[] = [
  rec("S-001", "subject", "Dvořák Josef", { role: "client", person_type: "natural_person", birth_number: "931208/4430" }),
  rec("S-002", "subject", "JUDr. Správce", { role: "counterparty", person_type: "legal_person", registry_id: "25804685" }),
  rec("M-001", "matter", "KSBR 31 INS 3296/2024", {
    sources: [{ id: "isir-case", title: "ISIR – řízení", resource: "https://isir.justice.cz/x", last_modified: "2026-09-10" }],
    truth: "Stav řízení: **VYŘÍZENÁ**.[^isir-case]\nCelkem 24 událostí | bez odkazu.",
  }),
  rec("C-001", "claim", "Dlužník tvrdí, že splátky platil", { claimed_by: "dlužník", claimed_at: "2026-05-01", proof_status: "unproven" }),
  rec("E-001", "evidence", "B: Usnesení o úpadku", { evidence_kind: "document", origin_date: "2024-04-18",
    sources: [{ id: "isir-1", title: "Usnesení", resource: "https://isir.justice.cz/doc/1" }, { id: "pdf", title: "PDF ve spisu", resource: "Dokumenty/B-2024-04-18-usneseni.pdf" }] }),
];

const SABLONA_A = `# Vec — Status

## 1. Strany
| Rola | Subjekt | IČO | Kontakt |
|---|---|---|---|
| Klient | Dvořák Josef |  | |

## 2. Fakty veci
| # | Fakt | Zdroj | Zistené | Dopad na vec |
|---|---|---|---|---|

## 6. Kľúčové dokumenty
| Typ | Lokácia |
|---|---|
`;

test("retrofit najde sekcie 1, 2 a 6 sablony Fazy A a naplni ich z pamate", () => {
  const { text, inserted } = retrofitStatus(SABLONA_A, ZAZNAMY, "sk");
  assert.deepEqual([...inserted].sort(), ["documents", "facts", "parties"]);
  assert.match(text, /## 1\. Strany\n<!-- okf:render:parties:start -->/);
  assert.match(text, /\| klient \| Dvořák Josef \| 931208\/•••• \| S-001 \|/, "rodné číslo maskované");
  assert.doesNotMatch(text, /931208\/4430/, "celé rodné číslo do statusu nepatrí");
  assert.match(text, /\| protistrana \| JUDr\. Správce \| 25804685 \|/);
  assert.match(text, /\| 1 \| Stav řízení: VYŘÍZENÁ\. \| \[ISIR – řízení\]\(https:\/\/isir\.justice\.cz\/x\) \| 2026-09-10 \| M-001 \|/, "poznámka pod čiarou → odkaz na prameň, dátum z prameňa");
  assert.match(text, /\| 2 \| Celkem 24 událostí \\\| bez odkazu\. \| — \| 2026-09-11 \|/, "zvislá čiara v texte sa escapuje, bez prameňa pomlčka");
  assert.match(text, /\| 3 \| Dlužník tvrdí, že splátky platil \| tvrdí dlužník \| 2026-05-01 \| C-001 \|/, "tvrdenie ide za faktmi s pôvodcom");
  assert.match(text, /\| B: Usnesení o úpadku \| listina \| 2024-04-18 \| \[Usnesení\]\(https:\/\/isir\.justice\.cz\/doc\/1\), \[B-2024-04-18-usneseni\.pdf\]\(Dokumenty\/B-2024-04-18-usneseni\.pdf\) \| E-001 \|/, "URL aj súbor vo veci");
  assert.match(text, /\| Klient \| Dvořák Josef \|  \| \|/, "pôvodná tabuľka advokáta ostáva pod blokom");
});

test("strany, fakty a dokumenty su marker-only: kostra novej veci ich ma, cudzi subor sam nerastie", () => {
  for (const b of ["parties", "facts", "documents"] as const) {
    assert.ok(BLOCKS.includes(b)); assert.ok(MARKER_ONLY.includes(b));
  }
  const kostra = renderStatus(statusSkeleton("cz"), ZAZNAMY, "cz");
  assert.match(kostra, /## Strany\n<!-- okf:render:parties:start -->/);
  assert.match(kostra, /## Fakta věci\n<!-- okf:render:facts:start -->/);
  assert.match(kostra, /## Klíčové dokumenty\n<!-- okf:render:documents:start -->/);
  assert.match(kostra, /\| Role \| Subjekt \| IČO \/ RČ \| Záznam \|/);
  const cudzi = renderStatus("# Vec\n", ZAZNAMY, "cz");
  for (const b of ["parties", "facts", "documents"]) assert.doesNotMatch(cudzi, new RegExp(`okf:render:${b}`), `${b} sa sám nepridáva`);
});

test("bez subjektov, faktov a dokumentov su bloky prazdne, nie chybne", () => {
  const out = renderStatus(statusSkeleton("sk"), [rec("T-001", "task", "x", { state: "pending" })], "sk");
  const blok = (b: string) => out.split(`okf:render:${b}:start`)[1]?.split(`okf:render:${b}:end`)[0] ?? "";
  for (const b of ["parties", "facts", "documents"]) assert.match(blok(b), /zatiaľ nič/, b);
});

test("cudzia sekcia Strany bez markerov sync neblokuje — blok sa nepridá a lehoty sa vyrenderujú", () => {
  // Pri lehotách je holý nadpis konflikt (dve pravdy). Pri stranách, faktoch a
  // dokumentoch nie: sú to bežné nadpisy advokáta a blokovať každý status by bolo horšie.
  const ludsky = "# Vec\n\n## Strany\n| Kto | Čo |\n|---|---|\n| Klient | moja poznámka |\n\n## Dokumenty\nZoznam píšem sám.\n";
  assert.deepEqual([...SOFT_HEADING].sort(), ["documents", "facts", "parties"]);
  const out = renderStatus(ludsky, ZAZNAMY, "sk");
  assert.doesNotMatch(out, /okf:render:parties/, "strany sa k cudzej sekcii nepridajú");
  assert.doesNotMatch(out, /okf:render:documents/);
  assert.doesNotMatch(out, /okf:render:facts/, "fakty sú marker-only, bez retrofitu sa nepridajú");
  assert.match(out, /okf:render:deadlines:start/);
  assert.match(out, /\| Klient \| moja poznámka \|/, "poznámka advokáta ostáva");
  assert.throws(() => renderStatus("# Vec\n\n## Lehoty\nmoje\n", ZAZNAMY, "sk"), RenderConflictError, "pri lehotách konflikt platí ďalej");
});
