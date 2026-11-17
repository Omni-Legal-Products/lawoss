import { expect, test } from "bun:test";
import { retryStartupWithEngineRestart } from "../src/react-app/shell/engine-startup";

// The boot screen's "Skúsiť znova" used to only reload; with the engine in `error` the same screen came back
// for up to 5 min. It now asks the server for an immediate engine restart first.
test("#477: boot retry restarts the engine before it reloads", async () => {
  const order: string[] = [];
  await retryStartupWithEngineRestart({
    restart: async () => { order.push("restart"); return { restarting: true, engine: { status: "starting" } }; },
    reload: () => { order.push("reload"); },
  });
  expect(order).toEqual(["restart", "reload"]);
});

test("#477: boot retry still reloads when the restart request fails or there is no server", async () => {
  const order: string[] = [];
  await retryStartupWithEngineRestart({ restart: async () => { throw new Error("offline"); }, reload: () => { order.push("reload"); } });
  await retryStartupWithEngineRestart({ restart: undefined, reload: () => { order.push("reload"); } });
  expect(order).toEqual(["reload", "reload"]);
});

test("#477: the boot screen button uses it", async () => {
  const source = await Bun.file(new URL("../src/react-app/shell/loading-overlay.tsx", import.meta.url)).text();
  expect(source).toContain("retryStartupWithEngineRestart(");
});
