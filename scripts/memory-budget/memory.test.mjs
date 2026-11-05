import assert from "node:assert/strict";
import test from "node:test";
import { parseProcessTable, parseSmapsRollup, parseTopMemory, parseTopOutput, processKind, selectTree, summarize } from "./memory.mjs";

test("strom procesov: potomkovia aj osirelé procesy s cestou appky", () => {
  const rows = parseProcessTable([
    "  10     1 /Applications/LAWOSS.app/Contents/MacOS/LAWOSS",
    "  11    10 /Applications/LAWOSS.app/Contents/Frameworks/LAWOSS Helper --type=gpu-process",
    "  12    10 /Applications/LAWOSS.app/Contents/Resources/sidecars/opencode-aarch64-apple-darwin serve --port 1",
    "  13    12 /Applications/LAWOSS.app/Contents/Resources/node/node /tmp/p/run.mjs mcp",
    "  20     1 /Applications/LAWOSS.app/Contents/Resources/node/node /tmp/p/run.mjs mcp",
    "  30     1 /usr/bin/unrelated",
  ].join("\n"));
  assert.deepEqual(selectTree(rows, 10, ["/Applications/LAWOSS.app"]).map((row) => row.pid), [10, 11, 12, 13, 20]);
  assert.deepEqual(selectTree(rows, 10).map((row) => row.pid), [10, 11, 12, 13]);
});

test("macOS top MEM a Linux PSS", () => {
  assert.equal(parseTopMemory("512K"), 0.5);
  assert.equal(parseTopMemory("80M+"), 80);
  assert.equal(parseTopMemory("1.5G"), 1536);
  assert.equal(parseTopMemory("bad"), 0);
  assert.deepEqual([...parseTopOutput("Processes: 3 total\nPID   MEM\n10    250M\n12    1.2G-\n").entries()], [[10, 250], [12, 1228.8]]);
  assert.equal(parseSmapsRollup("Rss:  204800 kB\nPss:   102400 kB\n"), 100);
});

test("druh procesu", () => {
  assert.equal(processKind("/x/LAWOSS Helper (Renderer) --type=renderer"), "renderer");
  assert.equal(processKind("/x/sidecars/opencode-aarch64-apple-darwin serve --port 5"), "engine");
  assert.equal(processKind("/x/node/node /p/scripts/run.mjs mcp"), "mcp");
  assert.equal(processKind("/bin/sh -c read lawoss-engine-watchdog 12 5"), "watchdog");
  assert.equal(processKind("/x/LAWOSS.app/Contents/MacOS/LAWOSS"), "main");
});

test("súhrn: špička rozhoduje o rozpočte", () => {
  const samples = [100, 1500, 2100, 1600].map((totalMb, index) => ({ t: index * 2, processes: 7 + index, totalMb, byKind: { main: totalMb } }));
  const result = summarize(samples, 2048);
  assert.equal(result.peakMb, 2100);
  assert.equal(result.peakAtSeconds, 4);
  assert.equal(result.withinBudget, false);
  assert.equal(result.maxProcesses, 10);
  assert.equal(summarize(samples.slice(0, 2), 2048).withinBudget, true);
});
