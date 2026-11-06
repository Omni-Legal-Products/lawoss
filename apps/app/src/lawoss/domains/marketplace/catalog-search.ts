import type { MarketplaceEntry } from "./catalog";

/** Bez diakritiky a veľkosti písmen: „upadc“ aj „úpadc“ nájdu Register úpadcov. */
const folded = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** N12: hľadanie v „Všetky balíky“. Každé slovo dopytu musí byť v názve alebo popise. */
export function filterCatalogEntries<T extends Pick<MarketplaceEntry, "name" | "description">>(entries: readonly T[], query: string): readonly T[] {
  const terms = folded(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  return entries.filter((entry) => {
    const haystack = folded(`${entry.name} ${entry.description}`);
    return terms.every((term) => haystack.includes(term));
  });
}
