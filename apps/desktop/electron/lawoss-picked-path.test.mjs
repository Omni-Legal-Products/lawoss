import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canonicalPickedDirectory, canonicalRealpath, pickedDirectories, withShareRootSeparator } from "./lawoss-picked-path.mjs";
import { createWorkspaceStore } from "./workspace-store.mjs";

const stat = (kind) => ({ isSymbolicLink: () => kind === "link", isDirectory: () => kind !== "file" });

function fakeFs(entries, mapping) {
  const calls = [];
  return {
    calls,
    fs: {
      lstat: async (value) => {
        calls.push(value);
        if (!(value in entries)) throw Object.assign(new Error(`ENOENT ${value}`), { code: "ENOENT" });
        return stat(entries[value]);
      },
      realpath: async (value) => {
        if (!(value in mapping)) throw Object.assign(new Error(`ENOENT ${value}`), { code: "ENOENT" });
        return mapping[value];
      },
    },
  };
}

test("namapovaný disk dostane kanonický tvar UNC", async () => {
  const { fs } = fakeFs(
    { "Z:\\Kancelaria": "dir", "Z:\\Kancelaria\\Klienti": "dir", "\\\\nas\\share\\Kancelaria\\Klienti": "dir" },
    { "Z:\\Kancelaria\\Klienti": "\\\\nas\\share\\Kancelaria\\Klienti" },
  );
  assert.equal(
    await canonicalPickedDirectory("Z:\\Kancelaria\\Klienti", { platform: "win32", fs }),
    "\\\\nas\\share\\Kancelaria\\Klienti",
  );
});

test("disk namapovaný priamo na zdieľanie dostane koreň s lomkou ako z resolve()", async () => {
  const { fs } = fakeFs({ "\\\\nas\\Kancelaria\\": "dir" }, { "Z:\\": "\\\\nas\\Kancelaria" });
  assert.equal(await canonicalPickedDirectory("Z:\\", { platform: "win32", fs }), "\\\\nas\\Kancelaria\\");
  assert.equal(path.win32.resolve("\\\\nas\\Kancelaria"), "\\\\nas\\Kancelaria\\");
});

test("lomka sa pridá len koreňu zdieľania na Windows", () => {
  assert.equal(withShareRootSeparator("\\\\nas\\Kancelaria", "win32"), "\\\\nas\\Kancelaria\\");
  assert.equal(withShareRootSeparator("\\\\nas\\Kancelaria\\", "win32"), "\\\\nas\\Kancelaria\\");
  assert.equal(withShareRootSeparator("\\\\nas\\Kancelaria\\Klienti", "win32"), "\\\\nas\\Kancelaria\\Klienti");
  assert.equal(withShareRootSeparator("C:\\", "win32"), "C:\\");
  assert.equal(withShareRootSeparator("C:\\Klienti", "win32"), "C:\\Klienti");
  assert.equal(withShareRootSeparator("\\\\nas\\Kancelaria", "darwin"), "\\\\nas\\Kancelaria");
  assert.equal(withShareRootSeparator("/Volumes/NAS", "darwin"), "/Volumes/NAS");
});

test("cesta cez junction alebo symlink ostane, ako je", async () => {
  const { fs } = fakeFs(
    { "C:\\Users": "dir", "C:\\Users\\Advokat": "dir", "C:\\Users\\Advokat\\Dokumenty": "link", "D:\\Spisy": "dir" },
    { "C:\\Users\\Advokat\\Dokumenty": "D:\\Spisy" },
  );
  assert.equal(
    await canonicalPickedDirectory("C:\\Users\\Advokat\\Dokumenty", { platform: "win32", fs }),
    "C:\\Users\\Advokat\\Dokumenty",
  );
});

