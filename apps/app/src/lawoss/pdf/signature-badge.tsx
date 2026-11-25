import { useEffect, useRef, useState } from "react";
import { ChevronDown, Clock3, Fingerprint, Info, ScanLine } from "lucide-react";
import { currentLocale, t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { inspectPdfSignatures, type PdfSignatureReport } from "./inspect-signatures";

const label = (key: string, count?: number) => t(`lawoss.pdf_signatures.${key}`, count === undefined ? undefined : { count });

const formats: Readonly<Record<string, string>> = {
  "ETSI.CAdES.detached": "CAdES",
  "adbe.pkcs7.detached": "CMS / PKCS #7",
  "adbe.pkcs7.sha1": "CMS / PKCS #7 (SHA-1)",
  "adbe.x509.rsa_sha1": "X.509 (RSA / SHA-1)",
  "ETSI.RFC3161": "RFC 3161",
};

function displayTime(value: string) {
  if (!value.includes("T")) return value; // Preserve partial dates without inventing a day or time.
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const date = new Date(zoned ? value : value + "Z");
  if (!Number.isFinite(date.getTime())) return value;
  const formatted = new Intl.DateTimeFormat(currentLocale(), {
    year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
    ...(zoned ? { timeZoneName: "short" } : { timeZone: "UTC" }),
  }).format(date);
  return zoned ? formatted : `${formatted} (${label("no_timezone")})`;
}

export function PdfSignatureBadge({ bytes, visible }: { bytes: ArrayBuffer; visible: boolean }) {
  const [result, setResult] = useState<{ bytes: ArrayBuffer; report: PdfSignatureReport } | null>(null);
  useEffect(() => {
    if (!visible || result?.bytes === bytes) return;
    const owner = new AbortController();
    const publish = (report: PdfSignatureReport) => {
      if (!owner.signal.aborted) setResult({ bytes, report });
    };
    void inspectPdfSignatures(new Uint8Array(bytes), owner.signal).then(publish, () => {
      publish({ status: "unavailable", emptyFields: 0, signatures: [] });
    });
    return () => owner.abort();
  }, [bytes, visible, result]);
  return <PdfSignatureDetails report={result?.bytes === bytes ? result.report : null} />;
}

export function PdfSignatureDetails({ report }: { report: PdfSignatureReport | null }) {
  useLocale();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current?.open && event.target instanceof Node && !details.current.contains(event.target)) details.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.current?.open) return;
      details.current.open = false;
      details.current.querySelector("summary")?.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  if (!report) return <div role="status" className="lawoss-pdf-quiet"><ScanLine/>{label("loading")}</div>;
  const timestamps = report.signatures.filter(item => item.kind === "timestamp").length;
  const signed = report.signatures.length - timestamps;
  const counts = [signed && label("signatures", signed), timestamps && label("timestamps", timestamps)].filter(Boolean);
  const title = counts.length ? counts.join(" · ") : label(report.status === "inspected" ? "none" : "unknown");
  const BadgeIcon = timestamps && !signed ? Clock3 : Fingerprint;
  if (report.status === "inspected" && !counts.length && !report.emptyFields) {
    return <div role="status" className="lawoss-pdf-quiet"><ScanLine aria-hidden="true"/>{title}</div>;
  }
  const firstSigner = report.signatures.find(item => item.kind === "signature" && item.signer)?.signer;
  return <details ref={details} className="lawoss-pdf-signatures">
    <summary>
      <span className="lawoss-pdf-seal"><BadgeIcon aria-hidden="true"/></span>
      <span className="lawoss-pdf-summary"><strong>{title}</strong>
        <small>{[counts.length ? label("unverified") : undefined, report.status === "partial" ? label("partial") : undefined, firstSigner].filter(Boolean).join(" · ")}</small>
      </span>
      <ChevronDown className="lawoss-pdf-caret" aria-hidden="true"/>
    </summary>
    <div className="lawoss-pdf-records">
      {report.status !== "inspected" && <p>{label(report.issue ?? "incomplete")}</p>}
      {!!counts.length && <ol>
        {report.signatures.map((item, index) => {
          const Icon = item.kind === "timestamp" ? Clock3 : Fingerprint;
          const format = item.subFilter && (Object.hasOwn(formats, item.subFilter) ? formats[item.subFilter] : item.subFilter);
          const fields = [
            ["format", format, item.subFilter],
            ["issuer", item.issuer],
            ["time", item.signedAt && displayTime(item.signedAt), item.signedAt],
            ["field", item.fieldName],
          ] as const;
          return <li key={index}>
            <div className="lawoss-pdf-record-heading"><Icon aria-hidden="true"/>
              <div><small>{label(item.kind)} · {index + 1}</small>
                <strong dir="auto">{item.signer || format || item.fieldName || label(item.kind)}</strong></div>
            </div>
            <dl>
              {fields.map(([key, value, original]) => value ? <div key={key} className="contents">
                <dt className="text-muted-foreground">{label(key)}</dt>
                <dd title={original} dir="auto" className="[overflow-wrap:anywhere]">{value}</dd>
              </div> : null)}
            </dl>
          </li>;
        })}
      </ol>}
      {!!report.emptyFields && <p className="lawoss-pdf-empty-fields">{label("empty", report.emptyFields)}</p>}
      {!!counts.length && <p className="lawoss-pdf-trust"><Info aria-hidden="true"/>{label("trust_note")}</p>}
    </div>
  </details>;
}
