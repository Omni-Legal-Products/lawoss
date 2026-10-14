#!/usr/bin/env python3
"""Prepare a private ISIR snapshot for local acceptance; never commit the output."""
import argparse
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

SOAP = "https://isir.justice.cz:8443/isir_cuzk_ws/IsirWsCuzkService"
MAX_BYTES = 20 * 1024 * 1024


def fetch(url, data=None):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "isir.justice.cz":
        raise ValueError("Only the official ISIR source is allowed")
    request = urllib.request.Request(url, data=data, headers={
        "User-Agent": "LAWOSS local attachment acceptance",
        "Content-Type": "text/xml; charset=utf-8" if data else "application/octet-stream",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        if urllib.parse.urlparse(response.url).hostname != "isir.justice.cz":
            raise ValueError("Unexpected redirect outside ISIR")
        content = response.read(MAX_BYTES + 1)
    if len(content) > MAX_BYTES:
        raise ValueError("Document exceeds the bounded acceptance sample")
    return content


def search():
    body = b'''<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:typ="http://isirws.cca.cz/types/">
<soapenv:Body><typ:getIsirWsCuzkDataRequest><nazevOsoby>%s.r.o.%</nazevOsoby><maxPocetVysledku>40</maxPocetVysledku><filtrAktualniRizeni>T</filtrAktualniRizeni></typ:getIsirWsCuzkDataRequest></soapenv:Body></soapenv:Envelope>'''
    tree = ET.fromstring(fetch(SOAP, body))
    results = [{child.tag.rsplit("}", 1)[-1]: child.text.strip() for child in row if child.text and child.text.strip()}
               for row in tree.iter() if row.tag.rsplit("}", 1)[-1] == "data"]
    return [row for row in results if re.fullmatch(r"\d{8}", row.get("ic", "")) and row.get("urlDetailRizeni")]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--search-json", type=Path, help="Existing official SOAP search snapshot from isir-search")
    args = parser.parse_args()
    root = args.output.resolve()
    if any((parent / ".git").exists() for parent in (root, *root.parents)):
        raise SystemExit("Store live ISIR data outside Git repositories")
    if root.exists() and any(root.iterdir()):
        raise SystemExit("Choose a new empty snapshot folder; existing data is preserved")
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    root.chmod(0o700)
    if (root / "corpus.json").exists():
        raise SystemExit("Choose a new snapshot folder; existing corpus is preserved")
    candidates = json.loads(args.search_json.read_text())["results"] if args.search_json else search()
    candidates = [row for row in candidates if re.fullmatch(r"\d{8}", row.get("ic", ""))
                  and re.search(r"s\s*\.\s*r\s*\.\s*o\s*\.", row.get("nazevOsoby", ""), re.I)
                  and not row.get("jmeno") and row.get("urlDetailRizeni")]
    cases, failures, seen = [], [], set()
    for candidate in reversed(candidates):
        source_url = candidate["urlDetailRizeni"]
        if source_url in seen:
            continue
        seen.add(source_url)
        try:
            page = fetch(source_url).decode("utf-8", errors="replace")
            ids = list(dict.fromkeys(re.findall(r"dokument\.PDF\?id=(\d+)", page, re.I)))
            documents = []
            for document_id in ids[:12]:
                url = f"https://isir.justice.cz/isir/doc/dokument.PDF?id={document_id}"
                try:
                    content = fetch(url)
                    if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
                        raise ValueError("Response is not a complete PDF")
                    documents.append((document_id, url, content))
                    if len(documents) == 2:
                        break
                except Exception as error:
                    failures.append({"url": url, "error": str(error)})
                time.sleep(0.15)
            if len(documents) != 2:
                raise ValueError("Two downloadable original PDFs were not available")
            case_id = f"case-{len(cases) + 1:02d}"
            directory = root / "source" / case_id
            directory.mkdir(parents=True, exist_ok=True)
            saved = []
            for document_id, url, content in documents:
                name = f"ISIR — dokument {document_id} (originál).pdf"
                path = directory / name
                with path.open("xb") as output:
                    output.write(content)
                saved.append({"documentId": document_id, "url": url, "name": name,
                              "path": path.relative_to(root).as_posix(), "bytes": len(content),
                              "sha256": hashlib.sha256(content).hexdigest()})
            cases.append({"id": case_id, "company": candidate.get("nazevOsoby"), "ic": candidate["ic"],
                          "caseNumber": candidate.get("spisovaZnacka") or f'{candidate.get("cisloSenatu", "")} INS {candidate["bcVec"]}/{candidate["rocnik"]}',
                          "sourceUrl": source_url, "documents": saved})
            print(f"Prepared {case_id}: {len(saved)} verified PDFs", flush=True)
            if len(cases) == 10:
                break
        except Exception as error:
            failures.append({"url": source_url, "error": str(error)})
        time.sleep(0.15)
    manifest = {"version": 1, "source": "ISIR", "downloadedAt": datetime.now(timezone.utc).isoformat(),
                "cases": cases, "failures": failures}
    with (root / "corpus.json").open("x", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2)
    print(f"Snapshot: {root / 'corpus.json'}; cases={len(cases)}, PDFs={sum(len(c['documents']) for c in cases)}")
    if len(cases) != 10:
        raise SystemExit("Incomplete corpus: acquisition failures are recorded in the manifest")


if __name__ == "__main__":
    main()