test("junction uprostred cesty (presmerované Dokumenty) cestu tiež nemení", async () => {
  const { fs } = fakeFs(
    {
      "C:\\Users": "dir",
      "C:\\Users\\Advokat": "dir",
      "C:\\Users\\Advokat\\Dokumenty": "link",
      "C:\\Users\\Advokat\\Dokumenty\\Klienti": "dir",
      "D:\\Spisy\\Klienti": "dir",
    },
    { "C:\\Users\\Advokat\\Dokumenty\\Klienti": "D:\\Spisy\\Klienti" },
  );
  assert.equal(
    await canonicalPickedDirectory("C:\\Users\\Advokat\\Dokumenty\\Klienti", { platform: "win32", fs }),
    "C:\\Users\\Advokat\\Dokumenty\\Klienti",
  );
});

test("chyba ani súbor namiesto priečinka cestu nemenia", async () => {
  const missing = fakeFs({}, {});
  assert.equal(await canonicalPickedDirectory("Z:\\Kancelaria", { platform: "win32", fs: missing.fs }), "Z:\\Kancelaria");
  const file = fakeFs({ "Z:\\spis.pdf": "file", "\\\\nas\\share\\spis.pdf": "file" }, { "Z:\\spis.pdf": "\\\\nas\\share\\spis.pdf" });
  assert.equal(await canonicalPickedDirectory("Z:\\spis.pdf", { platform: "win32", fs: file.fs }), "Z:\\spis.pdf");
  const relative = fakeFs({}, {});
  assert.equal(await canonicalPickedDirectory("Kancelaria", { platform: "win32", fs: relative.fs }), "Kancelaria");
  assert.deepEqual(relative.calls, []);
});

test("mimo Windows sa cesta nečíta ani nemení", async () => {
  for (const platform of /** @type {NodeJS.Platform[]} */ (["darwin", "linux"])) {
    const { fs, calls } = fakeFs({}, {});
    assert.equal(await canonicalPickedDirectory("/Volumes/NAS/Kancelaria", { platform, fs }), "/Volumes/NAS/Kancelaria");
    assert.deepEqual(calls, []);
  }
});

test("handler pickDirectory prevedie cesty len s voľbou canonical", async () => {
  const seen = [];
  const canonicalize = async (value) => { seen.push(value); return `kanonicky:${value}`; };
  assert.deepEqual(await pickedDirectories(["Z:\\A", "Z:\\B"], { canonical: true }, canonicalize), ["kanonicky:Z:\\A", "kanonicky:Z:\\B"]);
  assert.deepEqual(await pickedDirectories(["Z:\\A"], {}, canonicalize), ["Z:\\A"]);
  assert.deepEqual(await pickedDirectories(["Z:\\A"], { canonical: false }, canonicalize), ["Z:\\A"]);
  assert.deepEqual(seen, ["Z:\\A", "Z:\\B"]);
  // main.mjs sa v testoch nenačíta (Electron), preto aspoň overíme, že handler funkciu volá.
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const handler = main.slice(main.indexOf('"pickDirectory": async'), main.indexOf('"pickFile": async'));
  assert.match(handler, /await pickedDirectories\(result\.filePaths, options\)/);
  assert.match(handler, /options\.multiple \? filePaths : \(filePaths\[0\] \?\? null\)/);
});

// Kontrola, ktorou OKF, server aj register pracovných priestorov odmietajú cestu.
const accepted = async (value) => (await canonicalRealpath(value)) === path.resolve(value);

function freeDriveLetter() {
  for (const letter of "PQRSTUVWXY") if (!existsSync(`${letter}:\\`)) return letter;
  return null;
}

/** @param {string} root */
async function testStore(root) {
  const userData = path.join(root, "userData");
  await mkdir(userData, { recursive: true });
  return createWorkspaceStore({
    app: { getPath: (name) => name === "userData" ? userData : root },
    defaultDenBaseUrl: "https://example.test",
    defaultRequireSignin: false,
    forceRequireSignin: false,
  });
}

