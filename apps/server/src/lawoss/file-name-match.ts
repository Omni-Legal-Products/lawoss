/**
 * #465: hľadanie súboru podľa názvu. Advokát píše časť názvu bez diakritiky, s medzerou namiesto
 * pomlčky či podčiarkovníka („zmluva najom“ → `Zmluva_o_nájme.docx`, „sken 2026“ → `sken-2026-11-13.txt`).
 * Len pre zhodu názvu súboru; hľadanie v chatoch a zvýraznenie ostávajú pri `matchesSearch`.
 */
const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\s\-_.]+/g, " ");

/** Každé slovo dotazu (po zložení diakritiky a oddeľovačov) je v relatívnej ceste súboru. */
export function fileNameMatches(relativePath: string, query: string): boolean {
  const path = fold(relativePath);
  const terms = fold(query).split(" ").filter(Boolean).slice(0, 12);
  return terms.length > 0 && terms.every((term) => path.includes(term));
}
