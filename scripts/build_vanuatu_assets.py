#!/usr/bin/env python3
"""Mechanical assembly of country-scoped native Admin and inherited B3.
No private data or credentials are read. Run after changing source assets.
"""
import json
import re
import argparse
from pathlib import Path
from bust_cache import _rewrite

ROOT = Path(__file__).resolve().parents[1]


def build():
    # Reuse the complete corrected Tonga chord layout and interaction code.
    html = (ROOT / 'tongan-chord-flanked.html').read_text()
    for a, b in [('TONGAN', 'VANUATU'), ('TonganMobility', 'VanuatuMobility'), ('tongan', 'vanuatu'), ('Tongan', 'Ni-Vanuatu'), ('Tonga', 'Vanuatu')]:
        html = html.replace(a, b)
    html = re.sub(r'js/vanuatu-mobility-model.js\?v=\w+', 'js/vanuatu-mobility-model.js', html)
    html = html.replace('js/main.js?v=86450a67', 'js/vanuatu-main.js')
    # Parent controls fullscreen without replacing/reloading the iframe.
    html = html.replace('async function init(){', "window.addEventListener('message',function(e){if(e.source!==window.parent||e.origin!==location.origin||e.data?.type!=='embed-fullscreen')return;document.body.classList.toggle('is-embed-fullscreen',e.data.value===true);window.dispatchEvent(new Event('resize'));});\nasync function init(){")
    (ROOT / 'js/vanuatu-main.js').write_text((ROOT / 'js/tongan-main.js').read_text())
    (ROOT / 'vanuatu-chord-flanked.html').write_text(_rewrite(html).rstrip() + '\n')
    # Local relative assets do not resolve in Apps Script's sandbox. Inline our
    # exact source assets, not arbitrary remote code or secret configuration.
    admin = (ROOT / 'admin-vanuatu-master.html').read_text()
    css = (ROOT / 'css/vanuatu-database.css').read_text()
    admin = re.sub(r'<link rel="stylesheet" href="css/vanuatu-database\.css(?:\?v=[^\"]+)?">', lambda _: '<style>' + css + '</style>', admin)
    for name in ['vanuatu-geography', 'vanuatu-model', 'vanuatu-config', 'vanuatu-preview-data', 'admin-vanuatu-master']:
        script = (ROOT / f'js/{name}.js').read_text().replace('</script', '<\\/script')
        admin = re.sub(r'<script defer src="js/' + re.escape(name) + r'\.js(?:\?v=[^\"]+)?"></script>', '', admin)
        admin = admin.replace('</body>', '<script>' + script + '</script></body>')
    admin = admin.replace('href="vanuatu-research-database-master.html"', 'href="https://ronvave.github.io/vave-lab/vanuatu-research-database-master.html" target="_blank" rel="noopener"')
    (ROOT / 'apps-script/vanuatu-admin-app.html').write_text(admin)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--boundary-source', type=Path)
    args = parser.parse_args()
    build()
    if args.boundary_source:
        geo = json.loads(args.boundary_source.read_text())
        assert len(geo['features']) == 6
        for feature in geo['features']:
            if feature['properties']['shapeName'] == 'Shefa Province':
                feature['properties']['originalShapeName'] = 'Shefa Province'
                feature['properties']['shapeName'] = 'Shefa'
        geo['metadata'] = {'boundaryID':'VUT-ADM1-32282491','yearRepresented':2017,'source':'geoBoundaries / OpenStreetMap, Wambacher','license':'Open Data Commons Open Database License 1.0','licenseURL':'https://opendatacommons.org/licenses/odbl/1-0/','sourceURL':'https://www.geoboundaries.org/api/current/gbOpen/VUT/ADM1/','downloadURL':'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/VUT/ADM1/geoBoundaries-VUT-ADM1_simplified.geojson','checked':'2026-10-03','purpose':'Reference province geometry; not proof of present-day council limits'}
        (ROOT/'data/vanuatu-provinces.geojson').write_text(json.dumps(geo,separators=(',',':')))
