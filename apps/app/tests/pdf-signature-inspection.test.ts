import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { Integer, ObjectIdentifier, OctetString, Utf8String, UTCTime } from "asn1js";
import {
  Attribute, AttributeTypeAndValue, Certificate, ContentInfo, EncapsulatedContentInfo,
  IssuerAndSerialNumber, MessageImprint, SignedAndUnsignedAttributes, SignedData, SignerInfo, TSTInfo,
  id_eContentType_TSTInfo,
} from "pkijs";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { inspectPdfSignatures, MAX_PDF_INSPECTION_BYTES } from "../src/lawoss/pdf/inspect-signatures";
import { parsePdfSignatures } from "../src/lawoss/pdf/signature-parser";

const signingTime = new Date("2024-02-03T04:05:06.000Z");
const timestampTime = new Date("2025-03-04T05:06:07.000Z");

// All certificates and signing keys exist only in the test process.
async function cms(timestamp: boolean) {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const cert = new Certificate({ version: 2, serialNumber: new Integer({ value: 3 }) });
  const cn = (value: string) => new AttributeTypeAndValue({ type: "2.5.4.3", value: new Utf8String({ value }) });
  cert.issuer.typesAndValues.push(cn("Synthetic issuer"));
  cert.subject.typesAndValues.push(cn(timestamp ? "Synthetic TSA" : "Synthetic signer"));
  cert.notBefore.value = signingTime;
  cert.notAfter.value = timestampTime;
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");

  const data = new Uint8Array([1, 2, 3]).buffer;
  const payload = timestamp ? new TSTInfo({
    version: 1, policy: "1.2.3.4", serialNumber: new Integer({ value: 1 }), genTime: timestampTime,
    messageImprint: await MessageImprint.create("SHA-256", data),
  }).toSchema().toBER() : data;
  const type = timestamp ? id_eContentType_TSTInfo : ContentInfo.DATA;
  const envelope = new SignedData({
    certificates: [cert],
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: type, ...(timestamp ? { eContent: new OctetString({ valueHex: payload }) } : {}),
    }),
    signerInfos: [new SignerInfo({
      version: 1,
      sid: new IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
      signedAttrs: new SignedAndUnsignedAttributes({ type: 0, attributes: [
        new Attribute({ type: "1.2.840.113549.1.9.3", values: [new ObjectIdentifier({ value: type })] }),
        new Attribute({ type: "1.2.840.113549.1.9.4", values: [new OctetString({ valueHex: await crypto.subtle.digest("SHA-256", payload) })] }),
        new Attribute({ type: "1.2.840.113549.1.9.5", values: [new UTCTime({ valueDate: signingTime })] }),
      ] }),
    })],
  });
  await envelope.sign(keys.privateKey, 0, "SHA-256", payload);
  const bytes = new ContentInfo({ contentType: ContentInfo.SIGNED_DATA, content: envelope.toSchema() }).toSchema().toBER();
  return Buffer.from(bytes).toString("hex") + "0000";
}

type Field = { type: string; hex: string; timestamp?: boolean };

async function fieldsPdf(fields: Field[], permission?: "UR3" | "DocMDP") {
  const doc = await PDFDocument.create();
  doc.addPage();
  const ctx = doc.context;
  const refs = fields.map(({ type, hex, timestamp }, index) => {
    const value = ctx.register(ctx.obj({
      Type: timestamp ? "DocTimeStamp" : "Sig", Name: PDFString.of("Unverified PDF name"),
      M: PDFString.of("D:20010101000000Z"), SubFilter: type,
      ByteRange: [0, 1111111111, 2222222222, 3333333333], Contents: PDFHexString.of(hex),
    }));
    if (permission) doc.catalog.set(PDFName.of("Perms"), ctx.obj({ [permission]: value }));
    return ctx.register(ctx.obj({ FT: "Sig", T: PDFString.of("Field" + index), V: value }));
  });
  doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: permission ? [] : refs }));
  const pdf = Buffer.from(await doc.save({ useObjectStreams: false })).toString("latin1");
  // Use exact offsets of each real PDF string. CMS signatures over test payloads deliberately
  // differ from these PDF bytes, so this also exercises the structural-only boundary.
  const withRanges = pdf.replaceAll(/1111111111 2222222222 3333333333(?= \]\s*\/Contents <)/g, (marker, at: number) => {
    const start = pdf.indexOf("<", at + marker.length);
    const end = pdf.indexOf(">", start) + 1;
    return [start, end, pdf.length - end].map((n) => String(n).padStart(10, "0")).join(" ");
  });
  return Buffer.from(withRanges, "latin1");
}

