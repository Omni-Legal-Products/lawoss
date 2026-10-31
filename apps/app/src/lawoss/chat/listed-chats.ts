/**
 * LAWOSS: zoznam chatov klienta neukazuje chaty subagentov (N-A8-4, regresia 30. 10. 2026).
 *
 * Engine 1.18.29 zakladá podriadený chat s `parentID` len pre subagenta (nástroj `task`, názov
 * „… (@general subagent)“). „Rozvetviť do nového chatu“ (`session.fork`) zakladá samostatný chat bez
 * `parentID` s názvom „… (fork #1)“. Upstream stránka „Chaty“ preto značí ako „Vetva“ práve subagentov.
 * Advokát ich otvorí z riadku subagenta v rodičovskom chate; v zozname chatov ostanú len chaty,
 * ktoré viedol on, vrátane rozvetvených. Rovnako to robí upstream bočný panel (`sidebarSessionGroups`).
 */
export const isListedClientChat = (session: { parentID?: string | null }): boolean => !session.parentID?.trim();
