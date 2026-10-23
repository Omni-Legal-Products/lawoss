import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const environment = () => Object.fromEntries(Object.entries({ ...process.env, LC_ALL: 'C' }).filter(([key]) => !key.startsWith('LD_')));
function invoke(command, args, optional = false) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: environment(), timeout: 30_000, maxBuffer: 4 * 1024 ** 2 });
  if (result.error || result.signal || (!optional && result.status !== 0)) throw new Error(`Linux runtime ${command} inspection failed`);
  return result.status === 0 ? result.stdout : null;
}
function needed(file, machine) {
  const header = invoke('readelf', ['-h', file]);
  if (!header.includes(machine)) throw new Error('Linux runtime ELF architecture differs');
  const dynamic = invoke('readelf', ['-d', file]);
  const names = [...dynamic.matchAll(/\(NEEDED\).*Shared library: \[([^\]\r\n]+)\]/g)].map(match => match[1]);
  if (names.some(name => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name))) throw new Error('Unsupported Linux runtime dependency name');
  return names;
}
function loaderResolution(source) {
  const libraries = new Map();
  for (const line of invoke('ldd', [source]).split('\n')) {
    if (/=>\s+not found\s*$/.test(line)) throw new Error('Missing Linux runtime dependency');
    const dependency = /^\s*(\S+)\s+=>\s+(\/.*?)\s+\(0x[0-9a-f]+\)\s*$/i.exec(line);
    const loader = /^\s*(\/.*?)\s+\(0x[0-9a-f]+\)\s*$/i.exec(line);
    if (!dependency && !loader) continue;
    const name = dependency ? dependency[1] : basename(loader[1]);
    const original = realpathSync(dependency ? dependency[2] : loader[1]);
    if (libraries.has(name) && libraries.get(name) !== original) throw new Error('Ambiguous Linux runtime dependency');
    libraries.set(name, original);
  }
  return libraries;
}
function packageOwner(file) {
  const candidates = [file];
  if (file.startsWith('/usr/lib/')) candidates.push(file.slice(4));
  if (file.startsWith('/usr/lib64/')) candidates.push(file.slice(4));
  const packages = new Set();
  for (const candidate of candidates) {
    const output = invoke('dpkg-query', ['-S', candidate], true);
    for (const line of output?.trim().split('\n') ?? []) {
      const separator = line.lastIndexOf(': ');
      if (separator < 1) continue;
      const path = line.slice(separator + 2);
      if (!existsSync(path) || realpathSync(path) !== file) continue;
      for (const owner of line.slice(0, separator).split(', ')) packages.add(owner);
    }
  }
  if (packages.size > 1) throw new Error('Ambiguous Linux runtime package owner');
  if (!packages.size) return null;
  const owner = [...packages][0];
  const output = invoke('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${Architecture}\t${source:Package}\t${source:Version}\n', owner]).trim();
  const [binaryPackage, binaryVersion, architecture, sourcePackage, sourceVersion, ...extra] = output.split('\t');
  if (extra.length || ![binaryPackage, binaryVersion, architecture, sourcePackage, sourceVersion].every(Boolean)) throw new Error('Missing Linux runtime package metadata');
  return { kind: 'dpkg', binaryPackage, binaryVersion, architecture, sourcePackage, sourceVersion };
}
function licenseFile(file, name) {
  if (!statSync(file).isFile() || statSync(file).size > 4 * 1024 ** 2) throw new Error('Invalid Linux runtime license');
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) throw new Error('Empty Linux runtime license');
  return { name, text, sha256: sha256(Buffer.from(text)) };
}
function licensesFor(name, owner, dependencyLicenses) {
  if (owner) {
    const packageName = owner.binaryPackage.split(':')[0];
    const copyright = `/usr/share/doc/${packageName}/copyright`;
    const files = [licenseFile(copyright, copyright)];
    const referenced = new Set([...files[0].text.matchAll(/\/usr\/share\/common-licenses\/([A-Za-z0-9][A-Za-z0-9.+-]*)/g)].map(match => match[1].replace(/\.+$/, '')));
    for (const common of referenced) files.push(licenseFile(`/usr/share/common-licenses/${common}`, `/usr/share/common-licenses/${common}`));
    return files;
  }
  const directory = dependencyLicenses && join(resolve(dependencyLicenses), name);
  if (!directory || !existsSync(directory) || !statSync(directory).isDirectory()) throw new Error('Missing Linux runtime dependency license provenance');
  const files = [];
  const collect = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name), label = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) collect(file, label);
      else if (entry.isFile()) files.push(licenseFile(file, label));
      else throw new Error('Unsupported Linux runtime license entry');
    }
  };
  collect(directory, name);
  if (!files.length) throw new Error('Missing Linux runtime dependency license provenance');
  return files;
}

