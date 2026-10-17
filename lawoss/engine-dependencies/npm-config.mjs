import { homedir } from 'node:os';
import path from 'node:path';
import { localRuntimePackage } from './runtime-tools.mjs';

const refusal = code => Object.assign(new Error(code), { code });
const absolute = value => typeof value === 'string' && value.length > 0 && !value.includes('\0') && path.isAbsolute(value);
function tooling() {
  const load = localRuntimePackage('@npmcli/config', '10.8.1', ['@npmcli/config/lib/definitions']);
  return { Config: load('@npmcli/config'), definitions: load('@npmcli/config/lib/definitions') };
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
