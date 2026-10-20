/**
 * LAWOSS: zlyhaný štart desktop runtime sa nesmie zapamätať navždy.
 *
 * `describeRuntimeBootFailure` vracia `{ ok: false }` a nevyhodí výnimku.
 * Pôvodný `runtimeBootstrapPromise` preto ostal visieť aj po timeoute enginu
 * a ďalšie volanie IPC `runtimeBootstrap` — vrátane reloadu okna — vrátilo
 * tú istú chybu (lawoss#185). Úspešný výsledok aj práve bežiaci pokus ostávajú
 * jeden zdieľaný promise.
 *
 * @param {() => Promise<{ ok?: boolean } | null | undefined>} start
 */
export function createRuntimeBootstrapGate(start) {
  let pending = null;
  return function ensure() {
    if (!pending) {
      const attempt = Promise.resolve().then(() => start());
      pending = attempt.then(
        (result) => {
          if (result?.ok === false) pending = null;
          return result;
        },
        (error) => {
          pending = null;
          throw error;
        },
      );
    }
    return pending;
  };
}