test("Windows: disk zo subst prejde kontrolou kanonickej cesty až po výbere", { skip: process.platform !== "win32" }, async (t) => {
  const letter = freeDriveLetter();
  if (!letter) return t.skip("žiadne voľné písmeno disku");
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-subst-")));
  const office = path.join(root, "Kancelaria");
  await mkdir(path.join(office, "Klienti", "Sub"), { recursive: true });
  execFileSync("subst", [`${letter}:`, office]);
  try {
    const picked = `${letter}:\\Klienti`;
    // Bez úpravy: natívny realpath prepíše disk na cieľ a cesta z dialógu neprejde.
    assert.equal(await realpath(picked), path.join(office, "Klienti"));
    assert.equal(await accepted(picked), false);

    const canonical = await canonicalPickedDirectory(picked);
    assert.equal(canonical, path.join(office, "Klienti"));
    assert.equal(await accepted(canonical), true);
    assert.equal(await accepted(await canonicalPickedDirectory(`${letter}:\\`)), true);

    // Register pracovných priestorov (registerExisting) prijme kanonický tvar.
    const store = await testStore(root);
    await assert.rejects(store.createWorkspace({ folderPath: picked, name: "Klienti", preset: "starter", registerExisting: true }));
    const registered = await store.createWorkspace({ folderPath: canonical, name: "Klienti", preset: "starter", registerExisting: true });
    assert.ok(registered.workspaces.some((workspace) => workspace.path === canonical));

    // Junction v ceste (na konci aj uprostred): zmena by obišla kontrolu odkazov, cesta ostane.
    await symlink(path.join(office, "Klienti"), path.join(office, "Odkaz"), "junction");
    assert.equal(await canonicalPickedDirectory(`${letter}:\\Odkaz`), `${letter}:\\Odkaz`);
    assert.equal(await canonicalPickedDirectory(`${letter}:\\Odkaz\\Sub`), `${letter}:\\Odkaz\\Sub`);
  } finally {
    execFileSync("subst", [`${letter}:`, "/D"]);
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("Windows: namapovaný sieťový disk (net use) prejde kontrolou až po výbere, aj jeho koreň", { skip: process.platform !== "win32" }, async (t) => {
  const letter = freeDriveLetter();
  if (!letter) return t.skip("žiadne voľné písmeno disku");
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-netuse-")));
  const { root: volume } = path.parse(root);
  const share = `\\\\localhost\\${volume[0]}$`;
  try {
    execFileSync("net", ["use", `${letter}:`, share, "/persistent:no"], { stdio: "ignore", timeout: 30_000 });
  } catch {
    await rm(root, { recursive: true, force: true });
    return t.skip(`administratívna zdieľaná zložka ${share} nie je dostupná`);
  }
  try {
    const picked = `${letter}:\\${root.slice(volume.length)}`;
    assert.equal(await accepted(picked), false);
    const canonical = await canonicalPickedDirectory(picked);
    assert.notEqual(canonical, picked);
    assert.equal(await accepted(canonical), true);

    // Koreň zdieľania: natívny realpath ho vráti bez lomky, resolve s lomkou.
    t.diagnostic(`realpath(${JSON.stringify(share)}) = ${JSON.stringify(await realpath(share))}`);
    assert.equal(await accepted(share), true);
    assert.equal(await accepted(`${share}\\`), true);
    const pickedRoot = await canonicalPickedDirectory(`${letter}:\\`);
    assert.equal(pickedRoot, path.resolve(share));
    assert.equal(await accepted(pickedRoot), true);

    // Register pracovných priestorov prijme koreň zdieľania; samotné písmeno disku nie.
    const store = await testStore(root);
    await assert.rejects(store.createWorkspace({ folderPath: `${letter}:\\`, name: "NAS", preset: "starter", registerExisting: true }));
    const registered = await store.createWorkspace({ folderPath: pickedRoot, name: "NAS", preset: "starter", registerExisting: true });
    assert.ok(registered.workspaces.some((workspace) => workspace.path === pickedRoot));
  } finally {
    execFileSync("net", ["use", `${letter}:`, "/delete", "/y"], { stdio: "ignore", timeout: 30_000 });
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
