import assert from "node:assert/strict";
import test from "node:test";
import { applyRendererHeapLimit, DEFAULT_RENDERER_HEAP_MB, rendererHeapLimitMb } from "./lawoss-memory-budget.mjs";

function fakeApp(initial = "") {
  const switches = new Map(initial ? [["js-flags", initial]] : []);
  return {
    switches,
    commandLine: {
      getSwitchValue: (name) => switches.get(name) ?? "",
      appendSwitch: (name, value = "") => { switches.set(name, value); },
    },
  };
}

test("renderer dostane predvolený limit haldy V8", () => {
  const app = fakeApp();
  assert.equal(applyRendererHeapLimit(app, {}), DEFAULT_RENDERER_HEAP_MB);
  assert.equal(app.switches.get("js-flags"), `--max-old-space-size=${DEFAULT_RENDERER_HEAP_MB}`);
});

test("ostatné js-flags ostanú a explicitný limit má prednosť", () => {
  const other = fakeApp("--expose-gc");
  applyRendererHeapLimit(other, { LAWOSS_RENDERER_HEAP_MB: "768" });
  assert.equal(other.switches.get("js-flags"), "--expose-gc --max-old-space-size=768");
  const explicit = fakeApp("--max-old-space-size=2048");
  assert.equal(applyRendererHeapLimit(explicit, {}), null);
  assert.equal(explicit.switches.get("js-flags"), "--max-old-space-size=2048");
});

test("nastavenie z prostredia: 0 vypne, nezmysel a príliš malé číslo nie", () => {
  assert.equal(rendererHeapLimitMb({ LAWOSS_RENDERER_HEAP_MB: "0" }), 0);
  assert.equal(applyRendererHeapLimit(fakeApp(), { LAWOSS_RENDERER_HEAP_MB: "0" }), null);
  assert.equal(rendererHeapLimitMb({ LAWOSS_RENDERER_HEAP_MB: "abc" }), DEFAULT_RENDERER_HEAP_MB);
  assert.equal(rendererHeapLimitMb({ LAWOSS_RENDERER_HEAP_MB: "-5" }), DEFAULT_RENDERER_HEAP_MB);
  assert.equal(rendererHeapLimitMb({ LAWOSS_RENDERER_HEAP_MB: "64" }), 128);
});
