/** Oznámenie OKF so zoznamom súborov (R3); spoločné pre „Toto som našiel“, „Začať nanovo“ a formulár klienta. */
import type { FoundTextKey } from "./found-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

export const OKF_FILES = ["AGENTS.md", "CLAUDE.md", "client.md", "memory/", "_STATUS.md"];

/** Veta oznámenia musí byť viditeľná pri každej odpovedi, ktorá ho berie na vedomie; zoznam súborov je zbalený. */
export function OkfNotice({ text }: { text: Text }) {
  return (
    <>
      <p className="text-muted-foreground">{text("okfNotice")}</p>
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{text("filesTitle")}</summary>
        <p className="mt-1">{OKF_FILES.join(", ")}</p>
      </details>
    </>
  );
}
