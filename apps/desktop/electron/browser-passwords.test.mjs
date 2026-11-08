import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserPasswordActions } from "./browser-passwords.mjs";

function fixture() {
  let url = "https://login.example.org/form", frame = url, generation = 1, kind = true, fail = false;
  const calls = [], saved = { id: "saved", origin: "https://login.example.org", password: "private-value" };
  const target = () => ({ resources: [frame], key: String(generation) });
  const page = { contents: { isDestroyed: () => false, getURL: () => url }, state: () => ({ id: "tab", generation }),
    execute: async command => {
      calls.push(command);
      if (command.inspect) return { value: target() };
      assert.equal(command.generation, generation);
      assert.deepEqual(command.target, target());
      if (command.action.type === "evaluate") return { value: { value: kind } };
      if (fail) throw new Error(saved.password);
      return { value: { unsafe: saved.password } };
    },
  };
  const matchesWebsite = (_saved, website) => ["https://login.example.org", "https://example.org", "https://auth.example.org"].includes(new URL(website).origin);
  const actions = createBrowserPasswordActions(page, async () => ({ get: async () => saved, matchesWebsite,
    list: async website => matchesWebsite(saved.origin, website) ? [{ id: saved.id }] : [] }));
  return { actions, calls, saved, set: value => { url = value.url ?? url; frame = value.frame ?? frame; kind = value.kind ?? kind; fail = value.fail ?? fail; generation = value.generation ?? generation; } };
}
test("fill resolves inside the host, preserves native target checks, returns no secret and never submits", async () => {
  const f = fixture(), signal = new AbortController().signal;
  assert.deepEqual(await f.actions.list(signal), { website: "https://login.example.org", passwords: [{ id: "saved" }] });
  const output = await f.actions.fill({ password_id: "saved", ref: "@e2" }, signal);
  assert.deepEqual(output, { filled: true, password_id: "saved" });
  assert.equal(f.calls.at(-1).action.text, f.saved.password);
  assert.equal(f.calls.filter(call => call.action.type === "fill" && !call.inspect).length, 1);
  assert.equal(JSON.stringify(output).includes(f.saved.password), false);
});
test("the main domain, login subdomains and same-website frames can use the saved password", async () => {
  const f = fixture(); f.set({ url: "https://example.org/login", frame: "https://auth.example.org/frame" });
  assert.deepEqual(await f.actions.list(new AbortController().signal), { website: "https://example.org", passwords: [{ id: "saved" }] });
  assert.deepEqual(await f.actions.fill({ password_id: "saved", ref: "@e2" }, new AbortController().signal), { filled: true, password_id: "saved" });
});
test("other websites, wrong frame websites and non-password fields fail before inserting a value", async () => {
  for (const value of [{ url: "https://evil.example.net" }, { frame: "https://evil.example.net/frame" }, { frame: "https://login.example.org:444/frame" }, { kind: false }]) {
    const f = fixture(); f.set(value);
    await assert.rejects(f.actions.fill({ password_id: "saved", ref: "@e2" }, new AbortController().signal), /could not be confirmed|does not match|different website/);
    assert.equal(f.calls.some(call => call.action.text === f.saved.password), false);
  }
});
test("navigation, cancellation and renderer errors cannot echo the password", async () => {
  const f = fixture(); f.set({ fail: true });
  await assert.rejects(f.actions.fill({ password_id: "saved", ref: "@e2" }, new AbortController().signal), error => error instanceof Error && !error.message.includes(f.saved.password));
  const stopped = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(stopped.actions.fill({ password_id: "saved", ref: "@e2" }, abort.signal));
  assert.equal(stopped.calls.length, 0);
  const moved = fixture(), original = moved.actions;
  moved.set({ url: "about:blank" });
  assert.deepEqual(await original.list(new AbortController().signal), { website: null, passwords: [] });
});
