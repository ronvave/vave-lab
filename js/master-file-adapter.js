/*
 * Master-file → Zotero-shape adapter
 * ===================================
 *
 * Produces a { snap, geo, unis, provFlat, profiles, sync, grad, insightsDoc,
 * workplaceCoordsDoc, uniCountryDoc, progressRoster } bundle in the exact shape
 * the production `js/itaukei-database.js` expects, but reading its ground truth
 * from the iTaukei_Master_file JSON snapshots (produced by
 * scripts/master_file_transformer.py).
 *
 * Downstream benefit: every existing render function, panel, filter, map,
 * chord, browser, and export in the production code path continues to work
 * unchanged. The adapter is the *only* file that needs to know that data now
 * comes from a Google Sheet instead of Zotero.
 *
 * Key semantic rules applied here (per Master-file spec):
 *   - Scholar identity → Scholar ID.
 *   - Publication identity → Publication ID / BibTeX Key.
 *   - iTaukei-associated status → Authorship bridge link to a Scholar ID.
 *   - Lead author → Author Position = 1 OR Is First Author? = Yes.
 *   - Institution counts → C_Uni name only (O_Uni is historical metadata).
 *   - Fiji publication geography → Master-file 14 province one-hots +
 *     "Fiji - no province specified" + "Unsure".
 *   - Confederacies: Burebasaga / Kubuna / Tovata (see PROVINCE_TO_CONFED).
 *
 * The Master-file JSON files loaded here all pass through the encrypted gate
 * (js/db-gate.js). Absence of the .enc files → the caller sees a graceful
 * "not-yet-seeded" state.
 */

