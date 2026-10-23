import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

const supported = new Map([[0x01000007, { arch: 'x64', subtype: 3 }], [0x0100000c, { arch: 'arm64', subtype: 0 }]]);
const refuse = () => { throw Object.assign(new Error('Unsupported or unverified Mach-O architecture'), { code: 'macho-architecture-unverified' }); };
const sameFile = (a, b) => a.isFile() && b.isFile() &&
    ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);

// Static alpha-format admission, not a loader, signature or native-runtime proof.
// Apple SDK mach-o/loader.h describes the 32-byte mach_header_64 and byte order;
// mach/machine.h defines the exact generic CPU type/subtype pairs admitted here.
function thin(header, size) {
    const magic = header.readUInt32BE(0);
    if (magic !== 0xfeedfacf && magic !== 0xcffaedfe) refuse();
    const uint = offset => magic === 0xcffaedfe ? header.readUInt32LE(offset) : header.readUInt32BE(offset);
    const cpu = uint(4), subtype = uint(8), target = supported.get(cpu);
    const commands = uint(16), commandBytes = uint(20);
    if (!target || subtype !== target.subtype || uint(12) !== 2 || uint(28) !== 0 ||
        BigInt(commandBytes) > size - 32n || commandBytes % 8 || commands > commandBytes / 8 ||
        (commands === 0) !== (commandBytes === 0)) refuse();
    return { arch: target.arch, cpu, subtype };
}

// Apple mach-o/fat.h: canonical big-endian fat_header followed by fat_arch
// (20 bytes) or fat_arch_64 (32 bytes). Validate every slice, not only a match.
async function architectures(read, header, fileSize) {
    const magic = header.readUInt32BE(0);
    if (magic !== 0xcafebabe && magic !== 0xcafebabf) return [thin(header, fileSize).arch];
    const wide = magic === 0xcafebabf, count = header.readUInt32BE(4), entrySize = wide ? 32 : 20;
    if (!count || count > 64) refuse();
    const table = await read(8n, count * entrySize), end = BigInt(8 + table.length), slices = [], seen = new Set();
    for (let index = 0; index < count; index++) {
        const base = index * entrySize, cpu = table.readUInt32BE(base), subtype = table.readUInt32BE(base + 4);
        const target = supported.get(cpu), offset = wide ? table.readBigUInt64BE(base + 8) : BigInt(table.readUInt32BE(base + 8));
        const size = wide ? table.readBigUInt64BE(base + 16) : BigInt(table.readUInt32BE(base + 12));
        const align = table.readUInt32BE(base + (wide ? 24 : 16));
        if (!target || subtype !== target.subtype || seen.has(target.arch) || offset < end || size < 32n ||
            offset > fileSize || size > fileSize - offset || align > (wide ? 63 : 31) ||
            offset % (1n << BigInt(align)) !== 0n || (wide && table.readUInt32BE(base + 28) !== 0)) refuse();
        seen.add(target.arch); slices.push({ cpu, subtype, offset, size });
    }
    const ordered = [...slices].sort((a, b) => a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0);
    if (ordered.some((slice, index) => index && ordered[index - 1].offset + ordered[index - 1].size > slice.offset)) refuse();
    const result = [];
    for (const slice of slices) {
        const inner = thin(await read(slice.offset, 32), slice.size);
        if (inner.cpu !== slice.cpu || inner.subtype !== slice.subtype) refuse();
        result.push(inner.arch);
    }
    return result;
}

export async function assertMachOArchitecture(file, expectedArch) {
    if (!['x64', 'arm64'].includes(expectedArch)) refuse();
    const before = await lstat(file, { bigint: true });
    if (!before.isFile() || before.size < 32n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) refuse();
    // O_NOFOLLOW is unavailable on some hosts. In that case the same physical
    // path/handle identities are still checked; OS-atomic no-follow is not claimed.
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!sameFile(before, await handle.stat({ bigint: true }))) refuse();
        // At most 32 + 64*32 + 64*32 = 4128 bytes: no executable body reads.
        const read = async (position, length) => {
            if (position < 0n || BigInt(length) > before.size - position) refuse();
            const bytes = Buffer.alloc(length);
            let offset = 0;
            while (offset < length) {
                const { bytesRead } = await handle.read(bytes, offset, length - offset, Number(position) + offset);
                if (!bytesRead) refuse();
                offset += bytesRead;
            }
            return bytes;
        };
        if (!(await architectures(read, await read(0n, 32), before.size)).includes(expectedArch)) refuse();
        if (!sameFile(before, await handle.stat({ bigint: true })) || !sameFile(before, await lstat(file, { bigint: true }))) refuse();
    } finally { await handle.close(); }
}
