// #367 (RAM 2 GB): tvar priečinka sa od enginu pýta raz. `GET /api/location` engine v2 postaví lokáciu so všetkými MCP,
// takže opakované čítanie výpisu predošlého klienta by po prepnutí vyhodilo otvoreného klienta z rozpočtu MCP.
import { expect, test } from "bun:test";
import { abortable, locateOnce } from "../src/lawoss/lite/matter-conversations";

const where = (directory: string) => ({ directory, worktree: "/", projectId: "global" });

test("priečinok sa od enginu pýta raz, aj pri súbežných výpisoch", async () => {
  let asked = 0;
  const run = async () => { asked += 1; return where("/K/C025"); };
  const results = await Promise.all([locateOnce("e1\n/K/C025", run), locateOnce("e1\n/K/C025", run)]);
  expect(await locateOnce("e1\n/K/C025", run)).toEqual(where("/K/C025"));
  expect(results).toEqual([where("/K/C025"), where("/K/C025")]);
  expect(asked).toBe(1);
  // Iný priečinok alebo iný engine sa pýta zvlášť.
  await locateOnce("e1\n/K/MEDIN", async () => { asked += 1; return where("/K/MEDIN"); });
  await locateOnce("e2\n/K/C025", async () => { asked += 1; return where("/K/C025"); });
  expect(asked).toBe(3);
});

test("chyba sa nepamätá, ďalší výpis sa opýta znova", async () => {
  await expect(locateOnce("e1\n/K/zlyha", async () => { throw new Error("engine nedostupný"); })).rejects.toThrow("engine nedostupný");
  expect(await locateOnce("e1\n/K/zlyha", async () => where("/K/zlyha"))).toEqual(where("/K/zlyha"));
});

test("zrušený výpis (navigácia) nezruší spoločnú požiadavku ostatným výpisom", async () => {
  let answer = (_: ReturnType<typeof where>) => {};
  let asked = 0;
  const run = () => { asked += 1; return new Promise<ReturnType<typeof where>>((resolve) => { answer = resolve; }); };
  const first = new AbortController();
  const one = abortable(locateOnce("e1\n/K/M064", run), first.signal);
  const two = abortable(locateOnce("e1\n/K/M064", run), new AbortController().signal);
  first.abort(new Error("navigácia"));
  await expect(one).rejects.toThrow("navigácia");
  answer(where("/K/M064"));
  expect(await two).toEqual(where("/K/M064"));
  expect(await locateOnce("e1\n/K/M064", run)).toEqual(where("/K/M064"));
  expect(asked).toBe(1);
});
