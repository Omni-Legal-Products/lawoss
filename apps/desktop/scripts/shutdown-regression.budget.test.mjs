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
