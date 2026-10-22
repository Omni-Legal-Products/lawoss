import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptUiLocaleReport, createNativeLocaleState, NATIVE_STRINGS, preferredSystemLocale } from "./native-locale.mjs";

test("presentation reports require an owning ordinary app main frame and an exact supported locale", () => {
  const window = { isDestroyed: () => false };
  const frame = { url: "http://localhost:5173/#/home" };
  const sender = { mainFrame: frame };
  const event = { sender, senderFrame: frame };
  const state = createNativeLocaleState(() => "sk-SK");
  const options = { fromWebContents: () => window, isAppWindow: owner => owner === window, isAppUrl: url => url === frame.url, state };
  assert.equal(state.forWindow(window), "sk");
  for (const input of ["cs-CZ", "toString", "unsupported", null, {}]) assert.equal(acceptUiLocaleReport(event, input, options), false);
  assert.equal(acceptUiLocaleReport({ ...event, senderFrame: { ...frame } }, "cs", options), false);
  assert.equal(acceptUiLocaleReport(event, "cs", { ...options, isAppWindow: () => false }), false);
  assert.equal(acceptUiLocaleReport(event, "cs", { ...options, isAppUrl: () => false }), false);
  assert.equal(state.forWindow(window), "sk");
  let changes = 0;
  const stop = state.subscribe(() => changes++);
  assert.equal(acceptUiLocaleReport(event, "cs", options), true);
  assert.equal(state.forWindow(window), "cs");
  assert.equal(acceptUiLocaleReport(event, "cs", options), true);
  assert.equal(changes, 1);
  stop();
});

test("native presentation catalogs have complete nonempty keys", () => {
  for (const locale of ["cs", "sk", "de"]) {
    assert.deepEqual(Object.keys(NATIVE_STRINGS[locale]).sort(), Object.keys(NATIVE_STRINGS.en).sort());
    for (const value of Object.values(NATIVE_STRINGS[locale])) assert.ok(value.trim());
  }
});

test("natívne menu pred hlásením renderera: SK/CS kdekoľvek v zozname systému, inak prvý podporovaný, inak slovenčina", () => {
  assert.equal(preferredSystemLocale(["en-US", "sk-SK"]), "sk");
  assert.equal(preferredSystemLocale(["en-US", "cs-CZ"]), "cs");
  assert.equal(preferredSystemLocale(["de-DE"]), "de");
  assert.equal(preferredSystemLocale(["en-US"]), "en");
  assert.equal(preferredSystemLocale(["fr-FR"]), "sk");
  assert.equal(preferredSystemLocale(undefined), "sk");
});
