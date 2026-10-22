import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertMachOArchitecture } from './macho-architecture.mjs';

async function fixture(t, bytes) {
    const root = await mkdtemp(join(tmpdir(), 'lawoss-macho-header-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const file = join(root, 'inert-macho');
    await writeFile(file, bytes);
    return file;
}

// Apple loader.h: little-endian mach_header_64, CPU_TYPE_ARM64,
// CPU_SUBTYPE_ARM64_ALL, MH_EXECUTE. These bytes are never executed.
const arm64 = () => Buffer.from('cffaedfe0c000001000000000200000000000000000000000000000000000000', 'hex');
const x64 = () => Buffer.from('cffaedfe07000001030000000200000000000000000000000000000000000000', 'hex');
const refusal = { code: 'macho-architecture-unverified' };
function bigEndian(header) {
    const bytes = Buffer.from(header);
    for (let offset = 0; offset < bytes.length; offset += 4) bytes.subarray(offset, offset + 4).reverse();
    return bytes;
}
function fat(wide = false) {
    const bytes = Buffer.alloc(544);
    bytes.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe);
    bytes.writeUInt32BE(2, 4);
    for (const [index, cpu, subtype, header] of [[0, 0x01000007, 3, x64()], [1, 0x0100000c, 0, arm64()]]) {
        const entry = 8 + index * (wide ? 32 : 20), offset = 256 * (index + 1);
        bytes.writeUInt32BE(cpu, entry); bytes.writeUInt32BE(subtype, entry + 4);
        if (wide) {
            bytes.writeBigUInt64BE(BigInt(offset), entry + 8); bytes.writeBigUInt64BE(32n, entry + 16);
        } else {
            bytes.writeUInt32BE(offset, entry + 8); bytes.writeUInt32BE(32, entry + 12);
        }
        bytes.writeUInt32BE(8, entry + (wide ? 24 : 16));
        header.copy(bytes, offset);
    }
    return bytes;
}
test('an inert generic ARM64 Mach-O header is admitted as static architecture data', async t => {
    assert.equal(await assertMachOArchitecture(await fixture(t, arm64()), 'arm64'), undefined);
});
test('canonical FAT32 and FAT64 admit either actual generic 64-bit slice', async t => {
    for (const wide of [false, true]) await t.test(wide ? 'FAT64' : 'FAT32', async t => {
        const file = await fixture(t, fat(wide));
        await assertMachOArchitecture(file, 'x64');
        await assertMachOArchitecture(file, 'arm64');
    });
});
test('a Mach-O object header cannot stand in for the app executable', async t => {
    const bytes = arm64(); bytes.writeUInt32LE(1, 12);
    await assert.rejects(assertMachOArchitecture(await fixture(t, bytes), 'arm64'), { code: 'macho-architecture-unverified' });
});
test('generic x64 and ARM64 headers are data-only on either host and in either thin byte order', async t => {
    for (const [arch, make] of [['x64', x64], ['arm64', arm64]]) {
        for (const endian of ['little', 'big']) await t.test(`${arch}/${endian}`, async t => {
            const file = await fixture(t, endian === 'big' ? bigEndian(make()) : make());
            await assertMachOArchitecture(file, arch);
            await assert.rejects(assertMachOArchitecture(file, arch === 'x64' ? 'arm64' : 'x64'), refusal);
        });
    }
});
test('a universal table may contain big-endian inner Mach-O headers', async t => {
    for (const wide of [false, true]) {
        const bytes = fat(wide);
        bigEndian(x64()).copy(bytes, 256); bigEndian(arm64()).copy(bytes, 512);
        const file = await fixture(t, bytes);
        await assertMachOArchitecture(file, 'x64'); await assertMachOArchitecture(file, 'arm64');
    }
});
test('truncation, unsupported CPU subtypes and invalid executable headers refuse admission', async t => {
    const mutations = {
        empty: () => Buffer.alloc(0), truncated: bytes => bytes.subarray(0, 31),
        'unknown-magic': bytes => { bytes.writeUInt32LE(0x12345678); },
        '32-bit-header': bytes => { bytes.writeUInt32LE(0xfeedface); },
        'unknown-cpu': bytes => { bytes.writeUInt32LE(0x01000012, 4); },
        arm64e: bytes => { bytes.writeUInt32LE(2, 8); },
        'subtype-capability-flag': bytes => { bytes.writeUInt32LE(0x80000000, 8); },
        'reserved-header-field': bytes => { bytes.writeUInt32LE(1, 28); },
        'load-command-past-slice': bytes => { bytes.writeUInt32LE(1, 16); bytes.writeUInt32LE(8, 20); },
        'count-without-commands': bytes => { bytes.writeUInt32LE(1, 16); },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
        const bytes = arm64(), changed = mutate(bytes);
        await assert.rejects(assertMachOArchitecture(await fixture(t, changed ?? bytes), 'arm64'), refusal);
    });
    const haswell = x64(); haswell.writeUInt32LE(8, 8);
    await assert.rejects(assertMachOArchitecture(await fixture(t, haswell), 'x64'), refusal);
});
test('every FAT entry and inner header must be safe even when an earlier slice matches', async t => {
    for (const wide of [false, true]) await t.test(wide ? 'FAT64 mutations' : 'FAT32 mutations', async t => {
        const entry = 8 + (wide ? 32 : 20), offsetField = entry + 8, sizeField = entry + (wide ? 16 : 12);
        const setOffset = (bytes, value) => wide ? bytes.writeBigUInt64BE(BigInt(value), offsetField) : bytes.writeUInt32BE(value, offsetField);
        const setSize = (bytes, value) => wide ? bytes.writeBigUInt64BE(BigInt(value), sizeField) : bytes.writeUInt32BE(value, sizeField);
        const mutations = {
            'empty-table': bytes => { bytes.writeUInt32BE(0, 4); },
            'oversized-table': bytes => { bytes.writeUInt32BE(65, 4); },
            'truncated-table': bytes => bytes.subarray(0, 35),
            'offset-inside-table': bytes => { setOffset(bytes, 0); },
            'slice-outside-file': bytes => { setOffset(bytes, 1024); },
            'size-outside-file': bytes => { setSize(bytes, 1024); },
            'empty-slice': bytes => { setSize(bytes, 0); },
            'short-inner-header': bytes => { setSize(bytes, 31); },
            'overlapping-slices': bytes => { setOffset(bytes, 256); },
            'duplicate-architecture': bytes => { bytes.writeUInt32BE(0x01000007, entry); bytes.writeUInt32BE(3, entry + 4); },
            'unaligned-slice': bytes => { setOffset(bytes, 511); },
            'alignment-overflow': bytes => { bytes.writeUInt32BE(64, entry + (wide ? 24 : 16)); },
            'outer-inner-cpu-mismatch': bytes => { x64().copy(bytes, 512); },
            'unsupported-unselected-outer': bytes => { bytes.writeUInt32BE(2, entry + 4); },
            'unsupported-unselected-inner': bytes => { bytes.writeUInt32LE(2, 520); },
            'nested-fat': bytes => { bytes.writeUInt32BE(0xcafebabe, 512); },
            'inner-command-outside-slice': bytes => { bytes.writeUInt32LE(1, 528); bytes.writeUInt32LE(8, 532); },
            'swapped-fat-magic': bytes => { bytes.writeUInt32BE(wide ? 0xbfbafeca : 0xbebafeca); },
        };
        if (wide) {
            mutations['unsafe-64-bit-offset'] = bytes => { setOffset(bytes, 0x20000000000001n); };
            mutations['64-bit-size-overflow'] = bytes => { setSize(bytes, 0xffffffffffffffffn); };
            mutations['reserved-fat64-field'] = bytes => { bytes.writeUInt32BE(1, entry + 28); };
        }
        for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
            const bytes = fat(wide), changed = mutate(bytes);
            await assert.rejects(assertMachOArchitecture(await fixture(t, changed ?? bytes), 'x64'), refusal);
        });
        const onlyX64 = fat(wide); onlyX64.writeUInt32BE(1, 4);
        await assert.rejects(assertMachOArchitecture(await fixture(t, onlyX64), 'arm64'), refusal);
    });
});
test('physical regular-file identity is required and unsupported requested targets refuse', async t => {
    const file = await fixture(t, arm64());
    for (const arch of ['ARM64', 'x86_64', '', null]) await assert.rejects(assertMachOArchitecture(file, arch), refusal);
    const directory = join(file, '..', 'directory'); await mkdir(directory);
    await assert.rejects(assertMachOArchitecture(directory, 'arm64'), refusal);
    await assert.rejects(assertMachOArchitecture(join(file, '..', 'missing'), 'arm64'), { code: 'ENOENT' });
    await t.test('a symbolic link is not a physical executable', {
        skip: process.platform === 'win32' ? 'Creating file symlinks requires a Windows privilege; regular-file positives run above' : false,
    }, async () => {
        const link = join(file, '..', 'link'); await symlink(file, link);
        await assert.rejects(assertMachOArchitecture(link, 'arm64'), refusal);
    });
});
test('a large sparse inert body needs only its bounded architecture header', async t => {
    const file = await fixture(t, arm64());
    await truncate(file, 128 * 1024 * 1024);
    await assertMachOArchitecture(file, 'arm64');
});
