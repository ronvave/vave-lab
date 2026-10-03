#!/usr/bin/env python3
"""Read header-mapped Vanuatu Master, validate, sanitize, encrypt atomically.
Private source tables/diagnostics never become Pages assets. No inferred identity,
ancestry, coordinates, thesis publications or Master's-to-PhD pair relation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import vanuatu_master_file_config as C


def yes(value):
    return value is True or str(value).strip().lower() in ('true','yes','1')


def rows(values, required=()):
    if len(values) < 4:
        raise ValueError('Missing row-4 schema; preserving previous snapshot')
    headers = [str(v).strip() for v in values[3]]
    nonblank = [h for h in headers if h]
    if len(set(nonblank)) != len(nonblank):
        raise ValueError('Duplicate row-4 header')
    if set(required) - set(headers):
        raise ValueError('Required schema headers missing')
    return [{h: row[i] if i < len(row) else '' for i,h in enumerate(headers) if h} for row in values[4:]]


def keyed(table, records):
    key = C.KEYS[table]
    records = [r for r in records if r.get(key) is not None and str(r.get(key,'')).strip()]
    ids = [str(r[key]).strip() for r in records]
    if len(ids) != len(set(ids)):
        raise ValueError(f'{table}: duplicate canonical ID')
    if any(not re.fullmatch(re.escape(C.PREFIXES[table]) + r'[A-Za-z0-9-]+', x) for x in ids):
        raise ValueError(f'{table}: wrong-country or malformed ID')
    if table != 'Institutions':
        status_field = 'Identity Verification Status' if table == 'Scholars' else 'Verification Status'
        if any((r.get(status_field) not in (None, '') and r.get(status_field) not in C.STATUSES) or (yes(r.get('Public Display Approved')) and not r.get(status_field)) for r in records):
            raise ValueError(f'{table}: unknown verification status')
    return records


def allowed_fields(config):
    allow = {table:set() for table in C.FIELDS}
    decisions = {}
    for r in config:
        table, field = r.get('Table',''), r.get('Field','')
        if table not in allow or field not in C.FIELDS[table] or field in C.FORBIDDEN:
            continue
        approval = yes(r.get('Publicly Exportable'))
        previous = decisions.get((table,field))
        if previous is not None and previous != approval:
            raise ValueError('Conflicting public-export decisions')
        decisions[(table,field)] = approval
    for (table,field),approval in decisions.items():
        if approval:
            allow[table].add(field)
    return allow


def eligible(r, identity=False):
    return r.get('Identity Verification Status' if identity else 'Verification Status') == 'Verified' and yes(r.get('Public Display Approved'))


def canonical_institution(value):
    value = re.sub(r'\s+', ' ', str(value).strip())
    if re.search(r'Te Herenga Waka|Victoria University of Wellington', value, re.I):
        return 'Victoria University of Wellington'
    return value


def sanitize(table, record, allowed):
    result = {f: record.get(f,'') for f in C.FIELDS[table] if f in allowed[table]}
    for k,v in list(result.items()):
        if 'Country' in k or k == 'Country':
            result[k] = C.COUNTRY_ALIASES.get(str(v),v)
        if k == 'Canonical University Name (C_Uni)':
            result[k] = canonical_institution(v)
        if ('URL' in k or 'Handle' in k) and v and not str(v).startswith(('http://','https://')):
            result[k] = ''
    return result


def transform(source, enrichment=None):
    raw = {name:keyed(name, rows(source[name], C.REQUIRED[name])) for name in C.KEYS}
    config = rows(source['Public Export Config'], ['Table','Field','Publicly Exportable'])
    allowed = allowed_fields(config)
    if not {'Scholar ID','Scholar Name'} <= allowed['Scholars']:
        raise ValueError('Public Scholar ID/Name are not explicitly approved')
    if not raw['Scholars']:
        raise ValueError('Unexpected empty Scholar read; preserving previous snapshot')
    sids = {r['Scholar ID'] for r in raw['Scholars']}
    pids = {r['Publication ID'] for r in raw['Publications']}
    for r in raw['Graduate Degrees']:
        if r['Scholar ID'] not in sids:
            raise ValueError('Dangling degree-to-scholar relationship')
    for r in raw['Authorship']:
        if r['Scholar ID'] not in sids or r['Publication ID'] not in pids:
            raise ValueError('Dangling authorship relationship')
    for r in raw['Research Geography']:
        if r['Publication ID'] not in pids:
            raise ValueError('Dangling research-location relationship')
        if r.get('Province') and r.get('Country') == 'Vanuatu' and r['Province'] not in C.PROVINCES:
            raise ValueError('Unresolved research province')
        for key,low,high in [('Latitude',-90,90),('Longitude',-180,180)]:
            if r.get(key,'') != '' and not low <= float(r[key]) <= high:
                raise ValueError('Invalid research coordinate')
    people = [r for r in raw['Scholars'] if eligible(r,True)]
    eligible_ids = {r['Scholar ID'] for r in people}
    degrees = [r for r in raw['Graduate Degrees'] if eligible(r) and r['Scholar ID'] in eligible_ids]
    pubs = [r for r in raw['Publications'] if eligible(r)]
    eligible_pids = {r['Publication ID'] for r in pubs}
    authors = [r for r in raw['Authorship'] if r['Verification Status']=='Verified' and r['Scholar ID'] in eligible_ids and r['Publication ID'] in eligible_pids]
    geo = [r for r in raw['Research Geography'] if eligible(r) and r['Publication ID'] in eligible_pids]
    public_universities = {canonical_institution(d.get('Canonical University Name (C_Uni)','')) for d in degrees}
    institutions = [r for r in raw['Institutions'] if yes(r.get('Active')) and canonical_institution(r.get('Canonical Institution (C_Uni)','')) in public_universities]
    for r in institutions:
        for key,low,high in [('Latitude',-90,90),('Longitude',-180,180)]:
            if r.get(key) not in ('',None) and not low<=float(r[key])<=high:
                raise ValueError('Invalid institution coordinate')
    chosen = {'Scholars':people,'Graduate Degrees':degrees,'Publications':pubs,'Authorship':authors,'Research Geography':geo,'Institutions':institutions}
    pathways = []
    if 'Study Pathways' in source:
        pathway_rows = rows(source['Study Pathways'],['Pathway ID','Scholar ID',"Master's Degree ID",'PhD Degree ID','Verification Status','Public Display Approved'])
        by_degree = {d['Degree ID']:d for d in degrees}
        seen_paths = set()
        for r in pathway_rows:
            if not r.get('Pathway ID'):
                continue
            if r['Pathway ID'] in seen_paths:
                raise ValueError('Duplicate pathway key')
            seen_paths.add(r['Pathway ID'])
            if not eligible(r) or r['Scholar ID'] not in eligible_ids:
                continue
            master, phd = by_degree.get(r["Master's Degree ID"]), by_degree.get(r['PhD Degree ID'])
            if not master or not phd or any(d['Scholar ID']!=r['Scholar ID'] for d in (master,phd)):
                raise ValueError('Explicit pathway owners/degree links do not agree')
            if 'Master' not in master['Degree Level'] or not re.search('PhD|Doctor',phd['Degree Level']) or master['Completion Status']!='Completed' or phd['Completion Status'] not in ('Completed','Ongoing','In progress'):
                raise ValueError('Explicit pathway has invalid degree levels/status')
            if set(C.FIELDS['Study Pathways']) <= allowed['Study Pathways'] and {'Degree ID','Scholar ID','Degree Level','Completion Status','Canonical University Name (C_Uni)','University Country'} <= allowed['Graduate Degrees']:
                pathways.append({f:r[f] for f in C.FIELDS['Study Pathways']})
    chosen['Study Pathways'] = pathways
    tables = {}
    # Only release relational tables when their stable join keys are approved.
    joins = {'Graduate Degrees':{'Degree ID','Scholar ID'},'Publications':{'Publication ID'},'Authorship':{'Publication ID','Scholar ID'},'Research Geography':{'Publication ID'},'Institutions':{'Institution ID'}}
    for name,records in chosen.items():
        tables[name] = [sanitize(name,r,allowed) for r in records] if name not in joins or joins[name] <= allowed[name] else []
    # Only the two currently approved thesis fields, with no unapproved person,
    # degree key, institution or date. Separate from Publication counts.
    thesis_fields = {'Thesis / Dissertation Title','Thesis URL / Handle'} & allowed['Graduate Degrees']
    theses = [{k:r.get(k,'') for k in sorted(thesis_fields)} for r in degrees if r.get('Thesis / Dissertation Title') and 'Thesis / Dissertation Title' in thesis_fields]
    seen = set()
    theses = [r for r in theses if not (json.dumps(r,sort_keys=True) in seen or seen.add(json.dumps(r,sort_keys=True)))]
    public_enrichment = {}
    for sid,r in (enrichment or {}).get('scholars',{}).items():
        if sid not in eligible_ids or not yes(r.get('approved')):
            continue
        out = {}
        for field in allowed['Admin enrichment']:
            if field=='photo' and str(r.get(field,'')).startswith('https://'):
                out[field]=r[field]
            elif field=='summary':
                out[field]=str(r.get(field,''))[:12000]
            elif field=='keywords' and isinstance(r.get(field),list):
                out[field]=[v[:200] for v in r[field][:50] if isinstance(v,str)]
            elif field=='sector':
                out[field]=str(r.get(field,''))[:200]
            elif field in ('institutionUrl','departmentUrl') and str(r.get(field,'')).startswith('https://'):
                out[field]=r[field]
            elif field=='sources' and isinstance(r.get(field),list):
                out[field]=[u for u in r[field] if isinstance(u,str) and u.startswith(('http://','https://'))]
        if out:
            public_enrichment[sid]=out
    content = {'country':'Vanuatu','schemaVersion':1,'fields':{t:sorted(allowed[t]) for t in allowed},'tables':tables,'theses':theses,'enrichment':public_enrichment,'notices':['Only individually approved fields are exported. Restricted views display unavailable, not zero.']}
    # No implicit public sidecars. Explicit separate owner approval is required.
    content['generation'] = hashlib.sha256(json.dumps(content,sort_keys=True,ensure_ascii=False).encode()).hexdigest()[:16]
    return content


def fetch_live():
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    info = json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    credentials = Credentials.from_service_account_info(info, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    api = build('sheets','v4',credentials=credentials,cache_discovery=False)
    metadata = api.spreadsheets().get(spreadsheetId=C.SPREADSHEET_ID,fields='properties(title),sheets(properties(title,gridProperties))').execute()
    if metadata['properties']['title'] != 'Vanuatu Scholarly Database — Master File':
        raise ValueError('Unexpected source workbook title')
    sheets = {s['properties']['title']:s['properties']['gridProperties'] for s in metadata['sheets']}
    result = {}
    # Full bounded metadata-derived grids. Sparse trailing FALSE rows are omitted
    # only by canonical keys, never by prepared grid dimensions.
    for name in [*C.KEYS,'Public Export Config']:
        if name not in sheets:
            raise ValueError('Missing exact live worksheet title')
        n=sheets[name]['columnCount'];col=''
        while n:
            n,k=divmod(n-1,26);col=chr(65+k)+col
        escaped=name.replace("'","''")
        result[name] = api.spreadsheets().values().get(spreadsheetId=C.SPREADSHEET_ID,range=f"'{escaped}'!A1:{col}{sheets[name]['rowCount']}",valueRenderOption='UNFORMATTED_VALUE').execute().get('values',[])
    if 'Study Pathways' in sheets:
        grid=sheets['Study Pathways']
        result['Study Pathways']=api.spreadsheets().values().get(spreadsheetId=C.SPREADSHEET_ID,range=f"'Study Pathways'!A1:J{grid['rowCount']}",valueRenderOption='UNFORMATTED_VALUE').execute().get('values',[])
    return result


def fetch_enrichment():
    file_id=os.environ.get('VANUATU_ENRICHMENT_FILE_ID')
    if not file_id:
        return {}
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    info=json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON'])
    credentials=Credentials.from_service_account_info(info,scopes=['https://www.googleapis.com/auth/drive.readonly'])
    drive=build('drive','v3',credentials=credentials,cache_discovery=False)
    data=drive.files().get_media(fileId=file_id).execute()
    return json.loads(data)


def encrypt(payload, passcode):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    salt,iv=os.urandom(16),os.urandom(12)
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=salt,iterations=200000).derive(passcode.encode())
    return b'IVAV'+salt+iv+AESGCM(key).encrypt(iv,payload,None)


def decrypt(blob, passcode):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    if blob[:4]!=b'IVAV':raise ValueError('Unknown encryption format')
    key=PBKDF2HMAC(algorithm=hashes.SHA256(),length=32,salt=blob[4:20],iterations=200000).derive(passcode.encode())
    return AESGCM(key).decrypt(blob[20:32],blob[32:],None)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,help='Private JSON source fixture (never commit)');ap.add_argument('--enrichment',type=Path,help='Private approved sidecar fixture');ap.add_argument('--dry-run',action='store_true');ap.add_argument('--out-dir',type=Path,default=Path('data'));args=ap.parse_args()
    bundle=transform(json.loads(args.source.read_text()) if args.source else fetch_live(),json.loads(args.enrichment.read_text()) if args.enrichment else ({} if args.source else fetch_enrichment()))
    if args.dry_run:
        print(json.dumps({'country':'Vanuatu','generation':bundle['generation'],'publicScholars':len(bundle['tables']['Scholars']),'releasedFields':bundle['fields'],'privacy':'exact allowlist; private evidence/queues absent'}));return
    passcode=os.environ.get('VAVELAB_VANUATU_PASSCODE')
    if not passcode:raise ValueError('Vanuatu-specific encryption secret is missing; no snapshot written')
    collaborator=os.environ.get('VAVELAB_VANUATU_COLLABORATOR_PASSCODE')
    if collaborator and collaborator == passcode:
        raise ValueError('Owner and collaborator passwords must differ; no snapshot written')
    args.out_dir.mkdir(parents=True,exist_ok=True)
    targets=[(args.out_dir/C.OUTPUT_NAME,passcode)]
    collaborator_target=args.out_dir/'vanuatu-collaborator-bundle.json.enc'
    if collaborator:
        targets.append((collaborator_target,collaborator))
    elif collaborator_target.exists():
        raise ValueError('Existing collaborator snapshot requires its secret; no snapshot written')
    pending=[]
    for target,key in targets:
        if target.exists():
            old=json.loads(decrypt(target.read_bytes(),key))
            if old.get('enrichment') and set(old['enrichment'])-set(bundle['enrichment']):
                raise ValueError('Approved sidecars disappeared; explicit owner reconciliation required before replacing snapshot')
            if old.get('generation')==bundle['generation']:
                continue
        pending.append((target,key))
    if not pending:
        print('No public content changes; retaining previous coherent generation.');return
    bundle['generatedAt']=datetime.now(timezone.utc).isoformat()
    payload=json.dumps(bundle,ensure_ascii=False,sort_keys=True).encode()
    staged=[]
    try:
        # Stage and round-trip every new ciphertext before replacing any file.
        # Git publishes both viewing copies together; neither contains Admin credentials.
        for target,key in pending:
            ciphertext=encrypt(payload,key)
            if decrypt(ciphertext,key)!=payload:raise ValueError('Encryption round-trip failed')
            with tempfile.NamedTemporaryFile(dir=args.out_dir,delete=False) as f:
                f.write(ciphertext);staged.append((Path(f.name),target))
        for temp,target in staged:temp.replace(target)
    finally:
        for temp,target in staged:temp.unlink(missing_ok=True)
    print('Wrote '+str(len(pending))+' encrypted Vanuatu viewing snapshot(s), generation '+bundle['generation'])



if __name__=='__main__':
    main()
