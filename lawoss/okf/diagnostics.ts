/** Portable diagnostics: machine identity and original detail stay independent of UI language. */
export type DiagnosticParams = Record<string, string | number>;
export type DiagnosticFields = { code?: string; params?: DiagnosticParams };
export class OkfDiagnostic extends Error {
  constructor(readonly code: string, readonly params: DiagnosticParams, message: string) {
    super(message);
    this.name = "OkfDiagnostic";
  }
}
export function diagnosticFields(error: unknown): DiagnosticFields {
  if (!(error instanceof OkfDiagnostic)) return {};
  return { code: error.code, params: error.params };
}
