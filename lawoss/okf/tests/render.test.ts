import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatus, BLOCKS } from "../src/render.ts";
import type { OkfRecord } from "../src/record.ts";

function r(over: Partial<OkfRecord>): OkfRecord {
  return {
    schema: 1, id: "X-1", type: "decision", title: "t", summary: "s",
    layer: "L2", jurisdiction: "cz", status: "platny",
    created: "2026-08-29", updated: "2026-08-29", truth: "", timeline: [],
    ...over,
  } as OkfRecord;
}

const ZAZNAMY = [
  r({ id: "R-001", type: "decision", title: "Nenapadat prislusnost", deadlines: ["2026-09-12"],
      timeline: [{ date: "2026-08-20", text: "zvazovana namitka" }] }),
  r({ id: "O-001", type: "question", title: "Ma klient plnu moc?",
      timeline: [{ date: "2026-08-25", text: "dotaz odoslany klientovi" }] }),
];

const LUDSKY_STATUS = `---
type: status
title: Vec — Status
updated: 2026-08-01
---

# Vec — Status (SSOT)

> **Fáze:** příprava odvolání
> **Další krok:** podat do 12. 9., zajistit plnou moc

## 1. Strany
| Role | Subjekt |
|---|---|
| Klient | ruční poznámka advokáta |

## 3. Lhůty
<!-- okf:render:deadlines:start -->
zastaralý obsah, který se má přepsat
<!-- okf:render:deadlines:end -->

## 8. Vlastní poznámky
Tohle si píšu sám a nikdo mi to nesmí přepsat.
`;

test("obsah medzi markermi sa prepise", () => {
  const out = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  assert.doesNotMatch(out, /zastaralý obsah/);
  assert.match(out, /2026-09-12/);
});

test("ludska hlavicka Faze a Dalsi krok zostava nedotknuta", () => {
  const out = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  assert.match(out, /> \*\*Fáze:\*\* příprava odvolání/);
  assert.match(out, /> \*\*Další krok:\*\* podat do 12\. 9\., zajistit plnou moc/);
});

test("ludske sekcie mimo markerov zostavaju bajt po bajte", () => {
  const out = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  assert.match(out, /\| Klient \| ruční poznámka advokáta \|/);
  assert.match(out, /Tohle si píšu sám a nikdo mi to nesmí přepsat\./);
});

test("druhy beh renderu uz nic nezmeni", () => {
  const once = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  assert.equal(renderStatus(once, ZAZNAMY, "cz"), once);
});

test("chybajuci blok sa doplni aj s markermi", () => {
  const out = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  for (const b of BLOCKS) {
    assert.match(out, new RegExp(`okf:render:${b}:start`), `chýba blok ${b}`);
    assert.match(out, new RegExp(`okf:render:${b}:end`), `chýba koniec ${b}`);
  }
});

test("chronologia zluci historiu vsetkych zaznamov podla datumu", () => {
  const out = renderStatus(LUDSKY_STATUS, ZAZNAMY, "cz");
  const chrono = out.split("okf:render:timeline:start")[1]?.split("okf:render:timeline:end")[0] ?? "";
  assert.ok(chrono.indexOf("2026-08-20") < chrono.indexOf("2026-08-25"), chrono);
});

test("markery su technicke — rovnake v CZ aj SK", () => {
  const sk = renderStatus(LUDSKY_STATUS, ZAZNAMY, "sk");
  assert.match(sk, /okf:render:deadlines:start/);
});

test("nadpisy doplnenych blokov su jurisdikcne", () => {
  const cz = renderStatus("# Status\n", ZAZNAMY, "cz");
  const sk = renderStatus("# Status\n", ZAZNAMY, "sk");
  assert.match(cz, /^## Lhůty$/m);
  assert.match(sk, /^## Lehoty$/m);
});

test("render bez zaznamov necha bloky prazdne, nie rozbite", () => {
  const out = renderStatus(LUDSKY_STATUS, [], "cz");
  assert.match(out, /okf:render:deadlines:start/);
  assert.equal(renderStatus(out, [], "cz"), out);
});
