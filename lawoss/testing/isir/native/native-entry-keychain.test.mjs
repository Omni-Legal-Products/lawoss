import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise the actual fixture entry at its Electron/production-main boundary.
// Stub native APIs so the regression can never prompt for the host keychain.
async function entryFixture(platform, outsideProfile = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-native-entry-'));
  try {
    const profile = path.join(root, 'profile');
    await mkdir(profile);
    await writeFile(path.join(root, 'electron.mjs'), `
      Object.defineProperty(process,'platform',{value:${JSON.stringify(platform)}});
      export const switches = new Map();
      export const app={isPackaged:false,setPath(){},commandLine:{appendSwitch:(name,value)=>switches.set(name,value)}};
      export const dialog={};
      export const ipcMain={handle(){}};
    `);
    await writeFile(path.join(root, 'main.mjs'), `
      import assert from 'node:assert/strict';
      import {switches} from './electron.mjs';
      assert.equal(switches.has('use-mock-keychain'),${platform === 'darwin'},'isolated macOS startup must select the mock keychain before production imports');
      console.log('native-main-imported');
    `);
    const source = await readFile(new URL('../../../../apps/desktop/scripts/isir-native-entry.mjs', import.meta.url), 'utf8');
    const fixture = source.replace('from "electron"', `from ${JSON.stringify(pathToFileURL(path.join(root, 'electron.mjs')).href)}`)
      .replace('from "../../../lawoss/testing/isir/native/engine-fetch.mjs"', `from ${JSON.stringify(new URL('./engine-fetch.mjs',import.meta.url).href)}`)
      .replace('from "../../../lawoss/testing/isir/native/quit-acceptance.mjs"', `from ${JSON.stringify(new URL('./quit-acceptance.mjs',import.meta.url).href)}`)
       .replace('import("../electron/main.mjs")', 'import("./main.mjs")');
    await writeFile(path.join(root, 'entry.mjs'), fixture);
    return spawnSync(process.execPath, [path.join(root, 'entry.mjs')], {
      env: { LEGALWORK_DEV_MODE: '1', LAWOSS_ISIR_NATIVE_ROOT: root,
        LEGALWORK_ELECTRON_USERDATA: outsideProfile ? path.dirname(root) : profile },
      encoding: 'utf8', timeout: 5000,
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}

for (const platform of ['darwin', 'linux', 'win32']) test(`native entry configures test keychain before the production main import on ${platform}`, async () => {
  const result = await entryFixture(platform);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /native-main-imported/);
});

test('native entry rejects an unowned profile before importing production main', async () => {
  const result = await entryFixture('darwin', true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /profile inside the owned test root/);
  assert.doesNotMatch(result.stdout, /native-main-imported/);
});
