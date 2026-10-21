import { test } from "node:test";
import assert from "node:assert/strict";
import { presentationLocaleFailures } from "./check-presentation-locales.mjs";

const catalog = () => ({ en: { action: "Open {path}" }, cs: { action: "Otevřít {path}" }, sk: { action: "Otvoriť {path}" }, de: { action: "{path} öffnen" } });
test("presentation audit accepts complete catalogs and preserves interpolation", () => {
  assert.deepEqual(presentationLocaleFailures({ native: catalog() }), []);
});
test("presentation audit rejects missing, blank, orphan and altered placeholders", () => {
  const values = catalog();
  delete values.sk.action;
  values.cs.action = "";
  values.de.action = "Öffnen";
  values.de.extra = "Zusatz";
  const errors = presentationLocaleFailures({ office: values });
  for (const fragment of ["sk.action: missing", "cs.action: empty", "de.action: placeholders", "de.extra: unknown"]) assert(errors.some(error => error.includes(fragment)), errors.join("\n"));
});
test("Czech presentation rejects distinctive Slovak copy, allowing shared vocabulary and literal placeholders", () => {
  const values = catalog();
  values.cs.action = "Otvoriť priečinok {path}";
  assert(presentationLocaleFailures({ app: values }).some(error => error.includes("Slovak copy")));
  values.cs.action = "Stav souboru {path}";
  assert.deepEqual(presentationLocaleFailures({ app: values }), []);
});
