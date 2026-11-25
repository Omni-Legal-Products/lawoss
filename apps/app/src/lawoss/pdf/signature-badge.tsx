import { useEffect, useState } from "react";
import { ChevronDown, Clock3, FileSignature } from "lucide-react";
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
  const base = "shrink-0 border-b border-border bg-muted/30 px-3 py-2 text-xs";
  if (!report) return <div role="status" className={`${base} text-muted-foreground`}>{label("loading")}</div>;
  const timestamps = report.signatures.filter(item => item.kind === "timestamp").length;
  const signed = report.signatures.length - timestamps;
  const counts = [signed && label("signatures", signed), timestamps && label("timestamps", timestamps)].filter(Boolean);
  const title = counts.length ? counts.join(" · ") : label(report.status === "inspected" ? "none" : "unknown");
  const BadgeIcon = timestamps && !signed ? Clock3 : FileSignature;
  if (report.status === "inspected" && !counts.length && !report.emptyFields) {
    return <div role="status" className={`${base} text-muted-foreground`}>{title}</div>;
  }
  return <details className={`${base} group max-h-[45%] overflow-auto`}>
    <summary className="flex w-fit max-w-full cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-sm focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 font-medium">
        <BadgeIcon aria-hidden="true" className="size-3.5 shrink-0" />{title}
      </span>
      {!!counts.length && <span className="text-muted-foreground">{label("unverified")}</span>}
      {!!counts.length && report.status === "partial" && <span>{label("partial")}</span>}
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 transition-transform group-open:rotate-180" />
    </summary>
    <div className="mt-2 space-y-2 break-words pb-1">
      {!!counts.length && <p>{label("trust_note")}</p>}
      {report.status !== "inspected" && <p>{label(report.issue ?? "incomplete")}</p>}
      {!!report.emptyFields && <p>{label("empty", report.emptyFields)}</p>}
      {!!counts.length && <ol className="space-y-2">
        {report.signatures.map((item, index) => {
          const Icon = item.kind === "timestamp" ? Clock3 : FileSignature;
          const format = item.subFilter && (Object.hasOwn(formats, item.subFilter) ? formats[item.subFilter] : item.subFilter);
          const fields = [
            ["format", format, item.subFilter],
            ["signer", item.signer],
            ["issuer", item.issuer],
            ["time", item.signedAt && displayTime(item.signedAt), item.signedAt],
            ["field", item.fieldName],
          ] as const;
          return <li key={index} className="border-s-2 border-border ps-3">
            <p className="mb-1 flex items-center gap-1.5 font-medium"><Icon aria-hidden="true" className="size-3.5" />{index + 1}. {label(item.kind)}</p>
            <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5">
              {fields.map(([key, value, original]) => value ? <div key={key} className="contents">
                <dt className="text-muted-foreground">{label(key)}</dt>
                <dd title={original} dir="auto" className="[overflow-wrap:anywhere]">{value}</dd>
              </div> : null)}
            </dl>
          </li>;
        })}
      </ol>}
    </div>
  </details>;
}
