import { buildCockpit, provenance, HORIZON_DAYS, missingScopeLevels, urgencyOf, deadlineText, daysUntil, inHorizon, today, type OkfSnapshot } from '../../okf-reader/src/index.ts';
import type { ReadState } from './refresh.ts';
import type { Locale } from './settings.ts';
import { tr, type TextKey } from './i18n.ts';
export type ViewKind = 'practice' | 'matter' | 'deadlines' | 'office';
export const VIEW_KINDS: readonly ViewKind[] = ['practice', 'matter', 'deadlines', 'office'];
export type Preview = { path: string; text: string };
export type ViewData = { read: ReadState<OkfSnapshot>; locale: Locale; selected: string | null; preview?: Preview };
export type Actions = { navigate(kind: ViewKind): void; select(path: string): void; preview(path: string): void; previewClient(path: string): void; open(path: string): void; follow(link: string, from: string): void; close(): void; refresh(): void };
export type Filters = { query: string; jurisdiction: string };
function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const out = document.createElement(tag);
  if (text !== undefined) out.textContent = text;
  if (cls) out.className = cls;
  parent.append(out);
  return out;
}
function button(parent: HTMLElement, text: string, click: () => void) {
  const out = el(parent, 'button', text); out.type = 'button'; out.onclick = click; return out;
}
/** Render text with DOM APIs only. No HTML, Markdown processors or remote resources. */
export function renderView(host: HTMLElement, kind: ViewKind, state: ViewData, actions: Actions, filters: Filters): void {
  const text = (key: TextKey) => tr(state.locale, key);
  host.replaceChildren(); host.classList.add('lawoss-okf');
  const header = el(host, 'header'); el(header, 'h2', 'LAWOSS · ' + text(kind)); el(header, 'p', text('readonly'), 'lawoss-muted');
  const nav = el(header, 'nav'); nav.setAttribute('aria-label', 'LAWOSS OKF');
  for (const view of VIEW_KINDS) { const b = button(nav, text(view), () => actions.navigate(view)); if (view === kind) b.setAttribute('aria-current', 'page'); }
  button(nav, text('refresh'), actions.refresh);
  if (state.read.loading) el(header, 'p', text('loading'));
  if (state.read.updatedAt !== undefined) el(header, 'p', text('loaded') + ': ' + new Date(state.read.updatedAt).toLocaleString(state.locale), 'lawoss-muted');
  if (state.read.error) el(header, 'p', text('stale') + ': ' + state.read.error, 'lawoss-warning');
  const snapshot = state.read.data;
  if (!snapshot) { if (!state.read.loading) el(host, 'p', text('empty')); return; }
  if (snapshot.truncated) el(host, 'p', text('partial'), 'lawoss-warning');
  if (snapshot.problems.length) {
    const details = el(host, 'details'); el(details, 'summary', `${text('diagnostics')} (${snapshot.problems.length})`);
    for (const p of snapshot.problems) { const row = el(details, 'div', undefined, 'lawoss-row'); el(row, 'p', p.message); button(row, p.path || '.', () => actions.preview(p.path)); }
  }
  const preview = state.preview;
  if (preview) {
    const section = el(host, 'section', undefined, 'lawoss-preview'); section.setAttribute('aria-label', text('source'));
    el(section, 'h3', preview.path); el(section, 'p', text('raw')); el(section, 'pre', preview.text);
    const links = new Set<string>();
    for (const match of preview.text.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]|(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      const link = match[1] ? '[[' + match[1] + ']]' : match[2];
      if (link && links.size < 100) links.add(link);
    }
    for (const link of links) button(section, link, () => actions.follow(link, preview.path));
    el(section, 'p', text('editorNotice'), 'lawoss-warning');
    button(section, text('open'), () => actions.open(preview.path)); button(section, text('close'), actions.close);
  }
  const controls = el(host, 'div', undefined, 'lawoss-controls');
  const input = el(controls, 'input'); input.type = 'search'; input.placeholder = text('search'); input.setAttribute('aria-label', text('search')); input.value = filters.query;
  const select = el(controls, 'select'); select.setAttribute('aria-label', 'Jurisdiction');
  for (const [value, label] of [['', text('all')], ['cz', 'CZ'], ['sk', 'SK']]) { const option = el(select, 'option', label); option.value = value; option.selected = value === filters.jurisdiction; }
  const body = el(host, 'main');
  const source = (parent: HTMLElement, path: string) => button(parent, text('source'), () => actions.preview(path));
  const matches = (value: string) => value.toLocaleLowerCase().normalize('NFC').includes(filters.query.toLocaleLowerCase().normalize('NFC'));
  const jurisdictionMatches = (path: string) => !filters.jurisdiction || buildCockpit(snapshot, path, today())?.jurisdiction === filters.jurisdiction;
  function renderBody() {
    body.replaceChildren();
    const day = today();
    if (kind === 'practice') {
      el(body, 'h3', text('clients'));
      for (const client of snapshot?.clients ?? []) {
        if (!matches((client.title ?? '') + ' ' + client.path)) continue;
        const row = el(body, 'div', undefined, 'lawoss-row'); el(row, 'strong', client.title ?? client.path);
        el(row, 'small', client.path || '.'); button(row, text('source'), () => actions.previewClient(client.path));
      }
      el(body, 'h3', text('matters'));
      for (const matter of snapshot?.matters ?? []) {
        if (!matches(matter.title + ' ' + matter.path + ' ' + (matter.matterRef ?? '')) || !jurisdictionMatches(matter.path)) continue;
        const row = el(body, 'div', undefined, 'lawoss-row'); button(row, matter.title, () => actions.select(matter.path));
        el(row, 'small', [matter.matterRef, matter.court, matter.path].filter(Boolean).join(' · '));
        if (matter.cardPath) source(row, matter.cardPath);
      }
    } else if (kind === 'matter') {
      if (state.selected === null) { el(body, 'p', text('noMatter')); return; }
      const cockpit = buildCockpit(snapshot!, state.selected, day);
      if (!cockpit) { el(body, 'p', text('noMatter')); return; }
      el(body, 'h3', cockpit.matter.title); el(body, 'p', [cockpit.client, cockpit.jurisdiction].filter(Boolean).join(' · '));
      const input = snapshot?.inputs.find(i => i.path === state.selected);
      const missing = missingScopeLevels(input?.scopePaths ?? [cockpit.matter.path]);
      if (missing.length) el(body, 'p', text('missing') + ': ' + missing.map(level => level === 'office' ? text('office') : text('clients')).join(', '), 'lawoss-warning');
      for (const field of cockpit.obal) el(body, 'p', field.label + ': ' + field.value, field.missing ? 'lawoss-muted' : undefined);
      const manual = input?.manualStatus;
      if (manual) { el(body, 'h4', text('manual')); el(body, 'p', text(manual.state === 'stale' ? 'outdated' : manual.state === 'dated' ? 'dated' : 'unknown') + (manual.updated ? ': ' + manual.updated : '')); el(body, 'pre', manual.content); source(body, state.selected + '/_STATUS.md'); }
      el(body, 'h4', text('parties'));
      for (const p of cockpit.parties) if (matches(p.name)) { const row = el(body, 'div', p.name + ' · ' + (p.role ?? ''), 'lawoss-row'); source(row, p.file); }
      el(body, 'h4', text('tasks'));
      for (const task of cockpit.tasks) if (matches(task.title)) { const row = el(body, 'div', task.title + (task.due ? ' · ' + task.due : ''), 'lawoss-row'); source(row, task.file); }
      el(body, 'h4', text('records'));
      for (const record of input?.records ?? []) if (matches(record.title + ' ' + record.type)) { const row = el(body, 'div', `${record.title} · ${record.type} · ${provenance(record)}`, 'lawoss-row'); const path = input?.recordFiles?.[record.id]; if (path) source(row, path); }
      el(body, 'h4', text('events'));
      for (const event of cockpit.events) if (matches(event.text)) { const row = el(body, 'div', event.date + ' · ' + event.text, 'lawoss-row'); source(row, event.file); }
    } else if (kind === 'deadlines') {
      el(body, 'p', text('horizon').replace('{n}', String(HORIZON_DAYS)), 'lawoss-muted');
      const all = (snapshot?.matters ?? []).flatMap(m => {
        const cockpit = buildCockpit(snapshot!, m.path, day);
        return cockpit ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].map(d => ({ ...d, matter: m })) : [];
      }).sort((a, b) => a.date.localeCompare(b.date));
      for (const confirmed of [true, false]) {
        el(body, 'h3', text(confirmed ? 'confirmed' : 'candidates'));
        const seen = new Set<string>();
        for (const d of all) {
          const key = d.file + '\u0000' + d.date + '\u0000' + (d.label ?? '');
          if (d.confirmed !== confirmed || seen.has(key) || !inHorizon(d.date, day, d.invalid) || !matches(d.title + ' ' + d.matter.title + ' ' + (d.label ?? '')) || !jurisdictionMatches(d.matter.path)) continue;
          seen.add(key);
          const row = el(body, 'div', undefined, 'lawoss-row lawoss-' + urgencyOf(d.date, day, d.invalid));
          const days = daysUntil(day, d.date);
          const due = d.invalid ? text('invalid') : text(days < 0 ? 'overdue' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'days').replace('{n}', String(days));
          el(row, 'strong', d.date + ' · ' + due); el(row, 'p', deadlineText(d)); button(row, d.matter.title, () => actions.select(d.matter.path)); source(row, d.file);
        }
      }
    } else {
      for (const scope of snapshot?.scopes ?? []) {
        if (scope.level !== 'office') continue;
        el(body, 'h3', scope.path);
        for (const record of scope.records) {
          if (!matches(record.title + ' ' + record.type) || (filters.jurisdiction && record.jurisdiction !== filters.jurisdiction)) continue;
          const row = el(body, 'div', undefined, 'lawoss-row'); el(row, 'strong', record.title); el(row, 'p', record.layer + ' · ' + record.type);
          const path = scope.recordFiles[record.id]; if (path) source(row, path);
        }
      }
    }
    if (!body.childElementCount) el(body, 'p', text('empty'));
  }
  input.oninput = () => { filters.query = input.value; renderBody(); };
  select.onchange = () => { filters.jurisdiction = select.value; renderBody(); };
  renderBody();
}