/** Package only owned copies; the native loader's resolution defines the closure. */
export function bundleLinuxRuntimeLibraries({ source, destination, dependencyLicenses }) {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Linux runtime packaging requires a supported native Linux host');
  const architecture = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const machine = process.arch === 'arm64' ? 'AArch64' : 'Advanced Micro Devices X86-64';
  const baseline = new Set(['libc.so.6', 'libm.so.6', 'libpthread.so.0', 'libdl.so.2', 'librt.so.1', 'libresolv.so.2', 'libutil.so.1', 'libanl.so.1', process.arch === 'arm64' ? 'ld-linux-aarch64.so.1' : 'ld-linux-x86-64.so.2']);
  const resolved = loaderResolution(source), files = new Map(), notices = [], sbom = [];
  const visit = (name, original, root = false) => {
    const canonical = realpathSync(original);
    if (files.has(name)) {
      if (files.get(name).original !== canonical) throw new Error('Ambiguous Linux runtime library basename');
      return;
    }
    const dependencies = needed(canonical, machine);
    // A root ldd census alone can hide a second ELF's conflicting local
    // resolution of the same SONAME. Refuse instead of flattening two files.
    if (dependencies.length) {
      const local = loaderResolution(canonical);
      for (const dependency of dependencies) {
        if (!resolved.has(dependency) || !local.has(dependency)) throw new Error('Missing Linux runtime dependency resolution');
        if (resolved.get(dependency) !== local.get(dependency)) throw new Error('Ambiguous Linux runtime dependency resolution');
      }
    }
    const owner = root ? null : packageOwner(canonical);
    if (!root && baseline.has(name)) {
      if (owner?.binaryPackage.split(':')[0] !== 'libc6' || owner.architecture !== architecture) throw new Error('Unverified Linux host glibc baseline');
      return;
    }
    if (owner && owner.architecture !== architecture && owner.architecture !== 'all') throw new Error('Linux runtime package architecture differs');
    const licenses = root ? [] : licensesFor(name, owner, dependencyLicenses);
    files.set(name, { name, original: canonical, originalSha256: sha256(readFileSync(canonical)),
      provenance: root ? { kind: 'reviewed-qemu-source', version: '11.1.2' } : owner ?? { kind: 'explicit-dependency-licenses' }, licenses });
    for (const dependency of dependencies) {
      if (!resolved.has(dependency)) throw new Error('Missing Linux runtime dependency resolution');
      visit(dependency, resolved.get(dependency));
    }
  };
  visit(basename(source), source, true);
  for (const file of files.values()) {
    const output = join(destination, file.name);
    if (existsSync(output) && realpathSync(output) === file.original) throw new Error('Refusing in-place Linux runtime packaging');
    copyFileSync(file.original, output);
    if (sha256(readFileSync(output)) !== file.originalSha256) throw new Error('Linux runtime changed during copy');
    chmodSync(output, 0o755);
    invoke('patchelf', ['--set-rpath', '$ORIGIN', output]);
    file.bundledSha256 = sha256(readFileSync(output));
    if (sha256(readFileSync(file.original)) !== file.originalSha256) throw new Error('Linux runtime original bytes changed');
    for (const license of file.licenses) notices.push(`\nLinux runtime library: ${file.name}\nLicense: ${license.name}\n${license.text}`);
    sbom.push({ kind: 'linux-runtime-elf', name: file.name, originalSha256: file.originalSha256, bundledSha256: file.bundledSha256,
      provenance: file.provenance, licenses: file.licenses.map(({ name, sha256 }) => ({ name, sha256 })) });
  }
  return { files: [...files.values()], notices, sbom };
}
