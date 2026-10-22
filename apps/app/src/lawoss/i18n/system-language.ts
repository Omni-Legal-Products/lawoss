/**
 * Systémový jazyk pre produkt SK/CZ (N-2, akceptácia 22. 10. 2026; R1 bod 5): slovenčina alebo čeština
 * kdekoľvek v zozname jazykov systému má prednosť pred jazykom na prvom mieste (Mac s „en-US, sk-SK“ je
 * slovenský), inak prvý podporovaný jazyk, a bez podporovaného jazyka slovenčina. Mení sa len význam voľby
 * „Systém“; jazyk kancelárie a výslovná voľba advokáta majú naďalej prednosť (poradie z #201).
 */
const LOCAL = new Set(["sk", "cs"]);

export function preferredSystemLanguage<L extends string>(supported: readonly L[], fallback: L): L {
  return supported.find(language => LOCAL.has(language)) ?? supported[0] ?? fallback;
}
