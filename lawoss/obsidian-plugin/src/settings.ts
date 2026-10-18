import { validRoot } from '../../okf-reader/src/index.ts';
export type Locale = 'cs' | 'sk';
export type Settings = { roots: string[]; locale: Locale };
export function parseSettings(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return { roots: [''], locale: 'cs' };
  const roots = 'roots' in value ? value.roots : [''];
  if (!Array.isArray(roots) || !roots.every((r): r is string => typeof r === 'string' && validRoot(r)) || roots.length === 0 || roots.length > 20) throw new Error('Invalid OKF roots (max 20).');
  return { roots: [...new Set(roots)], locale: 'locale' in value && value.locale === 'sk' ? 'sk' : 'cs' };
}
