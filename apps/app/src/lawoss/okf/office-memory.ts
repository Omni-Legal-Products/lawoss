/** Odpoveď hostiteľa `GET /lawoss/onboarding/office-memory` (`apps/server/src/lawoss/office-memory.ts`). */
export type OfficeMemoryRead = {
  practiceRoot: string;
  /** Priečinok kancelárie voči koreňu praxe; `null`, keď prax kanceláriu nemá. */
  directory: string | null;
  /** Cesty voči koreňu praxe (`Office/memory/…`). */
  files: { path: string; content: string }[];
  problems: { path: string; message: string }[];
  truncated: boolean;
};
