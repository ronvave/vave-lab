#!/usr/bin/env python3
"""Structural checks only; not a substitute for rendered-browser acceptance."""
from pathlib import Path
from html.parser import HTMLParser
import json
import subprocess
ROOT=Path(__file__).resolve().parents[1]
class Links(HTMLParser):
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag in ('script','link','iframe'):
            value=a.get('src') or (a.get('href') if tag=='link' else '')
            if value and not value.startswith(('https:','http:','data:')):
                assert (ROOT/value.split('?')[0]).exists(),value
for filename in ['vanuatu-research-database-master.html','admin-vanuatu-master.html','vanuatu-chord-flanked.html','s-vanuatu.html']:
    text=(ROOT/filename).read_text();Links().feed(text)
    if filename!='vanuatu-chord-flanked.html':
        assert 'tongan-' not in text and 'TNG-S' not in text,filename
    assert '<html' in text and '</html>' in text,filename
for path in list((ROOT/'js').glob('*vanuatu*.js')):
    subprocess.run(['node','--check',str(path)],check=True)
geo=json.loads((ROOT/'data/vanuatu-provinces.geojson').read_text())
assert len(geo['features'])==6
assert {f['properties']['shapeName'] for f in geo['features']}=={'Torba','Sanma','Penama','Malampa','Shefa','Tafea'}
native=(ROOT/'apps-script/vanuatu-admin-app.html').read_text()
class NativeLinks(HTMLParser):
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        assert not (a.get('src','').startswith('js/') or a.get('href','').startswith('css/')),a
NativeLinks().feed(native)
assert 'tonganlab_gh_token' not in native and 'var PASSWORD_HASH' not in native
print('Vanuatu assets, namespaces, boundary joins and JS syntax pass.')
