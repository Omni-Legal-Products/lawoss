import assert from "node:assert/strict";
import test from "node:test";
import { alphaPlatform, feedbackUrl, latestAlpha, newerAlpha, parseAlphaVersion } from "./lawoss-alpha-feedback.mjs";

test("odkaz na hlásenie nesie verziu a systém v parametroch formulára, nič iné", () => {
  assert.equal(
    feedbackUrl({ locale: "sk", version: "0.2.1-alpha.12.ge0dd860", platform: "darwin", arch: "arm64" }),
    "https://lawoss.app/sk/alfa/hlasenie?v=0.2.1-alpha.12.ge0dd860&os=darwin&arch=arm64",
  );
  assert.match(feedbackUrl({ locale: "cs", version: "", platform: "win32", arch: "arm64" }), /\/cz\/alfa\/hlasenie\?os=win32&arch=arm64$/);
  assert.match(feedbackUrl({ locale: "de", version: "1", platform: "linux", arch: "x64" }), /\/en\/alfa\/hlasenie\?v=1$/);
});

test("platformy zodpovedajú kľúčom webu", () => {
  assert.equal(alphaPlatform("darwin", "arm64"), "mac");
  assert.equal(alphaPlatform("win32", "x64"), "win-x64");
  assert.equal(alphaPlatform("win32", "arm64"), "win-arm64");
  assert.equal(alphaPlatform("linux", "x64"), "");
});

test("novšia alfa sa pozná podľa čísla alfy aj základnej verzie", () => {
  const web = { mac: { version: "0.2.1-alpha.13" }, "win-x64": { version: "0.2.1-alpha.12" } };
  assert.equal(newerAlpha("0.2.1-alpha.12.ge0dd860", web, "mac"), "0.2.1-alpha.13");
  assert.equal(newerAlpha("0.2.1-alpha.12.ge0dd860", web, "win-x64"), "");
  assert.equal(newerAlpha("0.2.1-alpha.13.gabc", web, "mac"), "");
  assert.equal(newerAlpha("0.2.1-alpha.12", { mac: { version: "0.3.0-alpha.1" } }, "mac"), "0.3.0-alpha.1");
  assert.equal(newerAlpha("0.3.0-alpha.1", { mac: { version: "0.2.1-alpha.99" } }, "mac"), "");
  assert.equal(newerAlpha("0.2.1", web, "mac"), "");
  assert.equal(newerAlpha("0.2.1-alpha.12", { mac: { version: "<script>" } }, "mac"), "");
  assert.equal(newerAlpha("0.2.1-alpha.12", null, "mac"), "");
  assert.equal(parseAlphaVersion("nie"), undefined);
});

test("chyba siete ani zlá odpoveď neznamená novú alfu", async () => {
  const ok = async () => ({ ok: true, json: async () => ({ mac: { version: "0.2.1-alpha.13" } }) });
  assert.equal(await latestAlpha("0.2.1-alpha.12", { fetchImpl: ok, platform: "mac" }), "0.2.1-alpha.13");
  assert.equal(await latestAlpha("0.2.1-alpha.12", { fetchImpl: async () => ({ ok: false }), platform: "mac" }), "");
  assert.equal(await latestAlpha("0.2.1-alpha.12", { fetchImpl: async () => { throw new Error("offline"); }, platform: "mac" }), "");
  let called = false;
  assert.equal(await latestAlpha("0.2.1", { fetchImpl: async () => { called = true; return ok(); }, platform: "mac" }), "");
  assert.equal(called, false);
});
