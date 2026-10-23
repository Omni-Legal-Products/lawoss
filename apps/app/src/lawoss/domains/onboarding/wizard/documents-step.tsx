/** @jsxImportSource react */
/**
 * Krok 2 „Vaše dokumenty“ (C1): dve veľké voľby s ikonou a malým príkladom výsledku. Oznámenie o pomocných
 * súboroch ostáva pri voľbe „Začať nanovo“ (R3); pri pripojení ho ukáže krok „Toto sme našli“ pred zápisom.
 */
import { useId, type ReactNode } from "react";
import { FileText, FolderOpen, FolderPlus, Landmark, UserRound, Briefcase } from "lucide-react";
import { AlphaNoticeInline } from "../../../alpha/alpha-notice";
import { OkfNotice } from "../okf-notice";
import type { FoundTextKey } from "../found-text";
import { FolderConnectIllustration, FolderFreshIllustration } from "./illustrations";
import { StepScreen } from "./wizard-frame";
import type { WizardText } from "./wizard-text";

type FoundText = (key: FoundTextKey, params?: Record<string, string | number>) => string;

type ExampleRow = { depth: number; icon: ReactNode; label: string };

/** Malý príklad výsledku: odsadený strom s ikonami a textom (nie len obrázok). */
function Example({ text, rows }: { text: WizardText; rows: readonly ExampleRow[] }) {
  return (
    <figure className="lw-wiz-example">
      <figcaption>{text("docsExample")}</figcaption>
      <ul>
        {rows.map((row) => (
          <li key={`${row.depth}-${row.label}`} style={{ paddingInlineStart: `${row.depth * 14}px` }}>
            <span aria-hidden="true">{row.icon}</span>
            {row.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}

export function DocumentsChoiceView({ text, found, busy, nav, resume, onConnect, onFresh }: {
  text: WizardText;
  found: FoundText;
  busy: boolean;
  nav?: ReactNode;
  /** Naposledy vybraný priečinok (návrat Späť alebo obnova): pokračovať bez nového výberu. */
  resume?: { name: string; onContinue: () => void };
  onConnect: () => void;
  onFresh: () => void;
}) {
  const connectId = useId(), freshId = useId();
  return (
    <StepScreen step="folder" title={text("docsTitle")} lead={<p>{text("docsLead")}</p>} nav={nav}>
      {/* Alfa: pri voľbe priečinka musí byť vidieť, na čom sa skúša; tu bez možnosti skryť. */}
      <AlphaNoticeInline />
      {resume ? (
        <div className="lw-wiz-resume">
          <FolderOpen className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 break-words">{text("docsResume", { name: resume.name })}</span>
          <button type="button" className="lw-btn gold" disabled={busy} onClick={resume.onContinue}>{text("docsResumeAction")}</button>
        </div>
      ) : null}
      <div className="lw-onb-choices">
        <section className="lw-onb-choice lw-wiz-choice" aria-labelledby={connectId}>
          <FolderConnectIllustration />
          <h3 id={connectId}><FolderOpen className="size-5" aria-hidden /> {text("docsConnect")}</h3>
          <p>{text("docsConnectHint")}</p>
          <Example text={text} rows={[
            { depth: 0, icon: <UserRound className="size-3.5" />, label: text("exampleClient") },
            { depth: 1, icon: <Briefcase className="size-3.5" />, label: text("exampleCase") },
            { depth: 2, icon: <FileText className="size-3.5" />, label: text("exampleDocs") },
          ]} />
          <button type="button" className={resume ? "lw-btn" : "lw-btn gold"} disabled={busy} onClick={onConnect}>{text("docsPick")}</button>
        </section>
        <section className="lw-onb-choice lw-wiz-choice" aria-labelledby={freshId}>
          <FolderFreshIllustration />
          <h3 id={freshId}><FolderPlus className="size-5" aria-hidden /> {text("docsFresh")}</h3>
          <p>{text("docsFreshHint")}</p>
          <Example text={text} rows={[
            { depth: 0, icon: <Landmark className="size-3.5" />, label: text("exampleOffice") },
            { depth: 0, icon: <UserRound className="size-3.5" />, label: text("exampleClients") },
          ]} />
          {/* R3: nový priečinok dostane pomocné súbory, oznámenie musí byť pri voľbe viditeľné. */}
          <OkfNotice text={found} />
          <button type="button" className="lw-btn" disabled={busy} onClick={onFresh}>{text("docsPickEmpty")}</button>
          <p className="text-xs text-muted-foreground">{found("acknowledge")}</p>
        </section>
      </div>
    </StepScreen>
  );
}
