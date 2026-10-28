import { useState } from "react";

/**
 * N-A7-16: mená súborov, ktoré ukazuje dialóg „Zahodiť neuložené zmeny?“.
 *
 * Po potvrdení alebo zrušení sa výzva hneď vymaže (`discardPrompt = null`), ale dialóg ešte chvíľu
 * dobieha zatváraciu animáciu. Bez zapamätaných mien sa počas nej vykreslil text „Zahodiť zmeny
 * v súbore ? …“ a advokát to videl ako druhý dialóg bez mena. Kým je výzva otvorená, vracia jej
 * mená; po jej skončení mená poslednej výzvy, takže zatvárajúci sa dialóg ostane rovnaký.
 */
export function useShownDiscardNames(prompt: { names: string[] } | null): string {
  const [shown, setShown] = useState<string[]>(() => prompt?.names ?? []);
  if (prompt && prompt.names !== shown) setShown(prompt.names);
  return (prompt?.names ?? shown).join(", ");
}
