import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
for (const name of ['alpha-macos-aarch64', 'alpha-windows-x64', 'release-macos-aarch64'])
    test(`${name} binds final evidence and refuses untested public publication`, () => {
        const text = read(name);
        assert.match(text, /release-evidence\.mjs create/);
        assert.match(text, /release-evidence\.mjs verify .*--require-tested/);
        assert.match(text, /publish-electron-assets\.mjs/);
        assert.ok(text.indexOf('release-evidence.mjs create') > text.indexOf('Verify packaged startup'));
        if (name.startsWith('alpha'))
            assert.match(text, /channel-evidence\.mjs/);
        const payloadUploads = text.split(/\n\s*- name:/).filter(step => /Upload Electron (alpha updater|release) assets/.test(step));
        for (const step of payloadUploads)
            assert.doesNotMatch(step, /--clobber/);
    });
const step = (text, name) => { const found = text.split(/\n\s*- name:/).filter(item => item.startsWith(` ${name}\n`)); assert.equal(found.length, 1, name); return found[0]; };
test('alpha-macos-aarch64 mirrors the Windows signing gate for unsigned internal builds', () => {
    const text = read('alpha-macos-aarch64');
    const gate = step(text, 'Require notarization or an explicit unsigned internal build');
    assert.match(text, /allow_unsigned_internal:\n\s+description:/);
    assert.match(gate, /HAS_APPLE: \$\{\{ secrets\.APPLE_CODESIGN_CERT_P12_BASE64 != '' && secrets\.APPLE_NOTARY_API_KEY_ID != '' && secrets\.APPLE_NOTARY_API_ISSUER_ID != '' && secrets\.APPLE_NOTARY_API_KEY_P8_BASE64 != '' \}\}/);
    assert.match(gate, /if \[ "\$\{HAS_APPLE:-false\}" != "true" \]; then[\s\S]*?exit 1/);
    assert.match(gate, /if \[ "\$\{ALLOW_UNSIGNED_INTERNAL:-false\}" != "true" \]; then[\s\S]*?exit 1/);
    assert.match(gate, /echo "signed=false" >> "\$GITHUB_OUTPUT"\n\s+echo "draft=true" >> "\$GITHUB_OUTPUT"/);
    assert.match(gate, /echo "draft=false" >> "\$GITHUB_OUTPUT"\n\s+fi\n\s+exit 0\n/, 'the signed branch ends the gate');
    assert.match(gate, /NOTARIZE: \$\{\{ \(vars\.MACOS_NOTARIZE \|\| 'true'\) == 'true' \}\}/);
    assert.match(text, /sandbox-runtime:\n\s+needs: signing/);
    assert.match(text, /publish-alpha-macos-aarch64:\n\s+needs: \[signing, sandbox-runtime\]/);
    for (const name of ['MACOS_NOTARIZE', 'SIGNED'])
        assert.match(text, new RegExp(`\\n      ${name}: \\$\\{\\{ needs\\.signing\\.outputs\\.signed \\}\\}\\n`), name);
    assert.match(text, /\n      DRAFT: \$\{\{ needs\.signing\.outputs\.draft \}\}\n/);
    assert.equal(text.match(/^\s+SIGNED: /gm).length, 1, 'no step overrides SIGNED');
    assert.equal(text.match(/^\s+DRAFT: /gm).length, 2, 'DRAFT only in the gate input and the job env');
    const create = step(text, 'Create immutable alpha prerelease');
    assert.match(create, /unsigned_prefix="NEPODPÍSANÉ – len interný tím · "/);
    assert.match(create, /if \[ "\$SIGNED" != "true" \]; then\n\s+title="\$\{unsigned_prefix\}\$\{title\}"\n\s+cat <<'EOF'\n\s+> \[!WARNING\]\n\s+> \*\*NEPODPÍSANÝ build/);
    assert.equal(create.match(/^\s+title=/gm).length, 2, 'the title is set once and prefixed once');
    assert.match(create, /existing_name="\$\(gh release view "\$ALPHA_RUN_RELEASE_TAG" --repo "\$GITHUB_REPOSITORY" --json name --jq \.name\)"\n\s+existing_signed=true\n\s+case "\$existing_name" in "\$\{unsigned_prefix\}"\*\) existing_signed=false ;; esac\n\s+if \[ "\$existing_signed" != "\$SIGNED" \]; then[\s\S]*?exit 1/, 'a re-run with another signing state keeps title, notes and assets');
    assert.match(create, /if \[ "\$DRAFT" = "true" \]; then\n\s+release_flags\+=\(--draft\)/);
    assert.match(create, /if \[ "\$existing_draft" != "\$DRAFT" \]; then[\s\S]*?exit 1[\s\S]*?gh release edit "\$ALPHA_RUN_RELEASE_TAG" \\\n\s+--repo "\$GITHUB_REPOSITORY" \\\n\s+--title "\$title" \\\n\s+--notes-file "\$notes"\n\s+exit 0/, 'a re-run with another draft state uploads nothing, otherwise title and notes follow this attempt');
    assert.match(step(text, 'Upload Electron alpha updater assets'), /--payload-only \$\{\{ needs\.signing\.outputs\.draft == 'true' && '--draft-payload' \|\| '' \}\}/);
    assert.doesNotMatch(create, /"\$DRAFT" = "true" \]; then\n\s+echo/, 'a signed draft keeps the plain notes, resume publishes it without rewriting them');
    assert.match(step(text, 'Require exact native acceptance before public publication'), /needs\.signing\.outputs\.draft != 'true'/);
    for (const name of ['Stage exact final artifact for native acceptance', 'Preserve final installer and target evidence before the public gate'])
        assert.match(step(text, name), /if: env\.SIGNED == 'true'/);
    const pointer = step(text, 'Update alpha updater pointer');
    assert.match(pointer, /if: \$\{\{ needs\.signing\.outputs\.draft != 'true' \}\}/);
    assert.match(pointer, /if \[ "\$SIGNED" != "true" \]; then[\s\S]*?exit 1/);
    assert.doesNotMatch(text, /inputs\.draft &&|!inputs\.draft/);
});
