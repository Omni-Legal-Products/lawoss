import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// LAWOSS v2: static guards of the native ISIR harness and of the managed engine credential
// boundary. They replace the guard part of the frozen 1.18.29 Windows experiments
// (engine-baseline-probe, engine-compile-monitor, engine-empty-auth-probe), which were removed
// with their `if: false` jobs: they rebuilt and probed the unmodified upstream 1.18.29 Windows
// binary and its OPENCODE_AUTH_CONTENT behaviour, neither of which exists for the 2.1.4 derivative.
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const read=file=>fs.readFile(path.join(repo,file),'utf8');

function assertIntegratedHarness(source,startup) {
  assert.ok(!/empty-auth-probe|engine-baseline-probe|engine-compile-monitor|OPENCODE_AUTH_CONTENT|PINNED_ENGINE_VERSION/.test(source),'No frozen v1 experiment or pinned version remains in the driver');
  assert.ok(source.includes('const engineSelection = await selectedNativeEngine();'));
  assert.ok(source.indexOf('const engineSelection = await selectedNativeEngine();')<source.indexOf('probeNativeEngineVersion(externalEngine, engineSelection.selection.version)'));
  assert.ok(source.indexOf('preparedEngine = await prepareNativeEngineFiles(')<source.indexOf('probeNativeEngineVersion(engine, preparedEngine.version)'));
  assert.ok(source.indexOf('probeNativeEngineVersion(engine, preparedEngine.version)')<source.indexOf('Object.assign(env, {'));
  assert.ok(source.indexOf('Object.assign(env, {')<source.indexOf('const launch ='));
  assert.ok(source.includes('spawn(command, args, { cwd, env:quitNonce ? {...env,LAWOSS_ISIR_NATIVE_QUIT_NONCE:quitNonce} : env, detached:'));
  assert.ok(source.includes('child.isirNativeQuitAcceptance={root,nonce:quitNonce,pid:child.pid}'));
  assert.ok(source.includes('readQuitAcceptance:()=>readNativeQuitAcceptance(appChild.isirNativeQuitAcceptance)'));
  assert.match(source,/await awaitNativeStartup\(\{engineRequest,request:nativeFetch,serverInfo,workspace:workspaces\[0\],expectedVersion:preparedEngine\.version/);
  assert.ok(!/liveEngine\.(?:opencodeUsername|opencodePassword)/.test(source));
  // Engine identity is the instance-free /api/info; no location-bound probe before the provider bootstrap.
  assert.equal((source.match(/engineRequest\('\/info'\)/g)??[]).length,2);
  assert.ok(!/engineRequest\('\/(?:global\/health|mcp|path)/.test(source));
  assert.ok(startup.includes('await engineRequest.ready();'));
  assert.ok(startup.indexOf('await engineRequest.ready();')<startup.indexOf('deadline = Date.now() + 90_000'));
  assert.ok(startup.indexOf('deadline = Date.now() + 90_000')<startup.indexOf('const receipt = await awaitEngineInfo'));
  assert.match(startup,/await response\.json\(\)/);
  assert.ok(!/[?&]directory=|location\[directory\]|\/path\?/.test(startup),'Startup readiness never names a location');
  assert.ok(source.lastIndexOf('verifyNativeEngineRuntime')<source.indexOf('diagnostics.phase("complete")'));
}
test('integrated harness keeps the selected-engine identity and cold-to-selected startup proof without a location probe',async()=>{
  const source=await read('scripts/test-isir-native.mjs'),startup=await read('lawoss/testing/isir/native/startup-readiness.mjs');
  assertIntegratedHarness(source,startup);
  assert.throws(()=>assertIntegratedHarness(source.replace('await awaitNativeStartup({engineRequest','await awaitNativeStartup({wrongRequest'),startup));
  assert.throws(()=>assertIntegratedHarness(source.replace("engineRequest('/info')","engineRequest('/global/health')"),startup));
  assert.throws(()=>assertIntegratedHarness(source,startup.replace('await engineRequest.ready();','')));
  assert.throws(()=>assertIntegratedHarness(source,startup.replace('`${baseUrl}/info`','`${baseUrl}/path?directory=${encodeURIComponent(directory)}`')));
});

test('removed frozen engine experiments leave no job, module or workflow reference while native packaging stays active',async()=>{
  const workflow=await read('.github/workflows/ci-desktop-packaging.yml');
  for(const name of ['windows-engine-baseline','windows-engine-compile-monitor','windows-engine-empty-auth-probe'])assert.ok(!workflow.includes(`  ${name}:`),name);
  assert.ok(!/engine-baseline-probe|engine-compile-monitor|engine-empty-auth-probe/.test(workflow));
  for(const file of ['engine-baseline-probe.mjs','engine-compile-monitor.mjs','engine-compile-monitor-preload.mjs','engine-empty-auth-probe.mjs'])
    await assert.rejects(fs.lstat(path.join(repo,'lawoss/testing/isir/native',file)),{code:'ENOENT'},file);
  // The native gate may live in package-smoke or its own optional job (#385); either way it stays admitted.
  const jobs=workflow.split(/\n(?=  [a-z][a-z-]*:\n)/).filter(block=>block.includes('pnpm test:isir:native'));
  assert.ok(jobs.length>=1);
  for(const job of jobs){
    assert.ok(!/^    if: false$/m.test(job));
    assert.ok(job.includes('node lawoss/testing/isir/native/engine-runtime-smoke.mjs'));
    assert.ok(job.includes('name: isir-native-diagnostics-${{ matrix.os }}'));
  }
});

// LAWOSS v2: engine 2.1.4 dostane heslo cez OPENCODE_PASSWORD (bez OPENCODE_SERVER_*); poistky LAWOSS idú po
// options.env a heslo posledné. Prostredie aj snímka sú filtrované cez withoutServerCredentials.
function assertManagedCredentialBoundary(managed) {
  assert.match(managed,/const lawossEnv = lawossEngineEnv\(options\.inheritEnvironment === false \? \{\} : process\.env\);/);
  assert.match(managed,/const env: Record<string, string \| undefined> = withoutServerCredentials\(\{ \.\.\.\(options\.inheritEnvironment === false \? \{\} : process\.env\), \.\.\.options\.env \}\);/);
  assert.match(managed,/Object\.assign\(env, \{\s+\.\.\.serviceEnv,(?:\s+\/\/[^\n]*)*\s+OPENCODE_DISABLE_FFF: "true",(?:\s+\/\/[^\n]*)*\s+NODE_USE_SYSTEM_CA: "1",\s+\.\.\.lawossEnv,\s+\.\.\.\(options\.service \? \{\} : \{ OPENCODE_PASSWORD: password \}\),\s+\}\);/);
  assert.match(managed,/delete env\.OPENCODE_SERVER_USERNAME;\s+delete env\.OPENCODE_SERVER_PASSWORD;/);
  assert.match(managed,/Object\.entries\(withoutServerCredentials\(\{\s+\.\.\.\(options\.env \?\? \{\}\),\s+\.\.\.serviceEnv,\s+OPENCODE_DISABLE_FFF: "true",\s+NODE_USE_SYSTEM_CA: "1",\s+\.\.\.lawossEnv,\s+\.\.\.\(options\.service \? \{\} : \{ OPENCODE_PASSWORD: password \}\),\s+\}\)\)/);
  assert.match(managed,/spawn\(command, args, \{\s+cwd: options.cwd,\s+env,/);
}
test('source propagation retains reserved filters and current-dev credential stripping',async()=>{
  const runtime=await fs.readFile(path.join(repo,'apps/desktop/electron/runtime.mjs'),'utf8');
  const managed=await fs.readFile(path.join(repo,'apps/server/src/managed-opencode.ts'),'utf8');
  const network=await fs.readFile(path.join(repo,'apps/server/src/lawoss/engine-network.ts'),'utf8');
  assert.ok(runtime.includes('const USER_ENV_RESERVED_PREFIXES = ["LEGALWORK_", "OPENCODE_"];'));
  assert.ok(runtime.includes('if (USER_ENV_RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;'));
  assert.match(runtime,/\.\.\.loadUserEnvFile\(\),\s+\.\.\.process\.env,/);
  assert.ok(runtime.includes('const serverEnv = await buildChildEnv({});\n    Object.assign(process.env, serverEnv);'));
  assertManagedCredentialBoundary(managed);
  assert.throws(()=>assertManagedCredentialBoundary(managed.replace('const env: Record<string, string | undefined> = withoutServerCredentials({','const env: Record<string, string | undefined> = ({')));
  assert.ok(!network.includes('OPENCODE_AUTH_CONTENT'));
});
test('managed credential source guard rejects inheritance, wrapper and precedence regressions',async()=>{
  const managed=await fs.readFile(path.join(repo,'apps/server/src/managed-opencode.ts'),'utf8');
  assertManagedCredentialBoundary(managed);
  const ambient='...(options.inheritEnvironment === false ? {} : process.env),';
  const password='    ...(options.service ? {} : { OPENCODE_PASSWORD: password }),\n';
  const mutations=[
    ['inverted inheritance',ambient,'...(options.inheritEnvironment !== false ? {} : process.env),'],
    ['unconditional inheritance',ambient,'...process.env,'],
    ['reversed inheritance branches',ambient,'...(options.inheritEnvironment === false ? process.env : {}),'],
    ['network helper inherits ambient env','lawossEngineEnv(options.inheritEnvironment === false ? {} : process.env)','lawossEngineEnv(process.env)'],
    ['removed spawn credential wrapper','const env: Record<string, string | undefined> = withoutServerCredentials({','const env: Record<string, string | undefined> = ({'],
    ['removed snapshot credential wrapper','Object.entries(withoutServerCredentials({','Object.entries(({'],
    ['removed feature guard','    OPENCODE_DISABLE_FFF: "true",\n',''],
    ['options override LAWOSS guards','    ...lawossEnv,\n'+password,'    ...lawossEnv,\n    ...options.env,\n'+password],
    ['password before LAWOSS guards','    ...lawossEnv,\n'+password,password+'    ...lawossEnv,\n'],
    ['retained ambient v1 credentials','  delete env.OPENCODE_SERVER_PASSWORD;\n',''],
    ['snapshot options override LAWOSS guards','    ...lawossEnv,\n'+password+'  }))','    ...lawossEnv,\n    ...(options.env ?? {}),\n'+password+'  }))'],
    ['snapshot includes ambient credentials','...(options.env ?? {}),','...process.env,'],
    ['spawn uses unfiltered options','cwd: options.cwd,\n      env,','cwd: options.cwd,\n      env: options.env,'],
  ];
  for(const [name,before,after] of mutations){
    const changed=managed.replace(before,after);
    assert.notEqual(changed,managed,`${name}: mutation must affect actual source`);
    assert.throws(()=>assertManagedCredentialBoundary(changed),undefined,name);
  }
});
