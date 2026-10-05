import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingParent, inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { planClientConversion } from "../src/onboarding/plan.ts";
import { incompleteInspectionMessage, LOCKED_FILES_MESSAGE_PREFIX } from "../src/onboarding/messages.ts";
import { holdWindowsFileLock } from "./windows-file-lock.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "okf-onboard-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content); }
  return root;
}
const card = (type: string) => `---\ntype: ${type}\ntitle: Synthetic\n---\n`;

test.each([['client.md','client'], ['klient.md','client'], ['subject.md','subject'], ['matter.md','matter'], ['spis.md','matter'], ['project.md','matter']] as const)("recognizes %s without changing source", async (file, level) => {
  const root = await fixture({ [file]: card(file.startsWith('project') ? 'project' : level), '_memory.md': 'Archive bytes\n' });
  const before = await readFile(join(root, file));
  const result = await inspectOnboardingRoot(root);
  expect(result).toMatchObject({ level, complete: true, confidence: 'confirmed' });
  expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.memorySources).toEqual(['_memory.md']);
  expect(await readFile(join(root, file))).toEqual(before);
  expect((await readdir(root)).sort()).toEqual([file, '_memory.md'].sort());
});
test('distinguishes office root, direct Office and unknown folder', async () => {
  const root = await fixture({ 'Office/okf.config': 'client_path: "Klienti/*"\n', 'Klienti/Synthetic/client.md': card('client') });
  expect(await inspectOnboardingRoot(root)).toMatchObject({ level:'office', complete:true });
  expect(await inspectOnboardingRoot(join(root,'Office'))).toMatchObject({ level:'office', complete:true });
  const unknown = await fixture({ 'notes.md':'ordinary text' });
  expect(await inspectOnboardingRoot(unknown)).toMatchObject({ level:'unknown', confidence:'unknown', complete:true });
});
test('conflicting card aliases and nested offices never yield confirmed client', async () => {
  const cases: Record<string, string>[] = [
    {'client.md':card('client'), 'klient.md':card('client')},
    {'client.md':card('matter')},
    {'client.md':card('client'), 'Office/okf.config':'version: 1'},
    {'client.md':card('client'), 'Nested/Office/okf.config':'version: 1'},
  ];
  for (const files of cases) {
    const result = await inspectOnboardingRoot(await fixture(files));
    expect(result.level).toBe('conflict');
    expect(result.issues.length).toBeGreaterThan(0);
  }
});
test('digest covers document bytes, filenames and empty directories', async () => {
  const root = await fixture({ 'client.md':card('client'), 'document.pdf':'first' });
  const before = await inspectOnboardingRoot(root);
  await writeFile(join(root,'document.pdf'),'other');
  const changed = await inspectOnboardingRoot(root);
  expect(changed.digest).not.toBe(before.digest);
  await mkdir(join(root,'new-empty-folder'));
  expect((await inspectOnboardingRoot(root)).digest).not.toBe(changed.digest);
});
test('bounded scan is incomplete with no usable digest', async () => {
  const root = await fixture({ 'client.md':card('client'), 'a.pdf':'123456789' });
  for (const limits of [{maxEntries:1}, {maxBytes:4}]) {
    const result = await inspectOnboardingRoot(root,limits);
    expect(result.complete).toBe(false);
    expect(result.digest).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
  }
});
test('an incomplete scan keeps a recognized card only as an unconfirmed candidate', async () => {
  const root = await fixture({ 'client.md': card('client'), 'z.pdf': 'late entry' });
  const result = await inspectOnboardingRoot(root, { maxEntries: 1 });
  expect(result).toMatchObject({ level: 'client', confidence: 'unknown', complete: false, digest: null });
  expect(result.issues).toContainEqual({ path: 'z.pdf', code: 'entry_limit' });
});
test('symlinks consume the entry budget without being followed', async () => {
  const root = await fixture({ 'z-client.md': card('client') });
  await symlink(root, join(root, 'a-link'), 'dir');
  await symlink(root, join(root, 'b-link'), 'dir');
  const result = await inspectOnboardingRoot(root, { maxEntries: 2 });
  expect(result.complete).toBe(false);
  expect(result.digest).toBeNull();
  expect(result.entries.filter(entry => entry.kind === 'symlink')).toHaveLength(2);
  expect(result.issues).toContainEqual({ path: 'z-client.md', code: 'entry_limit' });
});
// Windows named pipes are not filesystem entries; this fixture exercises Unix sockets.
test.skipIf(process.platform === 'win32')('unsupported socket entries consume the entry budget', async () => {
  const root = await fixture({ 'z-client.md': card('client') });
  const socketPath = join(root, 'b.socket');
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
    await symlink(root, join(root, 'a-link'), 'dir');
    const result = await inspectOnboardingRoot(root, { maxEntries: 2 });
    expect(result.complete).toBe(false);
    expect(result.digest).toBeNull();
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'a-link', kind: 'symlink' }),
      expect.objectContaining({ path: 'b.socket', kind: 'unsupported' }),
    ]));
    expect(result.entries.some(entry => entry.path === 'z-client.md')).toBe(false);
    expect(result.issues).toContainEqual({ path: 'z-client.md', code: 'entry_limit' });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
