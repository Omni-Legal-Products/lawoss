import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Release App (release-macos-aarch64.yml): artefakt behu je v public repe verejný, preto
// doň smie ísť inštalátor pre macOS len podpísaný a notarizovaný a pre Windows len
// podpísaný cez SignPath (Q06/U6). Test vyhodnotí `if` každého kroku jobu
// publish-electron pre každý cieľ matice a stav podpisu podľa pravidiel výrazov Actions.
const desktopRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
const YAML = desktopRequire('yaml');
const workflow = YAML.parse(readFileSync(new URL('../../.github/workflows/release-macos-aarch64.yml', import.meta.url), 'utf8'));
const job = workflow.jobs['publish-electron'];

// Podmnožina výrazov GitHub Actions, ktorú kroky jobu používajú: kontexty, reťazce,
// ==, !=, !, &&, || a zátvorky. Porovnanie reťazcov je ako v Actions bez ohľadu na veľkosť písmen.
// Čokoľvek iné (funkcie, čísla) test odmietne, aby nič nevyhodnotil potichu zle.
const evaluate = (source, context) => {
    const expression = source.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, '$1');
    const tokens = expression.match(/'(?:[^']|'')*'|==|!=|&&|\|\||[!()]|[A-Za-z_][\w.-]*|\S/g) ?? [];
    let index = 0;
    const peek = () => tokens[index];
    const take = expected => {
        const token = tokens[index++];
        if (expected !== undefined && token !== expected) throw new Error(`Unexpected ${token} in ${source}`);
        return token;
    };
    const truthy = value => value !== '' && value !== false && value !== null && value !== undefined;
    const equal = (left, right) => String(left ?? '').toLowerCase() === String(right ?? '').toLowerCase();
    const primary = () => {
        const token = take();
        if (token === '(') { const value = or(); take(')'); return value; }
        if (token === '!') return !truthy(primary());
        if (token?.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
        if (token && /^[A-Za-z_][\w.-]*$/.test(token) && peek() !== '(') {
            if (!Object.hasOwn(context, token)) throw new Error(`Unknown context ${token} in ${source}`);
            return context[token];
        }
        throw new Error(`Unsupported token ${token} in ${source}`);
    };
    const comparison = () => {
        const left = primary();
        if (peek() === '==') { take(); return equal(left, primary()); }
        if (peek() === '!=') { take(); return !equal(left, primary()); }
        return left;
    };
    const and = () => { let value = comparison(); while (peek() === '&&') { take(); const right = comparison(); value = truthy(value) ? right : value; } return value; };
    const or = () => { let value = and(); while (peek() === '||') { take(); const right = and(); value = truthy(value) ? value : right; } return value; };
    const value = or();
    if (index !== tokens.length) throw new Error(`Trailing ${peek()} in ${source}`);
    return truthy(value);
};

const runs = (step, context) => step.if === undefined || evaluate(String(step.if), context);
const stepOf = name => {
    const found = job.steps.filter(step => step.name === name);
    assert.equal(found.length, 1, name);
    return found[0];
};
const STAGE = 'Stage exact final artifact for native acceptance';
const PRESERVE = 'Preserve final installer and target evidence before the public gate';

// Stavy podpisu: notarizácia podľa vstupu/premennej, SignPath vždy s oboma slugmi
// (s jedným z nich job skončí už v „Validate SignPath configuration (Windows)“).
// `vars.MACOS_NOTARIZE` ide do jobu bez kontroly: 'no' nie je 'true' ani 'false'
// (odlíši `== 'true'` od `!= 'false'`), 'TRUE' sa v Actions rovná 'true'.
const scenarios = [];
for (const entry of job.strategy.matrix.include)
    for (const notarize of ['true', 'false', 'no', 'TRUE'])
        for (const signpath of ['', 'lawoss'])
            for (const draft of ['true', 'false'])
                scenarios.push({
                    entry, notarize, signpath, draft,
                    context: {
                        ...Object.fromEntries(Object.entries(entry).map(([key, value]) => [`matrix.${key}`, value])),
                        'env.MACOS_NOTARIZE': notarize,
                        'env.SIGNPATH_PROJECT_SLUG': signpath,
                        'env.SIGNPATH_ARTIFACT_CONFIGURATION_SLUG': signpath && 'installer',
                        'needs.resolve-release.outputs.draft': draft,
                    },
                });
