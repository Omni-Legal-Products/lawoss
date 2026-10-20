import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OFFICE_MEMORY_MAX_BYTES, readOfficeMemory } from "./office-memory.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const practice = async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-office-memory-"));
  roots.push(root);
  return root;
};

describe("readOfficeMemory (N1, prehľad praxe)", () => {
  test("číta len memory/*.md kancelárie, bez index.md a log.md, zoradené", async () => {
    const root = await practice();
    await mkdir(join(root, "Office", "memory", "vnorene"), { recursive: true });
    await writeFile(join(root, "Office", "memory", "T-002.md"), "b");
    await writeFile(join(root, "Office", "memory", "T-001.md"), "a");
    await writeFile(join(root, "Office", "memory", "index.md"), "index");
    await writeFile(join(root, "Office", "memory", "log.md"), "log");
    await writeFile(join(root, "Office", "memory", "poznamka.txt"), "nie");
    await writeFile(join(root, "Office", "memory", "vnorene", "T-003.md"), "nie");
    expect(await readOfficeMemory(root)).toEqual({
      practiceRoot: root, directory: "Office",
      files: [{ path: "Office/memory/T-001.md", content: "a" }, { path: "Office/memory/T-002.md", content: "b" }],
      problems: [],
      truncated: false,
    });
  });

  test("prax bez kancelárie alebo bez pamäte nič nehlási", async () => {
    const root = await practice();
    expect(await readOfficeMemory(root)).toEqual({ practiceRoot: root, directory: null, files: [], problems: [], truncated: false });
    await mkdir(join(root, "_kancelaria"));
    expect(await readOfficeMemory(root)).toEqual({ practiceRoot: root, directory: "_kancelaria", files: [], problems: [], truncated: false });
  });

  test("odkaz von z praxe ani priveľký súbor sa neprečíta, ostatné áno", async () => {
    const root = await practice();
    const elsewhere = await practice();
    await writeFile(join(elsewhere, "tajne.md"), "iný klient");
    await mkdir(join(root, "Office", "memory"), { recursive: true });
    await writeFile(join(root, "Office", "memory", "T-001.md"), "a");
    await writeFile(join(root, "Office", "memory", "T-002.md"), "x".repeat(OFFICE_MEMORY_MAX_BYTES + 1));
    await symlink(join(elsewhere, "tajne.md"), join(root, "Office", "memory", "T-003.md"));
    const read = await readOfficeMemory(root);
    expect(read.files).toEqual([{ path: "Office/memory/T-001.md", content: "a" }]);
    expect(read.files.some((file) => file.content.includes("iný klient"))).toBe(false);
    expect(read.problems.map((p) => p.path)).toEqual(["Office/memory/T-002.md"]);
  });

  test("kancelária ako odkaz na iný priečinok sa nečíta", async () => {
    const root = await practice();
    const elsewhere = await practice();
    await mkdir(join(elsewhere, "memory"));
    await writeFile(join(elsewhere, "memory", "T-001.md"), "cudzie");
    await symlink(elsewhere, join(root, "Office"));
    const result = await readOfficeMemory(root);
    expect(result.files).toEqual([]);
    expect(result.problems).toHaveLength(1);
  });
});


test("aggregate office budget is bounded and reported", async () => {
  const root = await practice();
  await mkdir(join(root, "Office", "memory"), { recursive: true });
  for (let i = 0; i < 9; i++) await writeFile(join(root, "Office", "memory", `T-${i}.md`), "x".repeat(OFFICE_MEMORY_MAX_BYTES));
  const result = await readOfficeMemory(root);
  expect(result.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0)).toBeLessThanOrEqual(8 * 1024 * 1024);
  expect(result.truncated).toBe(true);
});


test("memory directory symlink is rejected with visible coverage problem", async () => {
  const root = await practice(), other = await practice();
  await mkdir(join(root, "Office"));
  await writeFile(join(other, "T-secret.md"), "foreign");
  await symlink(other, join(root, "Office", "memory"));
  const result = await readOfficeMemory(root);
  expect(result.files).toEqual([]);
  expect(result.problems).toHaveLength(1);
});