test('missing roots are errors, never an empty new client', async () => {
  const root=await fixture();
  const result=await inspectOnboardingRoot(join(root,'missing'));
  expect(result).toMatchObject({level:'unknown',complete:false,digest:null});
});
test('symlinks do not read or follow another client', async () => {
  const root = await fixture({ 'client.md':card('client') });
  const other = await fixture({ 'private.md':'Other client data' });
  try { await symlink(other,join(root,'other'),'dir'); }
  catch(error) { if(error && typeof error==='object' && 'code' in error && ['EPERM','EACCES','ENOSYS'].includes(String(error.code))) return; throw error; }
  const result=await inspectOnboardingRoot(root);
  expect(result.complete).toBe(false);
  expect(result.digest).toBeNull();
  expect(result.entries.some(entry=>entry.path.includes('private'))).toBe(false);
});
test('an opened client stays a confirmed client despite app files with symlinks in .opencode', async () => {
  const root = await fixture({ 'client.md': card('client'), 'Spisy/.keep': '', '.opencode/node_modules/pkg/index.js': 'x' });
  await mkdir(join(root, '.opencode/node_modules/.bin'), { recursive: true });
  await symlink('../pkg/index.js', join(root, '.opencode/node_modules/.bin/pkg'));
  const result = await inspectOnboardingRoot(root);
  expect(result).toMatchObject({ level: 'client', confidence: 'confirmed', complete: true });
  expect(result.entries).toContainEqual(expect.objectContaining({ path: '.opencode', kind: 'directory' }));
  expect(result.entries.some(entry => entry.path.startsWith('.opencode/'))).toBe(false);
});

// Windows a Office zakladajú tieto súbory samy (otvorený dokument vo Worde, Prieskumník);
// otlačok ani skúšobný klon ich nesmú vidieť, inak otvorený Word zablokuje apply.
test('volatile Windows and Office artefacts never enter entries or the digest', async () => {
  const files = { 'client.md': card('client'), 'zmluva.docx': 'docx', 'Spisy/2026-10 Vec/podanie.docx': 'podanie' };
  const clean = await inspectOnboardingRoot(await fixture(files));
  const root = await fixture({ ...files, '~$zmluva.docx': 'owner', 'Thumbs.db': 'thumbs', 'desktop.ini': '[.ShellClassInfo]', 'Spisy/2026-10 Vec/~WRL0001.tmp': 'tmp', 'Spisy/2026-10 Vec/DESKTOP.INI': 'ini', 'Spisy/~$podanie.docx': 'owner' });
  const result = await inspectOnboardingRoot(root);
  expect(result).toMatchObject({ level: 'client', complete: true, confidence: 'confirmed' });
  expect(result.digest).toBe(clean.digest);
  expect(result.entries).toEqual(clean.entries);
  expect(result.ignored?.sort()).toEqual(['Spisy/2026-10 Vec/DESKTOP.INI', 'Spisy/2026-10 Vec/~WRL0001.tmp', 'Spisy/~$podanie.docx', 'Thumbs.db', 'desktop.ini', '~$zmluva.docx']);
  const parent = await inspectOnboardingParent(root);
  expect(parent.entries.map(entry => entry.path)).toEqual(['Spisy', 'client.md', 'zmluva.docx']);
  expect(parent.ignored).toEqual(['Thumbs.db', 'desktop.ini', '~$zmluva.docx']);
  expect(parent.digest).toBe((await inspectOnboardingParent(await fixture(files))).digest);
  // Podobné, ale bežné mená ostávajú dokumentmi.
  const ordinary = await inspectOnboardingRoot(await fixture({ 'client.md': card('client'), 'zmluva~$.docx': 'x', 'Thumbs.db.bak': 'x', 'WRL0001.tmp': 'x' }));
  expect(ordinary.entries.map(entry => entry.path)).toEqual(['Thumbs.db.bak', 'WRL0001.tmp', 'client.md', 'zmluva~$.docx']);
  expect(ordinary.ignored).toBeUndefined();
});

