/* Vanuatu Panel B2 — fill missing world-map coordinates (Oct 2026).
 *
 * The Vanuatu Master's Institutions sheet does not yet record university
 * Latitude/Longitude, so every B2 world point arrived without coordinates and
 * the map drew no circles. Before the dashboard renders, this helper fills
 * each point that lacks coordinates, in this order:
 *   1. Latitude/Longitude entered in the Master Institutions sheet (by
 *      canonical university name) — wins automatically once recorded;
 *   2. the public, shared university-location list used by the Regional
 *      dashboard (data/regional-university-locations.json) plus the built-in
 *      CAMPUSES list below, matched by normalised university name AND country;
 *   3. the capital city of the university's country, flagged as approximate
 *      (point.coordApprox = true) so the popup can say so.
 * Points that already have coordinates are never changed. No scholar data
 * leaves the page; the lookup file holds only public university locations.
 */
(function () {
  'use strict';

  // Capital-city positions used only when the university itself cannot be
  // located. Keys use the dashboard's normalised country names.
  var CAPITALS = {
    'Australia': [-35.2809, 149.13], 'New Zealand': [-41.2866, 174.7756],
    'Fiji': [-18.1416, 178.4419], 'Vanuatu': [-17.7333, 168.3273],
    'Solomon Islands': [-9.4456, 159.9729], 'Papua New Guinea': [-9.4438, 147.1803],
    'New Caledonia': [-22.2758, 166.458], 'French Polynesia': [-17.5516, -149.5585],
    'Samoa': [-13.8333, -171.7667], 'Tonga': [-21.1394, -175.2049],
    'Kiribati': [1.4518, 172.9717], 'Tuvalu': [-8.5211, 179.1983],
    'Nauru': [-0.5477, 166.9209], 'Naoero': [-0.5477, 166.9209],
    'Marshall Islands': [7.0897, 171.3803], 'Palau': [7.5006, 134.6242],
    'Federated States of Micronesia': [6.9248, 158.161], 'Cook Islands': [-21.2075, -159.7755],
    'Niue': [-19.0544, -169.8672], 'Wallis and Futuna': [-13.2825, -176.1736],
    'Guam': [13.4757, 144.7489], 'American Samoa': [-14.2756, -170.702],
    'United States': [38.9072, -77.0369], 'Canada': [45.4215, -75.6972],
    'Mexico': [19.4326, -99.1332], 'Brazil': [-15.7939, -47.8828], 'Chile': [-33.4489, -70.6693],
    'Argentina': [-34.6037, -58.3816], 'Peru': [-12.0464, -77.0428], 'Colombia': [4.711, -74.0721],
    'Cuba': [23.1136, -82.3666], 'Jamaica': [17.9712, -76.7936],
    'Trinidad and Tobago': [10.6549, -61.5019],
    'United Kingdom': [51.5074, -0.1278], 'Ireland': [53.3498, -6.2603],
    'France': [48.8566, 2.3522], 'Germany': [52.52, 13.405], 'Netherlands': [52.3676, 4.9041],
    'Belgium': [50.8503, 4.3517], 'Switzerland': [46.948, 7.4474], 'Austria': [48.2082, 16.3738],
    'Italy': [41.9028, 12.4964], 'Spain': [40.4168, -3.7038], 'Portugal': [38.7223, -9.1393],
    'Sweden': [59.3293, 18.0686], 'Norway': [59.9139, 10.7522], 'Denmark': [55.6761, 12.5683],
    'Finland': [60.1699, 24.9384], 'Iceland': [64.1466, -21.9426], 'Poland': [52.2297, 21.0122],
    'Czech Republic': [50.0755, 14.4378], 'Czechia': [50.0755, 14.4378], 'Hungary': [47.4979, 19.0402],
    'Greece': [37.9838, 23.7275], 'Russia': [55.7558, 37.6173],
    'Türkiye': [39.9334, 32.8597], 'Turkey': [39.9334, 32.8597],
    'Israel': [31.7683, 35.2137], 'Egypt': [30.0444, 31.2357], 'Saudi Arabia': [24.7136, 46.6753],
    'United Arab Emirates': [24.4539, 54.3773], 'Qatar': [25.2854, 51.531], 'Iran': [35.6892, 51.389],
    'India': [28.6139, 77.209], 'Pakistan': [33.6844, 73.0479], 'Bangladesh': [23.8103, 90.4125],
    'Sri Lanka': [6.9271, 79.8612], 'Nepal': [27.7172, 85.324],
    'China': [39.9042, 116.4074], 'Hong Kong': [22.3193, 114.1694], 'Taiwan': [25.033, 121.5654],
    'Japan': [35.6762, 139.6503], 'South Korea': [37.5665, 126.978], 'Korea': [37.5665, 126.978],
    'Mongolia': [47.8864, 106.9057], 'Philippines': [14.5995, 120.9842],
    'Indonesia': [-6.2088, 106.8456], 'Timor-Leste': [-8.5569, 125.5603], 'Malaysia': [3.139, 101.6869],
    'Singapore': [1.3521, 103.8198], 'Thailand': [13.7563, 100.5018], 'Vietnam': [21.0278, 105.8342],
    'Cambodia': [11.5564, 104.9282], 'Laos': [17.9757, 102.6331], 'Myanmar': [19.7633, 96.0785],
    'Brunei': [4.9031, 114.9398],
    'South Africa': [-25.7479, 28.2293], 'Kenya': [-1.2921, 36.8219], 'Nigeria': [9.0765, 7.3986],
    'Ghana': [5.6037, -0.187], 'Ethiopia': [9.03, 38.74], 'Tanzania': [-6.163, 35.7516],
    'Morocco': [34.0209, -6.8416], 'Mauritius': [-20.1609, 57.5012], 'Madagascar': [-18.8792, 47.5079]
  };
  // Public main-campus positions for universities commonly attended by
  // Pacific scholars and missing from the shared regional list. Matched by
  // normalised name and country, exactly like the shared list.
  var CAMPUSES = [
    ['University of the South Pacific', 'Fiji', -18.1487, 178.4440],
    ['University of the South Pacific', 'Vanuatu', -17.7480, 168.3150],
    ['University of the South Pacific', 'Samoa', -13.8480, -171.7600],
    ['Fiji National University', 'Fiji', -18.1190, 178.4570],
    ['University of Fiji', 'Fiji', -17.6620, 177.4190],
    ['University of Papua New Guinea', 'Papua New Guinea', -9.4110, 147.1690],
    ['PNG University of Technology', 'Papua New Guinea', -6.6700, 146.9860],
    ['Université de la Nouvelle-Calédonie', 'New Caledonia', -22.2620, 166.4040],
    ['University of New Caledonia', 'New Caledonia', -22.2620, 166.4040],
    ['Université de la Polynésie française', 'French Polynesia', -17.5760, -149.6110],
    ['University of French Polynesia', 'French Polynesia', -17.5760, -149.6110],
    ['National University of Samoa', 'Samoa', -13.8350, -171.7720],
    ['University of Queensland', 'Australia', -27.4975, 153.0137],
    ['Queensland University of Technology', 'Australia', -27.4772, 153.0281],
    ['Griffith University', 'Australia', -27.5530, 153.0530],
    ['James Cook University', 'Australia', -19.3290, 146.7590],
    ['Australian National University', 'Australia', -35.2777, 149.1185],
    ['University of Canberra', 'Australia', -35.2380, 149.0840],
    ['University of Sydney', 'Australia', -33.8886, 151.1873],
    ['University of New South Wales', 'Australia', -33.9173, 151.2313],
    ['UNSW Sydney', 'Australia', -33.9173, 151.2313],
    ['Macquarie University', 'Australia', -33.7738, 151.1126],
    ['University of Technology Sydney', 'Australia', -33.8832, 151.2005],
    ['Western Sydney University', 'Australia', -33.8090, 150.9330],
    ['University of Newcastle', 'Australia', -32.8930, 151.7040],
    ['University of Wollongong', 'Australia', -34.4054, 150.8784],
    ['University of Melbourne', 'Australia', -37.7964, 144.9612],
    ['Monash University', 'Australia', -37.9105, 145.1362],
    ['RMIT University', 'Australia', -37.8083, 144.9631],
    ['Deakin University', 'Australia', -38.1960, 144.2990],
    ['La Trobe University', 'Australia', -37.7210, 145.0480],
    ['University of Adelaide', 'Australia', -34.9206, 138.6062],
    ['Flinders University', 'Australia', -35.0190, 138.5720],
    ['University of Western Australia', 'Australia', -31.9800, 115.8180],
    ['Curtin University', 'Australia', -32.0062, 115.8944],
    ['Charles Darwin University', 'Australia', -12.3720, 130.8690],
    ['University of Tasmania', 'Australia', -42.9040, 147.3240],
    ['University of New England', 'Australia', -30.4880, 151.6420],
    ['Southern Cross University', 'Australia', -28.8190, 153.2970],
    ['University of the Sunshine Coast', 'Australia', -26.7180, 153.0620],
    ['Central Queensland University', 'Australia', -23.3230, 150.5200],
    ['University of Southern Queensland', 'Australia', -27.6040, 151.9320],
    ['University of Auckland', 'New Zealand', -36.8523, 174.7691],
    ['Auckland University of Technology', 'New Zealand', -36.8532, 174.7662],
    ['Massey University', 'New Zealand', -40.3850, 175.6170],
    ['Victoria University of Wellington', 'New Zealand', -41.2900, 174.7680],
    ['University of Waikato', 'New Zealand', -37.7870, 175.3170],
    ['University of Canterbury', 'New Zealand', -43.5235, 172.5839],
    ['Lincoln University', 'New Zealand', -43.6430, 172.4680],
    ['University of Otago', 'New Zealand', -45.8650, 170.5140],
    ['University of Hawaii at Manoa', 'United States', 21.2969, -157.8171],
    ['University of Hawaii', 'United States', 21.2969, -157.8171],
    ['University of Hawai‘i at Mānoa', 'United States', 21.2969, -157.8171],
    ['University of Hawaiʻi at Mānoa', 'United States', 21.2969, -157.8171],
    ['University of Guam', 'Guam', 13.4300, 144.8000]
  ];
  var ALIAS = {
    'usa': 'United States', 'united states of america': 'United States', 'us': 'United States',
    'uk': 'United Kingdom', 'great britain': 'United Kingdom', 'england': 'United Kingdom',
    'scotland': 'United Kingdom', 'wales': 'United Kingdom', 'png': 'Papua New Guinea',
    'turkiye': 'Türkiye', 'republic of korea': 'South Korea', 'peoples republic of china': 'China',
    'tahiti': 'French Polynesia', 'micronesia': 'Federated States of Micronesia', 'fsm': 'Federated States of Micronesia'
  };

  function key(s) {
    var t = String(s == null ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    t = t.replace(/&/g, ' and ').replace(/['\u02bb\u2019]/g, '').replace(/\bthe\b/g, '');
    return t.replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function countryName(c) {
    var k = key(c);
    if (ALIAS[k]) return ALIAS[k];
    for (var n in CAPITALS) if (key(n) === k) return n;
    return c;
  }
  function num(v) {
    if (v === '' || v == null) return NaN;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  function hasCoords(p) { return Number.isFinite(p.lat) && Number.isFinite(p.lng); }

  var lookupPromise = null;
  function loadLookup() {
    if (!lookupPromise) {
      lookupPromise = fetch('data/regional-university-locations.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          var out = {};
          var locs = (d && d.locations) || {};
          Object.keys(locs).forEach(function (k) {
            var v = locs[k];
            if (!v || !Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return;
            out[key(v.name || k)] = v;
            out[k] = out[k] || v;
            out[key(v.name || k) + '|' + key(countryName(v.country))] = v;
          });
          return out;
        })
        .catch(function () { return {}; })
        .then(function (out) {
          CAMPUSES.forEach(function (c) {
            var k = key(c[0]), v = { name: c[0], country: c[1], lat: c[2], lng: c[3] };
            if (!out[k]) out[k] = v;
            out[k + '|' + key(countryName(c[1]))] = v;
          });
          return out;
        });
    }
    return lookupPromise;
  }

  function masterInstitutionCoords() {
    var out = {};
    try {
      var b = window.VanuatuBundle && window.VanuatuBundle.current && window.VanuatuBundle.current();
      var rows = (b && b.tables && b.tables.Institutions) || [];
      rows.forEach(function (r) {
        var lat = num(r.Latitude), lng = num(r.Longitude);
        var name = r['Canonical Institution (C_Uni)'] || r['Canonical University Name (C_Uni)'] || r['Institution Name'];
        if (name && Number.isFinite(lat) && Number.isFinite(lng)) out[key(name)] = { lat: lat, lng: lng };
      });
    } catch (e) { /* bundle not available — skip */ }
    return out;
  }

  // Fill missing coordinates on grad.worldPoints in place. Returns a summary.
  function fill(grad) {
    var pts = (grad && grad.worldPoints) || [];
    var summary = { total: pts.length, master: 0, matched: 0, approx: 0, missing: 0 };
    if (!pts.some(function (p) { return !hasCoords(p); })) return Promise.resolve(summary);
    var master = masterInstitutionCoords();
    return loadLookup().then(function (lookup) {
      pts.forEach(function (p) {
        if (hasCoords(p)) return;
        var uk = key(p.university);
        var m = master[uk];
        if (m) { p.lat = m.lat; p.lng = m.lng; summary.master++; return; }
        var L = lookup[uk + '|' + key(countryName(p.country))] || lookup[uk];
        if (L && (!p.country || key(countryName(L.country)) === key(countryName(p.country)))) {
          p.lat = L.lat; p.lng = L.lng; summary.matched++; return;
        }
        var cap = CAPITALS[countryName(p.country)];
        if (cap) { p.lat = cap[0]; p.lng = cap[1]; p.coordApprox = true; summary.approx++; return; }
        summary.missing++;
      });
      // Fan out approximate (capital-city) circles that share a country so
      // each stays visible and clickable instead of stacking on one spot.
      var byCountry = {};
      pts.forEach(function (p) {
        if (p.coordApprox) (byCountry[p.country] = byCountry[p.country] || []).push(p);
      });
      Object.keys(byCountry).forEach(function (c) {
        var list = byCountry[c];
        if (list.length < 2) return;
        var r = Math.min(2.5, 0.6 + 0.15 * list.length);
        list.forEach(function (p, i) {
          var a = (2 * Math.PI * i) / list.length;
          p.lat += r * Math.sin(a);
          p.lng += (r * Math.cos(a)) / Math.max(0.3, Math.cos(p.lat * Math.PI / 180));
        });
      });
      grad.coordFill = summary;
      return summary;
    });
  }

  window.VanuatuWorldCoords = { fill: fill, key: key };
})();
