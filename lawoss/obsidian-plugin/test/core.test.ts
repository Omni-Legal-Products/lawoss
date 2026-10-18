import { test, expect } from 'bun:test';
import { RefreshController } from '../src/refresh.ts';
import { parseSettings } from '../src/settings.ts';
import { resolveLocalLink } from '../src/links.ts';
import { createVaultSource } from '../src/source.ts';

test('latest requested refresh wins and dispose rejects pending results', async () => {
  const pending: ((v: string) => void)[] = [];
  const c = new RefreshController(() => new Promise<string>(r => pending.push(r)), () => 10);
  const a = c.refresh(); const b = c.refresh();
  pending[1]('new'); await b;
  pending[0]('old'); await a;
  expect(c.state.data).toBe('new');
  const d = c.refresh(); c.dispose(); pending[2]('after unload'); await d;
  expect(c.state.data).toBe('new');
});

test('failure keeps the last successful data with stale status', async () => {
  let fail = false;
  const c = new RefreshController(async () => { if (fail) throw Error('unavailable'); return 'current'; }, () => 42);
  await c.refresh(); fail = true; await c.refresh();
  expect(c.state).toMatchObject({ data: 'current', updatedAt: 42, error: 'unavailable', loading: false });
  c.dispose();
});

test('settings validate before any write and reject dangerous paths', () => {
  expect(parseSettings(null)).toEqual({ roots: [''], locale: 'cs' });
  expect(parseSettings({ roots: ['Clients', 'Clients'], locale: 'sk' }).roots).toEqual(['Clients']);
  for (const root of ['../a', '/a', 'a//b', 'C:/a', '.obsidian']) expect(() => parseSettings({ roots: [root] })).toThrow();
});

test('local links resolve relative paths and reject external or escaping targets', () => {
  const exists = (p: string) => ['Clients/A/source.md', 'Clients/A/memory/Q-1.md', 'Subjekty/Žáček.md'].includes(p);
  const roots = ['Clients/A', 'Subjekty'];
  expect(resolveLocalLink('./memory/Q-1.md', 'Clients/A/source.md', roots, exists)).toBe('Clients/A/memory/Q-1.md');
  expect(resolveLocalLink('[[Subjekty/Žáček]]', 'Clients/A/source.md', roots, exists)).toBe('Subjekty/Žáček.md');
  for (const link of ['https://evil', 'javascript:evil()', '/etc/passwd', '../../../outside', 'a%2fb.md', '![[remote]]']) {
    expect(resolveLocalLink(link, 'Clients/A/source.md', roots, exists)).toBeNull();
  }
});

test('Vault source reads BOM through binary and never reads attachments on listing', async () => {
  const reads: string[] = [];
  const port = {
    entries: async () => [{ name: 'ok.md', path: 'ok.md', kind: 'file' as const }, { name: 'big.pdf', path: 'big.pdf', kind: 'file' as const }],
    binary: async (p: string) => { reads.push(p); return new TextEncoder().encode('\ufeff---\ntitle: Test\n---\n').buffer; },
  };
  const source = createVaultSource(port);
  expect((await source.list('')).entries).toHaveLength(2);
  expect(reads).toEqual([]);
  expect(await source.readText('ok.md')).toStartWith('---');
  expect(reads).toEqual(['ok.md']);
});

test('directory listing is bounded and explicitly partial', async () => {
  const port = { entries: async () => Array.from({ length: 90000 }, (_, i) => ({ name: `attachment-${i}.pdf`, path: `attachment-${i}.pdf`, kind: 'file' as const })), binary: async () => { throw Error('must not read attachments'); } };
  const out = await createVaultSource(port).list('');
  expect(out.entries).toHaveLength(2000);
  expect(out.truncated).toBe(true);
});

test('wiki basename resolves beside its source before a vault-relative path', () => {
  expect(resolveLocalLink('[[evidence]]', 'Clients/A/note.md', ['Clients/A'], p => p === 'Clients/A/evidence.md')).toBe('Clients/A/evidence.md');
});

test('unchanged snapshots retain identity so an open preview survives background refresh', async () => {
  const c = new RefreshController(async () => ({ value: 1 }), () => 10, (a, b) => JSON.stringify(a) === JSON.stringify(b));
  await c.refresh(); const first = c.state.data; await c.refresh();
  expect(c.state.data).toBe(first); c.dispose();
});

test('a new scope clears old data even if its first read fails', async () => {
  let fail = false;
  const c = new RefreshController(async () => { if (fail) throw Error('missing new root'); return 'A'; });
  await c.refresh(); c.reset(); fail = true; await c.refresh();
  expect(c.state.data).toBeUndefined(); expect(c.state.error).toBe('missing new root'); c.dispose();
});
