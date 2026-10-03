import { afterEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderWorkingProfile, workingProfile } from "../../../lawoss/okf/src/profile";
import { saveDocumentsToMatter } from "../src/lawoss/lite/matter-intake";
import { memoryFixture } from "./lawoss-memory-fixture";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const REGISTER = "| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |\n|---|---|---|---|---|---|\n| IN-007 | 2026-09-23 | e-mail | older.pdf | processed | M-1 |\n";
const profile = renderWorkingProfile(workingProfile(["Prijaté podklady"], { inbox: "Prijaté podklady" }, "{date}_{kind}"));

async function fixture() {
  const result = await memoryFixture();
  cleanups.push(result.cleanup);
  await writeFile(join(result.matter, "PRACOVNY-PROFIL.md"), profile);
  await writeFile(join(result.matter, "VSTUPY.md"), REGISTER);
  return result;
}

test("server preserves pre-existing original bytes when the create-only intake path collides", async () => {
  const f = await fixture();
  const path = join(f.matter, "Prijaté podklady/IN-008/doklad.bin");
  const original = new Uint8Array([0, 255, 17, 128, 13, 10]);
  await mkdir(join(f.matter, "Prijaté podklady/IN-008"), { recursive: true });
  await writeFile(path, original);

  await expect(
    saveDocumentsToMatter(f.client, "matter", { path: "", title: "Synthetic" }, [new File([new Uint8Array([1, 2, 3])], "doklad.bin")]),
  ).rejects.toThrow("changed since it was loaded");

  expect(await readFile(path)).toEqual(Buffer.from(original));
  expect(await readFile(join(f.matter, "VSTUPY.md"), "utf8")).toBe(REGISTER);
});

test("server saves the original byte-for-byte under the matter profile inbox and registers it", async () => {
  const f = await fixture();
  const bytes = new Uint8Array([0, 255, 17, 128, 13, 10]);

  const saved = await saveDocumentsToMatter(
    f.client,
    "matter",
    { path: "", title: "Synthetic" },
    [new File([bytes], "doklad.bin")],
    new Date(2026, 9, 3, 10, 0),
  );

  expect(saved).toEqual([{ id: "IN-008", name: "doklad.bin", path: "Prijaté podklady/IN-008/doklad.bin" }]);
  expect(await readFile(join(f.matter, saved[0]!.path))).toEqual(Buffer.from(bytes));
  expect(await readFile(join(f.matter, "VSTUPY.md"), "utf8")).toMatch(
    /\| IN-008 \| 2026-10-03T10:00:00[+-]\d{2}:\d{2} \| ruční vložení \(LAWOSS\) \| Prijaté podklady\/IN-008\/doklad\.bin \| pending \| \|/,
  );
});

test("server retries a stale input register once without writing the original again", async () => {
  const f = await fixture();
  let changed = false;
  let binaryWrites = 0;
  const client = {
    ...f.client,
    async writeWorkspaceBinaryFile(
      workspaceId: string,
      payload: { path: string; data: ArrayBuffer; baseUpdatedAt?: number | null; force?: boolean },
    ) {
      binaryWrites++;
      return f.client.writeWorkspaceBinaryFile(workspaceId, payload);
    },
    async writeWorkspaceFile(workspaceId: string, payload: { path: string; content: string; baseUpdatedAt?: number | null }) {
      if (!changed) {
        changed = true;
        const current = await f.client.readWorkspaceFile(workspaceId, payload.path);
        await f.client.writeWorkspaceFile(workspaceId, {
          path: payload.path,
          content: `${current.content}| IN-008 | 2026-10-03 | concurrent | external.pdf | pending | |\n`,
          baseUpdatedAt: current.updatedAt,
        });
      }
      return f.client.writeWorkspaceFile(workspaceId, payload);
    },
  };

  const saved = await saveDocumentsToMatter(
    client,
    "matter",
    { path: "", title: "Synthetic" },
    [new File([new Uint8Array([7, 8, 9])], "doklad.bin")],
    new Date(2026, 9, 3, 10, 0),
  );

  const register = await readFile(join(f.matter, "VSTUPY.md"), "utf8");
  expect(saved).toEqual([{ id: "IN-009", name: "doklad.bin", path: "Prijaté podklady/IN-008/doklad.bin" }]);
  expect(register).toContain("| IN-008 | 2026-10-03 | concurrent | external.pdf | pending | |");
  expect(register).toMatch(
    /\| IN-009 \| 2026-10-03T10:00:00[+-]\d{2}:\d{2} \| ruční vložení \(LAWOSS\) \| Prijaté podklady\/IN-008\/doklad\.bin \| pending \| \|/,
  );
  expect(binaryWrites).toBe(1);
  expect(await readFile(join(f.matter, saved[0]!.path))).toEqual(Buffer.from([7, 8, 9]));
});
