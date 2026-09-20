#!/usr/bin/env python3
"""Persist stable Tonga profile tokens in Scholars and publish the lookup only.
No names, private lineage, contact information or submissions are exported.
"""
import json
import os
import re
import secrets
from pathlib import Path

SHEET_ID = '1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI'

def column(n):
    out = ''
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out

def prepare(rows):
    headers = rows[3]
    sid_col = headers.index('Scholar ID')
    token_col = headers.index('Scholar Share Token') if 'Scholar Share Token' in headers else len(headers)
    writes = []
    if token_col == len(headers):
        writes.append({'range': f"'Scholars'!{column(token_col+1)}4", 'values': [['Scholar Share Token']]})
    mapping = {}
    for i, row in enumerate(rows[4:], 5):
        sid = str(row[sid_col] if len(row) > sid_col else '').strip()
        if not sid:
            continue
        if not re.fullmatch(r'TNG-S\d{4}', sid) or sid in mapping:
            raise ValueError('Invalid or duplicate Tonga Scholar ID')
        token = str(row[token_col] if len(row) > token_col else '').strip()
        if token and not re.fullmatch(r'[0-9a-f]{40}', token):
            raise ValueError('Existing token is malformed; manual review required')
        if not token:
            token = secrets.token_hex(20)
            writes.append({'range': f"'Scholars'!{column(token_col+1)}{i}", 'values': [[token]]})
        mapping[sid] = token
    if not mapping or len(set(mapping.values())) != len(mapping):
        raise ValueError('Missing roster or duplicate share token')
    return writes, mapping

def main():
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_info(json.loads(os.environ['GOOGLE_SERVICE_ACCOUNT_JSON']), scopes=['https://www.googleapis.com/auth/spreadsheets'])
    api = build('sheets','v4',credentials=creds,cache_discovery=False).spreadsheets().values()
    rows = api.get(spreadsheetId=SHEET_ID,range="'Scholars'!A:ZZ").execute().get('values',[])
    writes, mapping = prepare(rows)
    if writes:
        api.batchUpdate(spreadsheetId=SHEET_ID,body={'valueInputOption':'RAW','data':writes}).execute()
    # Reread before publication; never publish a token not stored in Master.
    fresh = api.get(spreadsheetId=SHEET_ID,range="'Scholars'!A:ZZ").execute().get('values',[])
    pending, confirmed = prepare(fresh)
    if pending or confirmed != mapping:
        raise RuntimeError('Master changed during token sync; retry before publishing')
    Path('data/tongan-share-tokens.json').write_text(json.dumps({'v':1,'country':'Tonga','m':mapping},sort_keys=True,separators=(',',':'))+'\n')
    print(f'Confirmed stable share tokens for {len(mapping)} Tonga scholars.')

if __name__ == '__main__':
    main()
