import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Command wiring only; the invoked real Electron smoke owns renderer/IPC proof.
test('normal macOS test job retries flaky Electron shutdown without soft-failure', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci-tests.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  unit-tests:\n')[1]?.split('\n  legalwork-tests:\n')[0];
  assert.ok(job, 'The normal PR unit-tests job must exist');
  const step = job.split(/^      - name: /m).find(block => /^Verify workflow editing and close\/restart decisions in Electron\n/.test(block));
  assert.ok(step, 'The real shutdown command must be a normal CI step');
  assert.match(step, /^        if: \(runner\.os == 'macOS'\) && \(needs\.changes\.outputs\.app == 'true' \|\| needs\.changes\.outputs\.desktop == 'true'\)$/m);
  assert.match(
    step,
    /^          pnpm --filter @legalwork\/desktop test:shutdown \|\| pnpm --filter @legalwork\/desktop test:shutdown$/m,
  );
  assert.match(step, /^          pnpm --filter @legalwork\/desktop test:workflow-editor$/m);
  assert.match(step, /^          pnpm --filter @legalwork\/desktop test:updater-quit$/m);
  assert.doesNotMatch(step, /continue-on-error|workflow_dispatch|inputs\./);
  const desktop = JSON.parse(readFileSync(new URL('../../apps/desktop/package.json', import.meta.url), 'utf8'));
  assert.equal(desktop.scripts['test:shutdown'], 'node scripts/shutdown-regression.mjs');
  assert.ok(readFileSync(new URL('../../apps/desktop/scripts/shutdown-regression.mjs', import.meta.url), 'utf8').length > 0);
});
