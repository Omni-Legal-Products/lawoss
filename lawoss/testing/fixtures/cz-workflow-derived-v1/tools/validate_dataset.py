#!/usr/bin/env python3
"""Validate fixture integrity and declared ground truth; does not test an AI model."""
from pathlib import Path
import argparse, csv, hashlib, json, re, subprocess, sys, zipfile
from email import policy
from email.parser import BytesParser
from xml.etree import ElementTree as ET
from pypdf import PdfReader

def require(condition, message):
    if not condition: raise ValueError(message)

def docx_text(path):
    with zipfile.ZipFile(path) as z:
        require(not any(n.startswith('/') or '..' in Path(n).parts for n in z.namelist()), 'Unsafe DOCX part')
        texts=[]
        for name in z.namelist():
            if name.endswith(('.xml','.rels')):
                raw=z.read(name).decode('utf-8')
                require('TargetMode="External"' not in raw, 'External DOCX relationship')
                require(not any(x in raw for x in ('<w:del ','<w:ins ','<w:commentRangeStart')), 'Unexpected tracked/commented DOCX')
                texts.append(raw)
        core=ET.fromstring(z.read('docProps/core.xml'))
        for tag in ('{http://purl.org/dc/elements/1.1/}creator','{http://schemas.openxmlformats.org/package/2006/metadata/core-properties}lastModifiedBy'):
            require(core.findtext(tag)=='TEST DATA','Unexpected DOCX author')
        return '\n'.join(texts)

def privacy_check(text, label):
    # Screening supports review; it is not a universal anonymization guarantee.
    lower=text.casefold()
    for forbidden in ('/users/', '\\users\\', '/home/', 'dropbox', 'file://', 'localhost:', '127.0.0.1', 'com.eigenweltlabs', 'legalwork-server-tokens', 'private-import-manifest'):
        require(forbidden not in lower, 'Private/runtime reference in '+label)
    for address in re.findall(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}',text):
        require(address.casefold().endswith('@example.invalid'),'Non-test email in '+label)
    require(not re.search(r'(?<!\d)\d{6}/\d{3,4}(?!\d)',text),'Possible personal identifier in '+label)
    require(not re.search(r'\bCZ\d{22}\b',text),'Possible real IBAN in '+label)

