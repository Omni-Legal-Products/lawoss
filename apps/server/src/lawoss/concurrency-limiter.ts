// Spúšťa najviac `limit` úloh naraz, ostatné čakajú v poradí príchodu. Uvoľnené miesto
// prechádza priamo na ďalšiu úlohu; zlyhaná úloha ho vráti rovnako ako úspešná.
export function createConcurrencyLimiter(limit: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active < limit) active += 1;
    else await new Promise<void>(resolve => { waiting.push(resolve); });
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
