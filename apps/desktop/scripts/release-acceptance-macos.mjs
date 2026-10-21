import { stopNativeChild } from '../../../lawoss/testing/isir/native/owned-process.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline/promises';
import { REQUIRED_NATIVE_SCENARIOS, sha256 } from '../../../scripts/release/release-evidence.mjs';
async function tree(root) {
    const result = [];
    async function visit(dir) { for (const name of (await readdir(dir)).sort()) {
        const path = join(dir, name), info = await lstat(path), nameInTree = relative(root, path);
        if (info.isSymbolicLink())
            result.push([nameInTree, 'link', await readlink(path)]);
        else if (info.isDirectory()) {
            result.push([nameInTree, 'dir']);
            await visit(path);
        }
        else if (info.isFile())
            result.push([nameInTree, 'file', info.mode & 0o777, sha256(await readFile(path))]);
        else
            throw new Error('Unsupported installed bundle entry');
    } }
    await visit(root);
    return result;
}
export async function compareInstalledTree(installerApp, installedApp) {
    if (JSON.stringify(await tree(installerApp)) !== JSON.stringify(await tree(installedApp)))
        throw new Error('Installed bundle tree or bytes differ from final installer');
}
export function validateLiveProcessIdentity(observed, expected) {
    const b = observed.build, e = expected.build;
    if (observed.ok !== true || b?.provenance !== 'embedded' || b.legalworkDevMode !== false || b.version !== e.version || b.gitSha !== e.gitSha || b.buildEpoch !== e.buildEpoch || b.os !== e.platform || b.arch !== e.arch || b.channel !== e.channel)
        throw new Error('Live packaged IPC identity differs');
    if (observed.process?.pid !== expected.pid || observed.process.userData !== expected.userData || observed.process.executable !== expected.executable)
        throw new Error('Live process or profile ownership differs');
    let renderer;
    try {
        renderer = fileURLToPath(observed.rendererUrl);
    }
    catch {
        throw new Error('Expected the packaged file renderer');
    }
    if (!renderer.startsWith(`${expected.rendererRoot}${sep}`))
        throw new Error('Packaged renderer or shipping snapshot unavailable');
}
export function validateLiveIdentity(observed, expected) {
    validateLiveProcessIdentity(observed, expected);
    if (observed.snapshot?.ok !== true || typeof observed.snapshot.route !== 'string')
        throw new Error('Packaged renderer or shipping snapshot unavailable');
}
async function verifyMacInstallation({ installedApp, asset, scratch }) {
    // Verify only. These tools never sign, notarize, or modify the payload.
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', installedApp], { stdio: 'pipe', timeout: 60000 });
    execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', installedApp], { stdio: 'pipe', timeout: 60000 });
    let extracted, mounted = false;
    try {
        if (asset.endsWith('.dmg')) {
            extracted = join(scratch, 'mount');
            await mkdir(extracted);
            execFileSync('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', extracted, asset], { stdio: 'pipe', timeout: 60000 });
            mounted = true;
        }
        else if (asset.endsWith('.zip')) {
            extracted = join(scratch, 'extracted');
            await mkdir(extracted);
            execFileSync('/usr/bin/ditto', ['-x', '-k', asset, extracted], { stdio: 'pipe', timeout: 60000 });
        }
        else
            throw new Error('macOS acceptance requires the final DMG or ZIP');
        const apps = (await readdir(extracted)).filter(name => name.endsWith('.app'));
        if (apps.length !== 1)
            throw new Error('Expected one installed app in final installer');
        await compareInstalledTree(join(extracted, apps[0]), installedApp);
    }
    finally {
        if (mounted)
            execFileSync('/usr/bin/hdiutil', ['detach', extracted], { stdio: 'pipe', timeout: 30000 });
    }
}
async function launchOwnedApp({ installedApp, profileRoot, build, timeoutMs = 90000 }) {
    const executable = await realpath(join(installedApp, 'Contents/MacOS/LAWOSS'));
    const root = await realpath(profileRoot), userdata = join(root, 'userdata'), runtime = join(root, 'runtime'), workspace = join(root, 'workspace');
    for (const path of [userdata, runtime, workspace, join(root, 'home'), join(root, 'config'), join(root, 'data'), join(root, 'cache')])
        await mkdir(path, { recursive: true, mode: 0o700 });
    // Stale discovery cannot identify a new child. Keep credentials in memory only.
    const discoveryPath = join(userdata, 'legalwork-ui-control.json');
    await rm(discoveryPath, { force: true });
    const inherited = Object.fromEntries(['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TERM', 'USER', 'LOGNAME'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const child = spawn(executable, [], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...inherited, HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'config'), XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '', LEGALWORK_DEV_MODE: '0', LEGALWORK_ELECTRON_USERDATA: userdata, LEGALWORK_DATA_DIR: runtime, LEGALWORK_SERVER_CONFIG: join(runtime, 'server.json'), LEGALWORK_RUNTIME_DB: join(runtime, 'runtime.db'), OPENCODE_DB: join(runtime, 'opencode.db'), LEGALWORK_WORKSPACES: workspace, LEGALWORK_WORD_ADDIN: '0' } });
    let launchError;
    child.once('error', error => { launchError = error; });
    child.stdout.resume();
    child.stderr.resume();
    const closed = new Promise(resolveClosed => child.once('close', resolveClosed));
    async function stop() {
        await stopNativeChild(child, 5_000);
        await Promise.race([closed, delay(5_000, undefined, { ref: false })]);
    }

    const expected = { build, pid: child.pid, userData: userdata, executable, rendererRoot: join(await realpath(installedApp), 'Contents/Resources/app-dist') };
    let discovery;
    async function request(path) { const response = await fetch(`${discovery.baseUrl}${path}`, { headers: { authorization: `Bearer ${discovery.token}` }, signal: AbortSignal.timeout(5000) }); if (!response.ok)
        throw new Error('Shipping UI control request failed'); return response.json(); }
    async function observe() { const identity = await request('/build-info'); identity.snapshot = await request('/snapshot'); validateLiveIdentity(identity, expected); return identity; }
    try {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (launchError)
                throw launchError;
            if (child.exitCode !== null || child.signalCode !== null)
                throw new Error('Installed app exited before native readiness');
            try {
                discovery = JSON.parse(await readFile(discoveryPath, 'utf8'));
                if (typeof discovery.token !== 'string' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(discovery.baseUrl))
                    throw new Error('Invalid owned discovery');
                const identity = await observe();
                return { stop, observe, identity, pid: child.pid };
            }
            catch { /* Discovery and renderer may not yet be ready. The original deadline remains. */ }
            await delay(200);
        }
        throw new Error('Native readiness timeout or live IPC identity mismatch');
    }
    catch (error) {
        await stop();
        throw error;
    }
}
const instructions = {
    onboarding: 'Complete Ty → AI (skip permitted) → Folder on synthetic data. Verify an ordinary folder and existing OKF without the historical OKF-choice screen.',
    'native-picker': 'Open the real native folder picker, cancel it, reopen it, select the synthetic folder, and verify the visible selected folder.',
    okf: 'Create a synthetic client and matter through preview/apply and inspect the resulting OKF files and native view.',
    restart: 'After the measured restart, verify the same synthetic client, matter, selected folder, and settings.',
    memory: 'Record synthetic matter memory, start a new conversation, and verify it uses that matter memory.',
    'client-isolation': 'Use three synthetic clients. Verify a client session cannot access a different client and moving between clients preserves the office overview.',
    'practice-overview': 'Verify all clients, a read failure and recovery, changed workspace, and date rollover using the approved practice acceptance procedure.',
    'deadline-cz': 'Run the approved CZ delivery → calculation → human confirmation → OKF → ICS journey, then change the candidate and verify invalidation.',
    'deadline-sk': 'Run the approved SK delivery → calculation → human confirmation → OKF → ICS journey and verify repeated export is idempotent.',
    'cloud-policy-cz': 'Run the approved CZ policy journey for the actual configured service, including revocation and all supported protected-context paths. Missing account or legal gate is blocked.',
    'cloud-policy-sk': 'Run the approved SK policy journey, source LegalWork disabled/enabled and a test provider. Missing account or unsupported route is blocked.',
};
/** Real macOS adapter. Manual judgments stay explicit and are captured alongside live native observations. */
export async function runMacAcceptance({ installedApp, asset, evidence, profileKind, profileRoot, manual = false, evidenceUrl, operator, timeoutMs }) {
    if (process.platform !== 'darwin' || evidence.build.platform !== 'darwin' || process.arch !== evidence.build.arch)
        throw new Error('macOS target host is unavailable');
    const scratch = await mkdtemp(join(tmpdir(), 'lawoss-native-acceptance-'));
    let app, reader;
    try {
        await verifyMacInstallation({ installedApp: resolve(installedApp), asset: resolve(asset), scratch });
        app = await launchOwnedApp({ installedApp: resolve(installedApp), profileRoot, build: evidence.build, timeoutMs });
        const observations = [{ scenario: 'startup', pid: app.pid, route: app.identity.snapshot.route, build: app.identity.build }];
        const scenarios = [];
        const attachments = [];
        const canPrompt = manual && process.stdin.isTTY && process.stdout.isTTY && typeof operator === 'string' && operator.trim() && /^https:\/\//.test(evidenceUrl ?? '');
        if (canPrompt)
            reader = createInterface({ input: process.stdin, output: process.stdout });
        for (const scenario of REQUIRED_NATIVE_SCENARIOS) {
            if (scenario === 'restart') {
                await app.stop();
                app = null;
                app = await launchOwnedApp({ installedApp: resolve(installedApp), profileRoot, build: evidence.build, timeoutMs });
            }
            let status = 'blocked';
            if (reader) {
                const answer = await reader.question(`\n${scenario}: ${instructions[scenario]}\nRecord pass, fail, or blocked after performing the steps: `);
                status = ['pass', 'fail', 'blocked'].includes(answer.trim()) ? answer.trim() : 'blocked';
            }
            const live = await app.observe();
            observations.push({ scenario, pid: app.pid, route: live.snapshot.route, build: live.build });
            if (status === 'pass') {
                const source = /^window:(\d+):/.exec(live.windowSourceId ?? '');
                if (!source)
                    throw new Error('Owned native window capture unavailable');
                const screenshot = join(scratch, `${scenario}.png`);
                execFileSync('/usr/sbin/screencapture', ['-x', '-l', source[1], screenshot], { stdio: 'pipe', timeout: 10000 });
                const output = join(profileRoot, `acceptance-${profileKind}-${scenario}-${Date.now()}.png`);
                const bytes = await readFile(screenshot);
                await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
                attachments.push({ scenario, path: output, sha256: sha256(bytes) });
            }
            scenarios.push({ scenario, status, method: reader ? 'operator-native-ui' : 'native-preflight-only', operator: reader ? operator : null, evidenceUrl: status === 'pass' ? evidenceUrl : null });
        }
        return { build: evidence.build, profileKind, assetSha256: sha256(await readFile(asset)), legalworkDevMode: false, scenarios, observations, attachments, signature: { status: 'verified', method: 'codesign-spctl-and-installer-tree' } };
    }
    finally {
        reader?.close();
        try {
            await app?.stop();
        }
        finally {
            await rm(scratch, { recursive: true, force: true });
        }
    }
}
