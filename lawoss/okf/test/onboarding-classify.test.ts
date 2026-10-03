import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";

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
test('symlinks and unsupported entries consume the entry budget without being followed', async () => {
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
