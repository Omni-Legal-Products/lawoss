import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const keys = ['schemaVersion', 'product', 'version', 'gitSha', 'buildEpoch', 'platform', 'arch', 'channel', 'workflowRunUrl'];
/**
 * Validate the shipped identity independently from the machine running the app.
 * @returns {import("@legalwork/types/desktop-ipc").BuildInfoV1}
 */
export function validateBuildInfo(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value)))
        throw new Error('Invalid BuildInfoV1 schema');
    if (value.schemaVersion !== 1 || value.product !== 'lawoss-desktop' || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version) || typeof value.gitSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.gitSha) || typeof value.buildEpoch !== 'string' || !/^[1-9]\d*$/.test(value.buildEpoch))
        throw new Error('Invalid build identity');
    if (!['darwin', 'win32', 'linux'].includes(value.platform) || !['arm64', 'x64'].includes(value.arch) || !['alpha', 'stable'].includes(value.channel))
        throw new Error('Invalid build target or channel');
    if (typeof value.workflowRunUrl !== 'string' || (value.workflowRunUrl !== '' && !/^https:\/\/[^\s]+$/.test(value.workflowRunUrl)))
        throw new Error('Invalid workflowRunUrl');
    return value;
}
export async function readPackagedBuildInfo({ resourcesPath, version, platform, arch }) {
    try {
        const info = validateBuildInfo(JSON.parse(await readFile(join(resourcesPath, 'build-info.json'), 'utf8')));
        return info.version === version && info.platform === platform && info.arch === arch ? info : null;
    }
    catch {
        return null;
    }
}
/** @returns {Promise<import("@legalwork/types/desktop-ipc").AppBuildInfo>} */
export async function getAppBuildInfo({ resourcesPath = '', version, platform, arch, isPackaged, env = process.env }) {
    const common = { version, os: platform, arch };
    if (!isPackaged)
        return { ...common, gitSha: env.LEGALWORK_GIT_SHA ?? null, buildEpoch: env.LEGALWORK_BUILD_EPOCH ?? null, legalworkDevMode: env.LEGALWORK_DEV_MODE === '1', provenance: 'development' };
    const info = await readPackagedBuildInfo({ resourcesPath, version, platform, arch });
    return info ? { ...common, gitSha: info.gitSha, buildEpoch: info.buildEpoch, legalworkDevMode: false, provenance: 'embedded', channel: info.channel, workflowRunUrl: info.workflowRunUrl }
        : { ...common, gitSha: null, buildEpoch: null, legalworkDevMode: false, provenance: 'unavailable' };
}