def validate(root, okf_cli=None,node='node'):
    require(root.is_dir(),'Dataset directory not found')
    manifest=json.loads((root/'manifest.json').read_text())
    all_files={str(p.relative_to(root)):p for p in root.rglob('*') if p.is_file() and p.name!='manifest.json'}
    require(not any(p.is_symlink() for p in root.rglob('*')),'Symlinks forbidden')
    require(set(all_files)==set(manifest['files']),'Manifest inventory mismatch')
    for name,p in all_files.items():
        require(len(p.read_bytes())>0 or p.name=='.keep','Unexpected empty file '+name)
        require(hashlib.sha256(p.read_bytes()).hexdigest()==manifest['files'][name]['sha256'],'SHA256 mismatch '+name)
        require(p.stat().st_size==manifest['files'][name]['bytes'],'Size mismatch '+name)
        require(not name.startswith('/') and '..' not in Path(name).parts,'Unsafe path')
        text=''
        if p.name=='.keep':continue
        if p.suffix in ('.md','.csv','.json','.py','.txt') or p.name=='LICENSE':text=p.read_text()
        elif p.suffix=='.docx':text=docx_text(p)
        elif p.suffix=='.pdf':
            reader=PdfReader(p);require(len(reader.pages)==1,'Unexpected PDF pagination '+name)
            text='\n'.join(page.extract_text() or '' for page in reader.pages)+'\n'+str(reader.metadata)
        elif p.suffix=='.eml':
            message=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
            text=str(message.get_body(preferencelist=('plain',)).get_content())+'\n'+'\n'.join(str(v) for k,v in message.items())
        else:raise ValueError('Unreviewed file format '+name)
        # The scanner source itself contains its forbidden-pattern definitions.
        if name!='tools/validate_dataset.py':privacy_check(text,name)
    expected=json.loads((root/'ground-truth'/'expected.json').read_text())['cases']
    require(len(expected)==10 and len({c['id'] for c in expected})==10,'Expected ten unique cases')
    require(len(list((root/'office').rglob('client.md')))==5,'Expected five clients')
    require(len(list((root/'office').rglob('matter.md')))==10,'Expected ten matters')
    require(len(list((root/'office').rglob('*.docx')))==10,'Expected ten DOCX files')
    require(len(list((root/'office').rglob('*.eml')))==10,'Expected ten EML files')
    require(len(list((root/'office').rglob('*.pdf')))==11,'Expected ten PDFs and one scan PDF')
    okf_results=[]
    for c in expected:
        path=Path(c['path']);require(not path.is_absolute() and '..' not in path.parts,'Unsafe ground-truth path')
        matter=root/path;require(matter.is_dir(),'Missing matter')
        case_id=c['id'][-2:]
        with (matter/'ledger.csv').open(newline='') as f: rows=list(csv.DictReader(f))
        require(len(rows)==3 and all(r['status']=='model_only' for r in rows),'Malformed ledger')
        require(sum(int(r['amount_test_units']) for r in rows)==c['expected_balance_test_units'],'Incorrect ledger total')
        require(c['service_date'] is None and not c['human_confirmation'] and c['verified_deadline'] is None and not c['calendar_write_allowed'],'Unjustified verified state')
        require(len(c['checks'])==3,'Expected three scenario checks')
        pdf=matter/'01_Podklady'/f'test-{case_id}.pdf'
        require(c['id'] in ''.join(page.extract_text() or '' for page in PdfReader(pdf).pages),'PDF lacks test identity')
        eml=matter/'05_Komunikace'/f'test-{case_id}.eml'
        message=BytesParser(policy=policy.default).parsebytes(eml.read_bytes());attachments=list(message.iter_attachments())
        require(len(attachments)==1 and attachments[0].get_filename()==pdf.name,'Unexpected EML attachment')
        require(attachments[0].get_payload(decode=True)==pdf.read_bytes(),'EML/PDF mismatch')
        if case_id=='09':require(not ''.join(p.extract_text() or '' for p in PdfReader(matter/'01_Podklady'/'test-09-scan.pdf').pages).strip(),'Scan unexpectedly has text layer')
        # Invariants come from actual model-visible evidence, not only expected.json.
        evidence=(matter/'evidence.md').read_text()
        require('Datum doručení: neznámé.' in evidence and 'Lidské potvrzení: neprovedeno.' in evidence,'Evidence contradicts unconfirmed state')
        main_text=re.sub(r'\s+',' ',''.join(p.extract_text() or '' for p in PdfReader(pdf).pages))
        require('TEST DATA' in main_text and 'FIKTIVNÍ' in main_text,'Fiction label missing')
        if case_id in ('01','02','04','05'):
            a=(matter/'01_Podklady'/'varianta-1.md').read_text();b=(matter/'01_Podklady'/'varianta-2.md').read_text()
            require(a!=b and 'nepodepsaný návrh' in a and 'nepodepsaný návrh' in b,'Distinct draft alternatives missing')
            if case_id=='01':require('přílohy A, B.' in a and 'přílohy A, B, C.' in b and not list(matter.rglob('*priloha-C*')),'Missing-attachment case malformed')
            if case_id=='02':require('Mapa M chybí.' in a and 'Mapa M chybí.' in b,'Missing-map case malformed')
            if case_id=='04':require('vlastní zdroj před úvěrem' in a and 'úvěr před vlastním zdrojem' in b,'Funding-order conflict missing')
            if case_id=='05':require('doložení zápisu' in a and 'předložení žádosti' in b,'Escrow-condition conflict missing')
        if case_id=='03':require('úrokovou sazbu' in main_text and 'Úrok bez doplnění sazby' in main_text,'Unknown-interest inputs missing')
        if case_id=='06':require('Není doložen bankovní výpis' in main_text and 'vznik zajištění' in main_text,'Principal/security uncertainty missing')
        if case_id=='07':require('Není přiloženo potvrzení podání' in main_text and 'aktuální výpis' in main_text,'Deletion proof uncertainty missing')
        if case_id=='08':require('https://example.invalid/test-08' in message.get_body(preferencelist=('plain',)).get_content(),'Untrusted-link challenge missing')
        if case_id=='10':require('Datum vyhotovení nepoužijte jako datum doručení.' in main_text,'Document-date/service distinction missing')
        if okf_cli:
            run=subprocess.run([node,str(okf_cli),'validate',str(matter),'--json'],capture_output=True,text=True)
            require(run.returncode==0,'OKF matter validation failed '+c['id']+': '+run.stdout)
            okf_results.append(c['id'])
    if okf_cli:
        for client in (root/'office'/'Clients').iterdir():
            run=subprocess.run([node,str(okf_cli),'validate',str(client),'--json'],capture_output=True,text=True)
            require(run.returncode==0,'OKF client validation failed '+client.name)
        negative=subprocess.run([node,str(okf_cli),'validate',str(root/'edge-cases'),'--json'],capture_output=True,text=True)
        require(negative.returncode!=0 and 'concept document bez' in negative.stdout,'Expected negative OKF rejection missing')
    return {'status':'PASS','files':len(all_files),'cases':10,'clients':5,'docx':10,'pdf':11,'eml':10,'scenario_expectations':30,'okf_matters_validated':len(okf_results),'application_behavior_tested':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--okf-cli',type=Path);parser.add_argument('--node',default='node');args=parser.parse_args()
    try: print(json.dumps(validate(args.root.resolve(),args.okf_cli,args.node),ensure_ascii=False,indent=2))
    except Exception as e: print('FAIL: '+str(e),file=sys.stderr);sys.exit(1)
