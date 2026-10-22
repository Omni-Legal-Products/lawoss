/**
 * LAWOSS: zmeny súborov a príkazy mimo YOLO len so súhlasom (MČ 22. 10. 2026, alfa 2, N-13).
 *
 * Engine 1.18.29 má pre nenastavené `edit` a `bash` predvolené „allow“, takže čistý profil
 * premenoval súbor bez karty. Kľúč, ktorý advokát nenastavil, sa preto pýta. Vlastné pravidlo
 * advokáta (aj vedomé „allow“ z vypnutého prepínača) a pravidlá firmy majú prednosť; YOLO
 * (`yolo-mode.ts`) z „ask“ robí „allow“ len pre chatového agenta.
 *
 * Jeden bod pravdy: `readGlobalToolPermissions` ho používa pre súbor enginu, managed shell,
 * prepínače v Nastaveniach aj kontrolu firmy, takže sa nerozídu.
 */
export const LAWOSS_TOOL_DEFAULTS = { edit: "ask", bash: "ask" } as const;

/**
 * Predvolené kľúče idú prvé: neskoršie pravidlo vyhráva, takže vlastný kľúč aj vlastný `*` ich prepíšu.
 * Nástroj, pre ktorý má pravidlo firma (`tools.permissions`), predvolenie nedostane: rozhoduje firma
 * presne ako doteraz (upstream `org-policy-engine.ts`), predvolenie nie je voľba člena.
 */
export function withLawossToolDefaults(own: Record<string, unknown>, firmTools: readonly string[] = []): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [tool, action] of Object.entries(LAWOSS_TOOL_DEFAULTS)) if (!Object.hasOwn(own, tool) && !firmTools.includes(tool)) defaults[tool] = action;
  return { ...defaults, ...own };
}
