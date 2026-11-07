#!/usr/bin/env python3
"""Link analytics: Google Analytics reports -> data/link-analytics.json.enc.

Reads the GA4 property behind G-7LJP79H70W with a read-only service account
(Viewer on the property) and writes one encrypted file that only
link-analytics.html can open, with LINK_ANALYTICS_PASSCODE.

Visits are attributed by the page_location set in js/link-analytics.js:
<page>?lc=<country code|none>&lt=<c|r|a1|none>. Panel time comes from
panel_<ID> events (value = seconds on screen).

Env: GA_PROPERTY_ID (numeric), GA_SERVICE_ACCOUNT_JSON, LINK_ANALYTICS_PASSCODE.
Prints only "link-analytics: updated|unchanged" (or a short error).
No secrets or report rows are printed.
"""
import html, json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from regional_viewer_access import opens, seal  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'link-analytics.json.enc'
BASE = '/vave-lab/'
PAGES = {
    'pacific-scholars.html': 'REG',
    'itaukei-research-database-master.html': 'FJI',
    'hawaii-research-database-master.html': 'HAW',
    'samoa-research-database-master.html': 'WSM',
    'solomon-islands-research-database-master.html': 'SLB',
    'tongan-research-database-master.html': 'TON',
    'vanuatu-research-database-master.html': 'VUT',
}
START = '2026-11-01'  # tracking by link began in November 2026


MENU_JS = {'FJI': 'itaukei', 'HAW': 'hawaii', 'WSM': 'samoa', 'SLB': 'solomon', 'TON': 'tongan', 'VUT': 'vanuatu'}


def panel_titles():
    """{dashboard: {panel code: name}} from each dashboard's panel menu
    (country pages) or data-panel-title markup (Regional)."""
    out = {}
    for page, code in PAGES.items():
        if code == 'REG':
            src = (ROOT / page).read_text(encoding='utf-8', errors='replace')
            pairs = re.findall(r'data-panel="([A-Za-z0-9]+)"[^>]*data-panel-title="([^"]+)"', src)
        else:
            src = (ROOT / 'js' / f'{MENU_JS[code]}-panel-menu.js').read_text(encoding='utf-8', errors='replace')
            pairs = re.findall(r"\['([A-H][0-9]?)',\s*'([^']+)'\]", src)
        out[code] = {k: html.unescape(v).strip()[:80] for k, v in pairs}
    return out


def session():
    info = json.loads(os.environ.get('GA_SERVICE_ACCOUNT_JSON') or '{}')
    if not info.get('client_email'):
        sys.exit('GA_SERVICE_ACCOUNT_JSON secret is missing')
    cred = service_account.Credentials.from_service_account_info(
        info, scopes=['https://www.googleapis.com/auth/analytics.readonly'])
    cred.refresh(Request())
    return cred.token, info['client_email']


def page_filter(extra=None):
    f = {'filter': {'fieldName': 'pagePath', 'inListFilter': {'values': [BASE + p for p in PAGES]}}}
    return {'andGroup': {'expressions': [f, extra]}} if extra else f


def run(token, prop, dims, mets, flt=None, order=None, limit=100000):
    body = {'dateRanges': [{'startDate': START, 'endDate': 'today'}],
            'dimensions': [{'name': d} for d in dims], 'metrics': [{'name': m} for m in mets],
            'dimensionFilter': flt or page_filter(), 'limit': limit, 'keepEmptyRows': False}
    if order:
        body['orderBys'] = order
    r = requests.post(f'https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport',
                      headers={'Authorization': f'Bearer {token}'}, json=body, timeout=120)
    if r.status_code != 200:
        msg = (r.json().get('error', {}) if r.headers.get('content-type', '').startswith('application/json') else {}).get('status', r.status_code)
        sys.exit(f'Google Analytics report failed ({msg})')
    rows = []
    for row in r.json().get('rows', []):
        rows.append([v['value'] for v in row['dimensionValues']] + [float(v['value']) for v in row['metricValues']])
    return rows


def link_of(path_qs):
    """'/vave-lab/x.html?lc=HAW&lt=r' -> (dash, lc, lt)."""
    u = urlsplit(path_qs)
    q = parse_qs(u.query)
    dash = PAGES.get(u.path[len(BASE):] if u.path.startswith(BASE) else u.path, '')
    lc = (q.get('lc') or ['none'])[0]
    lc = lc if re.fullmatch(r'[A-Z]{3}|none', lc) else 'none'
    lt = (q.get('lt') or ['none'])[0]
    lt = lt if lt in ('c', 'r', 'a1', 'none') else 'none'
    return dash, lc, lt


def main():
    pw = os.environ.get('LINK_ANALYTICS_PASSCODE', '')
    prop = re.sub(r'\D', '', os.environ.get('GA_PROPERTY_ID', ''))
    if len(pw) < 8 or not prop:
        sys.exit('LINK_ANALYTICS_PASSCODE or GA_PROPERTY_ID secret is missing')
    token, _ = session()

    def keyed(rows, n):
        out = []
        for r in rows:
            dash, lc, lt = link_of(r[n])
            if dash:
                out.append(r[:n] + [dash, lc, lt] + r[n + 1:])
        return out

    panel_evt = {'filter': {'fieldName': 'eventName', 'stringFilter': {'matchType': 'BEGINS_WITH', 'value': 'panel_'}}}
    d = {
        'generated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'start': START,
        'property_tz_note': 'Day and hour use the Google Analytics property time zone.',
        # [date, dash, lc, lt, country, city, sessions, users, views, engagedSec, newUsers]
        'visits': keyed(run(token, prop, ['date', 'pagePathPlusQueryString', 'country', 'city'],
                            ['sessions', 'activeUsers', 'screenPageViews', 'userEngagementDuration', 'newUsers']), 1),
        # [date, dash, lc, lt, event, country, count, seconds]
        'panels': keyed(run(token, prop, ['date', 'pagePathPlusQueryString', 'eventName', 'country'], ['eventCount', 'eventValue'],
                            flt=page_filter(panel_evt)), 1),
        # [date, dash, lc, lt, country, device, browser, os, sessions]
        'tech': keyed(run(token, prop, ['date', 'pagePathPlusQueryString', 'country', 'deviceCategory', 'browser', 'operatingSystem'], ['sessions']), 1),
        # [date, dash, lc, lt, country, dayOfWeek, hour, sessions]
        'when': keyed(run(token, prop, ['date', 'pagePathPlusQueryString', 'country', 'dayOfWeek', 'hour'], ['sessions']), 1),
        # [dateHourMinute, dash, lc, lt, country, city, device, sessions, engagedSec]
        'recent': keyed(run(token, prop, ['dateHourMinute', 'pagePathPlusQueryString', 'country', 'city', 'deviceCategory'],
                            ['sessions', 'userEngagementDuration'],
                            order=[{'dimension': {'dimensionName': 'dateHourMinute'}, 'desc': True}], limit=300), 1),
        # [dash, lc, lt, users] over the whole period (unique per link and page)
        'users': keyed(run(token, prop, ['pagePathPlusQueryString'], ['activeUsers']), 0),
        'titles': panel_titles(),
    }
    data_only = {k: v for k, v in d.items() if k != 'generated'}
    if OUT.exists():
        old = opens(OUT.read_bytes(), pw)
        if old is not None:
            prev = json.loads(old)
            prev.pop('generated', None)
            if prev == data_only:
                print('link-analytics: unchanged')
                return
    OUT.write_bytes(seal(json.dumps(d, ensure_ascii=False, separators=(',', ':')).encode(), pw))
    print('link-analytics: updated')


if __name__ == '__main__':
    main()
