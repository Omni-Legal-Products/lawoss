/**
 * Licenčná atribúcia upstreamu v distribuovanom balíku.
 *
 * LAWOSS je fork LegalWorku pod MIT. Tá licencia má jedinú vecnú podmienku:
 * doložka o autorstve musí byť „included in all copies or substantial
 * portions of the Software". Balík, ktorý dostane tester, je kópia — takže
 * doložka musí ísť s ním, nie ostať len v repozitári.
 *
 * Tieto testy nestrážia kód, strážia záväzok. Preto kontrolujú aj to, čo sa
 * „upratovaním brandingu" najľahšie stratí: meno pôvodného držiteľa práv.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, "..");
const repoRoot = path.join(desktopDir, "..", "..");
const config = readFileSync(path.join(desktopDir, "electron-builder.yml"), "utf8");

test("binárka nesie doložku, ktorá menuje oboch držiteľov", () => {
  const line = config.split("\n").find((row) => row.startsWith("copyright:"));
  assert.ok(line, "electron-builder.yml musí mať explicitný copyright — inak si ho electron-builder odvodí z `author` a uvedie jediného držiteľa");
  assert.match(line, /Eigenwelt Labs/, "pôvodný držiteľ práv musí v doložke ostať");
  assert.match(line, /LAWOSS/, "doložka má menovať aj nás");
});

test("LICENSE a NOTICE sa balia do aplikácie", () => {
  for (const name of ["LICENSE", "NOTICE"]) {
    assert.match(
      config,
      new RegExp(`- from: \\.\\./\\.\\./${name}\\s*\\n\\s*to: ${name}`),
      `${name} musí byť v extraResources, inak v .dmg ani .exe nie je`,
    );
    assert.ok(existsSync(path.join(repoRoot, name)), `${name} musí v koreni repozitára existovať — cesta v extraResources naň mieri`);
  }
});

test("LICENSE si drží pôvodnú doložku aj text MIT", () => {
  const license = readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
  assert.match(license, /Copyright \(c\) 2026 Eigenwelt Labs/);
  assert.match(license, /The above copyright notice and this permission notice shall be included/);
});

test("NOTICE priznáva pôvod forku", () => {
  const notice = readFileSync(path.join(repoRoot, "NOTICE"), "utf8");
  assert.match(notice, /eigenweltlabs\/legalwork/, "NOTICE musí odkazovať na upstream repozitár");
  assert.match(notice, /Eigenwelt Labs/);
});
