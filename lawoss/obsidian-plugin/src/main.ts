import { Plugin, ItemView, PluginSettingTab, Setting, Notice, FileSystemAdapter, TFile, TFolder, type TAbstractFile, type WorkspaceLeaf } from 'obsidian';
import { readOkfSnapshot, okfRefreshInterval, today, validRoot, CLIENT_CARDS, type OkfSnapshot } from '../../okf-reader/src/index.ts';
import { RefreshController } from './refresh.ts';
import { createVaultSource } from './source.ts';
import { parseSettings, type Settings } from './settings.ts';
import { renderView, VIEW_KINDS, type ViewKind, type Preview, type Filters } from './render.ts';
import { tr } from './i18n.ts';
import { resolveLocalLink } from './links.ts';
import { physicalBoundary } from './desktop-boundary.ts';
const viewId = (kind: ViewKind) => `lawoss-okf-${kind}`;
const MAX_BYTES = 2 * 1024 * 1024;
export default class LawossPlugin extends Plugin {
  settings: Settings = { roots: [''], locale: 'cs' };
  selected: string | null = null;
  preview?: Preview;
  controller!: RefreshController<OkfSnapshot>;
  private pending?: number;
  private nextRead = 0;
  private day = today();
  private previewGeneration = 0;
  private scopeGeneration = 0;
  private stopped = false;
  private checkPath!: (path: string) => Promise<void>;
  async onload() {
    try { this.settings = parseSettings(await this.loadData()); }
    catch { this.settings = { roots: [], locale: 'cs' }; new Notice(tr(this.settings.locale, 'badSettings')); }
    if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error('LAWOSS OKF requires a local desktop vault');
    this.checkPath = physicalBoundary(this.app.vault.adapter.getBasePath());
    const source = createVaultSource({
      entries: async path => {
        await this.checkPath(path);
        const folder = path ? this.app.vault.getAbstractFileByPath(path) : this.app.vault.getRoot();
        if (!(folder instanceof TFolder)) throw new Error(`404 ${path}`);
        return folder.children.slice(0, 2001).map(file => ({ name: file.name, path: file.path, kind: file instanceof TFolder ? 'dir' : 'file' }));
      },
      binary: async path => {
        await this.checkPath(path);
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`404 ${path}`);
        if (file.stat.size > MAX_BYTES) throw new Error(`OKF text exceeds 2 MiB: ${path}`);
        return this.app.vault.readBinary(file);
      },
    });
    this.controller = new RefreshController(async () => {
      const snapshot = await readOkfSnapshot(source, this.settings.roots, today());
      // An unavailable selected root is a failed refresh, not a successfully empty practice.
      if (!snapshot.inputs.length && snapshot.problems.length && !snapshot.scopes.some(s => s.records.length)) throw new Error(snapshot.problems[0].message);
      return snapshot;
    }, Date.now, (a, b) => JSON.stringify(a) === JSON.stringify(b));
    let lastData: OkfSnapshot | undefined;
    this.register(this.controller.subscribe(() => {
      if (lastData !== this.controller.state.data) { this.preview = undefined; this.previewGeneration++; lastData = this.controller.state.data; }
      if (!this.controller.state.loading) this.nextRead = Date.now() + okfRefreshInterval(this.controller.state.duration);
    }));
    for (const kind of VIEW_KINDS) {
      this.registerView(viewId(kind), leaf => new OkfView(leaf, this, kind));
      this.addCommand({ id: `open-${kind}`, name: tr(this.settings.locale, kind), callback: () => { void this.navigate(kind); } });
    }
    this.addCommand({ id: 'refresh', name: tr(this.settings.locale, 'refresh'), callback: () => { void this.controller.refresh(); } });
    this.addRibbonIcon('scale', 'LAWOSS OKF', () => { void this.navigate('practice'); });
    this.addSettingTab(new OkfSettings(this));
    const changed = (file: TAbstractFile) => this.schedule(file.path);
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('modify', changed));
    this.registerEvent(this.app.vault.on('delete', changed));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.schedule(file.path, oldPath)));
    this.registerDomEvent(window, 'focus', () => { void this.controller.refresh(); });
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) void this.controller.refresh(); });
    this.registerInterval(window.setInterval(() => {
      if (document.hidden || !document.hasFocus()) return;
      const day = today();
      if (day !== this.day || (!this.controller.state.loading && Date.now() >= this.nextRead)) { this.day = day; void this.controller.refresh(); }
    }, 1000));
    this.register(() => { if (this.pending !== undefined) window.clearTimeout(this.pending); this.previewGeneration++; this.scopeGeneration++; this.stopped = true; this.controller.dispose(); });
    this.app.workspace.onLayoutReady(() => { void this.controller.refresh(); });
  }
  private schedule(path: string, oldPath?: string) {
    if (this.preview && [path, oldPath].some(changed => changed && (this.preview?.path === changed || this.preview?.path.startsWith(changed + '/')))) {
      this.preview = undefined; this.previewGeneration++; this.redraw();
    }
    this.controller.invalidate();
    if (this.pending !== undefined) window.clearTimeout(this.pending);
    this.pending = window.setTimeout(() => { this.pending = undefined; void this.controller.refresh(); }, 250);
  }
  async navigate(kind: ViewKind) {
    if (this.stopped) return;
    const leaf = this.app.workspace.getLeavesOfType(viewId(kind))[0] ?? this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: viewId(kind), active: true });
    if (this.stopped) return;
    await this.app.workspace.revealLeaf(leaf);
    this.redraw();
  }
  private fileAt(path: string): TFile | null {
    const direct = this.app.vault.getAbstractFileByPath(path);
    if (direct instanceof TFile) return direct;
    // macOS NFD filenames and NFC links name the same file; return its actual path.
    let entry: TFolder | TFile = this.app.vault.getRoot();
    for (const part of path.split('/')) {
      if (!(entry instanceof TFolder)) return null;
      const next: TAbstractFile | undefined = entry.children.find(child => child.name.normalize('NFC') === part.normalize('NFC'));
      if (!(next instanceof TFolder) && !(next instanceof TFile)) return null;
      entry = next;
    }
    return entry instanceof TFile ? entry : null;
  }
  private allowed(path: string): boolean {
    if (!validRoot(path)) return false;
    if (this.settings.roots.some(root => root === '' || path === root || path.startsWith(root + '/'))) return true;
    // Inherited memory/cards do not grant the entire client subtree (other matters).
    return (this.controller.state.data?.scopes ?? []).some(scope => {
      const prefix = scope.path ? scope.path + '/' : '';
      return path.startsWith(prefix + 'memory/') || CLIENT_CARDS.some(name => path === prefix + name);
    });
  }
  async showClient(path: string) {
    const file = CLIENT_CARDS.map(name => this.fileAt(path ? path + '/' + name : name)).find(Boolean);
    if (file) await this.showPreview(file.path);
    else new Notice(tr(this.settings.locale, 'unavailable'));
  }
  async showPreview(path: string) {
    if (this.stopped) return;
    const generation = ++this.previewGeneration;
    const file = this.fileAt(path);
    if (!this.allowed(path) || !(file instanceof TFile) || file.stat.size > MAX_BYTES) { new Notice(tr(this.settings.locale, 'unavailable')); return; }
    try {
      await this.checkPath(path);
      const { decodeText } = await import('../../okf-reader/src/index.ts');
      const text = decodeText(new Uint8Array(await this.app.vault.readBinary(file)));
      if (generation !== this.previewGeneration) return;
      this.preview = { path, text }; this.redraw();
    } catch { new Notice(tr(this.settings.locale, 'unavailable')); }
  }
  follow(link: string, from: string) {
    const roots = this.settings.roots.concat(this.controller.state.data?.scopes.map(s => s.path) ?? []);
    const path = resolveLocalLink(link, from, roots, candidate => this.fileAt(candidate) !== null);
    const file = path ? this.fileAt(path) : null;
    if (!file) { new Notice(tr(this.settings.locale, 'unavailable')); return; }
    void this.showPreview(file.path);
  }
  async openSource(path: string) {
    if (this.stopped) return;
    const generation = this.scopeGeneration;
    const file = this.fileAt(path);
    if (!this.allowed(path) || !(file instanceof TFile)) { new Notice(tr(this.settings.locale, 'unavailable')); return; }
    try { await this.checkPath(path); } catch { new Notice(tr(this.settings.locale, 'unavailable')); return; }
    if (this.stopped || generation !== this.scopeGeneration || !this.allowed(path) || this.fileAt(path) !== file) return;
    new Notice(tr(this.settings.locale, 'editorNotice'));
    await this.app.workspace.getLeaf('tab').openFile(file);
  }
  redraw() { for (const kind of VIEW_KINDS) for (const leaf of this.app.workspace.getLeavesOfType(viewId(kind))) if (leaf.view instanceof OkfView) leaf.view.render(); }
  async saveSettings(value: unknown) {
    const next = parseSettings(value);
    await this.saveData(next); // Only intentional plugin-settings writes; never OKF content.
    const changedRoots = JSON.stringify([...next.roots].sort()) !== JSON.stringify([...this.settings.roots].sort());
    this.settings = next;
    if (changedRoots) { this.scopeGeneration++; this.selected = null; this.preview = undefined; this.previewGeneration++; this.controller.reset(); }
    await this.controller.refresh(); this.redraw();
  }
}
class OkfView extends ItemView {
  private filters: Filters = { query: '', jurisdiction: '' };
  private unsubscribe?: () => void;
  constructor(leaf: WorkspaceLeaf, private plugin: LawossPlugin, private kind: ViewKind) { super(leaf); }
  getViewType() { return viewId(this.kind); }
  getDisplayText() { return 'LAWOSS · ' + tr(this.plugin.settings.locale, this.kind); }
  getIcon() { return 'scale'; }
  async onOpen() { this.unsubscribe = this.plugin.controller.subscribe(() => this.render()); this.render(); }
  async onClose() { this.unsubscribe?.(); }
  render() {
    // Preserve typing position across background refreshes.
    const active = document.activeElement;
    const focused = active instanceof HTMLInputElement && this.contentEl.contains(active);
    const selection = focused ? active.selectionStart : null;
    renderView(this.contentEl, this.kind, { read: this.plugin.controller.state, locale: this.plugin.settings.locale, selected: this.plugin.selected, preview: this.plugin.preview }, {
      navigate: kind => { void this.plugin.navigate(kind); },
      select: path => { this.plugin.selected = path; void this.plugin.navigate('matter'); },
      previewClient: path => { void this.plugin.showClient(path); },
      preview: path => { void this.plugin.showPreview(path); },
      open: path => { void this.plugin.openSource(path); },
      follow: (link, from) => this.plugin.follow(link, from),
      close: () => { this.plugin.preview = undefined; this.plugin.redraw(); },
      refresh: () => { void this.plugin.controller.refresh(); },
    }, this.filters);
    if (focused) { const search = this.contentEl.querySelector('input'); search?.focus(); if (selection !== null) search?.setSelectionRange(selection, selection); }
  }
}
class OkfSettings extends PluginSettingTab {
  constructor(private plugin: LawossPlugin) { super(plugin.app, plugin); }
  display() {
    this.containerEl.replaceChildren(); const locale = this.plugin.settings.locale;
    let roots = this.plugin.settings.roots.map(r => r || '.').join('\n'); let selectedLocale = locale;
    new Setting(this.containerEl).setName(tr(locale, 'roots')).setDesc(tr(locale, 'rootsDescription')).addTextArea(input => input.setValue(roots).onChange(value => { roots = value; }));
    new Setting(this.containerEl).setName(tr(locale, 'language')).addDropdown(dropdown => dropdown.addOption('cs', 'Čeština').addOption('sk', 'Slovenčina').setValue(locale).onChange(value => { selectedLocale = value === 'sk' ? 'sk' : 'cs'; }));
    new Setting(this.containerEl).addButton(b => b.setButtonText(tr(locale, 'save')).onClick(async () => {
      try { await this.plugin.saveSettings({ roots: roots.split('\n').map(r => r.trim()).filter(Boolean).map(r => r === '.' ? '' : r), locale: selectedLocale }); this.display(); }
      catch { new Notice(tr(locale, 'badSettings')); }
    }));
  }
}
