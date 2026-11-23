import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Source contract only; the real Electron smoke owns IPC/dialog proof.
test('shutdown regression parent budget is long enough for tip macos CI', () => {
  const source = readFileSync(fileURLToPath(new URL('./shutdown-regression.mjs', import.meta.url)), 'utf8');
  assert.match(source, /LEGALWORK_SHUTDOWN_TEST_TIMEOUT_MS \|\| 180_000/);
  assert.match(source, /budgetMs >= 30_000/);
  assert.match(source, /parent budget \$\{budgetMs\}ms expired/);
  assert.doesNotMatch(source, /child\.kill\("SIGKILL"\), 60_000\)/);
});

// #561 added eventStreams/httpRequests.closeAll() to production before-quit; the
// synthetic vm context must stub them or preventDefault leaves quit cancelled.
test('shutdown and updater quit fixtures stub #561 stream/request closeAll', () => {
  for (const name of ['./shutdown-regression.mjs', './updater-quit-regression.mjs']) {
    const source = readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
    assert.match(source, /eventStreams:\s*\{\s*closeAll\(\)\s*\{\s*\}\s*\}/, `${name} stubs eventStreams.closeAll`);
    assert.match(source, /httpRequests:\s*\{\s*closeAll\(\)\s*\{\s*\}\s*\}/, `${name} stubs httpRequests.closeAll`);
  }
  const main = readFileSync(fileURLToPath(new URL('../electron/main.mjs', import.meta.url)), 'utf8');
  const quit = main.slice(main.indexOf('app.on("before-quit"'), main.indexOf('app.on("second-instance"'));
  assert.match(quit, /eventStreams\.closeAll\(\)/);
  assert.match(quit, /httpRequests\.closeAll\(\)/);
});
