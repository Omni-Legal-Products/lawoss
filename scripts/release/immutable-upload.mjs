import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { sha256 } from './release-evidence.mjs';
export const runGh = async (args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
/** Validate all collisions before the first write. Immutable payloads never use --clobber. */
export async function publishImmutableFiles({ files, tag, repo, gh = runGh, requireDraft = false }) {
    const release = JSON.parse(await gh(['release', 'view', tag, '--repo', repo, '--json', 'isDraft,assets']));
    if (requireDraft && release.isDraft !== true)
        throw new Error('Internal payload requires a draft release');
    const local = new Map();
    for (const file of files) {
        const name = basename(file);
        if (local.has(name) || /[\r\n*?\[\\]/.test(name))
            throw new Error('Duplicate or unsafe immutable filename');
        local.set(name, { file, bytes: await readFile(file) });
    }
    const root = await mkdtemp(join(tmpdir(), 'lawoss-release-readback-'));
    try {
        const existing = new Set(release.assets.map(x => x.name));
        for (const [name, item] of local)
            if (existing.has(name)) {
                await gh(['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', root]);
                if (sha256(await readFile(join(root, name))) !== sha256(item.bytes))
                    throw new Error(`Immutable release asset collision: ${name}`);
            }
        const missing = [...local].filter(([name]) => !existing.has(name)).map(([, item]) => item.file);
        if (missing.length)
            await gh(['release', 'upload', tag, ...missing, '--repo', repo]);
        // Read all bytes back from this exact tag, including newly uploaded files.
        for (const [name, item] of local) {
            if (existing.has(name))
                continue;
            await gh(['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', root]);
            if (sha256(await readFile(join(root, name))) !== sha256(item.bytes))
                throw new Error(`Published asset readback differs: ${name}`);
        }
        return { isDraft: release.isDraft, assets: [...local].map(([name, item]) => ({ name, size: item.bytes.length, sha256: sha256(item.bytes) })) };
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
}
