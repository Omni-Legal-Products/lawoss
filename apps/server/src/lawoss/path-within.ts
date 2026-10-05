import path from "node:path";

type PathApi = Pick<typeof path, "isAbsolute" | "relative" | "resolve" | "sep">;

/**
 * Leží `candidate` v priečinku `root` (alebo je to `root`)?
 *
 * Windows: cesty majú `\`, takže porovnanie s `${root}/` nesedí nikdy, a
 * `relative()` medzi dvoma diskami (`C:\` a `G:\` či `\\server\share`) vráti
 * absolútnu cestu bez `..`. Preto `relative()` + `isAbsolute()`; `win32.relative`
 * porovnáva bez ohľadu na veľkosť písmen. `api` je len pre testy s `path.win32`.
 */
export function isPathWithin(root: string, candidate: string, api: PathApi = path): boolean {
  const rel = api.relative(api.resolve(root), api.resolve(candidate));
  return rel === "" || (!api.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${api.sep}`));
}

/**
 * `child` vyriešený voči `root`, ak leží vnútri a nie je to `root` sám; inak `null`.
 * Nahrádza `resolve(root, child)` + prefix `root + sep`, ktorý pri koreni disku
 * (`D:\`) alebo zdieľania (`\\nas\share\`) odmietal všetko, lebo koreň už lomkou končí.
 * Koreň zapísaný inou veľkosťou písmen (`c:/klienti/novak`) ostáva odmietnutý ako
 * predtým — súborové operácie by ho inak brali ako súbor vo vnútri.
 */
export function childPathWithin(root: string, child: string, api: PathApi = path): string | null {
  const resolvedRoot = api.resolve(root);
  const candidate = api.resolve(resolvedRoot, child);
  return api.relative(resolvedRoot, candidate) !== "" && isPathWithin(resolvedRoot, candidate, api) ? candidate : null;
}

/** Najkonkrétnejší (najdlhší) priečinok zo zoznamu, v ktorom `candidate` leží. */
export function deepestContaining<T extends { path: string }>(items: readonly T[], candidate: string, api: PathApi = path): T | undefined {
  return [...items]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => isPathWithin(item.path, candidate, api));
}
