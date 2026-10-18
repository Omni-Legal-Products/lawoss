import { test, expect } from 'bun:test';
import { parseHTML } from 'linkedom';
import { renderView, type Actions } from '../src/render.ts';
import { readOkfSnapshot } from '../../okf-reader/src/index.ts';
import { memoryFiles, source } from '../../okf-reader/test/support.ts';

test('jurisdiction filter uses the matter card, not inherited office rules; preview remains inert', async () => {
  const files = memoryFiles(); files['Clients/Test/Spisy/A/matter.md'] += '';
  files['Clients/Test/Spisy/A/matter.md'] = files['Clients/Test/Spisy/A/matter.md']!.replace('title:', 'jurisdiction: sk\ntitle:');
  const snapshot = await readOkfSnapshot(source(files), [''], '2026-10-18');
  const { document } = parseHTML('<html><body></body></html>');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true });
  const actions: Actions = { navigate() {}, select() {}, preview() {}, previewClient() {}, open() {}, follow() {}, close() {}, refresh() {} };
  try {
    const host = document.createElement('div');
    renderView(host, 'practice', { locale: 'cs', selected: null, read: { data: snapshot, loading: false, duration: 0 } }, actions, { query: '', jurisdiction: 'cz' });
    expect(host.querySelector('main')?.textContent).not.toContain('Test matter');
    renderView(host, 'practice', { locale: 'sk', selected: null, read: { data: snapshot, loading: false, duration: 0 }, preview: { path: 'x.md', text: '<img src="https://example.com/secret"> ![[remote]]' } }, actions, { query: '', jurisdiction: 'sk' });
    expect(host.querySelector('main')?.textContent).toContain('Test matter');
    expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('pre')?.textContent).toContain('<img');
  } finally { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); }
});
