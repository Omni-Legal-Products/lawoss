import type { OkfReadSource } from '../src/index.ts';
export const record = (id: string, type: string, layer: string, extra = '') => `---\nokf: 1\nid: ${id}\ntype: ${type}\ntitle: ${id}\ndescription: synthetic\nlayer: ${layer}\njurisdiction: cz\nstatus: active\ncreated: 2026-10-18\nupdated: 2026-10-18\n${extra}---\n\n## Truth\n\nSynthetic truth.\n\n## History\n\n- 2026-10-18 [request] — synthetic\n`;
export function memoryFiles(): Record<string, string> {
  return {
    'Clients/Test/client.md': '---\ntitle: Test client\n---\n',
    'Clients/Test/Spisy/A/matter.md': '---\ntitle: Test matter\nmatter_kind: advisory\n---\n',
    'Clients/Test/Spisy/A/memory/T-001.md': record('T-001', 'task', 'L2', 'deadlines: [2026-10-19]\n'),
    'Clients/Test/memory/Q-001.md': record('Q-001', 'question', 'L2'),
    'Clients/Test/Spisy/A/_STATUS.md': '## Fáza\nRučný stav.\n',
    'Office/memory/L-001.md': record('L-001', 'rule', 'L1'),
    'Office/okf.config': 'client_path: Clients/*\n',
  };
}
export function source(files: Record<string, string>, reads: string[] = []): OkfReadSource {
  return {
    list: async (path) => {
      reads.push(`list:${path}`);
      const prefix = path ? path + '/' : '';
      const entries = new Map<string, 'file' | 'dir'>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) entries.set(name, rest.includes('/') ? 'dir' : 'file');
      }
      return { entries: [...entries].map(([name, kind]) => ({ name, kind, path: prefix + name })), truncated: false };
    },
    readText: async (path) => {
      reads.push(`read:${path}`);
      const text = files[path];
      if (text === undefined) throw Error('404');
      return text;
    },
  };
}
