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
