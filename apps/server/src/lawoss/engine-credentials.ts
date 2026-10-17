/**
 * LAWOSS: prihlasovacie údaje servera nesmú prejsť do prostredia enginu OpenCode.
 *
 * Jeden engine slúži všetkým spisom a kód v ňom (pluginy, MCP servery, príkazy) si prostredie
 * môže prečítať. Server tieto hodnoty dostáva od desktopu alebo orchestrátora cez prostredie,
 * spawn enginu ho však dedí celé. Engine sa pri serveri preukazuje len kľúčom viazaným na
 * reláciu (`wiki/agent-access.ts`).
 */
export const SERVER_CREDENTIAL_ENV: readonly string[] = [
  "LEGALWORK_TOKEN",
  "LEGALWORK_HOST_TOKEN",
  "LEGALWORK_CONTROL_TOKEN",
  "LEGALWORK_SERVER_TOKEN",
];

export function withoutServerCredentials<T>(env: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SERVER_CREDENTIAL_ENV.includes(name)));
}
