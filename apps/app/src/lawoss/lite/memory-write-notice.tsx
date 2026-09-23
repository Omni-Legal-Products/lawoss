/** @jsxImportSource react */
import { t } from "@/i18n";
import type { MemoryWriteProposal } from "./memory-write";

/**
 * Srozumitelná karta nad povolovacím panelem/modalem, když asistent navrhuje
 * `okf-memory write …`. Jen informuje — tlačítka schválit/zamítnout patří
 * beze změny existujícímu panelu (viz `describeMemoryWrite`).
 */
export function MemoryWriteNotice({ proposal }: { proposal: MemoryWriteProposal }) {
  return (
    <div
      role="note"
      data-lawoss-lite="memory-write"
      className="mb-3 rounded-[20px] border border-dls-border bg-dls-hover/45 p-4 text-[13px] leading-5 text-dls-text"
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-dls-secondary">
        {t("lawoss.lite.memory_write_title")}
      </div>
      {proposal.file ? (
        <div className="mt-2">
          <span className="font-medium">{t("lawoss.lite.memory_write_record")}:</span> {proposal.file}
        </div>
      ) : null}
      {proposal.reason ? (
        <div className="mt-1">
          <span className="font-medium">{t("lawoss.lite.memory_write_reason")}:</span> {proposal.reason}
        </div>
      ) : null}
      <div className="mt-2">
        {proposal.apply ? t("lawoss.lite.memory_write_apply") : t("lawoss.lite.memory_write_preview")}
      </div>
      <div className="mt-1 text-dls-secondary">{t("lawoss.lite.memory_write_note")}</div>
    </div>
  );
}
