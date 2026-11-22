import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Command wiring only; the invoked real Electron smoke owns renderer/IPC proof.
test('normal macOS test job runs the real host review gate without an optional or soft-failure path', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci-tests.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  legalwork-tests:\n')[1]?.split('\n  sandbox-engine:\n')[0];
  assert.ok(job, 'The normal PR test job must exist');
  const step = job.split(/^      - name: /m).find(block => /^Verify bounded native host context review in Electron\n/.test(block));
  assert.ok(step, 'The real host review command must be a normal CI step');
  assert.match(step, /^        if: runner\.os == 'macOS'$/m);
  assert.match(step, /^        timeout-minutes: 8$/m);
  assert.match(step, /^          attempt=1$/m);
  assert.match(step, /^          until pnpm --filter @legalwork\/desktop test:host-review; do$/m);
  assert.match(step, /^            if \[ "\$attempt" -ge 3 \]; then$/m);
  assert.match(step, /^            sleep \$\(\(attempt \* 5\)\)$/m);
  assert.doesNotMatch(step, /continue-on-error|workflow_dispatch|inputs\./);
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'));
  assert.equal(desktop.scripts['test:host-review'], 'node scripts/run-host-review-regression.mjs');
  const launcher = readFileSync(new URL('../../apps/desktop/scripts/run-host-review-regression.mjs', import.meta.url), 'utf8');
  assert.match(launcher, /new URL\("host-review-regression\.mjs"/);
  assert.match(launcher, /timeoutMs = 120000/);
  const regression = readFileSync(new URL('../../apps/desktop/scripts/host-review-regression.mjs', import.meta.url), 'utf8');
  assert.ok(regression.includes('createHostApprovalHandler'));
  assert.match(regression, /}, 90000\);/);
  assert.match(regression, /timed out at \$\{phase\} after \$\{Date\.now\(\) - startedAt\}ms/);
});
