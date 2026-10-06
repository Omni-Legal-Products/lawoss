import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  canonicalPickedDirectory,
  canonicalRealpath,
  canonicalTypedDirectory,
  pickedDirectories,
  typedDirectoryInput,
  withShareRootSeparator,
} from "./lawoss-picked-path.mjs";
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
  assert.equal(withShareRootSeparator("C:", "win32"), "C:\\");
  assert.equal(withShareRootSeparator("C:", "darwin"), "C:");
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

test("napísaná cesta: na Windows zmiznú úvodzovky z Prieskumníka a medzery na okraji", () => {
  assert.equal(typedDirectoryInput('"C:\\Klienti\\Novák s. r. o."', "win32"), "C:\\Klienti\\Novák s. r. o.");
  assert.equal(typedDirectoryInput('  "Z:\\Kancelaria"\r\n', "win32"), "Z:\\Kancelaria");
  assert.equal(typedDirectoryInput('" C:\\Klienti "', "win32"), "C:\\Klienti");
  assert.equal(typedDirectoryInput("\tc:\\klienti ", "win32"), "c:\\klienti");
  // Ručne skrátená cesta v úvodzovkách má úvodzovku len na začiatku.
  assert.equal(typedDirectoryInput('"C:\\Klienti', "win32"), "C:\\Klienti");
  // Iba jeden pár; medzery a bodky vnútri názvu ostanú.
  assert.equal(typedDirectoryInput('""C:\\Klienti""', "win32"), '"C:\\Klienti"');
  assert.equal(typedDirectoryInput("C:\\Klienti\\Novák a spol", "win32"), "C:\\Klienti\\Novák a spol");
  assert.equal(typedDirectoryInput("", "win32"), "");
  // Samotné písmeno disku je koreň disku, nie jeho aktuálny priečinok (relatívne `Z:`).
  assert.equal(typedDirectoryInput("Z:", "win32"), "Z:\\");
  assert.equal(typedDirectoryInput(' "z:\r\n', "win32"), "z:\\");
  assert.equal(typedDirectoryInput('"Z:\\"', "win32"), "Z:\\");
  assert.equal(typedDirectoryInput("Z:Klienti", "win32"), "Z:Klienti");
  // Mimo Windows sú úvodzovky aj medzery platné znaky názvu.
  for (const platform of /** @type {NodeJS.Platform[]} */ (["darwin", "linux"])) {
    assert.equal(typedDirectoryInput('"/Volumes/NAS/Kancelaria"', platform), '"/Volumes/NAS/Kancelaria"');
    assert.equal(typedDirectoryInput(" /Users/advokat/Klienti ", platform), " /Users/advokat/Klienti ");
    assert.equal(typedDirectoryInput("Z:", platform), "Z:");
  }
});

test("napísané písmeno disku (aj rodič kópie z cesty v úvodzovkách) dostane tvar koreňa z dialógu", async () => {
  const { fs } = fakeFs({ "\\\\nas\\Kancelaria\\": "dir" }, { "Z:\\": "\\\\nas\\Kancelaria" });
  const picked = await canonicalPickedDirectory("Z:\\", { platform: "win32", fs });
  assert.equal(picked, "\\\\nas\\Kancelaria\\");
  for (const typed of ["Z:", '"Z:', '"Z:\\"', " Z:\\\r\n"]) {
    assert.equal(await canonicalTypedDirectory(typed, { platform: "win32", fs }), picked, typed);
  }
});

test("napísaná cesta v úvodzovkách na namapovanom disku dostane tvar ako z dialógu", async () => {
  const { fs } = fakeFs(
    { "Z:\\Kancelaria": "dir", "Z:\\Kancelaria\\Klienti": "dir", "\\\\nas\\share\\Kancelaria\\Klienti": "dir" },
    { "Z:\\Kancelaria\\Klienti": "\\\\nas\\share\\Kancelaria\\Klienti" },
  );
  assert.equal(
    await canonicalTypedDirectory(' "Z:\\Kancelaria\\Klienti" ', { platform: "win32", fs }),
    "\\\\nas\\share\\Kancelaria\\Klienti",
  );
});

test("napísaná cesta s malým písmenom disku a inou veľkosťou písmen dostane tvar z disku", async () => {
  const { fs } = fakeFs(
    { "c:\\users": "dir", "c:\\users\\advokat": "dir", "c:\\users\\advokat\\klienti": "dir", "C:\\Users\\Advokat\\Klienti": "dir" },
    { "c:\\users\\advokat\\klienti": "C:\\Users\\Advokat\\Klienti" },
  );
  assert.equal(await canonicalTypedDirectory("c:\\users\\advokat\\klienti\\", { platform: "win32", fs }), "C:\\Users\\Advokat\\Klienti");
});

