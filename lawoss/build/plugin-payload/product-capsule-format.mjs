// Read-only archive format admission, not caller or workspace authorization.
// Caller owns the stable physical handle and independently pinned tar parser.
// Runtime use requires authentication of this module as application code.
import path from 'node:path';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const MiB = 1024 * 1024;
const bad = (code = 'PRODUCT_SDK_CAPSULE_INVALID') => { throw Object.assign(new Error(code), { code }); };
function safeName(raw, directoryEntry = false) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\p{Cc}\p{Cf}\\:<>"|?*]/u.test(raw) || raw.startsWith('/')) bad();
  let name = raw.startsWith('./') ? raw.slice(2) : raw;
  if (directoryEntry && name.endsWith('/')) name = name.slice(0, -1);
  if ((raw === '.' || raw === './') && directoryEntry) return '';
  if (!name || name.normalize('NFC') !== name || name.split('/')[0].toLowerCase() === '.capsule-input.tgz') bad();
  const parts = name.split('/');
  if (parts.length > 64) bad('PRODUCT_SDK_CAPSULE_LIMIT');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
    Buffer.byteLength(part) > 255 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) bad();
  return name;
}
function linkTarget(name, raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\p{Cc}\p{Cf}\\:<>"|?*]/u.test(raw) || path.posix.isAbsolute(raw)) bad();
  const parts = raw.split('/'); let index = 0;
  while (parts[index] === '..') index++;
  if (parts.slice(index).some(part => !part || part === '.' || part === '..')) bad();
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), raw));
  if (!target || target === '.' || target === '..' || target.startsWith('../')) bad();
  return safeName(target);
}
async function safeList(handle, size, tar) {
  /** @typedef {{ kind: 'Directory' | 'File' | 'SymbolicLink', explicit: boolean, target?: string }} ArchiveNode */
  const nodes = new Map(/** @type {[string, ArchiveNode][]} */ ([['', { kind: 'Directory', explicit: false }]])), aliases = new Map([['', '']]);
  let entries = 0, bytes = 0, metadata = 0, metadataEntries = 0, eof = false, ended = false;
  const parser = new tar.Parser({ strict: true, maxMetaEntrySize: 65536, brotli: false, zstd: false });
  let remainder = Buffer.alloc(0), trailing = 0;
  const sink = new Writable({
    write(chunk, encoding, done) {
      try {
        if (remainder.length) chunk = Buffer.concat([remainder, chunk]);
        let offset = 0;
        // Fixed blocks let the existing parser identify the exact EOF boundary.
        // It must not buffer arbitrary trailing bytes that sync extraction would
        // also accumulate; no headers or entry semantics are decoded here.
        while (!eof && offset + 512 <= chunk.length) { parser.write(chunk.subarray(offset, offset + 512)); offset += 512; }
        remainder = chunk.subarray(offset);
        if (eof) {
          if ((trailing += remainder.length) > 65536) bad('PRODUCT_SDK_CAPSULE_LIMIT');
          if (remainder.some(byte => byte !== 0)) bad();
          remainder = Buffer.alloc(0);
        }
        done();
      } catch (error) { done(error); }
    },
    final(done) {
      if (ended) { done(); return; }
      parser.once('end', done); try { if (remainder.length) parser.write(remainder); parser.end(); } catch (error) { done(error); }
    },
  });
  parser.once('end', () => { ended = true; });
  parser.on('error', error => sink.destroy(error));
  const refuse = error => { try { parser.abort(error); } catch (failure) { sink.destroy(failure); } };
  parser.on('eof', () => { eof = true; });
  parser.on('ignoredEntry', entry => refuse(Object.assign(new Error('PRODUCT_SDK_CAPSULE_INVALID'), {
    code: entry.meta ? 'PRODUCT_SDK_CAPSULE_LIMIT' : 'PRODUCT_SDK_CAPSULE_INVALID',
  })));
  parser.on('meta', text => {
    metadata += Buffer.byteLength(text);
    if (++metadataEntries > 30000 || metadata > 64 * MiB) refuse(Object.assign(new Error('PRODUCT_SDK_CAPSULE_LIMIT'), { code: 'PRODUCT_SDK_CAPSULE_LIMIT' }));
  });
  function node(name, value) {
    const alias = name.toLowerCase();
    if (aliases.has(alias) && aliases.get(alias) !== name) bad();
    aliases.set(alias, name); nodes.set(name, value);
    if (nodes.size > 30000) bad('PRODUCT_SDK_CAPSULE_LIMIT');
  }
  parser.on('entry', entry => {
    try {
      if (++entries > 30000 || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 32 * MiB) bad('PRODUCT_SDK_CAPSULE_LIMIT');
      if (!['File', 'OldFile', 'Directory', 'SymbolicLink'].includes(entry.type) ||
        !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 || (entry.type !== 'File' && entry.type !== 'OldFile' && entry.size)) bad();
      const name = safeName(entry.header.path, entry.type === 'Directory');
      if (safeName(entry.path, entry.type === 'Directory') !== name) bad();
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/'), previous = nodes.get(parent);
        if (previous && previous.kind !== 'Directory') bad();
        if (!previous) node(parent, { kind: 'Directory', explicit: false });
      }
      const previous = nodes.get(name);
      if (previous?.explicit || (previous && entry.type !== 'Directory')) bad();
      const kind = entry.type === 'OldFile' ? 'File' : entry.type;
      /** @type {ArchiveNode} */
      const value = { kind, explicit: true };
      if (kind === 'SymbolicLink') {
        if (!name.includes('/.bin/') || entry.header.linkpath !== entry.linkpath) bad();
        value.target = linkTarget(name, entry.header.linkpath);
      }
      if ((bytes += entry.size) > 256 * MiB) bad('PRODUCT_SDK_CAPSULE_LIMIT');
      node(name, value);
    } catch (error) { refuse(error); }
    entry.resume();
  });
  let decompressed = 0; const prefix = [];
  const cap = new Transform({ transform(chunk, encoding, done) {
    decompressed += chunk.length;
    for (const byte of chunk.subarray(0, 2 - prefix.length)) prefix.push(byte);
    // Parser must only see raw tar: its implicit nested gzip decoder would
    // otherwise sit after our raw-byte cap. Other auto-decoders are disabled.
    if (prefix[0] === 0x1f && prefix[1] === 0x8b) { done(Object.assign(new Error('PRODUCT_SDK_CAPSULE_INVALID'), { code: 'PRODUCT_SDK_CAPSULE_INVALID' })); return; }
    done(decompressed > 384 * MiB ? Object.assign(new Error('PRODUCT_SDK_CAPSULE_LIMIT'), { code: 'PRODUCT_SDK_CAPSULE_LIMIT' }) : null, chunk);
  } });
  try { await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: size - 1 }), createGunzip(), cap, sink); }
  catch (error) { refuse(error); throw error; }
  if (!eof) bad();
  function resolve(name, seen = new Set()) {
    if (seen.size > 64 || seen.has(name)) bad();
    seen.add(name);
    const parts = name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join('/'), value = nodes.get(current);
      if (!value) bad();
      if (value.kind === 'SymbolicLink') return resolve(path.posix.join(value.target, ...parts.slice(i)), seen);
      if (i < parts.length && value.kind !== 'Directory') bad();
    }
  }
  for (const value of nodes.values()) if (value.kind === 'SymbolicLink') resolve(value.target);
}

export { safeList as validateProductSdkCapsuleArchive };