const label = ({ entry, notarize, signpath, draft }) => `${entry.artifact} notarize=${notarize} signpath=${signpath ? 'on' : 'off'} draft=${draft}`;
// Podpísaný je build, ktorý prešiel krokom podpisu tohto jobu.
const signed = ({ entry, context }) => {
    if (entry.os_type === 'macos') return runs(stepOf('Package Electron (macOS, signed + notarized)'), context);
    if (entry.os_type === 'windows') return runs(stepOf('Apply signed Windows installer'), context);
    return undefined;
};

test('the expression evaluator follows Actions precedence and string comparison', () => {
    const context = { 'env.A': 'TRUE', 'env.EMPTY': '', 'matrix.os_type': 'linux' };
    assert.equal(evaluate("${{ env.A == 'true' }}", context), true);
    assert.equal(evaluate("env.EMPTY != ''", context), false);
    assert.equal(evaluate("matrix.os_type == 'macos' || env.A == 'true' && env.EMPTY == ''", context), true);
    assert.equal(evaluate("(matrix.os_type == 'macos' || env.A == 'true') && env.EMPTY != ''", context), false);
    assert.equal(evaluate("!(matrix.os_type != 'linux')", context), true);
    assert.throws(() => evaluate("always() && env.A", context), /Unsupported/);
    assert.throws(() => evaluate("env.MISSING == ''", context), /Unknown context/);
});

test('the simulated context matches the job env and the matrix covers every desktop target', () => {
    assert.equal(job.env.MACOS_NOTARIZE, '${{ needs.resolve-release.outputs.notarize }}');
    assert.equal(job.env.SIGNPATH_PROJECT_SLUG, '${{ secrets.SIGNPATH_PROJECT_SLUG || vars.SIGNPATH_PROJECT_SLUG }}');
    assert.deepEqual(job.strategy.matrix.include.map(entry => entry.os_type).sort(), ['linux', 'linux', 'macos', 'macos', 'windows', 'windows']);
    // Každý `if` jobu sa dá vyhodnotiť; neznámy kontext by test zastavil.
    for (const scenario of scenarios)
        for (const step of job.steps) runs(step, scenario.context);
});

test('macOS and Windows candidates are preserved exactly when the build was signed', () => {
    for (const scenario of scenarios) {
        const isSigned = signed(scenario);
        if (isSigned === undefined) continue;
        for (const name of [STAGE, PRESERVE])
            assert.equal(runs(stepOf(name), scenario.context), isSigned, `${name}: ${label(scenario)}`);
    }
});

test('Linux keeps preserving its candidate unchanged', () => {
    // Nepodpísaný AppImage je mimo Q06/U6 (mac a Windows); táto zmena ho nemení.
    for (const scenario of scenarios.filter(item => item.entry.os_type === 'linux'))
        for (const name of [STAGE, PRESERVE])
            assert.equal(runs(stepOf(name), scenario.context), true, `${name}: ${label(scenario)}`);
});

test('an unsigned macOS or Windows build uploads no installer as an Actions artifact', () => {
    const uploads = job.steps.filter(step => String(step.uses).startsWith('actions/upload-artifact@'));
    assert.ok(uploads.some(step => step.name === PRESERVE));
    const metadataOnly = path => /^apps\/desktop\/dist-electron\/(latest\*\.yml|SHA256SUMS|release-evidence-\*\.json)$/.test(path);
    for (const scenario of scenarios.filter(item => signed(item) === false))
        for (const step of uploads.filter(item => runs(item, scenario.context))) {
            const paths = String(step.with.path).split('\n').map(line => line.trim()).filter(Boolean);
            assert.ok(paths.every(metadataOnly), `${step.name}: ${label(scenario)} uploads ${paths.join(', ')}`);
        }
});

test('the unsigned Windows installer is uploaded only for the SignPath request that needs it', () => {
    for (const scenario of scenarios.filter(item => item.entry.os_type === 'windows'))
        assert.equal(runs(stepOf('Upload unsigned Windows installer for SignPath'), scenario.context),
            runs(stepOf('Submit Windows signing request to SignPath'), scenario.context), label(scenario));
});
