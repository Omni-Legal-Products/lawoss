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

/**
 * Read-only case memory (opencode-plugins/lawoss-memory-tools.ts, MČ 23. 10. 2026: reading needs no card).
 * The engine file allows it before the lawyer's and firm's rules, which follow and keep precedence.
 */
export const LAWOSS_MEMORY_TOOL = "lawoss_memory";

/** The permission `lawoss_files` asks with (opencode-plugins/lawoss-file-operations.ts). */
export const FILE_CHANGE_PERMISSION = "lawoss_file_change";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The rule for `lawoss_files`, derived from the edit rule in effect: a forbidden edit (also through
 * a later `*` denial) stays forbidden and the lawyer's denied patterns follow; otherwise every change
 * asks, or (YOLO, chat agent only) is allowed. Its own key, so an engine "always" granted on a native
 * edit card (`edit` + `*`, kept for every chat of the client) never covers moves and Trash.
 * An explicit `edit: allow` does not silence these cards: moving and deleting stay human-gated outside YOLO.
 */
export function fileChangeRule(permission: Record<string, unknown>, yolo: boolean): unknown {
  let edit: unknown = "allow";
  for (const [name, rule] of Object.entries(permission)) if (name === "*" || name === "edit") edit = rule;
  if (edit === "deny" || (isRecord(edit) && edit["*"] === "deny")) return "deny";
  const denied = isRecord(edit) ? Object.entries(edit).filter(([pattern, action]) => pattern !== "*" && action === "deny") : [];
  const base = yolo ? "allow" : "ask";
  return denied.length ? { "*": base, ...Object.fromEntries(denied) } : base;
}

/** An agent's own map with the file-change rule last, so a copied `*` cannot silence `lawoss_files`. */
export function withFileChangeRule(agent: string | Record<string, unknown>, permission: Record<string, unknown>): Record<string, unknown> {
  return { ...(typeof agent === "string" ? { "*": agent } : agent), [FILE_CHANGE_PERMISSION]: fileChangeRule(permission, false) };
}
