import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { zipSync, strToU8 } from "fflate";
import { inspectSkillPackage, readSkillPackageFile } from "./skill-package.js";
import { SandboxFilesystem } from "./agent-sandbox/filesystem.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "skill-package-"))); roots.push(root);
  const directory = join(root, "workflow");
  await mkdir(join(directory, "resources"), { recursive: true });
  await mkdir(join(directory, "scripts"));
  const skill = join(directory, "SKILL.md");
  await writeFile(skill, "Read resources/felder.md, then use the attached template.");
  await writeFile(join(directory, "resources/felder.md"), "Mandant und Aktenzeichen");
  await writeFile(join(directory, "resources/template.docx"), zipSync({ "word/document.xml": strToU8('<w:document><w:p><w:t>Current firm template</w:t></w:p></w:document>') }));
  await writeFile(join(directory, "scripts/helper.py"), "raise Exception('Reading must never execute this')");
  return { root, directory, skill };
}

test("full package includes Markdown, Word and helpers, and reads current installed bytes", async () => {
  const f = await fixture();
  const manifest = await inspectSkillPackage(f.skill);
  expect(manifest.directory).toBe(f.directory);
  expect(manifest.files.map(file => file.path)).toEqual(["resources/felder.md", "resources/template.docx", "scripts/helper.py", "SKILL.md"].sort((a, b) => a.localeCompare(b)));
  expect((await readSkillPackageFile(f.skill, f.directory, "resources/felder.md")).content).toBe("Mandant und Aktenzeichen");
  expect((await readSkillPackageFile(f.skill, f.directory, "resources/template.docx")).content).toContain("Current firm template");
  expect((await readSkillPackageFile(f.skill, f.directory, "scripts/helper.py")).content).toContain("must never execute");
  await writeFile(join(f.directory, "resources/felder.md"), "Updated checklist");
  expect((await readSkillPackageFile(f.skill, f.directory, "resources/felder.md")).content).toBe("Updated checklist");
  expect((await inspectSkillPackage(f.skill)).hash).not.toBe(manifest.hash);
});

test("resources cannot escape to another package, hidden files, absolute paths or links", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "secret.md"), "unrelated");
  for (const path of ["../secret.md", "resources/../../secret.md", "/etc/passwd", "resources\\..\\secret.md", ".env", "resources/./felder.md", "resources/file:stream"]) {
    await expect(readSkillPackageFile(f.skill, f.directory, path)).rejects.toThrow();
  }
  await expect(readSkillPackageFile(f.skill, f.root, "resources/felder.md")).rejects.toThrow("Load it again");
  // Junctions are available without Windows Developer Mode; file links are
  // tested on macOS/Linux, where they do not require elevated privileges.
  await symlink(f.root, join(f.directory, "linked"), process.platform === "win32" ? "junction" : "dir");
  await expect(readSkillPackageFile(f.skill, f.directory, "linked/secret.md")).rejects.toThrow();
  await expect(inspectSkillPackage(f.skill)).rejects.toThrow("symbolic links");
  if (process.platform !== "win32") {
    await symlink(join(f.root, "secret.md"), join(f.directory, "resources/link.md"));
    await expect(readSkillPackageFile(f.skill, f.directory, "resources/link.md")).rejects.toThrow("not links");
  }
});

test("long resources paginate and Word content with tracked changes is marked incomplete", async () => {
  const f = await fixture(), text = "a".repeat(30000);
  await writeFile(join(f.directory, "resources/long.md"), text);
  const first = await readSkillPackageFile(f.skill, f.directory, "resources/long.md");
  expect(first.nextOffset).toBe(24000);
  const second = await readSkillPackageFile(f.skill, f.directory, "resources/long.md", first.nextOffset);
  expect(first.content + second.content).toBe(text);
  expect(second.nextOffset).toBeUndefined();
  await writeFile(join(f.directory, "resources/template.docx"), zipSync({ "word/document.xml": strToU8('<w:document><w:ins><w:t>Changed</w:t></w:ins></w:document>') }));
  expect(await readSkillPackageFile(f.skill, f.directory, "resources/template.docx")).toMatchObject({ complete: false, notice: expect.stringContaining("visual review") });
});

test("sandbox exposes the full selected package read-only, without its sibling library", async () => {
  const f = await fixture(), workspace = join(f.root, "matter"); await mkdir(workspace);
  const fs = await SandboxFilesystem.create([
    { source: workspace, target: "/workspace", writable: true },
    { source: f.directory, target: "/skills/0", writable: false },
  ], new AbortController().signal);
  try {
    for (const path of ["resources/felder.md", "resources/template.docx", "scripts/helper.py"]) {
      const opened = await fs.request({ op: "open", path: `/skills/0/${path}`, write: false, create: false, exclusive: false, truncate: false });
      const handle = z.number().parse(opened);
      const result = await fs.request({ op: "read", handle, offset: 0, size: 128 * 1024 });
      expect(result).toEqual(await readFile(join(f.directory, path)));
      await fs.request({ op: "close", handle });
    }
    await expect(fs.request({ op: "open", path: "/skills/0/resources/felder.md", write: true, create: false, exclusive: false, truncate: false })).rejects.toThrow();
    await expect(fs.request({ op: "stat", path: "/skills/1/SKILL.md" })).rejects.toThrow();
    await expect(fs.request({ op: "stat", path: "/skills/0/../secret.md" })).rejects.toThrow();
  } finally { await fs.dispose(); }
});

test("Word extraction limits the whole document, including attached headers", async () => {
  const f = await fixture();
  const xml = strToU8("<w:document>" + "a".repeat(9 * 1024 * 1024) + "</w:document>");
  await writeFile(join(f.directory, "resources/template.docx"), zipSync({ "word/document.xml": xml, "word/header1.xml": xml }));
  await expect(readSkillPackageFile(f.skill, f.directory, "resources/template.docx")).rejects.toThrow("extraction limit");
});
