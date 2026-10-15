import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tools = fileURLToPath(new URL('./runtime-tools/', import.meta.url));
const require = createRequire(new URL('./runtime-tools/package.json', import.meta.url));
const refusal = code => Object.assign(new Error(code), { code });
const absolute = value => typeof value === 'string' && value.length > 0 && !value.includes('\0') && path.isAbsolute(value);

function tooling() {
  try {
    // Compare real package identities, allowing pnpm's local symlinks but refusing
    // Node's otherwise silent ancestor node_modules fallback.
    const local = realpathSync(path.join(tools, 'node_modules/@npmcli/config'));
    const manifest = require.resolve('@npmcli/config/package.json');
    if (realpathSync(path.dirname(manifest)) !== local) throw refusal('TOOLING_UNAVAILABLE');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    if (pkg.name !== '@npmcli/config' || pkg.version !== '10.8.1') throw refusal('TOOLING_UNAVAILABLE');
    for (const specifier of ['@npmcli/config', '@npmcli/config/lib/definitions']) {
      const relative = path.relative(local, realpathSync(require.resolve(specifier)));
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw refusal('TOOLING_UNAVAILABLE');
    }
    return { Config: require('@npmcli/config'), definitions: require('@npmcli/config/lib/definitions') };
  } catch {
    throw refusal('TOOLING_UNAVAILABLE');
  }
}

/** Load the source engine's constructor context. Not a compiled-path adapter. */
export async function loadEngineNpmConfig(input) {
  let directory, engineExecPath, engineNpmPath, nativeHome, environment;
  try {
    ({ directory, engineExecPath, engineNpmPath, nativeHome } = input);
    if (!absolute(directory) || !absolute(engineExecPath) || !absolute(engineNpmPath) ||
        !input.environment || typeof input.environment !== 'object' || Array.isArray(input.environment)) throw refusal('INVALID_INPUT');
    environment = { ...input.environment };
    if (Object.values(environment).some(value => typeof value !== 'string')) throw refusal('INVALID_INPUT');
    if (!absolute(nativeHome)) throw refusal('INVALID_INPUT');
  } catch {
    throw refusal('INVALID_INPUT');
  }
  // Config itself uses HOME || homedir(). Never manufacture a HOME override.
  if (!environment.HOME && nativeHome !== homedir()) throw refusal('NATIVE_HOME_MISMATCH');
  const { Config, definitions: { definitions, flatten, nerfDarts, shorthands } } = tooling();
  try {
    const config = new Config({
      npmPath: engineNpmPath, cwd: directory, env: environment,
      argv: [engineExecPath, engineExecPath], execPath: engineExecPath,
      platform: process.platform, definitions, flatten, nerfDarts, shorthands, warn: false,
    });
    // Config's existing invalidHandler logs raw values even with warn:false.
    // Record only refusal state locally; never throw here, because nopt clears
    // its module-global callback only after the handler returns normally.
    let invalidSeen = false;
    config.invalidHandler = () => { invalidSeen = true; };
    await config.load();
    // load() can resolve despite read errors. Ordinary absent path components
    // are normal; permissions, directory reads and other failures are not.
    for (const layer of config.data.values()) {
      if (layer.loadError && !['ENOENT', 'ENOTDIR'].includes(layer.loadError.code)) throw refusal('CONFIG_LOAD_FAILED');
    }
    // Actual Config validation also detects invalid typed values and legacy
    // unscoped authentication. Do not silently return its sanitized fallback.
    const valid = config.validate() && config.valid;
    if (invalidSeen || !valid) throw refusal('CONFIG_LOAD_FAILED');
    return config.flat;
  } catch {
    throw refusal('CONFIG_LOAD_FAILED');
  }
}