describe("local structural PDF signature inspection", () => {
  it("reads the CMS certificate and signing time, and the RFC3161 certificate and generation time", async () => {
    const bytes = await fieldsPdf([
      { type: "ETSI.CAdES.detached", hex: await cms(false) },
      { type: "ETSI.RFC3161", hex: await cms(true), timestamp: true },
    ]);
    const original = Uint8Array.from(bytes);
    expect(await inspectPdfSignatures(bytes)).toEqual({
      status: "inspected", emptyFields: 0, signatures: [
        { kind: "signature", fieldName: "Field0", subFilter: "ETSI.CAdES.detached", signer: "Synthetic signer", issuer: "Synthetic issuer", signedAt: signingTime.toISOString() },
        { kind: "timestamp", fieldName: "Field1", subFilter: "ETSI.RFC3161", signer: "Synthetic TSA", issuer: "Synthetic issuer", signedAt: timestampTime.toISOString() },
      ],
    });
    expect(Uint8Array.from(bytes)).toEqual(original);
  });

  it("handles compressed inherited signature fields and counts a field with two widgets once", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Signed /Type /Sig /ByteRange [0 1 2 3]");
    const ctx = doc.context;
    ctx.register(ctx.obj({ Type: "Sig", Contents: PDFHexString.of("deadbeef") })); // Unreachable.
    const widget = () => ctx.register(ctx.obj({ Subtype: "Widget" }));
    const leaf = ctx.register(ctx.obj({ T: PDFString.of("child"), Kids: [widget(), widget()] }));
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [ctx.obj({ FT: "Sig", Kids: [leaf] })] }));
    expect(await parsePdfSignatures(await doc.save())).toEqual({ status: "inspected", signatures: [], emptyFields: 1 });
  });

  it("preserves valid siblings and treats finalized zero-filled signatures as inconclusive", async () => {
    const bytes = await fieldsPdf([
      { type: "adbe.pkcs7.detached", hex: "000000" },
      { type: "adbe.pkcs7.detached", hex: "300100" },
      { type: "adbe.pkcs7.detached", hex: await cms(false) },
    ]);
    const report = await parsePdfSignatures(bytes);
    expect(report).toMatchObject({ status: "partial", issue: "malformed", emptyFields: 0 });
    expect(report.signatures.map((s) => s.fieldName)).toEqual(["Field2"]);
  });

  it("counts a genuinely unfinalized placeholder as empty", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [ctx.obj({
      FT: "Sig", V: { Type: "Sig", ByteRange: [0, 0, 0, 0], Contents: PDFHexString.of("0000") },
    })] }));
    expect(await parsePdfSignatures(await doc.save())).toEqual({ status: "inspected", signatures: [], emptyFields: 1 });
  });

  it("excludes reader usage rights and includes certification referenced only from DocMDP", async () => {
    const field = { type: "adbe.pkcs7.detached", hex: await cms(false) };
    expect(await parsePdfSignatures(await fieldsPdf([field], "UR3"))).toEqual({ status: "inspected", signatures: [], emptyFields: 0 });
    const certification = await parsePdfSignatures(await fieldsPdf([field], "DocMDP"));
    expect(certification.status).toBe("inspected");
    expect(certification.signatures.map((s) => s.signer)).toEqual(["Synthetic signer"]);
  });

  it("reports unknown encoding, invalid timestamp content, and nonmatching byte ranges as inconclusive", async () => {
    const ordinary = await cms(false);
    const proprietary = await fieldsPdf([{ type: "Private.Format", hex: "010203" }]);
    expect(await parsePdfSignatures(proprietary)).toMatchObject({ status: "partial", issue: "unsupported", signatures: [] });
    const timestamp = await fieldsPdf([{ type: "ETSI.RFC3161", hex: ordinary }]);
    expect(await parsePdfSignatures(timestamp)).toMatchObject({ status: "partial", issue: "malformed", signatures: [] });
    const pdf = (await fieldsPdf([{ type: "adbe.pkcs7.detached", hex: ordinary }])).toString("latin1");
    const changed = pdf.replace(/(\/ByteRange \[ 0 )\d{10}/, "$10000000002");
    expect(await parsePdfSignatures(Buffer.from(changed, "latin1"))).toMatchObject({ status: "partial", issue: "malformed", signatures: [] });
  });

  it("distinguishes ordinary unsigned, XFA, encrypted, truncated, and oversized documents", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const original = await doc.save();
    expect(await parsePdfSignatures(original)).toEqual({ status: "inspected", signatures: [], emptyFields: 0 });
    doc.catalog.set(PDFName.of("AcroForm"), doc.context.obj({ Fields: [], XFA: [] }));
    expect(await parsePdfSignatures(await doc.save())).toMatchObject({ status: "partial", issue: "unsupported" });
    const encrypted = readFileSync(new URL("./fixtures/pdf-signature-encrypted.pdf", import.meta.url));
    expect(await parsePdfSignatures(encrypted)).toMatchObject({ status: "unavailable", issue: "encrypted" });
    expect(await parsePdfSignatures(original.subarray(0, -10))).toMatchObject({ status: "unavailable", issue: "malformed" });
    expect(await inspectPdfSignatures(new Uint8Array(MAX_PDF_INSPECTION_BYTES + 1))).toMatchObject({ status: "unavailable", issue: "too_large" });
  });

  it("requires the declared catalog and follows incremental trailer inheritance", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const file = Buffer.from(await doc.save({ useObjectStreams: false })).toString("latin1");
    const previous = /startxref\s+(\d+)/.exec(file)![1];
    const revision = (trailer: string) => Buffer.from(file + "xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 5 "
      + trailer + " >>\nstartxref\n" + file.length + "\n%%EOF\n", "latin1");
    expect(await parsePdfSignatures(revision("/Prev " + previous))).toMatchObject({ status: "inspected", signatures: [] });
    expect(await parsePdfSignatures(revision("/Root 99 0 R /Prev " + previous))).toMatchObject({ status: "unavailable", issue: "malformed" });
    expect(await parsePdfSignatures(revision("/Prev " + file.length))).toMatchObject({ status: "unavailable", issue: "malformed" });
  });

  it("treats invalid and unresolvable field types as incomplete inspection", async () => {
    const doc = await PDFDocument.create();
    const ctx = doc.context;
    const missing = ctx.nextRef();
    doc.catalog.set(PDFName.of("AcroForm"), ctx.obj({ Fields: [ctx.obj({ FT: missing }), ctx.obj({ FT: 1 })] }));
    expect(await parsePdfSignatures(await doc.save())).toMatchObject({ status: "partial", issue: "malformed", signatures: [] });
  });

  it("cancels a running inspection on preview change", async () => {
    const controller = new AbortController();
    const task = inspectPdfSignatures(await fieldsPdf([]), controller.signal);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
  });
});
