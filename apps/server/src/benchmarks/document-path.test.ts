import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { isSafeDocumentPath, resolveDocumentPath } from "./document-path.js";
import { writeCustomTaskDocuments } from "../routes/benchmarks.js";
import type { ServerConfig } from "../types.js";

const unsafe = ["../escape", "..\\escape", "nested/..\\..\\escape", "C:\\escape", "C:escape", "/escape", "\\\\server\\share\\escape", "file:stream", "./file", "a//b", "a/../b", "a/", "nul.txt", "CON .txt", "COM1", "a/LPT2.log", "file.", "file ", "a\0b"];

test("rejects portable-path ambiguities before native resolution", () => {
  for (const name of unsafe) {
    expect(isSafeDocumentPath(name)).toBe(false);
    expect(() => resolveDocumentPath("/synthetic/root", name)).toThrow();
  }
  for (const name of ["memo.docx", "nested/input č. 1.txt", ".metadata", "company.txt"]) {
    expect(isSafeDocumentPath(name)).toBe(true);
    const root = "C:\\synthetic\\root";
    const child = win32.relative(root, win32.resolve(root, name));
    expect(child.startsWith("..")).toBe(false);
    expect(win32.isAbsolute(child)).toBe(false);
  }
});

test("write boundary rejects unsafe batches before deleting existing documents; nested input works", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-benchmark-path-"));
  const previous = process.env.LEGALWORK_BENCHMARKS_DIR;
  process.env.LEGALWORK_BENCHMARKS_DIR = root;
  try {
    const config = { configPath: join(root, "config.json") } as ServerConfig;
    const dir = await writeCustomTaskDocuments(config, "ct_test", [{ name: "nested/input.txt", contentBase64: Buffer.from("original").toString("base64") }]);
    expect(await readFile(join(dir!, "nested/input.txt"), "utf8")).toBe("original");
    for (const name of unsafe) {
      await expect(writeCustomTaskDocuments(config, "ct_test", [
        { name: "valid.txt", contentBase64: "bmV3" }, { name, contentBase64: "YmFk" },
      ])).rejects.toThrow();
      expect(await readFile(join(dir!, "nested/input.txt"), "utf8")).toBe("original");
    }
  } finally {
    if (previous === undefined) delete process.env.LEGALWORK_BENCHMARKS_DIR;
    else process.env.LEGALWORK_BENCHMARKS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
