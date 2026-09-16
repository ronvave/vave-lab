/*
 * Master-file publication geography repair — 2026-09-13
 *
 * Research Geography is the authoritative source for publication study
 * locations. This layer does three things:
 *   1. adds verified Master geography chips to publication cards;
 *   2. replaces province membership in dashboard state for publications that
 *      have verified Research Geography rows, so C2 uses the same source; and
 *   3. mirrors that authoritative province membership into the in-memory
 *      Master publication one-hots before the province/confederacy summaries
 *      are recalculated.
 *
 * Publications with NO verified Research Geography rows retain their legacy
 * province values as a compatibility fallback. Once a publication has one or
 * more verified Research Geography rows, those rows win and legacy province
 * flags are ignored for that publication.
 */
(function () {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isVerified(row) {
    var v = norm(row && row.Verification);
    return v.indexOf('verified') === 0 || v === 'strong';
  }

  function publicationKey(pub) {
    return String((pub && (pub['Publication ID / BibTeX Key'] || pub.key)) || '').trim();
  }

  function getFijiProvinces() {
    var a = window.MasterFileAdapter && window.MasterFileAdapter.constants;
    if (a && Array.isArray(a.PROVINCES)) return a.PROVINCES.slice();
    return ['Ba', 'Bua', 'Cakaudrove', 'Kadavu', 'Lau', 'Lomaiviti', 'Macuata',
      'Nadroga/Navosa', 'Naitasiri', 'Namosi', 'Ra', 'Rewa', 'Serua', 'Tailevu'];
  }

  function buildIndex(master) {
    var geoByKey = new Map();
    (master.geography || []).forEach(function (g) {
      if (!isVerified(g)) return;
      var key = String(g['Publication ID / BibTeX Key'] || '').trim();
      if (!key) return;
      if (!geoByKey.has(key)) geoByKey.set(key, []);
      geoByKey.get(key).push(g);
    });

    var byTitleYear = new Map();
    (master.publications || []).forEach(function (p) {
      var key = publicationKey(p);
      if (!key || !geoByKey.has(key)) return;
      var title = norm(p.Title || p.title);
      var year = String(p.Year || p.year || '').trim();
      if (!title) return;
      var idx = title + '||' + year;
      if (!byTitleYear.has(idx)) byTitleYear.set(idx, []);
      byTitleYear.get(idx).push({ key: key, rows: geoByKey.get(key), pub: p });
    });
    return { geoByKey: geoByKey, byTitleYear: byTitleYear };
  }

  function cardYear(card) {
    var meta = card.querySelector('.db-item__meta');
    if (!meta) return '';
    var m = String(meta.textContent || '').match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : '';
  }

  function uniqueLocations(rows) {
    var out = [];
    var seen = new Set();
    (rows || []).forEach(function (g) {
      var country = String(g.Country || '').trim();
      var province = String(g['Fiji Province'] || '').trim();
      var label = '';
      var kind = 'country';
      if (norm(country) === 'fiji') {
        if (province && norm(province) !== 'unclassified' && norm(province) !== 'unsure') {
          label = province;
          kind = 'province';
        } else {
          label = 'Fiji';
        }
      } else if (country) {
        label = country;
      }
      if (!label) return;
      var k = norm(label);
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ label: label, kind: kind });
    });
    return out;
  }

  function existingTagNames(card) {
    var set = new Set();
    card.querySelectorAll('.db-item__tags .db-item__badge').forEach(function (el) {
      set.add(norm(el.textContent).replace(/^📍\s*/, ''));
    });
    return set;
  }

  function ensureTagHost(card) {
    var host = card.querySelector('.db-item__tags');
    if (host) return host;
    host = document.createElement('div');
    host.className = 'db-item__tags';
    var actions = card.querySelector('.db-item__actions');
    if (actions) card.insertBefore(host, actions);
    else card.appendChild(host);
    return host;
  }

  function annotateCards(master, index) {
    var cards = document.querySelectorAll('[data-db-items] .db-item:not(.db-item__empty)');
    cards.forEach(function (card) {
      card.querySelectorAll('.mf-geo-location-tag').forEach(function (n) { n.remove(); });

      var titleEl = card.querySelector('.db-item__title');
      if (!titleEl) return;
      var title = norm(titleEl.textContent);
      var year = cardYear(card);
      var candidates = index.byTitleYear.get(title + '||' + year) || [];
      if (!candidates.length) {
        var titleMatches = [];
        index.byTitleYear.forEach(function (arr, k) {
          if (k.indexOf(title + '||') === 0) titleMatches = titleMatches.concat(arr);
        });
        if (titleMatches.length === 1) candidates = titleMatches;
      }
      if (!candidates.length) return;

      var rows = [];
      candidates.forEach(function (c) { rows = rows.concat(c.rows || []); });
      var locations = uniqueLocations(rows);
      if (!locations.length) return;

      var host = ensureTagHost(card);
      var existing = existingTagNames(card);
      locations.forEach(function (loc) {
        if (existing.has(norm(loc.label))) return;
        var chip = document.createElement('span');
        chip.className = 'db-item__badge db-item__badge--tag mf-geo-location-tag';
        chip.setAttribute('data-mf-geo-location', loc.label);
        chip.title = loc.kind === 'province'
          ? 'Verified Fiji province where this research was undertaken'
          : 'Verified country/location where this research was undertaken';
        chip.textContent = '📍 ' + loc.label;
        host.insertBefore(chip, host.firstChild);
        existing.add(norm(loc.label));
      });
    });
  }

  /*
   * Make verified Research Geography authoritative everywhere C2 reads
   * province membership. For a publication that has verified geography rows:
   *   - provincesByItem becomes exactly the verified named Fiji provinces;
   *   - legacy one-hot province flags on the in-memory publication are reset;
   *   - Fiji general/national is represented by PROVINCE_UNSPEC;
   *   - old Unsure values are cleared.
   * Publications without verified rows are deliberately left untouched.
   */
  function syncAuthoritativeGeographyIntoState(master, index) {
    var st = window.__vavelabDbState;
    if (!st) return;

    var provinces = getFijiProvinces();
    var validProv = new Set(provinces.map(norm));
    var pubByKey = new Map();
    (master.publications || []).forEach(function (p) {
      var key = publicationKey(p);
      if (key) pubByKey.set(key, p);
    });

    index.geoByKey.forEach(function (rows, key) {
      var named = new Set();
      var fijiGeneral = false;

      (rows || []).forEach(function (g) {
        if (norm(g.Country) !== 'fiji') return;
        var province = String(g['Fiji Province'] || '').trim();
        var np = norm(province);
        if (province && validProv.has(np)) named.add(province);
        else if (!province || np === 'unclassified' || np === 'unsure') fijiGeneral = true;
      });

      if (st.provincesByItem && typeof st.provincesByItem.set === 'function') {
        st.provincesByItem.set(key, new Set(Array.from(named)));
      }

      var p = pubByKey.get(key);
      if (p) {
        provinces.forEach(function (prov) { p[prov] = 0; });
        named.forEach(function (prov) { p[prov] = 1; });
        p['Fiji - no province specified'] = fijiGeneral ? 1 : 0;
        p.Unsure = 0;
      }
    });

    // Rebuild the Master-specific C2/confederacy summary from the now-synced
    // in-memory publications. This avoids card/totals drift.
    if (window.MasterFilePanelOverrides &&
        typeof window.MasterFilePanelOverrides.injectConfedTotals === 'function') {
      try { window.MasterFilePanelOverrides.injectConfedTotals(); } catch (e) {
        console.error('Research Geography C2 summary refresh failed', e);
      }
    }

    // Production panel renderers listen to the normal filter-change event.
    // Fire it once after the authoritative province sets are replaced so the
    // C2 bars and any province-sensitive lists recalculate immediately.
    try { window.dispatchEvent(new CustomEvent('vavelab:filters-changed')); } catch (e) {}
  }

  function installStyles() {
    if (document.getElementById('mf-geography-repair-style')) return;
    var s = document.createElement('style');
    s.id = 'mf-geography-repair-style';
    s.textContent =
      '.mf-geo-location-tag{cursor:default!important;}' +
      '.mf-geo-location-tag:hover{transform:none!important;}';
    document.head.appendChild(s);
  }

  function boot() {
    var tries = 0;
    (function waitForMaster() {
      var st = window.__vavelabDbState;
      var master = st && st.master;
      if (!master || !Array.isArray(master.geography) || !Array.isArray(master.publications)) {
        if (++tries < 240) setTimeout(waitForMaster, 50);
        return;
      }

      installStyles();
      var index = buildIndex(master);
      syncAuthoritativeGeographyIntoState(master, index);

      var scheduled = false;
      function applySoon() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function () {
          scheduled = false;
          annotateCards(master, index);
        });
      }

      applySoon();
      var list = document.querySelector('[data-db-items]');
      if (list) {
        new MutationObserver(applySoon).observe(list, { childList: true, subtree: true });
      }
      window.addEventListener('vavelab:filters-changed', applySoon);
      window.addEventListener('vavelab:master-hydrated', applySoon);

      window.MasterFileGeographyRepair = {
        refresh: applySoon,
        resync: function () {
          var fresh = buildIndex(master);
          syncAuthoritativeGeographyIntoState(master, fresh);
          index = fresh;
          applySoon();
        },
        verifiedRows: Array.from(index.geoByKey.values()).reduce(function (a, b) { return a.concat(b); }, [])
      };
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
