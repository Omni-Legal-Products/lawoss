// Spúšťa najviac `limit` úloh naraz, ostatné čakajú v poradí príchodu. Uvoľnené miesto
// prechádza priamo na ďalšiu úlohu; zlyhaná úloha ho vráti rovnako ako úspešná.
// `slotTimeoutMs`: úloha zaseknutá dlhšie (napr. čítanie z odpojeného NAS) miesto vráti a beží ďalej,
// aby nezablokovala ostatné priečinky. Jej výsledok volajúci dostane, až keď skončí.
export function createConcurrencyLimiter(limit: number, slotTimeoutMs = 0) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(work: () => Promise<T>): Promise<T> => {
    if (active < limit) active += 1;
    else await new Promise<void>(resolve => { waiting.push(resolve); });
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      release();
    };
    const timer = slotTimeoutMs > 0 ? setTimeout(releaseOnce, slotTimeoutMs) : null;
    timer?.unref?.();
    try {
      return await work();
    } finally {
      if (timer) clearTimeout(timer);
      releaseOnce();
    }
  };
}
