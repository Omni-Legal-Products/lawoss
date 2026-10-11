import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsSandboxRuntime, changedPaths } from './sandbox-changes.mjs';

test('ordinary UI, workflows, documents and unrelated server changes skip VM builds', () => {
  assert.equal(needsSandboxRuntime(['README.md', 'apps/app/src/react-app/session.tsx', 'apps/server/src/calendar/service.ts', 'apps/server/src/resources/skills/example/SKILL.md']), false);
  assert.equal(needsSandboxRuntime([]), false);
});

test('isolation, permissions, engine wiring and runtime dependencies retain real VM checks', () => {
  for (const path of ['apps/server/src/agent-sandbox/filesystem.ts', 'apps/server/src/agent-sandbox/vm.integration.test.ts',
    'apps/server/resources/agent-sandbox/runtime.json', 'scripts/sandbox/host-windows.c', 'scripts/sandbox/build-runtime-source.sh',
    'apps/server/src/server.ts', 'apps/server/src/approvals.ts', 'apps/server/src/org-policy.ts',
    'apps/server/src/legalwork-runtime-config.ts', 'apps/server/src/opencode-plugins/legalwork-sandbox.ts',
    'apps/server/src/routes/agent-sandbox.ts', 'apps/desktop/electron/main.mjs',
    'apps/server/src/opencode-plugins/legalwork-skill-tools.ts', 'apps/server/src/skill-composition.ts',
    'apps/server/src/calculations/python-runner.ts', 'apps/server/src/calculations/calculations.test.ts',
    'pnpm-lock.yaml', 'constants.json', '.github/workflows/sandbox-runtime.yml', '.github/workflows/ci-tests.yml',
    'scripts/ci/sandbox-changes.mjs', 'apps/server/package.json']) {
    assert.equal(needsSandboxRuntime([path]), true, path);
  }
});

test('Git diffs include every pushed commit and deleted/renamed inputs, without unrelated base-branch changes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sandbox-ci-diff-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const check = (base, head, event = 'push') => {
    const output = join(cwd, 'output'); writeFileSync(output, '');
    execFileSync(process.execPath, [fileURLToPath(new URL('./sandbox-changes.mjs', import.meta.url))], {
      cwd, env: { ...process.env, GITHUB_OUTPUT: output, EVENT_NAME: event, BASE_SHA: base, HEAD_SHA: head },
    });
    return readFileSync(output, 'utf8').trim();
  };
  try {
    git('init', '-b', 'dev');
    mkdirSync(join(cwd, 'scripts/sandbox'), { recursive: true });
    writeFileSync(join(cwd, 'scripts/sandbox/guest.py'), 'initial');
    writeFileSync(join(cwd, 'README.md'), 'initial');
    git('add', '.'); git('commit', '-m', 'initial'); const base = git('rev-parse', 'HEAD');
    git('checkout', '-b', 'docs');
    writeFileSync(join(cwd, 'README.md'), 'docs only'); git('add', 'README.md'); git('commit', '-m', 'docs');
    const docs = git('rev-parse', 'HEAD'); expectResult(check(base, docs), false);
    git('checkout', 'dev');
    writeFileSync(join(cwd, 'scripts/sandbox/guest.py'), 'new runtime'); git('add', 'scripts'); git('commit', '-m', 'runtime');
    const updatedBase = git('rev-parse', 'HEAD');
    expectResult(check(updatedBase, docs, 'pull_request'), false);
    writeFileSync(join(cwd, 'README.md'), 'later docs'); git('add', 'README.md'); git('commit', '-m', 'more docs');
    expectResult(check(base, git('rev-parse', 'HEAD')), true);
    git('mv', 'scripts/sandbox/guest.py', 'moved.py'); git('commit', '-m', 'move runtime input');
    expectResult(check(updatedBase, git('rev-parse', 'HEAD')), true);
    expectResult(check('', '', 'workflow_dispatch'), true);
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

function expectResult(output, required) { assert.equal(output, `required=${required}`); }

test('unknown diff boundaries require validation instead of silently skipping', () => {
  assert.equal(changedPaths('', 'bad', false), null);
  assert.equal(changedPaths('0'.repeat(40), 'a'.repeat(40), false), null);
});