test("napísaná cesta cez junction, chýbajúca či relatívna ostane (len bez úvodzoviek)", async () => {
  const link = fakeFs(
    { "C:\\Users": "dir", "C:\\Users\\Advokat": "dir", "C:\\Users\\Advokat\\Dokumenty": "link", "C:\\Users\\Advokat\\Dokumenty\\Klienti": "dir" },
    { "C:\\Users\\Advokat\\Dokumenty\\Klienti": "D:\\Spisy\\Klienti" },
  );
  assert.equal(
    await canonicalTypedDirectory('"C:\\Users\\Advokat\\Dokumenty\\Klienti"', { platform: "win32", fs: link.fs }),
    "C:\\Users\\Advokat\\Dokumenty\\Klienti",
  );
  const missing = fakeFs({}, {});
  assert.equal(await canonicalTypedDirectory("Z:\\Neexistuje ", { platform: "win32", fs: missing.fs }), "Z:\\Neexistuje");
  assert.equal(await canonicalTypedDirectory('"Klienti"', { platform: "win32", fs: missing.fs }), "Klienti");
  // Relatívna cesta sa ani nečíta.
  assert.deepEqual(missing.calls, ["Z:\\Neexistuje"]);
});

test("napísaná cesta: iný typ, príliš dlhá cesta a cesta mimo Windows sa nečítajú", async () => {
  const { fs, calls } = fakeFs({}, {});
  for (const value of [undefined, null, 42, { path: "C:\\Klienti" }]) {
    assert.equal(await canonicalTypedDirectory(/** @type {any} */ (value), { platform: "win32", fs }), value);
  }
  const long = `C:\\${"a".repeat(4096)}`;
  assert.equal(await canonicalTypedDirectory(long, { platform: "win32", fs }), long);
  for (const platform of /** @type {NodeJS.Platform[]} */ (["darwin", "linux"])) {
    assert.equal(await canonicalTypedDirectory(' "/Volumes/NAS/Kancelaria" ', { platform, fs }), ' "/Volumes/NAS/Kancelaria" ');
  }
  assert.deepEqual(calls, []);
});

test("handler canonicalDirectoryPath prevedie napísanú cestu ako výber v dialógu", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /import \{ canonicalTypedDirectory, pickedDirectories \} from "\.\/lawoss-picked-path\.mjs";/);
  const start = main.indexOf('  "canonicalDirectoryPath": async (event, ...args) => {');
  assert.ok(start > 0, "handler musí mať tvar, ktorý nájde scripts/check-electron-bridge.mjs");
  const handler = main.slice(start, main.indexOf("\n  },", start));
  assert.match(handler, /return canonicalTypedDirectory\(args\[0\]\);/);
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

    // Napísaná alebo vložená cesta: malé písmeno disku, iná veľkosť písmen, úvodzovky z Prieskumníka.
    for (const typed of [`${letter.toLowerCase()}:\\Klienti`, `${letter}:\\KLIENTI\\`, `  "${letter}:\\Klienti"\r\n`]) {
      const canonicalTyped = await canonicalTypedDirectory(typed);
      assert.equal(canonicalTyped, path.join(office, "Klienti"), typed);
      assert.equal(await accepted(canonicalTyped), true, typed);
    }
    const lower = `${root[0].toLowerCase()}${root.slice(1)}`;
    assert.equal(await accepted(lower), false);
    assert.equal(await canonicalTypedDirectory(`"${lower}"`), root);
    // Klient priamo v koreni disku, vložený v úvodzovkách (napr. `"P:\Klienti"`): rodič kópie je koreň
    // disku (`P:\` zo stránky, `"P:` zo staršej verzie aj samotné `P:`) a dostane tvar koreňa z dialógu.
    const driveRoot = await canonicalPickedDirectory(`${letter}:\\`);
    assert.equal(await canonicalTypedDirectory(`"${letter}:\\Klienti"`), path.join(office, "Klienti"));
    for (const typed of [`${letter}:\\`, `"${letter}:`, `${letter}:`, `"${letter}:\\"`]) {
      assert.equal(await canonicalTypedDirectory(typed), driveRoot, typed);
    }
    assert.equal(await accepted(driveRoot), true);
    // Skúšobný klon overuje rodiča cieľa kópie (`dirname(target)` v trial-clone.ts).
    assert.equal(await accepted(path.dirname(path.join(driveRoot, "Klienti (trial 2026-10-05)"))), true);
    // Junction ostane aj v napísanej ceste (len bez úvodzoviek) a kontrola ju odmietne ako doteraz.
    assert.equal(await canonicalTypedDirectory(`"${letter}:\\Odkaz"`), `${letter}:\\Odkaz`);
    assert.equal(await canonicalTypedDirectory(` ${path.join(office, "Odkaz")} `), path.join(office, "Odkaz"));
    assert.equal(await accepted(path.join(office, "Odkaz")), false);
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
