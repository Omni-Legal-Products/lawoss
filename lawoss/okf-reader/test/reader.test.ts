import { test, expect } from 'bun:test';
import { readOkfSnapshot, type OkfReadSource } from '../src/index.ts';
import { memoryFiles, source } from './support.ts';

test('portable reader shares scope, confirmation and manual status semantics', async () => {
  const out = await readOkfSnapshot(source(memoryFiles()), [''], '2026-10-18');
  expect(out.matters.map(m => m.title)).toEqual(['Test matter']);
  expect(out.inputs[0].records.map(r => r.id)).toEqual(['T-001', 'Q-001', 'L-001']);
  expect(out.inputs[0].manualStatus?.state).toBe('unknown');
  expect(out.scopes.some(s => s.level === 'office')).toBe(true);
  expect(out.clients).toEqual([{ path: 'Clients/Test', title: 'Test client' }]);
});

test('root narrowing keeps ancestor client and office and excludes other matters', async () => {
  const files = { ...memoryFiles(), 'Other/matter.md': '---\ntitle: Other\n---\n' };
  const out = await readOkfSnapshot(source(files), ['Clients/Test/Spisy/A'], '2026-10-18');
  expect(out.matters.map(m => m.path)).toEqual(['Clients/Test/Spisy/A']);
  expect(out.inputs[0].records.map(r => r.id)).toContain('L-001');
});

test('office and empty clients remain visible without a matter', async () => {
  const files = memoryFiles();
  for (const path of Object.keys(files)) if (path.includes('/Spisy/')) delete files[path];
  const out = await readOkfSnapshot(source(files), [''], '2026-10-18');
  expect(out.matters).toHaveLength(0);
  expect(out.clients).toHaveLength(1);
  expect(out.scopes.flatMap(s => s.records.map(r => r.id)).sort()).toEqual(['L-001', 'Q-001']);
});

test('rejects unsafe roots before reading', async () => {
  const forbidden: OkfReadSource = { list: async () => { throw Error('read attempted'); }, readText: async () => { throw Error('read attempted'); } };
  for (const root of ['../other', '/tmp', 'C:/vault', '.obsidian', 'a/../b']) {
    await expect(readOkfSnapshot(forbidden, [root], '2026-10-18')).rejects.toThrow('root');
  }
});

test('unsupported record version stays diagnostic rather than confirmed data', async () => {
  const files = memoryFiles();
  files['Clients/Test/Spisy/A/memory/T-001.md'] = files['Clients/Test/Spisy/A/memory/T-001.md']!.replace('okf: 1', 'okf: 99');
  const out = await readOkfSnapshot(source(files), [''], '2026-10-18');
  expect(out.problems.some(p => p.message.includes('Unsupported OKF'))).toBe(true);
  expect(out.inputs[0].records.some(r => r.id === 'T-001')).toBe(false);
});

test('independent scope validation exposes manual Truth edits and duplicates', async () => {
  const files = memoryFiles();
  files['Office/memory/L-001.md'] += '';
  files['Office/memory/L-001.md'] = files['Office/memory/L-001.md']!.replace('okf: 1', 'okf: 1\ntruth_digest: changed');
  files['Office/memory/L-001 (conflicted copy).md'] = files['Office/memory/L-001.md']!;
  const out = await readOkfSnapshot(source(files), ['Office'], '2026-10-18');
  expect(out.problems.some(p => p.message.includes('TRUTH_EDITED_OUTSIDE'))).toBe(true);
  expect(out.problems.some(p => p.message.includes('DUPLICATE_ID'))).toBe(true);
});

test('large vault reads OKF sources, never unrelated attachments, with visible matter cap', async () => {
  const files = memoryFiles();
  for (let i = 0; i < 90000; i++) files[`Attachments/file-${i}.pdf`] = 'synthetic';
  const reads: string[] = [];
  const out = await readOkfSnapshot(source(files, reads), [''], '2026-10-18');
  expect(out.matters).toHaveLength(1);
  expect(reads.filter(p => p.startsWith('read:Attachments/'))).toEqual([]);
  expect(reads.filter(p => p.startsWith('read:')).length).toBeLessThan(20);
});

test('matter references to inherited client records have the same validity in both hosts', async () => {
  const { readOkfRoot } = await import('../src/index.ts');
  const files = memoryFiles();
  files['Clients/Test/Spisy/A/memory/T-001.md'] = files['Clients/Test/Spisy/A/memory/T-001.md']!.replace('deadlines:', 'related: [Q-001]\ndeadlines:');
  const app = await readOkfRoot(source(files), '2026-10-18');
  const plugin = await readOkfSnapshot(source(files), [''], '2026-10-18');
  expect(plugin.matters).toEqual(app.matters);
  expect(plugin.inputs).toEqual(app.inputs);
  expect(plugin.problems.some(p => p.message.includes('BROKEN_LINK'))).toBe(false);
});

test('scope ordering is deterministic across asynchronous reads', async () => {
  const out = await readOkfSnapshot(source(memoryFiles()), [''], '2026-10-18');
  expect(out.scopes.map(s => s.path)).toEqual(out.scopes.map(s => s.path).sort((a, b) => a.localeCompare(b)));
});
