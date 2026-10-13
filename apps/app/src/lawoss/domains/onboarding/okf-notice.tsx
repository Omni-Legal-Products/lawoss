/** Oznámenie OKF so zoznamom súborov (R3); spoločné pre „Toto som našiel“, „Začať nanovo“ a formulár klienta. */
import type { FoundTextKey } from "./found-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

export const OKF_FILES = ["AGENTS.md", "CLAUDE.md", "client.md", "memory/", "_STATUS.md"];

/** Musí byť viditeľné pri každej odpovedi, ktorá oznámenie berie na vedomie. */
export function OkfNotice({ text }: { text: Text }) {
  return (
    <>
      <p className="text-muted-foreground">{text("okfNotice")}</p>
      <p className="text-sm"><strong>{text("filesTitle")}:</strong> {OKF_FILES.join(", ")}</p>
    </>
  );
}
