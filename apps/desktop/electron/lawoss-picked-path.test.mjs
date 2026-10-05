import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { canonicalPickedDirectory } from "./lawoss-picked-path.mjs";
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

// Kontrola, ktorou OKF, server aj register pracovných priestorov odmietajú cestu.
const accepted = async (value) => (await realpath(value)) === path.resolve(value);

function freeDriveLetter() {
  for (const letter of "PQRSTUVWXY") if (!existsSync(`${letter}:\\`)) return letter;
  return null;
}

test("Windows: disk zo subst prejde kontrolou kanonickej cesty až po výbere", { skip: process.platform !== "win32" }, async (t) => {
  const letter = freeDriveLetter();
  if (!letter) return t.skip("žiadne voľné písmeno disku");
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-subst-")));
  const office = path.join(root, "Kancelaria");
  await mkdir(path.join(office, "Klienti"), { recursive: true });
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
    const userData = path.join(root, "userData");
    await mkdir(userData);
    const store = createWorkspaceStore({
      app: { getPath: (name) => name === "userData" ? userData : root },
      defaultDenBaseUrl: "https://example.test",
      defaultRequireSignin: false,
      forceRequireSignin: false,
    });
    await assert.rejects(store.createWorkspace({ folderPath: picked, name: "Klienti", preset: "starter", registerExisting: true }));
    const registered = await store.createWorkspace({ folderPath: canonical, name: "Klienti", preset: "starter", registerExisting: true });
    assert.ok(registered.workspaces.some((workspace) => workspace.path === canonical));

    // Junction v ceste: zmena by obišla kontrolu odkazov, preto ostane pôvodná cesta.
    await symlink(path.join(office, "Klienti"), path.join(office, "Odkaz"), "junction");
    assert.equal(await canonicalPickedDirectory(`${letter}:\\Odkaz`), `${letter}:\\Odkaz`);
  } finally {
    execFileSync("subst", [`${letter}:`, "/D"]);
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("Windows: namapovaný sieťový disk (net use) prejde kontrolou až po výbere", { skip: process.platform !== "win32" }, async (t) => {
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
    // Koreň zdieľania: realpath vracia `\\server\share` bez lomky, resolve s lomkou, takže
    // kontrola `realpath(x) === resolve(x)` ho odmietne (známe obmedzenie, zapísané v PR).
    for (const value of [share, `${share}\\`]) {
      const real = await realpath(value).catch((error) => `chyba ${error.code}`);
      t.diagnostic(`koreň zdieľania ${JSON.stringify(value)}: realpath ${JSON.stringify(real)}, resolve ${JSON.stringify(path.resolve(value))}`);
    }
  } finally {
    execFileSync("net",["use", `${letter}:`, "/delete", "/y"], { stdio: "ignore", timeout: 30_000 });
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
