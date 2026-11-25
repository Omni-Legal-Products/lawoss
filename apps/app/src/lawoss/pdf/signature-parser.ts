import {
  PDFArray, PDFContext, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFObjectParser, PDFRef, PDFStream, PDFString, ParseSpeeds,
  type PDFObject,
} from "pdf-lib";
import { OctetString, fromBER } from "asn1js";
import { Certificate } from "pkijs";
import { certificateName, readCmsMetadata } from "./cms-metadata";
import { MAX_PDF_INSPECTION_BYTES, unavailable, type PdfSignatureReport } from "./signature-report";

const key = PDFName.of;
const MAX_FIELDS = 4096;
const MAX_CONTENTS = 1024 * 1024;
const pdfString = (obj?: PDFObject) => obj instanceof PDFString || obj instanceof PDFHexString ? obj : undefined;
const name = (obj?: PDFObject) => obj instanceof PDFName ? obj.decodeText().slice(0, 300) : undefined;
const text = (obj?: PDFObject) => pdfString(obj)?.decodeText().trim().slice(0, 300) || undefined;

function pdfTime(raw?: string): string | undefined {
  // Preserve missing timezone and date precision. PDF times are declarations by the author.
  const m = /^(?:D:)?(\d{4})(?:(\d{2})(?:(\d{2})(?:(\d{2})(?:(\d{2})(\d{2})?)?)?)?)?(Z|[+-]\d{2}'?\d{2}'?)?$/.exec(raw ?? "");
  if (!m) return undefined;
  const [, year, month, day, hour, minute, second, zone] = m;
  if (month && (+month < 1 || +month > 12)) return undefined;
  if (day && (+day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate())) return undefined;
  if (+hour > 23 || +minute > 59 || +second > 59) return undefined;
  const date = [year, month, day].filter(Boolean).join("-");
  if (!hour) return date;
  const tz = zone?.replace(/'/g, "").replace(/^([+-]\d{2})(\d{2})$/, "$1:$2") ?? "";
  return date + "T" + [hour, minute ?? "00", second ?? "00"].join(":") + tz;
}

function matchesContents(range: PDFObject | undefined, bytes: Uint8Array, contents: PDFHexString | PDFString): boolean {
  if (!(range instanceof PDFArray) || range.size() !== 4) return false;
  const [start, first, second, remaining] = range.asArray().map((v) => v instanceof PDFNumber ? v.asNumber() : NaN);
  if (![start, first, second, remaining].every(Number.isSafeInteger)
    || start !== 0 || first <= 0 || second <= first || remaining <= 0 || second + remaining > bytes.length) return false;
  const token = contents.toString();
  const gap = bytes.subarray(first, second);
  return token.length === gap.length && gap.every((byte, i) => byte === token.charCodeAt(i));
}

function inspectValue(dict: PDFDict, fieldName: string | undefined, file: Uint8Array, report: PdfSignatureReport) {
  const contents = pdfString(dict.lookup(key("Contents")));
  if (!contents) throw new Error("Missing signature contents");
  if (contents.asString().length > MAX_CONTENTS * 2) {
    report.status = "partial";
    report.issue = "limit";
    return;
  }
  // pdf-lib retains PDF whitespace inside hex strings; remove it before decoding the payload.
  const hex = contents instanceof PDFHexString ? contents.asString().replace(/[\x00\t\n\f\r ]/g, "") : undefined;
  if (hex !== undefined && /[^0-9a-f]/i.test(hex)) throw new Error("Invalid hex string");
  const bytes = hex === undefined ? contents.asBytes() : PDFHexString.of(hex).asBytes();
  const range = dict.lookup(key("ByteRange"));
  if (!bytes.some((byte) => byte !== 0)) {
    const unfilledRange = range instanceof PDFArray && range.size() === 4
      && range.asArray().every((n) => n instanceof PDFNumber && n.asNumber() === 0);
    if (dict.has(key("ByteRange")) && !unfilledRange) throw new Error("Empty contents with a finalized byte range");
    report.emptyFields++;
    return;
  }
  if (!matchesContents(range, file, contents)) throw new Error("Malformed byte range");
  const subFilter = name(dict.lookup(key("SubFilter")));
  let issuer: string | undefined;
  let signer = text(dict.lookup(key("Name")));
  let signedAt = pdfTime(text(dict.lookup(key("M"))));
  let timestamp = name(dict.lookup(key("Type"))) === "DocTimeStamp" || subFilter === "ETSI.RFC3161";
  if (subFilter === "adbe.x509.rsa_sha1") {
    const certEntry = dict.lookup(key("Cert"));
    const certBytes = pdfString(certEntry instanceof PDFArray ? certEntry.lookup(0) : certEntry)?.asBytes();
    const ber = fromBER(bytes);
    if (!certBytes || ber.offset < 0 || !(ber.result instanceof OctetString) || !ber.result.getValue().byteLength) {
      throw new Error("Malformed legacy signature");
    }
    const cert = Certificate.fromBER(Uint8Array.from(certBytes));
    signer = certificateName(cert.subject) ?? signer;
    issuer = certificateName(cert.issuer);
  } else {
    let cms;
    try {
      cms = readCmsMetadata(bytes);
    } catch (error) {
      if (subFilter && !["adbe.pkcs7.detached", "adbe.pkcs7.sha1", "ETSI.CAdES.detached", "ETSI.RFC3161"].includes(subFilter)) {
        report.status = "partial";
        report.issue ??= "unsupported";
        return;
      }
      throw error;
    }
    if (timestamp && !cms.timestamp) throw new Error("Mismatched document timestamp");
    timestamp ||= cms.timestamp;
    signer = cms.signer ?? signer;
    issuer = cms.issuer;
    signedAt = cms.signedAt ?? signedAt;
  }
  report.signatures.push({ kind: timestamp ? "timestamp" : "signature", fieldName, subFilter, signer, issuer, signedAt });
}

/** Inspect the unencrypted trailer even if encrypted object streams prevent loading the document. */
function readTrailer(bytes: Uint8Array, offset: number, end: number): PDFDict | undefined {
  const decoder = new TextDecoder("latin1");
  const prefix = decoder.decode(bytes.subarray(offset, offset + 64));
  const indirect = /^\d+\s+\d+\s+obj\b/.exec(prefix);
  let begin: number;
  if (indirect) {
    begin = offset + indirect[0].length;
  } else if (/^xref\b/.test(prefix)) {
    const trailer = decoder.decode(bytes.subarray(offset, end)).indexOf("trailer");
    if (trailer < 0) return undefined;
    begin = offset + trailer + "trailer".length;
  } else {
    return undefined;
  }
  const object = PDFObjectParser.forBytes(bytes.subarray(begin, end), PDFContext.create()).parseObject();
  if (object instanceof PDFStream && name(object.dict.lookup(key("Type"))) === "XRef") return object.dict;
  return !indirect && object instanceof PDFDict ? object : undefined;
}

export async function parsePdfSignatures(bytes: Uint8Array): Promise<PdfSignatureReport> {
  if (bytes.byteLength > MAX_PDF_INSPECTION_BYTES) return unavailable("too_large");
  const report: PdfSignatureReport = { status: "inspected", signatures: [], emptyFields: 0 };
  try {
    // pdf-lib recovers some truncated PDFs. A recovered prefix cannot establish an unsigned current revision.
    const decoder = new TextDecoder("latin1");
    const trailer = /startxref\s+(\d+)\s+%%EOF[\s\0]*$/.exec(decoder.decode(bytes.subarray(-1024)));
    if (!trailer) return unavailable("malformed");
    // pdf-lib can recover an unrelated catalog when /Root is damaged. Follow the declared
    // revisions independently and accept only the catalog named by their effective root.
    let offset = Number(trailer[1]);
    let end = bytes.length;
    let declaredRoot: PDFObject | undefined;
    const visitedRevisions = new Set<number>();
    while (true) {
      if (visitedRevisions.size >= 128) return unavailable("limit");
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= bytes.length || visitedRevisions.has(offset)) return unavailable("malformed");
      visitedRevisions.add(offset);
      const revision = readTrailer(bytes, offset, end);
      if (!revision) return unavailable("malformed");
      const size = revision.lookup(key("Size"));
      if (!(size instanceof PDFNumber) || !Number.isSafeInteger(size.asNumber()) || size.asNumber() < 1) return unavailable("malformed");
      if (size.asNumber() > 150_000) return unavailable("limit");
      if (revision.get(key("Encrypt"))) return unavailable("encrypted");
      declaredRoot ??= revision.get(key("Root"), true);
      const prev = revision.get(key("Prev"), true);
      if (prev === undefined) break;
      if (!(prev instanceof PDFNumber)) return unavailable("malformed");
      end = prev.asNumber() < offset ? offset : bytes.length;
      offset = prev.asNumber();
    }
    if (!(declaredRoot instanceof PDFRef)) return unavailable("malformed");
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: true, parseSpeed: ParseSpeeds.Fastest,
    });
    if (doc.isEncrypted) return unavailable("encrypted");
    if (doc.context.lookup(declaredRoot) !== doc.catalog) return unavailable("malformed");
    if (name(doc.catalog.lookup(key("Type"))) !== "Catalog" || !(doc.catalog.lookup(key("Pages")) instanceof PDFDict)) return unavailable("malformed");
    const seenSignatures = new Set<PDFDict>();
    const perms = doc.catalog.lookup(key("Perms"));
    if (perms instanceof PDFDict) {
      // Reader usage-rights grants are capabilities, not approval or certification signatures.
      for (const entry of ["UR", "UR3"]) {
        const rights = perms.lookup(key(entry));
        if (rights instanceof PDFDict) seenSignatures.add(rights);
      }
    }
    const inspectOnce = (value: PDFObject | undefined, fieldName?: string) => {
      if (!(value instanceof PDFDict)) throw new Error("Invalid signature dictionary");
      if (seenSignatures.has(value)) return;
      seenSignatures.add(value);
      inspectValue(value, fieldName, bytes, report);
    };
    const malformed = () => {
      report.status = "partial";
      report.issue ??= "malformed";
    };
    const form = doc.catalog.lookup(key("AcroForm"));
    if (doc.catalog.has(key("AcroForm"))) {
      if (!(form instanceof PDFDict)) return unavailable("malformed");
      const fields = form.lookup(key("Fields"));
      if (!(fields instanceof PDFArray)) return unavailable("malformed");
      const visited = new Set<PDFDict>();
      let steps = 0;
      const visit = (list: PDFArray, depth: number, parentName?: string, parentType?: string, parentValue?: PDFObject): number => {
        let fieldCount = 0;
        for (let index = 0; index < list.size(); index++) {
          if (++steps > MAX_FIELDS || depth > 64) {
            report.status = "partial";
            report.issue = "limit";
            return fieldCount;
          }
          try {
            const field = list.lookup(index);
            if (!(field instanceof PDFDict) || visited.has(field)) throw new Error("Invalid field tree");
            visited.add(field);
            // Pure widget children are visual appearances of the parent terminal field.
            if (depth && name(field.lookup(key("Subtype"))) === "Widget"
              && !["T", "FT", "V", "Kids"].some((entry) => field.has(key(entry)))) continue;
            fieldCount++;
            const ownType = name(field.lookup(key("FT")));
            if (field.get(key("FT"), true) !== undefined && !["Sig", "Btn", "Tx", "Ch"].includes(ownType ?? "")) malformed();
            const fieldType = ownType ?? parentType;
            const fieldName = [parentName, text(field.lookup(key("T")))].filter(Boolean).join(".").slice(0, 300) || undefined;
            const hasValue = field.get(key("V")) !== undefined;
            const value = hasValue ? field.lookup(key("V")) : parentValue;
            if (fieldType === "Sig" && (value || hasValue)) inspectOnce(value, fieldName);
            const kids = field.lookup(key("Kids"));
            if (field.has(key("Kids")) && !(kids instanceof PDFArray)) throw new Error("Invalid field children");
            const childFieldCount = kids instanceof PDFArray ? visit(kids, depth + 1, fieldName, fieldType, value) : 0;
            if (!fieldType && !childFieldCount) malformed();
            if (fieldType === "Sig" && !hasValue && !value && childFieldCount === 0) report.emptyFields++;
          } catch {
            malformed();
          }
        }
        return fieldCount;
      };
      visit(fields, 0);
      const flags = form.lookup(key("SigFlags"));
      if (flags instanceof PDFNumber && (flags.asNumber() & 1) && !report.emptyFields && !report.signatures.length) malformed();
      if (form.has(key("XFA"))) {
        report.status = "partial";
        report.issue ??= "unsupported";
      }
    }
    if (perms instanceof PDFDict) {
      if (perms.has(key("DocMDP"))) {
        try { inspectOnce(perms.lookup(key("DocMDP"))); } catch { malformed(); }
      }
    } else if (doc.catalog.has(key("Perms"))) malformed();
    return report;
  } catch {
    return unavailable("malformed");
  }
}
