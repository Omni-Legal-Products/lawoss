/** Every architecture slice and bundled library must load on macOS 12.0. */
export function assertMacOSMinimum(loadCommands, name) {
  const commands = loadCommands.split(/Load command \d+/).filter(command => /cmd LC_(?:BUILD_VERSION|VERSION_MIN_MACOSX)\b/.test(command));
  const minima = commands.map(command => command.match(command.includes('cmd LC_BUILD_VERSION')
    ? /^\s*minos\s+(\d+(?:\.\d+)*)/m : /^\s*version\s+(\d+(?:\.\d+)*)/m)?.[1]);
  if (!minima.length || minima.some(version => {
    if (!version) return true;
    const [major, ...parts] = version.split('.').map(Number);
    return major > 12 || major === 12 && parts.some(part => part > 0);
  })) throw new Error(`${name} must support macOS 12.0; found minimum versions: ${minima.join(', ') || 'unknown'}`);
}
