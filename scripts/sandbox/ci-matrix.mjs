import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const runtimes = [
  { os: 'macos-15', platform: 'darwin', arch: 'arm64', qemu: 'aarch64' },
  { os: 'macos-15-intel', platform: 'darwin', arch: 'x64', qemu: 'x86_64' },
  { os: 'windows-2022', platform: 'win32', arch: 'x64', qemu: 'x86_64',
    msystem: 'UCRT64', package: 'mingw-w64-ucrt-x86_64', prefix: 'ucrt64' },
  { os: 'windows-11-arm', platform: 'win32', arch: 'arm64', qemu: 'aarch64',
    msystem: 'CLANGARM64', package: 'mingw-w64-clang-aarch64', prefix: 'clangarm64' },
  { os: 'ubuntu-24.04', platform: 'linux', arch: 'x64', qemu: 'x86_64' },
  { os: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64', qemu: 'aarch64' },
];

export function sandboxMatrices(targets = 'all') {
  const requested = targets === 'all' ? runtimes.map(({ platform, arch }) => `${platform}-${arch}`)
    : targets.split(',').map(target => target.trim());
  const selected = requested.map(target => {
    const runtime = runtimes.find(({ platform, arch }) => `${platform}-${arch}` === target);
    if (!runtime) throw new Error(`Unknown sandbox target: ${target}`);
    return runtime;
  });
  if (new Set(requested).size !== requested.length) throw new Error('Duplicate sandbox targets');
  return {
    guest: { include: [...new Set(selected.map(({ arch }) => arch))].map(arch => ({
      os: arch === 'arm64' ? 'ubuntu-24.04-arm' : 'ubuntu-24.04', arch,
    })) },
    runtime: { include: selected },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const matrices = sandboxMatrices(process.env.SANDBOX_TARGETS);
  for (const [name, matrix] of Object.entries(matrices)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(matrix)}\n`);
  }
}
