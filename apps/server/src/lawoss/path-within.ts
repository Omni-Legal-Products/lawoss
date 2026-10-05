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

/** Najkonkrétnejší (najdlhší) priečinok zo zoznamu, v ktorom `candidate` leží. */
export function deepestContaining<T extends { path: string }>(items: readonly T[], candidate: string, api: PathApi = path): T | undefined {
  return [...items]
    .sort((left, right) => right.path.length - left.path.length)
    .find((item) => isPathWithin(item.path, candidate, api));
}
