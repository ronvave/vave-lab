from pathlib import Path

p = Path('s.html')
s = p.read_text(encoding='utf-8')

old_css = """          .scholar-pubs-review__list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
          .scholar-pubs-review__list>.db-item{margin:0!important;width:auto!important;max-width:none!important;overflow:visible!important}
          .scholar-geo-editor{margin:12px -1px -1px;padding:12px 14px 14px;border-top:1px dashed #d6d8d9;background:#f8fbfb;border-radius:0 0 10px 10px;overflow:visible!important}
          .scholar-geo-editor__label{font-weight:700;color:#174852;font-size:.82rem;margin-bottom:7px}
          .scholar-geo-editor__row{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;overflow:visible!important}
          details.scholar-geo-menu{position:relative;overflow:visible!important}
          details.scholar-geo-menu>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #cbd5d8;border-radius:999px;background:#fff;color:#174852;font-size:.8rem;font-weight:600;user-select:none}
          details.scholar-geo-menu>summary::-webkit-details-marker{display:none}
          details.scholar-geo-menu[open]>summary{border-color:#0e7490;box-shadow:0 0 0 2px rgba(14,116,144,.10)}
          .scholar-geo-menu__count{display:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#0e7490;color:#fff;align-items:center;justify-content:center;font-size:.68rem}
          .scholar-geo-menu.has-selection .scholar-geo-menu__count{display:inline-flex}
          .scholar-geo-options{
            position:fixed!important;z-index:2147483000!important;width:290px;max-width:calc(100vw - 20px);
            max-height:min(340px,46vh);overflow:auto;padding:8px;background:#fff;border:1px solid #cbd5d8;
            border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.22)
          }
"""
new_css = """          .scholar-pubs-review__list{list-style:none;margin:0;padding:0;display:grid;gap:12px}
          .scholar-pubs-review__list>.db-item{margin:0!important;width:auto!important;max-width:none!important;position:relative!important;overflow:hidden!important}
          .scholar-pubs-review__list>.db-item:has(.scholar-geo-menu[open]){padding-bottom:235px!important}
          .scholar-geo-editor{display:none!important}
          .scholar-geo-toolbar{display:flex!important;align-items:center!important;justify-content:flex-end!important;gap:7px!important;flex-wrap:wrap!important;position:relative!important;overflow:visible!important}
          .scholar-geo-toolbar .scholar-geo-editor__row{display:flex!important;align-items:center!important;gap:7px!important;flex-wrap:nowrap!important;overflow:visible!important}
          .scholar-geo-editor__label,.scholar-geo-editor__status{display:none!important}
          details.scholar-geo-menu{position:relative!important;overflow:visible!important}
          details.scholar-geo-menu>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid #cbd5d8;border-radius:999px;background:#fff;color:#174852;font-size:.8rem;font-weight:600;user-select:none;white-space:nowrap}
          details.scholar-geo-menu>summary::-webkit-details-marker{display:none}
          details.scholar-geo-menu[open]>summary{border-color:#0e7490;box-shadow:0 0 0 2px rgba(14,116,144,.10)}
          .scholar-geo-menu__count{display:none;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#0e7490;color:#fff;align-items:center;justify-content:center;font-size:.68rem}
          .scholar-geo-menu.has-selection .scholar-geo-menu__count{display:inline-flex}
          .scholar-geo-options{
            position:absolute!important;z-index:80!important;top:calc(100% + 6px)!important;right:0!important;width:250px!important;max-width:min(250px,calc(100vw - 28px))!important;
            max-height:210px!important;overflow:auto!important;padding:8px;background:#fff;border:1px solid #cbd5d8;
            border-radius:10px;box-shadow:0 10px 24px rgba(0,0,0,.22)
          }
"""
if old_css not in s:
    raise SystemExit('Expected geotag CSS block not found')
s = s.replace(old_css, new_css, 1)

old_js = """          var node = sourceNodes[idx] ? sourceNodes[idx].cloneNode(true) : fallbackPublicationCard(d, item);
          node.style.overflow = 'visible';
          var editor = buildGeoEditor(d, state, item, dirty);
          node.appendChild(editor);
          list.appendChild(node);
"""
new_js = """          var node = sourceNodes[idx] ? sourceNodes[idx].cloneNode(true) : fallbackPublicationCard(d, item);
          node.style.overflow = 'hidden';
          var editor = buildGeoEditor(d, state, item, dirty);
          node.appendChild(editor);
          integrateGeoControlsIntoPublicationCard(node, editor);
          list.appendChild(node);
"""
if old_js not in s:
    raise SystemExit('Expected publication clone block not found')
s = s.replace(old_js, new_js, 1)

marker = """      function buildGeoEditor(d, state, item, dirty) {
"""
helper = """      function integrateGeoControlsIntoPublicationCard(node, editor) {
        if (!node || !editor) return;

        // Remove the small black DOI badge beside the publication-type badge,
        // while preserving the working DOI link in the top-right action area.
        Array.prototype.slice.call(node.querySelectorAll('span,div,strong,b')).forEach(function (el) {
          if (String(el.textContent || '').trim().toUpperCase() !== 'DOI') return;
          if (el.closest('a')) return;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 80 && rect.height <= 40) el.remove();
        });

        var row = editor.querySelector('.scholar-geo-editor__row');
        if (!row) return;

        var actionAnchor = Array.prototype.slice.call(node.querySelectorAll('a')).find(function (a) {
          return /^(DOI|LINK|ZOTERO)\\b/i.test(String(a.textContent || '').trim());
        });
        var toolbar = actionAnchor && actionAnchor.parentElement;
        if (!toolbar) {
          toolbar = node.ownerDocument.createElement('div');
          toolbar.style.position = 'absolute';
          toolbar.style.top = '10px';
          toolbar.style.right = '12px';
          node.appendChild(toolbar);
        }
        toolbar.classList.add('scholar-geo-toolbar');
        toolbar.appendChild(row);
        editor.remove();
      }

"""
if marker not in s:
    raise SystemExit('buildGeoEditor marker not found')
s = s.replace(marker, helper + marker, 1)

p.write_text(s, encoding='utf-8')
print('Patched s.html successfully')