(function () {
  'use strict';

  // -------------------------------------------------------------------
  // Constants (mirror scripts/master_file_config.py)
  // -------------------------------------------------------------------

  var CONFEDERACIES = {
    Burebasaga: ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    Kubuna:     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    Tovata:     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
  };
  var PROVINCE_TO_CONFED = {};
  Object.keys(CONFEDERACIES).forEach(function (c) {
    CONFEDERACIES[c].forEach(function (p) { PROVINCE_TO_CONFED[p] = c; });
  });
  var PROVINCES = Object.keys(PROVINCE_TO_CONFED);           // 14 provinces
  var PROVINCE_UNSPEC = 'Fiji - no province specified';
  var PROVINCE_UNSURE = 'Unsure';

  // Master publication-type → Zotero itemType mapping.
  var TYPE_MAP = {
    "Journal Article":       'journalArticle',
    "Master's Thesis":       'thesisMasters',
    "PhD Thesis":            'thesisPhd',
    "Book Chapter":          'bookSection',
    "Book":                  'book',
    "Report":                'report',
    "Conference Paper":      'conferencePaper',
    "Unpublished report":    'preprint',
    "Others":                'document'
  };
  // Reverse for tag/itemType introspection.
  function zoteroTypeFor(pubType) { return TYPE_MAP[pubType] || 'document'; }

  // Deterministic 8-char Zotero-style keys ([A-Z0-9]) from arbitrary strings.
  // Used for synthesized `collections[]` entries so item.collections[] can
  // reference them and every existing panel keeps working.
  function hashKey(s) {
    var h = 5381;
    var str = String(s == null ? '' : s);
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h |= 0;
    }
    // Absolute base-36, zero-pad to 8 upper chars.
    var out = Math.abs(h).toString(36).toUpperCase();
    while (out.length < 8) out = '0' + out;
    return out.slice(0, 8);
  }

  // Canonical name key (mirrors production code: strip diacritics + non-alnum + lowercase)
  var HYPH_RE = /[\u2010\u2011\u2013\u2212]/g;
  function keyifyName(s) {
    return (s || '').replace(HYPH_RE, '-').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Convert "Given Names Family Name" → "Family, Given" (Zotero creator form).
  function toZoteroCreator(scholarName, familyName, givenNames) {
    if (familyName && givenNames) return familyName + ', ' + givenNames;
    if (scholarName && scholarName.indexOf(',') !== -1) return scholarName;
    if (scholarName) {
      // "Ron Vave" → "Vave, Ron"
      var parts = String(scholarName).trim().split(/\s+/);
      if (parts.length >= 2) {
        var last = parts[parts.length - 1];
        var first = parts.slice(0, -1).join(' ');
        return last + ', ' + first;
      }
      return scholarName;
    }
    return '';
  }

  // -------------------------------------------------------------------
  // Fetch helper — passes through the passcode gate.
  // -------------------------------------------------------------------
  function fetchJson(url) {
    if (window.dbGate && typeof window.dbGate.fetchJson === 'function') {
      return window.dbGate.fetchJson(url);
    }
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    });
  }

  // -------------------------------------------------------------------
  // Load raw Master JSON (encrypted through the gate).
  // -------------------------------------------------------------------
  function loadRawMaster() {
    return Promise.all([
      fetchJson('data/itaukei-master-scholars.json'),
      fetchJson('data/itaukei-master-publications.json'),
      fetchJson('data/itaukei-master-authorship.json'),
      fetchJson('data/itaukei-master-grad-degrees.json'),
      fetchJson('data/itaukei-master-mobility.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-geography.json').catch(function () { return []; }),
      fetchJson('data/itaukei-master-aggregates.json'),
      fetchJson('data/last-master-sync.json').catch(function () { return null; })
    ]).then(function (arr) {
      return {
        scholars:     arr[0],
        publications: arr[1],
        authorship:   arr[2],
        gradDegrees:  arr[3],
        mobility:     arr[4],
        geography:    arr[5],
        aggregates:   arr[6],
        lastSync:     arr[7]
      };
    });
  }

  // -------------------------------------------------------------------
  // Build the Zotero-shape snapshot.
  // -------------------------------------------------------------------
  function buildZoteroSnapshot(master) {
    // Synthesised Zotero-style collection keys.
    var COL_ROOT_ITAUKEI     = 'ITKAROOT';    // "iTaukei authors (>N papers)"
    var COL_BY_WITH          = 'ITKABYWI';    // "By or with iTaukei authors"
    var COL_ROOT_C1_PROV     = 'C1ROOTKY';    // publication-location root
    var COL_NONPROV_FIJI     = 'AREH32KK';    // "_Non-Provincial/Fiji"
    var COL_ROOT_PATERNAL    = 'PATRTROT';    // paternal-province root
    var COL_ROOT_DISCIPLINE  = 'DISCROT0';    // "Discipline" root
    var COL_ROOT_THESIS_UNI  = '9XHGQJE6';    // iTaukei Thesis by Country/Uni

    // Master Scholar ID → Zotero collection key (author collection).
    // Every scholar becomes a fake iTaukei author sub-collection so the
    // existing "iTaukei author" walkers pick them up.
    var scholarKeyById = {};
    var scholarNameById = {};
    var scholarCollections = [];
    master.scholars.forEach(function (s) {
      var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
      var k = hashKey('scholar:' + s['Scholar ID']);
      scholarKeyById[s['Scholar ID']] = k;
      scholarNameById[s['Scholar ID']] = name;
      scholarCollections.push({ key: k, name: name, parent: COL_ROOT_ITAUKEI });
    });

    // Province collections — publication location + paternal province.
    var provLocKeyByName = {};
    var provPaternalKeyByName = {};
    var provinceCollections = [];
    PROVINCES.forEach(function (p) {
      var locK = hashKey('provloc:' + p);
      var patK = hashKey('provpat:' + p);
      provLocKeyByName[p] = locK;
      provPaternalKeyByName[p] = patK;
      provinceCollections.push({ key: locK, name: p, parent: COL_ROOT_C1_PROV });
      provinceCollections.push({ key: patK, name: p, parent: COL_ROOT_PATERNAL });
    });
    // Add the two special province labels for publication location.
    var provLocUnspecKey = hashKey('provloc:' + PROVINCE_UNSPEC);
    var provLocUnsureKey = hashKey('provloc:' + PROVINCE_UNSURE);
    provLocKeyByName[PROVINCE_UNSPEC] = provLocUnspecKey;
    provLocKeyByName[PROVINCE_UNSURE] = provLocUnsureKey;
    provinceCollections.push({ key: provLocUnspecKey, name: PROVINCE_UNSPEC, parent: COL_ROOT_C1_PROV });
    provinceCollections.push({ key: provLocUnsureKey, name: PROVINCE_UNSURE, parent: COL_ROOT_C1_PROV });

    // Discipline collections — one per unique Primary Discipline / Field.
    var disciplineKeyByName = {};
    var disciplineCollections = [];
    var disciplineSet = new Set();
    master.scholars.forEach(function (s) {
      var d = (s['Primary Discipline / Field'] || '').trim();
      if (d) disciplineSet.add(d);
    });
    disciplineSet.forEach(function (d) {
      var k = hashKey('discipline:' + d);
      disciplineKeyByName[d] = k;
      disciplineCollections.push({ key: k, name: d, parent: COL_ROOT_DISCIPLINE });
    });

    // Root collections.
    var rootCollections = [
      { key: COL_ROOT_ITAUKEI, name: 'iTaukei authors (>N papers)', parent: null },
      { key: COL_BY_WITH,      name: 'By or with iTaukei authors', parent: null },
      { key: COL_ROOT_C1_PROV, name: 'C1-Publication location',    parent: null },
      { key: COL_NONPROV_FIJI, name: '_Non-Provincial/Fiji',       parent: COL_ROOT_C1_PROV },
      { key: COL_ROOT_PATERNAL,name: 'Paternal Province',           parent: null },
      { key: COL_ROOT_DISCIPLINE, name: 'Discipline',               parent: null },
      { key: COL_ROOT_THESIS_UNI, name: 'B2-iTaukei Thesis by Country/Universities', parent: null }
    ];

    // Build a Scholar ID → discipline collection key lookup for items.
    var disciplineKeyByScholarId = {};
    master.scholars.forEach(function (s) {
      var d = (s['Primary Discipline / Field'] || '').trim();
      if (d) disciplineKeyByScholarId[s['Scholar ID']] = disciplineKeyByName[d];
    });

    // Authorship index: publication ID → array of authorship rows.
    var authByPub = {};
    master.authorship.forEach(function (a) {
      var pid = a['Publication ID / BibTeX Key'];
      if (!pid) return;
      (authByPub[pid] = authByPub[pid] || []).push(a);
    });

    // Geography index: publication ID → array of geography rows.
    var geoByPub = {};
    (master.geography || []).forEach(function (g) {
      var pid = g['Publication ID / BibTeX Key'];
      if (!pid) return;
      (geoByPub[pid] = geoByPub[pid] || []).push(g);
    });

    // Grad-degree index: scholar ID → array of grad episodes.
    var gradByScholar = {};
    master.gradDegrees.forEach(function (g) {
      var sid = g['Scholar ID'];
      if (!sid) return;
      (gradByScholar[sid] = gradByScholar[sid] || []).push(g);
    });

    // ---- Build Zotero items[] from publications ----
    var items = master.publications.map(function (p) {
      var pid = p['Publication ID / BibTeX Key'];
      var itemKey = hashKey('pub:' + pid);
      var itemType = zoteroTypeFor(p['Publication Type']);

      // Creators (ordered by Author Position).
      var authRows = (authByPub[pid] || []).slice().sort(function (a, b) {
        var ap = Number(a['Author Position'] || 0);
        var bp = Number(b['Author Position'] || 0);
        return ap - bp;
      });
      var creators = authRows.map(function (a) {
        return scholarNameById[a['Scholar ID']] || (a['Author Name as Recorded'] || '');
      }).filter(Boolean);

      // Collections: iTaukei author sub-collections for every linked scholar,
      // "By or with iTaukei authors" if any iTaukei scholar is linked, discipline
      // of the FIRST lead-author scholar, and province location keys derived
      // from the publication's Fiji one-hot columns.
      var collections = [];
      var linkedScholarIds = new Set();
      authRows.forEach(function (a) {
        var sid = a['Scholar ID'];
        if (!sid) return;
        linkedScholarIds.add(sid);
        var sk = scholarKeyById[sid];
        if (sk) collections.push(sk);
      });
      if (linkedScholarIds.size > 0) collections.push(COL_BY_WITH);

      // Discipline: assign the discipline of the lead-author scholar, or
      // the first linked scholar as fallback.
      var lead = authRows.find(function (a) { return a._is_lead; });
      var leadDiscKey = null;
      if (lead && lead['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[lead['Scholar ID']];
      } else if (authRows.length && authRows[0]['Scholar ID']) {
        leadDiscKey = disciplineKeyByScholarId[authRows[0]['Scholar ID']];
      }
      if (leadDiscKey) collections.push(leadDiscKey);

      // Fiji research geography — read from the 14 province one-hots + the
      // two special columns embedded in each publication record.
      var provincesInPub = [];
      PROVINCES.forEach(function (prov) {
        if (Number(p[prov] || 0) > 0) {
          provincesInPub.push(prov);
          collections.push(provLocKeyByName[prov]);
        }
      });
      // Special province labels ("Fiji - no province specified", "Unsure").
      if (Number(p[PROVINCE_UNSPEC] || p['_fiji_unspecified'] || 0) > 0) {
        provincesInPub.push(PROVINCE_UNSPEC);
        collections.push(provLocKeyByName[PROVINCE_UNSPEC]);
        collections.push(COL_NONPROV_FIJI);
      }
      if (Number(p[PROVINCE_UNSURE] || p['_fiji_unsure'] || 0) > 0) {
        provincesInPub.push(PROVINCE_UNSURE);
        collections.push(provLocKeyByName[PROVINCE_UNSURE]);
      }

      // Paternal province: for every linked iTaukei scholar, add their
      // paternal province collection (falling back to maternal) so Panel B
      // "paternal province" filter works.
      authRows.forEach(function (a) {
        var sid = a['Scholar ID'];
        if (!sid) return;
        var scholar = master.scholars.find(function (s) { return s['Scholar ID'] === sid; });
        if (!scholar) return;
        var prov = (scholar['Province Paternal'] || '').trim() || (scholar['Province Maternal'] || '').trim();
        if (prov && provPaternalKeyByName[prov]) collections.push(provPaternalKeyByName[prov]);
      });

      // For theses, also add a country/university collection (COL_ROOT_THESIS_UNI
      // descendant) so the "iTaukei Thesis by Country/Universities" walker picks
      // them up. We keep the descendant tree flat here — one collection per
      // (country|university) pair — because the production walker traverses via
      // parent chain.
      if (itemType === 'thesisMasters' || itemType === 'thesisPhd') {
        // Find the linked scholar's grad episode(s) and pick the one matching
        // thesis level if possible.
        var thesisScholarId = lead ? lead['Scholar ID'] : (authRows[0] && authRows[0]['Scholar ID']);
        var episodes = thesisScholarId ? (gradByScholar[thesisScholarId] || []) : [];
        // Pick a matching-level episode.
        var episode = episodes.find(function (g) {
          var deg = (g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '');
          if (itemType === 'thesisPhd')     return /phd|doctor/i.test(deg);
          if (itemType === 'thesisMasters') return /master/i.test(deg);
          return false;
        }) || episodes[0];
        if (episode) {
          var country = (episode['Country'] || '').trim();
          var uni = (episode['C_Uni name'] || '').trim();
          if (country) {
            var ck = hashKey('thesis-country:' + country);
            collections.push(ck);
            rootCollections.push({ key: ck, name: country, parent: COL_ROOT_THESIS_UNI, _synthesized: true });
          }
          if (uni) {
            var uk = hashKey('thesis-uni:' + uni);
            var pk = country ? hashKey('thesis-country:' + country) : COL_ROOT_THESIS_UNI;
            collections.push(uk);
            rootCollections.push({ key: uk, name: uni, parent: pk, _synthesized: true });
          }
        }
      }

      // Publication metadata for browser (Panel G) and card views.
      var year = Number(p['Year']) || null;
      var publicationTitle = p['Journal / Book Title'] || '';
      var university = '';
      var thesisType = '';
      if (itemType === 'thesisMasters' || itemType === 'thesisPhd') {
        thesisType = (p['Thesis Level'] || (itemType === 'thesisPhd' ? 'PhD Thesis' : "Master's Thesis"));
        // Use publisher/institution/school as the university where present.
        university = p['Publisher / Institution / School'] || p['Journal / Book Title'] || '';
      }

      return {
        key:                itemKey,
        itemType:           itemType,
        title:              p['Title'] || '',
        date:               year ? String(year) : '',
        year:               year,
        creators:           creators,
        tags:               (p['Keywords'] || '').split(/\s*[;|,]\s*/).filter(Boolean),
        collections:        collections,
        publicationTitle:   publicationTitle,
        university:         university,
        thesisType:         thesisType,
        DOI:                p['DOI'] || '',
        url:                p['URL'] || '',
        publisher:          p['Publisher / Institution / School'] || '',
        abstractNote:       '',                  // Private per allowlist
        // Master-file specific extras (harmless to the production code):
        _masterPublicationType: p['Publication Type'],
        _masterProvinces:   provincesInPub,
        _masterFiji:        Number(p['Tagged Fiji?'] || 0) > 0,
        _masterITaukei:     p._is_itaukei_associated === true,
        _masterPublicationId: pid
      };
    });

    // Dedupe synthesized country/uni collections (they can be pushed many times).
    var seenColKeys = new Set();
    var allCollections = rootCollections.concat(scholarCollections)
      .concat(provinceCollections).concat(disciplineCollections)
      .filter(function (c) {
        if (seenColKeys.has(c.key)) return false;
        seenColKeys.add(c.key);
        return true;
      });

    return {
      generatedAt: (master.lastSync && master.lastSync.finishedAt) || new Date().toISOString(),
      items:       items,
      collections: allCollections,
      // Preserve any extra Master metadata for panel-level overrides.
      _master:     master,
      _scholarKeyById: scholarKeyById,
      _provLocKeyByName: provLocKeyByName,
      _provPaternalKeyByName: provPaternalKeyByName,
      _rootKeys: {
        itaukeiAuthors: COL_ROOT_ITAUKEI,
        byWithItaukei:  COL_BY_WITH,
        c1Provinces:    COL_ROOT_C1_PROV,
        nonProvincial:  COL_NONPROV_FIJI,
        paternal:       COL_ROOT_PATERNAL,
        discipline:     COL_ROOT_DISCIPLINE,
        thesisUni:      COL_ROOT_THESIS_UNI
      }
    };
  }

  // -------------------------------------------------------------------
  // Build a fiji-provinces.json flat descriptor from the province → confed map.
  // -------------------------------------------------------------------
  function buildProvFlat(snap) {
    return {
      zoteroCollectionKey_c1Root: snap._rootKeys.c1Provinces,
      zoteroCollectionKey_nonProvincialFiji: snap._rootKeys.nonProvincial,
      provinces: PROVINCES.map(function (p) {
        return {
          name: p,
          confederacy: PROVINCE_TO_CONFED[p],
          zoteroCollectionKey_publicationLocation: snap._provLocKeyByName[p],
          zoteroCollectionKey_paternalProvince: snap._provPaternalKeyByName[p]
        };
      })
    };
  }

  // -------------------------------------------------------------------
  // Build a fiji-provinces.geojson stub — production code uses it for the
  // Panel B choropleth + name-to-collection-key map. We ship an empty feature
  // list with metadata rows so the loop in loadAll() can still index the keys.
  // The actual map rendering will need the real geojson; keep a passthrough
  // to the existing static file if it's available.
  // -------------------------------------------------------------------
  function buildGeoJson(snap) {
    return fetchJson('data/fiji-provinces.geojson').then(function (geo) {
      // Overlay the synthesized keys onto each feature so the existing name→key
      // extractor picks up Master-file keys.
      if (geo && geo.features) {
        geo.features.forEach(function (f) {
          var name = f.properties && f.properties.name;
          if (name && snap._provLocKeyByName[name]) {
            f.properties.zoteroCollectionKey_publicationLocation = snap._provLocKeyByName[name];
          }
          if (name && snap._provPaternalKeyByName[name]) {
            f.properties.zoteroCollectionKey_paternalProvince = snap._provPaternalKeyByName[name];
          }
        });
      }
      return geo;
    }).catch(function () {
      // No geojson available — return an empty FeatureCollection.
      return { type: 'FeatureCollection', features: [] };
    });
  }

  // -------------------------------------------------------------------
  // Build scholar-profiles.json shape from Master scholars.
  // -------------------------------------------------------------------
  function buildProfiles(master, snap) {
    var scholars = master.scholars.map(function (s) {
      var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
      var parts = name.split(',');
      var last = (parts[0] || '').trim();
      var first = (parts[1] || '').trim();
      var paternal = (s['Province Paternal'] || '').trim();
      var maternal = (s['Province Maternal'] || '').trim();

      // Grad degrees for this scholar.
      var grads = master.gradDegrees.filter(function (g) { return g['Scholar ID'] === s['Scholar ID']; });
      var mastersRow = grads.find(function (g) { return /master/i.test((g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '')); });
      var phdRow     = grads.find(function (g) { return /phd|doctor/i.test((g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || '')); });

      return {
        scholarId: s['Scholar ID'],
        zoteroCollectionKey: snap._scholarKeyById[s['Scholar ID']],
        name: name,
        first: first,
        last: last,
        paternalProvince: paternal,
        maternalProvince: maternal,
        effectivePaternalProvince: paternal || maternal || '',
        confederacy: (s._effective_confederacy || PROVINCE_TO_CONFED[paternal] || PROVINCE_TO_CONFED[maternal] || ''),
        gender: s['Gender'] || '',
        title: s['Current Title / Role'] || '',
        institution: s['Current Institution'] || '',
        institutionCountry: s['Institution Country'] || '',
        department: s['Current Department / Unit'] || '',
        alive: s['Alive / Deceased'] || '',
        // Degrees — mastersUniversity/phdUniversity use C_Uni ONLY per rule.
        mastersUniversity: mastersRow ? mastersRow['C_Uni name'] : '',
        mastersCountry:    mastersRow ? mastersRow['Country'] : '',
        mastersOriginalName: mastersRow ? mastersRow['O_Uni name'] : '',
        phdUniversity:     phdRow ? phdRow['C_Uni name'] : '',
        phdCountry:        phdRow ? phdRow['Country'] : '',
        phdOriginalName:   phdRow ? phdRow['O_Uni name'] : '',
        village: s['Village Paternal'] || s['Village Maternal'] || '',
        subject: s['Primary Discipline / Field'] || ''
      };
    });
    return {
      scholars: scholars,
      nameAliases: {},          // Master file resolves via Scholar ID; no aliases needed.
      hiddenScholars: [],
      notItaukeiAuthors: []
    };
  }

  // -------------------------------------------------------------------
  // Build itaukei-graduate-studies.json shape.
  //   scholars: { "<name>": { paternal, maternal, mastersRow, phdRow, ... } }
  //   worldPoints: [ { country, city, university, scholars:[...] }, ... ]
  // -------------------------------------------------------------------
  function buildGraduateStudies(master, snap, profilesDoc) {
    var scholarsMap = {};
    profilesDoc.scholars.forEach(function (p) {
      scholarsMap[p.name] = {
        scholarId: p.scholarId,
        paternalProvince: p.paternalProvince,
        maternalProvince: p.maternalProvince,
        effectivePaternalProvince: p.effectivePaternalProvince,
        confederacy: p.confederacy,
        gender: p.gender,
        village: p.village,
        subject: p.subject,
        mastersUniversity: p.mastersUniversity,
        mastersCountry: p.mastersCountry,
        phdUniversity: p.phdUniversity,
        phdCountry: p.phdCountry
      };
    });

    // World points: group grad degrees by (Country, City, C_Uni name).
    var wpByKey = new Map();
    master.gradDegrees.forEach(function (g) {
      var country = (g['Country'] || '').trim();
      var uni = (g['C_Uni name'] || '').trim();
      var city = (g['City'] || '').trim();
      if (!country || !uni) return;
      var key = country + '|' + city + '|' + uni;
      var pt = wpByKey.get(key);
      if (!pt) {
        pt = {
          country: country,
          city: city,
          university: uni,
          region: g['Region'] || '',
          scholarsCount: 0,
          scholars: []
        };
        wpByKey.set(key, pt);
      }
      pt.scholars.push({
        name: g['Scholar Name'] || '',
        scholarId: g['Scholar ID'],
        degree: (g['Degree Stage'] || '') + ' ' + (g['Degree / Qualification'] || ''),
        year: g['Finish / Completion Year'] || g['Year / Status'] || '',
        completed: /^Completed/i.test(g['Completion Status'] || '')
      });
      pt.scholarsCount = pt.scholars.length;
    });
    var worldPoints = Array.from(wpByKey.values());

    return { scholars: scholarsMap, worldPoints: worldPoints, universities: [] };
  }

  // -------------------------------------------------------------------
  // Build world-universities.json shape.
  //   [{ university, country, lat, lng, region, zoteroCollectionKey }]
  // -------------------------------------------------------------------
  function buildWorldUniversities(master, snap) {
    var byUni = new Map();
    master.gradDegrees.forEach(function (g) {
      var uni = (g['C_Uni name'] || '').trim();
      if (!uni) return;
      if (byUni.has(uni)) return;
      byUni.set(uni, {
        university: uni,
        country: (g['Country'] || '').trim(),
        region: (g['Region'] || '').trim(),
        city: (g['City'] || '').trim(),
        zoteroCollectionKey: hashKey('thesis-uni:' + uni),
        // Coords are read from mobility rows when available.
        lat: null,
        lng: null
      });
    });
    (master.mobility || []).forEach(function (m) {
      // Grad-episode side (m_*).
      if (m.m_uni && byUni.has(m.m_uni.trim())) {
        var entry = byUni.get(m.m_uni.trim());
        if (m.m_lat && !entry.lat) entry.lat = m.m_lat;
        if (m.m_lon && !entry.lng) entry.lng = m.m_lon;
      }
    });
    return Array.from(byUni.values());
  }

  // -------------------------------------------------------------------
  // Public entry: return the full { snap, geo, unis, provFlat, profiles,
  // sync, grad, insightsDoc, workplaceCoordsDoc, uniCountryDoc,
  // progressRoster } bundle the production loadAll expects.
  // -------------------------------------------------------------------
  function loadFromMaster() {
    return loadRawMaster().then(function (master) {
      var snap = buildZoteroSnapshot(master);
      return buildGeoJson(snap).then(function (geo) {
        var profiles = buildProfiles(master, snap);
        var grad = buildGraduateStudies(master, snap, profiles);
        var unis = buildWorldUniversities(master, snap);
        return {
          master: master,
          snap: snap,
          geo: geo,
          unis: unis,
          provFlat: buildProvFlat(snap),
          profiles: profiles,
          sync: master.lastSync,
          grad: grad,
          insightsDoc: { insights: {} },
          workplaceCoordsDoc: { coords: {} },
          uniCountryDoc: { countryByUniversity: {} },
          progressRoster: master.scholars.map(function (s) {
            var name = toZoteroCreator(s['Scholar Name'], s['Family Name'], s['Given Names']);
            var parts = name.split(',');
            return {
              canonical: name,
              first: (parts[1] || '').trim(),
              last:  (parts[0] || '').trim()
            };
          })
        };
      });
    });
  }

  // Expose to production loadAll (which we patch to call this).
  window.MasterFileAdapter = {
    load: loadFromMaster,
    constants: {
      CONFEDERACIES: CONFEDERACIES,
      PROVINCE_TO_CONFED: PROVINCE_TO_CONFED,
      PROVINCES: PROVINCES,
      PROVINCE_UNSPEC: PROVINCE_UNSPEC,
      PROVINCE_UNSURE: PROVINCE_UNSURE,
      TYPE_MAP: TYPE_MAP
    },
    keyifyName: keyifyName,
    hashKey: hashKey
  };
})();
