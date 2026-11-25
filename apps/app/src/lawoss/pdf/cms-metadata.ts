import { fromBER, OctetString, Primitive, UTCTime } from "asn1js";
import {
  Certificate, ContentInfo, IssuerAndSerialNumber, SignedData, TSTInfo,
  id_ContentType_SignedData, id_eContentType_TSTInfo, id_SubjectKeyIdentifier,
  type SignerInfo,
} from "pkijs";

type CmsMetadata = { signer?: string; issuer?: string; signedAt?: string; timestamp: boolean };

function matchesSigner(cert: Certificate, signer: SignerInfo): boolean {
  const sid = signer.sid;
  if (sid instanceof IssuerAndSerialNumber) {
    return cert.issuer.isEqual(sid.issuer) && cert.serialNumber.isEqual(sid.serialNumber);
  }
  if (!(sid instanceof Primitive) || sid.idBlock.tagClass !== 3 || sid.idBlock.tagNumber !== 0) return false;
  const keyId = cert.extensions?.find((entry) => entry.extnID === id_SubjectKeyIdentifier)?.parsedValue;
  if (!(keyId instanceof OctetString)) return false;
  const expected = new Uint8Array(keyId.getValue());
  const actual = sid.valueBlock.valueHexView;
  return expected.length === actual.length && expected.every((value, index) => actual[index] === value);
}

export function certificateName(name: Certificate["subject"]): string | undefined {
  for (const oid of ["2.5.4.3", "2.5.4.10"]) {
    const attr = name.typesAndValues.find((item) => item.type === oid);
    const value: unknown = attr?.value.valueBlock.value;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 300);
  }
  return undefined;
}

/** Read CMS structure only. No hash, signature, certificate path or timestamp verification is performed. */
export function readCmsMetadata(bytes: Uint8Array): CmsMetadata {
  const ber = fromBER(bytes);
  if (ber.offset < 0 || bytes.subarray(ber.offset).some((value) => value !== 0)) throw new Error("Invalid CMS padding");
  const content = new ContentInfo({ schema: ber.result });
  if (content.contentType !== id_ContentType_SignedData) throw new Error("Expected SignedData");
  const data = new SignedData({ schema: content.content });
  if (!data.signerInfos.length || data.signerInfos.some((info) => !info.signature.valueBlock.valueHexView.length)) {
    throw new Error("Missing CMS signature value");
  }
  const isTimestamp = data.encapContentInfo.eContentType === id_eContentType_TSTInfo;
  let signedAt: string | undefined;
  let signer: string | undefined;
  let issuer: string | undefined;
  if (data.signerInfos.length === 1) {
    const info = data.signerInfos[0];
    const cert = data.certificates?.find((item) => item instanceof Certificate && matchesSigner(item, info));
    if (cert instanceof Certificate) {
      signer = certificateName(cert.subject);
      issuer = certificateName(cert.issuer);
    }
    const time = info.signedAttrs?.attributes.find((attr) => attr.type === "1.2.840.113549.1.9.5")?.values[0];
    if (time instanceof UTCTime) signedAt = time.toDate().toISOString();
  }
  if (isTimestamp) {
    const encapsulated = data.encapContentInfo.eContent;
    if (!(encapsulated instanceof OctetString)) throw new Error("Missing timestamp token");
    signedAt = TSTInfo.fromBER(encapsulated.getValue()).genTime.toISOString();
  }
  return { signer, issuer, signedAt, timestamp: isTimestamp };
}
