# /// script
# requires-python = ">=3.11"
# dependencies = ["pyhanko==0.38.2"]
# ///
"""Make disposable PDF signature examples from the bundled synthetic case."""

import argparse
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from tempfile import mkdtemp

from asn1crypto import keys, x509 as asn1_x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers
from pyhanko_certvalidator.registry import SimpleCertificateStore

REFERENCE = Path(__file__).resolve().parents[1] / "fixtures/cz-workflow-derived-v1"
PDF = REFERENCE / "office/Clients/C01/Spisy/test-02/01_Podklady/test-02.pdf"


def synthetic_signer(name):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.now(timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1)).not_valid_after(now + timedelta(days=30))
            .sign(key, hashes.SHA256()))
    return signers.SimpleSigner(
        asn1_x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER)),
        keys.PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER,
                                 serialization.PrivateFormat.PKCS8, serialization.NoEncryption())),
        SimpleCertificateStore(),
    )


def generate(parent):
    parent = parent.expanduser().resolve()
    if parent == REFERENCE or REFERENCE in parent.parents:
        raise ValueError("Choose a destination outside the reference dataset.")
    parent.mkdir(parents=True, exist_ok=True)
    output = Path(mkdtemp(prefix="LAWOSS-PDF-", dir=parent))
    reference = PDF.read_bytes()
    (output / "01-original.pdf").write_bytes(reference)
    writer = IncrementalPdfFileWriter(BytesIO(reference))
    names = ["Pilot-A", "Pilot-B"]
    for name in names:
        fields.append_signature_field(writer, fields.SigFieldSpec(sig_field_name=name))
    with (output / "02-empty-fields.pdf").open("wb") as dest:
        writer.write(dest)
    current = output / "02-empty-fields.pdf"
    for index, name in enumerate(names):
        target = output / ["03-one-signature.pdf", "04-two-signatures.pdf"][index]
        with current.open("rb") as source, target.open("wb") as dest:
            signers.sign_pdf(
                IncrementalPdfFileWriter(source),
                signers.PdfSignatureMetadata(field_name=name, subfilter=fields.SigSeedSubFilter.PADES),
                synthetic_signer(f"LAWOSS Test {name}"), existing_fields_only=True, output=dest,
            )
        current = target
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(generate(parser.parse_args().output.expanduser()))
