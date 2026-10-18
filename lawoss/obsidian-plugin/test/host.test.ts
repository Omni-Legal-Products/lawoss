import { test, expect, mock } from 'bun:test';
import { parseHTML } from 'linkedom';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { memoryFiles } from '../../okf-reader/test/support.ts';

class AbstractFile { constructor(public path: string, public name: string) {} }
class File extends AbstractFile { stat = { size: 0 }; }
class Folder extends AbstractFile { children: AbstractFile[] = []; }
class Adapter { constructor(private root: string) {} getBasePath() { return this.root; } }
class HostPlugin {
  cleanups: (() => void)[] = []; factories = new Map(); saved: unknown[] = [];
  constructor(public app: HostApp) {}
  async loadData() { return null; } async saveData(value: unknown) { this.saved.push(value); }
  register(fn: () => void) { this.cleanups.push(fn); }
  registerEvent(ref: () => void) { this.register(ref); }
  registerDomEvent(target: EventTarget, event: string, callback: EventListener) { target.addEventListener(event, callback); this.register(() => target.removeEventListener(event, callback)); }
  registerInterval(id: ReturnType<typeof setInterval>) { this.register(() => clearInterval(id)); }
  registerView(id: string, factory: (leaf: Leaf) => HostView) { this.factories.set(id, factory); }
  addCommand() {} addRibbonIcon() {} addSettingTab() {}
  async unload() { for (const leaf of this.app.workspace.leaves) await leaf.view?.onClose(); for (const close of this.cleanups.reverse()) close(); }
}
class HostView { contentEl = document.createElement('div'); constructor(public leaf: Leaf) { document.body.append(this.contentEl); } }
class Leaf {
  type = ''; view?: HostView;
  constructor(private host: HostApp) {}
  async setViewState(state: { type: string }) {
    if (this.type === state.type) return; // Reused leaves do not call onOpen again.
    this.type = state.type; this.view = this.host.plugin.factories.get(state.type)(this); await this.view?.onOpen();
  }
  async openFile(file: File) { this.host.workspace.opened.push(file.path); }
}
class HostApp {
  plugin!: HostPlugin;
  workspace = {
    leaves: [] as Leaf[], opened: [] as string[], activeLeaf: undefined as Leaf | undefined,
    getLeavesOfType: (type: string) => this.workspace.leaves.filter(l => l.type === type),
    getLeaf: () => { const leaf = new Leaf(this); this.workspace.leaves.push(leaf); return leaf; },
    revealLeaf: async (leaf: Leaf) => { this.workspace.activeLeaf = leaf; },
    onLayoutReady: (_fn: () => void) => {},
  };
  vault;
  constructor(root: string, files: Record<string, string>) {
    const tree = new Map<string, AbstractFile>([['', new Folder('', '')]]);
    for (const path of Object.keys(files)) {
      let parent = tree.get(''); const parts = path.split('/');
      for (let i = 0; i < parts.length; i++) {
        const current = parts.slice(0, i + 1).join('/'); let entry = tree.get(current);
        if (!entry) { entry = i === parts.length - 1 ? new File(current, parts[i]!) : new Folder(current, parts[i]!); tree.set(current, entry); if (parent instanceof Folder) parent.children.push(entry); }
        parent = entry;
      }
    }
    const events = new Map<string, Set<(...args: never[]) => void>>();
    this.vault = {
      adapter: new Adapter(root), getRoot: () => tree.get(''), getAbstractFileByPath: (path: string) => tree.get(path),
      readBinary: async (file: File) => { const b = await readFile(join(root, file.path)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
      on: (event: string, callback: (...args: never[]) => void) => { let set = events.get(event); if (!set) { set = new Set(); events.set(event, set); } set.add(callback); return () => set.delete(callback); },
      emit: (event: string, file: AbstractFile) => { for (const callback of events.get(event) ?? []) Reflect.apply(callback, null, [file]); },
      listenerCount: () => [...events.values()].reduce((n, set) => n + set.size, 0),
    };
  }
}
mock.module('obsidian', () => ({ Plugin: HostPlugin, ItemView: HostView, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, TFile: File, TFolder: Folder, FileSystemAdapter: Adapter }));
const { default: LawossPlugin } = await import('../src/main.ts');

test('real plugin lifecycle: reused leaf, preview continuity, scope reset, read-only and cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'okf-host-'));
  const files = { ...memoryFiles(), 'Clients/Test/Spisy/B/matter.md': '---\ntitle: Second matter\njurisdiction: sk\nmatter_kind: advisory\n---\n' };
  const originalGlobals = new Map(['window', 'document', 'HTMLInputElement'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const { window } = parseHTML('<html><body></body></html>');
  Object.defineProperty(window.document, 'hasFocus', { value: () => false });
  Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true });
  Object.defineProperty(globalThis, 'HTMLInputElement', { value: window.HTMLInputElement, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true });
  let plugin: InstanceType<typeof LawossPlugin> | undefined;
  try {
    for (const [path, text] of Object.entries(files)) { await mkdir(dirname(join(dir, path)), { recursive: true }); await writeFile(join(dir, path), text); }
    const hashes = async () => Promise.all(Object.keys(files).map(async path => createHash('sha256').update(await readFile(join(dir, path))).digest('hex')));
    const before = await hashes();
    const app = new HostApp(dir, files); plugin = new LawossPlugin(app, {}); app.plugin = plugin;
    await plugin.onload(); await plugin.controller.refresh();
    plugin.selected = 'Clients/Test/Spisy/A'; await plugin.navigate('matter');
    expect(app.workspace.activeLeaf?.view?.contentEl.querySelector('main h3')?.textContent).toBe('Test matter');
    plugin.selected = 'Clients/Test/Spisy/B'; await plugin.navigate('matter');
    expect(app.workspace.activeLeaf?.view?.contentEl.querySelector('main h3')?.textContent).toBe('Second matter');
    await plugin.showPreview('Office/memory/L-001.md'); const preview = plugin.preview;
    await plugin.controller.refresh(); expect(plugin.preview).toBe(preview);
    expect(await hashes()).toEqual(before);
    await plugin.saveSettings({ roots: ['Clients/Test/Spisy/A'], locale: 'cs' });
    await plugin.showPreview('Clients/Test/Spisy/B/matter.md');
    expect(plugin.preview).toBeUndefined();
    await plugin.openSource('Clients/Test/Spisy/B/matter.md'); expect(app.workspace.opened).toEqual([]);
    await plugin.saveSettings({ roots: [''], locale: 'cs' });
    const changedPath = 'Office/memory/L-001.md';
    await writeFile(join(dir, changedPath), files[changedPath]!.replace('Synthetic truth.', 'External change.'));
    app.vault.emit('modify', app.vault.getAbstractFileByPath(changedPath)!);
    expect(plugin.preview).toBeUndefined();
    const eventDeadline = Date.now() + 3000;
    while (!plugin.controller.state.data?.scopes.flatMap(s => s.records).some(r => r.truth.includes('External change.'))) {
      if (Date.now() > eventDeadline) throw new Error('External change was not observed');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(plugin.controller.state.data?.scopes.flatMap(s => s.records).some(r => r.truth.includes('External change.'))).toBe(true);
    const afterExternal = await hashes();
    const checkPath = plugin.checkPath;
    let releaseGuard!: () => void;
    plugin.checkPath = path => path.endsWith('T-001.md') ? new Promise<void>(resolve => { releaseGuard = resolve; }) : checkPath(path);
    const pendingOpen = plugin.openSource('Clients/Test/Spisy/A/memory/T-001.md');
    await plugin.saveSettings({ roots: ['Missing'], locale: 'cs' });
    releaseGuard(); await pendingOpen;
    expect(app.workspace.opened).toEqual([]);
    plugin.checkPath = checkPath;
    await plugin.showPreview('Clients/Test/Spisy/A/memory/T-001.md');
    expect(plugin.preview).toBeUndefined();
    await plugin.openSource('Clients/Test/Spisy/A/memory/T-001.md'); expect(app.workspace.opened).toEqual([]);
    expect(await hashes()).toEqual(afterExternal);
    expect(app.vault.listenerCount()).toBe(4);
    await plugin.saveSettings({ roots: [''], locale: 'cs' });
    let releaseUnload!: () => void;
    plugin.checkPath = path => path.endsWith('T-001.md') ? new Promise<void>(resolve => { releaseUnload = resolve; }) : checkPath(path);
    const openingAtUnload = plugin.openSource('Clients/Test/Spisy/A/memory/T-001.md');
    await plugin.unload(); releaseUnload(); await openingAtUnload;
    expect(app.workspace.opened).toEqual([]);
    plugin = undefined;
    expect(app.vault.listenerCount()).toBe(0);
  } finally {
    await plugin?.unload();
    for (const [key, descriptor] of originalGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(dir, { recursive: true, force: true });
  }
});
