export type IntakeCase = { title: string; source: string; phase?: string; next_step?: string };
export type IntakeFile = { path: string; state: "indexed" | "partial" | "unreadable" | "unsupported"; hash?: string; excerpt?: string };
export type FolderIntake = {
  run: string;
  state: "scanning" | "ready" | "failed";
  files: number;
  folders: number;
  indexed: number;
  partial: number;
  skipped: number;
  issues: string[];
  sources: IntakeFile[];
  cases: IntakeCase[];
  suggestions: IntakeCase[];
  registered: number;
  outside: boolean;
};
