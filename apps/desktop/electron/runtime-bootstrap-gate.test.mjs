import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createRuntimeBootstrapGate } from "./runtime-bootstrap-gate.mjs";

test("zlyhaný štart sa dá spustiť znova", async () => {
  let calls = 0;
  const ensure = createRuntimeBootstrapGate(async () => {
    calls += 1;
    return { ok: false, error: "Timeout waiting for OpenCode server after 15000ms" };
  });

  const first = await ensure();
  const second = await ensure();

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(calls, 2);
});

test("úspešný štart sa nespúšťa druhýkrát", async () => {
  let calls = 0;
  const ensure = createRuntimeBootstrapGate(async () => {
    calls += 1;
    return { ok: true, skipped: false };
  });

  const first = await ensure();
  const second = await ensure();

  assert.equal(first.ok, true);
  assert.equal(second, first);
  assert.equal(calls, 1);
});

test("súbežní volajúci zdieľajú jeden pokus a po zlyhaní ide ďalší", async () => {
  let calls = 0;
  /** @type {(value: { ok: false, error: string }) => void} */
  let release = () => {};
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  const ensure = createRuntimeBootstrapGate(() => {
    calls += 1;
    return hold;
  });

  const first = ensure();
  const second = ensure();
  await Promise.resolve();
  assert.equal(calls, 1);
  release({ ok: false, error: "timeout" });
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(calls, 1);

  await ensure();
  assert.equal(calls, 2);
});

test("odmietnutý pokus sa nezapamätá", async () => {
  let calls = 0;
  const ensure = createRuntimeBootstrapGate(async () => {
    calls += 1;
    throw new Error("boot exploded");
  });

  await assert.rejects(ensure(), /boot exploded/);
  await assert.rejects(ensure(), /boot exploded/);
  assert.equal(calls, 2);
});

test("main nespúšťa bootstrap mimo brány", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("runtimeBootstrapPromise"), false);
  assert.match(source, /createRuntimeBootstrapGate\(\(\) =>/);
  assert.match(source, /void ensureRuntimeBootstrap\(\)/);
});
