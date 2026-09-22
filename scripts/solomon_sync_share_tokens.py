#!/usr/bin/env python3
"""Persist stable Solomon profile tokens in Scholars and publish the lookup only.
No names, private lineage, contact information or submissions are exported.
"""
import json
import os
import re
import secrets
from pathlib import Path

SHEET_ID = '1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY'

def column(n):
    out = ''
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out

def prepare(rows, create_missing=True):
    headers = rows[0]
    sid_col = headers.index('Scholar ID')
    token_col = headers.index('Scholar Share Token') if 'Scholar Share Token' in headers else len(headers)
    writes = []
    if token_col == len(headers):
        writes.append({'range': f"'Scholars'!{column(token_col+1)}1", 'values': [['Scholar Share Token']]})
    mapping = {}
    seen_ids = set()
    for i, row in enumerate(rows[1:], 2):
        sid = str(row[sid_col] if len(row) > sid_col else '').strip()
        if not sid:
            continue
        if not re.fullmatch(r'SOL-S\d{4}', sid) or sid in seen_ids:
            raise ValueError('Invalid or duplicate Solomon Scholar ID')
        seen_ids.add(sid)
        token = str(row[token_col] if len(row) > token_col else '').strip()
        if token and not re.fullmatch(r'[0-9a-f]{40}', token):
            raise ValueError('Existing token is malformed; manual review required')
        if not token and not create_missing:
            continue
        if not token:
            token = secrets.token_hex(20)
            writes.append({'range': f"'Scholars'!{column(token_col+1)}{i}", 'values': [[token]]})
        mapping[sid] = token
    if not seen_ids or len(set(mapping.values())) != len(mapping):
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
        try:
            api.batchUpdate(spreadsheetId=SHEET_ID,body={'valueInputOption':'RAW','data':writes}).execute()
        except Exception as exc:
            if getattr(getattr(exc, 'resp', None), 'status', None) != 403:
                raise
            print('::warning::Refresh account cannot create missing share tokens. Owner must initialize new scholar tokens in Master; existing links still refresh.')
    # Publish only tokens confirmed in Master, never unpersisted random values.
    fresh = api.get(spreadsheetId=SHEET_ID,range="'Scholars'!A:ZZ").execute().get('values',[])
    _, confirmed = prepare(fresh, create_missing=False)
    missing = len(mapping) - len(confirmed)
    if missing:
        print(f'::warning::{missing} scholar links await owner initialization.')
    mapping = confirmed
    Path('data/solomon-share-tokens.json').write_text(json.dumps({'v':1,'country':'Solomon Islands','m':mapping},sort_keys=True,separators=(',',':'))+'\n')
    print(f'Confirmed stable share tokens for {len(mapping)} Solomon scholars.')

if __name__ == '__main__':
    main()
