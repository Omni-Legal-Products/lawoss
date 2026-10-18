/** Browser-safe read-only entry. Do not export okf-pamat's write-capable barrel. */
import { buildOverview } from '../../okf/read.ts';
import { readOkfRoot, MAX_MATTERS, type OkfReadSource, type OkfReadResult, type OkfScopeRecords } from './reader.ts';
import { today } from './time.ts';
export { readOkfRoot, MAX_MATTERS, MAX_DISCOVERY_DIRECTORIES, CLIENT_CARDS } from './reader.ts';
export type { OkfReadSource, OkfReadResult, OkfEntry, OkfScopeRecords, ReadProblem, OkfClient } from './reader.ts';
export * from './time.ts';
export * from './view-rules.ts';
export { buildCockpit, provenance } from '../../okf/cockpit.ts';
export type { Cockpit, CockpitDeadline } from '../../okf/cockpit.ts';
export type { OkfRecord } from '../../okf-pamat/src/record.ts';
export { missingScopeLevels } from '../../okf/read.ts';
export { decodeText } from '../../okf-pamat/src/text-decode.ts';
export type OkfSnapshot = OkfReadResult & { scopes: OkfScopeRecords[]; roots: readonly string[] };
export function validRoot(root: string): boolean {
  return root === '' || (!/[\\:\u0000-\u001f]/.test(root) && root.split('/').every(p => p.length > 0 && !p.startsWith('.')));
}
export async function readOkfSnapshot(source: OkfReadSource, roots: readonly string[], todayIso = today()): Promise<OkfSnapshot> {
  if (roots.some(root => !validRoot(root))) throw new Error('Invalid OKF root');
  const selected = [...new Set(roots)].sort().filter(root => !roots.some(other => other !== root && (other === '' || root.startsWith(other + '/'))));
  const parts: OkfReadResult[] = [];
  for (const root of selected) parts.push(await readOkfRoot(source, todayIso, root, true));
  const allInputs = [...new Map(parts.flatMap(p => p.inputs).map(i => [i.path, i])).values()];
  const inputs = allInputs.slice(0, MAX_MATTERS);
  return {
    ...buildOverview(inputs, todayIso), inputs,
    roots: selected,
    clients: [...new Map(parts.flatMap(p => p.clients ?? []).map(c => [c.path, c])).values()],
    scopes: [...new Map(parts.flatMap(p => p.scopes ?? []).map(s => [s.path, s])).values()].sort((a, b) => a.path.localeCompare(b.path)),
    problems: parts.flatMap(p => p.problems).sort((a, b) => a.path.localeCompare(b.path) || a.message.localeCompare(b.message)),
    truncated: parts.some(p => p.truncated) || allInputs.length > MAX_MATTERS,
  };
}
