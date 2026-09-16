/*
 * Authoritative Research Geography bridge — 2026-09-13
 *
 * Ensures every geography-sensitive V2 dashboard surface reads the same
 * verified Master-file Research Geography source used by scholar profile
 * review/approval. This runs after master-file-geography-repair.js.
 *
 * Key fixes:
 *   1. provincesByItem is keyed by the dashboard item key (not Publication ID);
 *   2. Fiji province membership is rebuilt from verified Research Geography;
 *   3. B4 country collection membership is rebuilt from verified Research
 *      Geography, removing stale legacy country memberships;
 *   4. Master in-memory province one-hots are mirrored from the same source so
 *      the province/confederacy summary override cannot drift from C2;
 *   5. one filter-change event is emitted after the authoritative state swap.
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

  function publicationId(pub) {
    return String((pub && (pub['Publication ID / BibTeX Key'] || pub._masterPublicationId)) || '').trim();
  }

  function countryAlias(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    var aliases = {
      'FSM': 'Federated States of Micronesia',
      'USA': 'United States',
      'U.S.': 'United States',
      'U.S.A.': 'United States',
      'United States of America': 'United States'
    };
    return aliases[s] || s;
  }

  function provinceList() {
    var a = window.MasterFileAdapter && window.MasterFileAdapter.constants;
    if (a && Array.isArray(a.PROVINCES)) return a.PROVINCES.slice();
    return ['Ba', 'Bua', 'Cakaudrove', 'Kadavu', 'Lau', 'Lomaiviti', 'Macuata',
      'Nadroga/Navosa', 'Naitasiri', 'Namosi', 'Ra', 'Rewa', 'Serua', 'Tailevu'];
  }

  function descendantKeys(collections, rootKey) {
    var out = new Set();
    var changed = true;
    while (changed) {
      changed = false;
      collections.forEach(function (c) {
        if (!c || !c.key || out.has(c.key)) return;
        if (c.parent === rootKey || (c.parent && out.has(c.parent))) {
          out.add(c.key);
          changed = true;
        }
      });
    }
    return out;
  }

  function run() {
    var st = window.__vavelabDbState;
    if (!st || !st.master || !st.snapshot || !Array.isArray(st.snapshot.items)) return false;

    var master = st.master;
    var items = st.snapshot.items;
    var collections = Array.isArray(st.snapshot.collections) ? st.snapshot.collections : [];
    var provinces = provinceList();
    var validProvinceByNorm = new Map();
    provinces.forEach(function (p) { validProvinceByNorm.set(norm(p), p); });

    // Publication ID -> dashboard item. The item key is the canonical key used
    // by provincesByItem and every production panel/filter map.
    var itemByPubId = new Map();
    items.forEach(function (item) {
      var pid = String(item && item._masterPublicationId || '').trim();
      if (pid) itemByPubId.set(pid, item);
    });

    // Verified Research Geography only.
    var geoByPub = new Map();
    (master.geography || []).forEach(function (g) {
      if (!isVerified(g)) return;
      var pid = String(g['Publication ID / BibTeX Key'] || '').trim();
      if (!pid) return;
      if (!geoByPub.has(pid)) geoByPub.set(pid, []);
      geoByPub.get(pid).push(g);
    });

    // Find the B4 geography collection root and every descendant country /
    // sub-location collection key so stale memberships can be removed safely.
    var b4Root = collections.find(function (c) {
      return c && !c.parent && /^B3-Where study was done/i.test(String(c.name || ''));
    });
    var b4Desc = b4Root ? descendantKeys(collections, b4Root.key) : new Set();
    var b4KeyByName = new Map();
    collections.forEach(function (c) {
      if (c && b4Desc.has(c.key)) b4KeyByName.set(String(c.name || '').trim(), c.key);
    });

    // Master publication rows are also updated in-memory so the Master-specific
    // province/confederacy summary reads the same authority as C2.
    var masterPubById = new Map();
    (master.publications || []).forEach(function (p) {
      var pid = publicationId(p);
      if (pid) masterPubById.set(pid, p);
    });

    geoByPub.forEach(function (rows, pid) {
      var item = itemByPubId.get(pid);
      var masterPub = masterPubById.get(pid);
      var namedProvinces = new Set();
      var hasFiji = false;
      var fijiGeneral = false;
      var verifiedCountries = new Set();

      rows.forEach(function (g) {
        var country = countryAlias(g.Country);
        if (country) verifiedCountries.add(country);

        if (norm(country) === 'fiji') {
          hasFiji = true;
          var rawProvince = String(g['Fiji Province'] || '').trim();
          var canonical = validProvinceByNorm.get(norm(rawProvince));
          if (canonical) namedProvinces.add(canonical);
          else if (!rawProvince || norm(rawProvince) === 'unclassified' ||
                   norm(rawProvince) === 'unsure' ||
                   norm(rawProvince) === 'fiji - no province specified' ||
                   norm(rawProvince) === 'fiji — general/national study') {
            fijiGeneral = true;
          }
        }
      });

      if (item) {
        // Correct keying: production provincesByItem uses item.key.
        if (st.provincesByItem && typeof st.provincesByItem.set === 'function') {
          st.provincesByItem.set(item.key, new Set(Array.from(namedProvinces)));
        }

        // Rebuild B4 memberships from verified RG. Remove every previous B4
        // descendant key first; non-geography collections are untouched.
        var existing = Array.isArray(item.collections) ? item.collections : [];
        item.collections = existing.filter(function (key) { return !b4Desc.has(key); });
        verifiedCountries.forEach(function (country) {
          var key = b4KeyByName.get(country);
          if (key && item.collections.indexOf(key) === -1) item.collections.push(key);
        });
        if (hasFiji) {
          var fijiKey = b4KeyByName.get('Fiji');
          if (fijiKey && item.collections.indexOf(fijiKey) === -1) item.collections.push(fijiKey);
        }

        // Keep the item-level Master extras consistent with the authoritative
        // source for any renderer that consults them directly.
        item._masterProvinces = Array.from(namedProvinces);
        item._masterFiji = hasFiji;
      }

      if (masterPub) {
        provinces.forEach(function (p) { masterPub[p] = 0; });
        namedProvinces.forEach(function (p) { masterPub[p] = 1; });
        masterPub['Fiji - no province specified'] = fijiGeneral ? 1 : 0;
        masterPub.Unsure = 0;
      }
    });

    // Publications with no verified Research Geography are intentionally left
    // on their legacy province values for compatibility. B4, however, is a
    // verified-geography surface: if a publication has no verified RG rows,
    // remove its legacy B4 membership so totals cannot be inflated by stale
    // country collections.
    items.forEach(function (item) {
      var pid = String(item && item._masterPublicationId || '').trim();
      if (!pid || geoByPub.has(pid)) return;
      var existing = Array.isArray(item.collections) ? item.collections : [];
      item.collections = existing.filter(function (key) { return !b4Desc.has(key); });
    });

    // Re-render the Master-specific province/confederacy summary after the
    // in-memory one-hots have been synchronized.
    if (window.MasterFilePanelOverrides &&
        typeof window.MasterFilePanelOverrides.injectConfedTotals === 'function') {
      try { window.MasterFilePanelOverrides.injectConfedTotals(); } catch (e) {
        console.error('Authoritative geography summary refresh failed', e);
      }
    }

    try { window.dispatchEvent(new CustomEvent('vavelab:filters-changed')); } catch (e) {}
    window.__masterAuthoritativeGeographyApplied = true;
    return true;
  }

  function boot() {
    var tries = 0;
    (function wait() {
      if (run()) return;
      if (++tries < 240) setTimeout(wait, 50);
    })();
  }

  window.MasterFileAuthoritativeGeography = { refresh: run };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