test('a locked file is recorded per file, later siblings are still read and apply stays impossible', async () => {
  const root = await fixture({ 'client.md': card('client'), 'a.pdf': 'first', 'b-locked.docx': 'locked', 'c.pdf': 'after', 'd-broken.pdf': 'io' });
  const result = await inspectOnboardingRoot(root, {}, {
    open: (async (path: Parameters<typeof open>[0], flags?: string | number) => {
      if (String(path).endsWith('b-locked.docx')) throw Object.assign(new Error('EBUSY: resource busy or locked, open'), { code: 'EBUSY' });
      if (String(path).endsWith('d-broken.pdf')) throw Object.assign(new Error('EIO: i/o error, open'), { code: 'EIO' });
      return open(path, flags);
    }) as typeof open,
  });
  expect(result).toMatchObject({ complete: false, digest: null, confidence: 'unknown' });
  expect(result.issues).toEqual([{ path: 'b-locked.docx', code: 'locked_file' }, { path: 'd-broken.pdf', code: 'EIO' }]);
  expect(result.entries).toContainEqual({ path: 'b-locked.docx', kind: 'unsupported', digest: null, size: 0 });
  expect(result.entries.find(entry => entry.path === 'c.pdf')).toMatchObject({ kind: 'file', size: 5 });
  expect(result.entries.find(entry => entry.path === 'c.pdf')?.digest).toMatch(/^[a-f0-9]{64}$/);
});

test('incomplete inspection message lists five issues, locked files first', () => {
  const issues = [{ path: '', code: 'changed_during_read' }, { path: 'a.pdf', code: 'EIO' }, { path: 'b.docx', code: 'locked_file' }, ...['c', 'd', 'e', 'f'].map(path => ({ path, code: 'EIO' }))];
  expect(incompleteInspectionMessage('Source client could not be inspected completely.', issues)).toBe(`${LOCKED_FILES_MESSAGE_PREFIX} b.docx: locked_file; .: changed_during_read; a.pdf: EIO; c: EIO; d: EIO (+2 more)`);
  expect(incompleteInspectionMessage('Source client could not be inspected completely.', issues.slice(0, 2))).toBe('Source client could not be inspected completely: .: changed_during_read; a.pdf: EIO');
  expect(incompleteInspectionMessage('Subject parent must be an inspected client root.', [])).toBe('Subject parent must be an inspected client root.');
});

test('incomplete conversion names the first issues', async () => {
  const root = await fixture({ 'client.md': card('client'), 'a.pdf': 'first' });
  try { await symlink(join(root, 'a.pdf'), join(root, 'link.pdf')); }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && ['EPERM', 'EACCES', 'ENOSYS'].includes(String(error.code))) return; throw error; }
  await expect(planClientConversion(root, { title: 'Synthetic', clientType: 'po', language: 'sk', jurisdiction: 'sk', date: '2026-10-05' })).rejects.toThrow('The directory could not be inspected completely and unambiguously: link.pdf: symlink_not_followed');
});

// Skutočný zámok Windows: súbor otvorený bez zdieľania, ako ho drží Outlook či antivírus.
test.skipIf(process.platform !== 'win32')('Windows: a file held open without sharing is locked_file and siblings are still listed', async () => {
  const root = await fixture({ 'client.md': card('client'), 'a.pdf': 'first', 'b-zmluva.docx': 'locked', 'c.pdf': 'after' });
  const release = await holdWindowsFileLock(join(root, 'b-zmluva.docx'));
  try {
    const result = await inspectOnboardingRoot(root);
    expect(result).toMatchObject({ complete: false, digest: null });
    expect(result.issues).toContainEqual({ path: 'b-zmluva.docx', code: 'locked_file' });
    expect(result.entries.find(entry => entry.path === 'c.pdf')).toMatchObject({ kind: 'file', size: 5 });
    const error = await planClientConversion(root, { title: 'Synthetic', clientType: 'po', language: 'sk', jurisdiction: 'sk', date: '2026-10-05' }).then(() => undefined, (reason: unknown) => reason);
    expect(error instanceof Error ? error.message : '').toStartWith(`${LOCKED_FILES_MESSAGE_PREFIX} b-zmluva.docx: locked_file`);
  } finally { await release(); }
  expect((await inspectOnboardingRoot(root)).complete).toBe(true);
}, 60_000);
