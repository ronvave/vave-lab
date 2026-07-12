/*
 * Vave Lab Admin Dashboard
 *
 * Client-side admin surface that reads:
 *   - data/itaukei-zotero-snapshot.json   (all authors extracted from Zotero)
 *   - data/scholar-profiles.json          (existing iTaukei enrichment)
 *   - optional: Google Sheet CSV URL     (persisted in localStorage)
 *
 * Provides:
 *   - Password gate (SHA-256 hash of the admin password)
 *   - Author list ranked by publication count with iTaukei toggle
 *   - Profile edit form for iTaukei authors
 *   - CSV / JSON export (paste into Google Sheet or data/scholar-profiles.json)
 *   - Highlights authors that appear in Zotero but not yet in the profile file
 *
 * No secrets in the browser: writes are copy-paste; the password hash below is
 * not a secret (it's a client-side deterrent, not a security boundary).
 */
(function () {
  'use strict';

  // SHA-256 of the admin password. Change here + in memory to update.
  const PASSWORD_HASH = 'd4d3d9ac6a90ffff854263c3edade0c83c5cc1836cb581f67aa91789ece296d6';
  const SESSION_KEY = 'vavelab_admin_session';
  const SHEET_URL_KEY = 'vavelab_scholar_sheet_url';
  const GH_TOKEN_KEY  = 'vavelab_gh_token';
  const GH_OWNER = 'ronvave';
  const GH_REPO  = 'vave-lab';
  const GH_BRANCH = 'main';
  const GH_PHOTO_DIR = 'img/scholars';

  const CONFEDERACY_BY_PROVINCE = {
    'Burebasaga': ['Kadavu', 'Nadroga/Navosa', 'Namosi', 'Rewa', 'Serua'],
    'Kubuna':     ['Ba', 'Lomaiviti', 'Naitasiri', 'Ra', 'Tailevu'],
    'Tovata':     ['Bua', 'Cakaudrove', 'Lau', 'Macuata']
  };
  function confederacyOf(prov) {
    for (const [conf, list] of Object.entries(CONFEDERACY_BY_PROVINCE)) {
      if (list.includes(prov)) return conf;
    }
    return '';
  }

  const state = {
    snapshot: null,
    profilesByKey: new Map(),  // key = "Last, First"
    hiddenScholars: new Set(), // names the admin explicitly UNCHECKED (removed from iTaukei list) — filtered out on public dashboard even if still in Zotero collection
    // Name-variant aliases. Map from a Zotero creator variant (e.g. "Tabunakawai, K.")
    // to the canonical author name it should be merged into (e.g. "Tabunakawai, Kesaia").
    // Persisted to data/scholar-profiles.json under `nameAliases`. The public dashboard
    // reads the same map so pub counts on scholar cards fold in variant items too.
    nameAliases: new Map(),
    // Groups the admin has explicitly "dismissed" in the variant finder so we don't keep
    // suggesting them. Stored as a Set of pipe-joined sorted-name lists.
    dismissedVariantGroups: new Set(),
    authors: [],               // all unique authors (sorted by total desc)
    filter: { q: '', status: 'all' },
    // Manual merge selection — names the admin has ticked from the author
    // table so they can merge duplicates the automatic finder missed
    // (e.g. "Movono, Api" + "Movono, Apisalome"). Survives search/filter
    // re-renders because it lives on state, not the DOM.
    manualMergeSelection: new Set()
  };

  // Resolve a raw Zotero creator name to its canonical form via the alias map.
  // Returns the input unchanged when no alias is registered.
  function resolveAlias(name) {
    if (!name) return name;
    return state.nameAliases.get(name) || name;
  }

  // ==================== Rule-based Sector / Country-of-work seeding ====================
  // Both fields are new on the scholar profile. To avoid Ron having to type in
  // 138 values by hand, we auto-seed them from the existing institution text
  // when a profile has no value yet. These guesses are just defaults — the
  // Admin edit form still shows them and lets Ron correct any misses. Correct
  // values are then persisted like any other profile field.

  function guessSector(profile) {
    const inst = String((profile && profile.institution) || '').toLowerCase();
    if (!inst) return '';
    // Academia — anything that looks like a research/teaching institution.
    if (/\b(university|college|school|institute|polytech|academy|centre for|center for|faculty|research centre|research center)\b/.test(inst))
      return 'Academia';
    // Government agencies.
    if (/\b(ministry|department of|government|centre for disease control|cdc|health authority|hospital)\b/.test(inst))
      return 'Government';
    // International organisations and multilateral bodies.
    if (/\b(spc\b|pacific community|sprep|undp|unesco|unicef|fao|who\b|world health|world bank|world food|iucn|un\s|united nations|ffa\b|forum fisheries|pacific islands forum)\b/.test(inst))
      return 'International Organisation';
    // NGOs / civil society.
    if (/\b(wwf|wildlife conservation|conservation international|nature\s*fiji|birdlife|greenpeace|caritas|save the children|red cross|foundation|society for|non-profit|non-govern|civil society|ngo)\b/.test(inst))
      return 'Non-Government / Civil Society';
    // Explicit private sector markers.
    if (/\b(ltd\b|limited|corp\b|inc\b|llc\b|consult|consulting|group\b|pvt\b|pty\b)\b/.test(inst))
      return 'Private Sector';
    return '';
  }

  // Country parsing: look for common country markers inside the institution
  // string. The first hit wins, in most-specific-to-least-specific order.
  // Where the site clearly implies a country ("USP", "Fiji National University",
  // "University of Guam", etc.) we map directly.
  const COUNTRY_RULES = [
    [/\bfiji national university\b|\bfnu\b/i, 'Fiji'],
    [/\buniversity of the south pacific\b|\busp\b/i, 'Fiji'],
    [/\bnature\s*fiji\b|\bfiji museum\b|\bblue prosperity fiji\b|\bwish fiji\b/i, 'Fiji'],
    [/\bministry.*fiji|\bfiji.*ministry|\bsuva\b|\blautoka\b/i, 'Fiji'],
    [/\buniversity of central lancashire\b|\bcentral lancashire\b|\buclan\b/i, 'United Kingdom'],
    [/\buniversity of southampton\b|\bimperial college\b|\boxford\b|\bcambridge\b|\b\(uk\)\b|\bunited kingdom\b/i, 'United Kingdom'],
    [/\buniversity of guam\b|\buog\b/i, 'Guam (USA territory)'],
    [/\byas seaworld\b|\babu dhabi\b|\buae\b|\bunited arab emirates\b/i, 'United Arab Emirates'],
    [/\bmassey university\b|\bauckland\b|\botago\b|\bcanterbury\b|\bwaikato\b|\bvictoria university of wellington\b|\b\(new zealand\)\b|\bnew zealand\b/i, 'New Zealand'],
    [/\bsydney\b|\btasmania\b|\bunsw\b|\bmelbourne\b|\bqueensland\b|\bjames cook\b|\bcharles darwin\b|\bgriffith\b|\bsunshine coast\b|\banu\b|\bmurdoch\b|\bwestern sydney\b|\bnewcastle\b|\bcanberra\b|\bmacquarie\b|\b\(australia\)\b|\baustralia\b/i, 'Australia'],
    [/\bmanoa\b|\bhawai[\u02bbi\']i\b|\bsan francisco state\b|\bsfsu\b|\bstanford\b|\bharvard\b|\byale\b|\bmit\b|\bcornell\b|\bnorthwestern\b|\bberkeley\b|\bucla\b|\bwashington\b|\bwyoming\b|\bhawaii\b|\b\(usa\)\b|\bunited states\b/i, 'USA'],
    [/\bryukyu\b|\btokyo\b|\bkyoto\b|\bosaka\b|\bhokkaido\b|\b\(japan\)\b|\bjapan\b/i, 'Japan'],
    [/\bpapua new guinea\b|\bpng\b/i, 'Papua New Guinea'],
    [/\bsolomon islands\b/i, 'Solomon Islands'],
    [/\bvanuatu\b/i, 'Vanuatu'],
    [/\bsamoa\b/i, 'Samoa'],
    [/\btonga\b/i, 'Tonga'],
    [/\btoronto\b|\bmontreal\b|\bvancouver\b|\bmcgill\b|\bottawa\b|\b\(canada\)\b|\bcanada\b/i, 'Canada'],
    [/\bberlin\b|\bmunich\b|\bheidelberg\b|\bgermany\b/i, 'Germany'],
  ];
  function guessInstitutionCountry(profile) {
    const inst = String((profile && profile.institution) || '');
    if (!inst) return '';
    for (const [pattern, country] of COUNTRY_RULES) {
      if (pattern.test(inst)) return country;
    }
    // Last-resort fallback: check for a " (Country)" suffix.
    const m = inst.match(/[\(,]\s*([A-Za-z][A-Za-z\s]{2,25}?)\s*\)?\s*$/);
    if (m) return m[1].trim();
    return '';
  }

  // Apply the seeds in-memory to every profile that lacks these fields. This
  // runs once per session at loadData time. Values are only overwritten with
  // the guess when the profile has no existing value — explicit admin edits
  // are never trampled.
  function seedSectorAndCountry(profilesByKey) {
    let seededSector = 0, seededCountry = 0;
    profilesByKey.forEach(p => {
      if (!p.sector) {
        const g = guessSector(p);
        if (g) { p.sector = g; seededSector += 1; }
      }
      if (!p.institutionCountry) {
        const g = guessInstitutionCountry(p);
        if (g) { p.institutionCountry = g; seededCountry += 1; }
      }
    });
    if (seededSector || seededCountry) {
      console.log(`[admin] auto-seeded sector for ${seededSector} profiles, country of work for ${seededCountry} profiles — saved on next push.`);
    }
  }

  // Stable identity for a group of variant names — used to remember dismissals.
  function variantGroupId(names) {
    return [...names].map(n => n.toLowerCase()).sort().join('|');
  }

  // ==================== helpers ====================
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  async function sha256(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('error', type === 'error');
    t.classList.add('is-visible');
    clearTimeout(t._to);
    // Error toasts hang around longer so you can actually read them
    const isErr = type === 'error' || /fail|error|couldn/i.test(msg);
    t._to = setTimeout(() => t.classList.remove('is-visible'), isErr ? 10000 : 3000);
    // Also mirror to console so we always have a record
    (isErr ? console.warn : console.log)('[admin toast]', msg);
  }

  function slugify(fullname) {
    return fullname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Convert Zotero creator string to canonical "Last, First"
  function canonicalName(creator) {
    if (!creator) return null;
    if (creator.includes(',')) return creator.trim();
    const parts = creator.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    const first = parts.slice(0, -1).join(' ');
    return `${last}, ${first}`;
  }
  function surnameOf(creator) {
    if (!creator) return '';
    const name = creator.trim();
    if (name.includes(',')) return name.split(',')[0].trim().toLowerCase();
    return name.split(/\s+/).pop().toLowerCase();
  }

  // ==================== login flow ====================
  document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      showDashboard();
    }
    $('#login-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      const pw = $('#pw').value;
      const hash = await sha256(pw);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem(SESSION_KEY, '1');
        showDashboard();
      } else {
        $('#login-error').classList.add('is-visible');
        $('#pw').value = '';
      }
    });
    $('#logout').addEventListener('click', () => {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
  });

  async function showDashboard() {
    $('#login').style.display = 'none';
    $('#dashboard').classList.add('is-visible');
    // Database files are AES-GCM encrypted at rest on GitHub Pages. Route the
    // fetch through window.dbGate so a valid session key (or a fresh passcode
    // entry) unlocks them. If db-gate isn't loaded (offline dev), just proceed
    // \u2014 loadData() below will try plain fetches and fall back gracefully.
    if (window.dbGate && typeof window.dbGate.boot === 'function') {
      await new Promise(resolve => window.dbGate.boot(resolve));
    }
    await loadData();
    wireControls();
    render();
    renderVariantPanel();
  }

  // Accept any of the common Google Sheets URL shapes and return a URL that
  // returns raw CSV to fetch():
  //  - Published-to-web  https://docs.google.com/spreadsheets/d/e/<PUBID>/pub?output=csv  → pass through
  //  - Published-to-web  https://docs.google.com/spreadsheets/d/e/<PUBID>/pubhtml         → replace pubhtml with pub?output=csv
  //  - Edit link         https://docs.google.com/spreadsheets/d/<SHEETID>/edit?...        → /export?format=csv[&gid=]
  //  - Anything else     → return as-is
  function normalizeSheetUrl(url) {
    const s = (url || '').trim();
    if (!s) return s;
    try {
      const u = new URL(s);
      // Published-to-web format already: keep as-is, but force output=csv
      const pubMatch = u.pathname.match(/\/spreadsheets\/d\/e\/([^/]+)\/(pub|pubhtml)/);
      if (pubMatch) {
        u.pathname = `/spreadsheets/d/e/${pubMatch[1]}/pub`;
        u.searchParams.set('output', 'csv');
        return u.toString();
      }
      // Plain edit link → export?format=csv (preserves gid if present)
      const editMatch = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
      if (editMatch) {
        let gid = null;
        if (u.hash) {
          const m = u.hash.match(/gid=(\d+)/);
          if (m) gid = m[1];
        }
        gid = gid || u.searchParams.get('gid');
        const out = new URL(`https://docs.google.com/spreadsheets/d/${editMatch[1]}/export`);
        out.searchParams.set('format', 'csv');
        if (gid) out.searchParams.set('gid', gid);
        return out.toString();
      }
    } catch (_) { /* not a URL — fall through */ }
    return s;
  }

  // ==================== data load ====================
  async function loadData() {
    // dbGate.fetchJson() decrypts the .enc blob when the file is on the
    // encrypted list; falls back to a plain fetch for anything else. If the
    // gate script never loaded (offline dev), just use plain fetch \u2014 that
    // path still works against local plaintext files.
    const readJson = (window.dbGate && window.dbGate.fetchJson)
      ? (url, fallback) => window.dbGate.fetchJson(url).catch(err => {
          console.warn('[admin] dbGate.fetchJson failed for', url, err);
          return fallback;
        })
      : (url, fallback) => fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
          .then(r => r.json()).catch(() => fallback);

    const [snap, profilesJson, graduate] = await Promise.all([
      readJson('data/itaukei-zotero-snapshot.json', null),
      readJson('data/scholar-profiles.json',        { scholars: [] }),
      readJson('data/itaukei-graduate-studies.json',{ scholars: {} }),
    ]);
    if (!snap) {
      toast('Couldn\u2019t load the Zotero snapshot. Check the passcode and reload.', true);
      return;
    }
    state.snapshot = snap;
    // Look-up for the edit form's auto-detected graduate-studies hints.
    state.graduateStudiesByName = new Map(Object.entries((graduate && graduate.scholars) || {}));

    // Try to enrich from Google Sheet CSV if user has configured it.
    // BUT: if a GitHub token is set, ignore the sheet entirely — the JSON
    // pushed from the admin dashboard is the source of truth. Otherwise the
    // sheet's empty cells will silently wipe fields the user just edited.
    const sheetUrl = localStorage.getItem(SHEET_URL_KEY);
    const hasGhToken = !!localStorage.getItem(GH_TOKEN_KEY);
    $('#sheet-url').value = sheetUrl || '';
    let sheetScholars = [];
    if (sheetUrl && hasGhToken) {
      console.log('[admin] Google Sheet URL is set but ignored because a GitHub token is active. GitHub JSON is the source of truth.');
    }
    if (sheetUrl && !hasGhToken) {
      const csvUrl = normalizeSheetUrl(sheetUrl);
      try {
        const resp = await fetch(csvUrl, { cache: 'no-cache' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const csv = await resp.text();
        // If Google redirected us to a sign-in page, the response is HTML, not CSV
        if (/^\s*<(!doctype|html)/i.test(csv)) {
          throw new Error('sheet is not publicly readable');
        }
        sheetScholars = parseCsv(csv);
        toast(`Loaded ${sheetScholars.length} rows from Google Sheet.`);
      } catch (e) {
        console.warn('Sheet load failed:', e);
        toast(
          'Couldn\u2019t load Google Sheet CSV \u2014 using local fallback. Open the sheet in Google, then File \u203a Share \u203a "Publish to web" \u203a select "Comma-separated values (.csv)" \u203a Publish, and paste that /pub?output=csv link here. (Simple "Anyone with the link" viewer sharing is not enough for fetch \u2014 the sheet must be published.)',
          'error'
        );
      }
    }

    // Merge: local JSON first, then sheet overrides local. Always back-fill the
    // canonical `name` field (`Last, First`) so downstream exports have it —
    // some legacy seed records had name:null even though last/first were set.
    const keyFor = p => (p.last && p.first) ? `${p.last}, ${p.first}` : (p.name || '');
    const withName = p => Object.assign({}, p, { name: p.name || keyFor(p) });
    const merged = new Map();
    (profilesJson.scholars || []).forEach(p => {
      const key = keyFor(p);
      if (key) merged.set(key, withName(p));
    });
    sheetScholars.forEach(p => {
      const key = keyFor(p);
      if (!key) return;
      // NEVER let an empty sheet cell wipe a non-empty local value. Only
      // merge in fields that have actual content.
      const cleanSheet = {};
      for (const [k, v] of Object.entries(p)) {
        if (v !== undefined && v !== null && v !== '') cleanSheet[k] = v;
      }
      merged.set(key, withName(Object.assign({}, merged.get(key) || {}, cleanSheet)));
    });
    state.profilesByKey = merged;
    // Rule-based auto-seed: fill Sector and Country of work for any profile
    // that has no value yet, using the institution text. Explicit edits are
    // preserved. Seeded values persist on the next “Push all to GitHub”.
    seedSectorAndCountry(state.profilesByKey);
    // Load the explicit hide-list. Names in here are removed from the public dashboard
    // even though they still exist as Zotero collection subs.
    state.hiddenScholars = new Set(Array.isArray(profilesJson.hiddenScholars) ? profilesJson.hiddenScholars : []);

    // Load persisted name-variant aliases (variant → canonical).
    state.nameAliases = new Map(Object.entries(profilesJson.nameAliases || {}));
    // Load list of dismissed variant groups (admin said "these are NOT the same person").
    state.dismissedVariantGroups = new Set(Array.isArray(profilesJson.dismissedVariantGroups)
      ? profilesJson.dismissedVariantGroups : []);

    // Build unique-author list from Zotero items. Alias resolution here folds
    // variant-name items into their canonical author so the admin table shows
    // one row per real person (with the combined pub count) after merges.
    rebuildAuthors(snap);
  }

  function rebuildAuthors(snapshot) {
    const snap = snapshot || state.snapshot;
    if (!snap) return;
    const authorMap = new Map();
    snap.items.forEach(it => {
      const creators = it.creators || [];
      creators.forEach((c, idx) => {
        const raw = canonicalName(c);
        if (!raw) return;
        const canonical = resolveAlias(raw);
        if (!authorMap.has(canonical)) {
          authorMap.set(canonical, { name: canonical, total: 0, firstAuthored: 0, types: {}, variants: new Set() });
        }
        const rec = authorMap.get(canonical);
        rec.total += 1;
        if (idx === 0) rec.firstAuthored += 1;
        rec.types[it.itemType] = (rec.types[it.itemType] || 0) + 1;
        if (raw !== canonical) rec.variants.add(raw);
      });
    });
    // Freeze variants as sorted arrays for downstream code.
    state.authors = Array.from(authorMap.values())
      .map(a => Object.assign(a, { variants: Array.from(a.variants).sort() }))
      .sort((a, b) => b.total - a.total);
  }

  // Very small CSV parser (handles quoted fields with embedded commas + newlines)
  function parseCsv(text) {
    const rows = [];
    let cur = '', row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i], next = text[i+1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQuotes = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && next === '\n') i++;
          row.push(cur); cur = '';
          if (row.length && row.some(v => v !== '')) rows.push(row);
          row = [];
        } else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] || '').trim(); });
      return obj;
    });
  }

  // We output TAB-separated values instead of comma-separated because Google
  // Sheets’ default paste splits on commas without honouring CSV quoting.
  // Names like "Finau, Glenn" would get chopped into two cells and shift every
  // other value one column to the right. Tabs never appear in author fields, so
  // no escaping is needed and the paste is bulletproof.
  function toCsv(rows) {
    if (!rows.length) return '';
    const headers = ['name','slug','last','first','salutation','village','paternalProvince','confederacy',
                     'institution','institutionUrl','title','googleScholarUrl','orcidUrl','photo',
                     'lastUpdate','total','firstAuthored',
                     'types.journalArticle','types.thesis','types.bookSection','types.book','types.report'];
    const esc = v => {
      if (v == null) return '';
      // Strip any stray tabs/newlines that would corrupt the row layout
      return String(v).replace(/[\t\r\n]+/g, ' ').trim();
    };
    const lines = [headers.join('\t')];
    rows.forEach(r => {
      const t = r.types || {};
      lines.push([
        r.name || '', r.slug || '', r.last || '', r.first || '',
        r.salutation || '', r.village || '', r.paternalProvince || '',
        confederacyOf(r.paternalProvince) || '',
        r.institution || '', r.institutionUrl || '', r.title || '',
        r.googleScholarUrl || '', r.orcidUrl || '', r.photo || '',
        r.lastUpdate || '',
        r.total ?? '', r.firstAuthored ?? '',
        t.journalArticle ?? 0, t.thesis ?? 0, t.bookSection ?? 0, t.book ?? 0, t.report ?? 0
      ].map(esc).join('\t'));
    });
    return lines.join('\n');
  }

  // ==================== render ====================
  function isItaukei(author) {
    return state.profilesByKey.has(author.name);
  }
  function isEnriched(author) {
    const p = state.profilesByKey.get(author.name);
    if (!p) return false;
    return !!(p.paternalProvince || p.institution || p.googleScholarUrl || p.orcidUrl || p.title);
  }
  function statusFlag(author) {
    if (!isItaukei(author)) return 'none';
    return isEnriched(author) ? 'filled' : 'pending';
  }

  function passesFilter(author) {
    const f = state.filter;
    if (f.q) {
      if (!author.name.toLowerCase().includes(f.q.toLowerCase())) return false;
    }
    if (f.status === 'itaukei' && !isItaukei(author)) return false;
    if (f.status === 'enriched' && statusFlag(author) !== 'filled') return false;
    if (f.status === 'pending'  && statusFlag(author) !== 'pending') return false;
    if (f.status === 'new') {
      // "New" = author with 2+ publications but no iTaukei profile yet. Simple heuristic.
      if (isItaukei(author)) return false;
      if (author.total < 2) return false;
    }
    return true;
  }

  // ==================== NAME-VARIANT DETECTION ====================
  // Heuristic: two authors are likely the same person when they share a surname
  // and their given names are either identical, initials of each other, or share
  // a first token. We surface groups of 2+ for admin review — we never merge
  // automatically. Once merged, one alias entry per variant redirects future
  // Zotero snapshots into the canonical author.

  function normSurname(name) {
    if (!name) return '';
    const s = name.includes(',') ? name.split(',')[0] : name.split(/\s+/).slice(-1)[0];
    return String(s || '').toLowerCase().replace(/[\.'\-\s]+/g, '');
  }

  function firstNameTokens(name) {
    if (!name || !name.includes(',')) return [];
    return String(name.split(',').slice(1).join(',') || '')
      .split(/\s+/)
      .map(t => t.replace(/\./g, '').trim().toLowerCase())
      .filter(Boolean);
  }

  // Are two first-name token sets compatible (i.e. plausibly the same person)?
  // Rule: at least one shared first-letter across their leading tokens, AND either
  //   (a) one side has ONLY initial-length tokens (≤1 char), so it can match anyone with
  //       that first letter (e.g. "K." vs "Kesaia"), OR
  //   (b) at least one full token appears identically on both sides (e.g. "Sera" vs
  //       "Sera Va"), OR
  //   (c) one side is empty (no given name at all).
  function firstNamesCompatible(a, b) {
    if (!a.length || !b.length) return true;
    const initialsA = a.every(t => t.length <= 1);
    const initialsB = b.every(t => t.length <= 1);
    const leadA = a[0][0], leadB = b[0][0];
    if (!leadA || !leadB) return true;
    if (leadA !== leadB) return false;
    if (initialsA || initialsB) return true;
    // Both sides have full tokens — require a shared full token to accept.
    return a.some(t => t.length > 1 && b.includes(t));
  }

  // Return an array of variant-group objects the admin should review.
  // Each group: { key, canonical, members: [{ name, total, isCanonical }], score }
  function detectVariantGroups() {
    // Only consider authors that (a) have at least one publication and
    // (b) aren't already merged INTO something else (they're at their canonical
    // form here — rebuildAuthors folded variants already).
    const groupsBySurname = new Map();
    state.authors.forEach(a => {
      const surname = normSurname(a.name);
      if (!surname) return;
      if (!groupsBySurname.has(surname)) groupsBySurname.set(surname, []);
      groupsBySurname.get(surname).push(a);
    });

    const groups = [];
    for (const [surname, members] of groupsBySurname.entries()) {
      if (members.length < 2) continue;
      // Build compatibility clusters within a surname.
      const buckets = [];
      for (const author of members) {
        const tokensA = firstNameTokens(author.name);
        let placed = false;
        for (const bucket of buckets) {
          if (bucket.every(other => firstNamesCompatible(tokensA, firstNameTokens(other.name)))) {
            bucket.push(author);
            placed = true;
            break;
          }
        }
        if (!placed) buckets.push([author]);
      }
      buckets.filter(b => b.length >= 2).forEach(bucket => {
        const names = bucket.map(a => a.name);
        const gid = variantGroupId(names);
        if (state.dismissedVariantGroups.has(gid)) return;
        // Determine "canonical" candidate = the one with a fully-typed given name,
        // preferring iTaukei-profile members, then highest pub count. Fall back to
        // the first alphabetically stable name.
        const scored = bucket.slice().sort((x, y) => {
          const xTokens = firstNameTokens(x.name);
          const yTokens = firstNameTokens(y.name);
          const xFull = xTokens.some(t => t.length > 1) ? 1 : 0;
          const yFull = yTokens.some(t => t.length > 1) ? 1 : 0;
          if (xFull !== yFull) return yFull - xFull;
          const xProf = isItaukei(x) ? 1 : 0;
          const yProf = isItaukei(y) ? 1 : 0;
          if (xProf !== yProf) return yProf - xProf;
          if (x.total !== y.total) return y.total - x.total;
          return x.name.localeCompare(y.name);
        });
        const canonical = scored[0].name;
        groups.push({
          id: gid,
          surname,
          suggestedCanonical: canonical,
          members: bucket.map(a => ({
            name: a.name, total: a.total, firstAuthored: a.firstAuthored,
            iTaukei: isItaukei(a), enriched: statusFlag(a) === 'filled'
          })).sort((a, b) => b.total - a.total),
          score: bucket.reduce((s, a) => s + a.total, 0)
        });
      });
    }
    // Highest combined publication count first (most impactful merges).
    return groups.sort((a, b) => b.score - a.score);
  }

  function renderVariantPanel() {
    const wrap = $('#variants-body');
    const countBadge = $('#variants-count');
    const aliasList = $('#variants-alias-list');
    if (!wrap) return;

    const groups = detectVariantGroups();
    if (countBadge) countBadge.textContent = groups.length ? `${groups.length} potential group${groups.length===1?'':'s'} to review` : 'No new variants detected';

    wrap.innerHTML = '';
    if (!groups.length) {
      wrap.innerHTML = '<p class="subtitle" style="margin:0;color:var(--muted);font-size:0.9rem;">No unreviewed name variants right now. If you see a duplicate that isn\u2019t showing here, use the search in the authors table below and we can teach the detector.</p>';
    }

    // Bulk-merge bar (top). We render another one at the bottom below.
    if (groups.length > 1) {
      const bulkTop = document.createElement('div');
      bulkTop.className = 'variant-bulk-bar';
      bulkTop.dataset.bulkBar = 'top';
      bulkTop.innerHTML = `
        <div class="variant-bulk-text">
          <strong>Batch merge</strong> \u2014 pick the canonical radio in every group you\u2019re sure about, then merge them all in one push.
        </div>
        <button type="button" class="btn" data-merge-all>Merge all <span data-merge-all-count>${groups.length}</span> groups</button>`;
      bulkTop.querySelector('[data-merge-all]').addEventListener('click', () => mergeAllVariantGroups());
      wrap.appendChild(bulkTop);
    }

    groups.forEach(g => {
      const card = document.createElement('div');
      card.className = 'variant-group';
      card.dataset.gid = g.id;
      const radioName = `canon-${g.id.replace(/[^a-z0-9]+/gi, '_')}`;
      const rows = g.members.map(m => {
        const isCanon = m.name === g.suggestedCanonical;
        return `
        <label class="variant-row">
          <input type="radio" name="${radioName}" data-canonical value="${escapeHtml(m.name)}" ${isCanon?'checked':''} />
          <input type="checkbox" data-member value="${escapeHtml(m.name)}" checked />
          <span class="variant-name">${escapeHtml(m.name)}</span>
          <span class="variant-meta">${m.total} pub${m.total===1?'':'s'}${m.firstAuthored?` · ${m.firstAuthored} first-authored`:''}${m.iTaukei?' · iTaukei':''}${m.enriched?' · profile filled':''}</span>
        </label>`;
      }).join('');
      card.innerHTML = `
        <div class="variant-head">
          <div>
            <div class="variant-title">Possible variants of “${escapeHtml(g.suggestedCanonical)}”</div>
            <div class="variant-hint">Choose the canonical name (radio), keep only the entries that are really the same person (checkboxes), then Merge.</div>
          </div>
          <div class="variant-actions">
            <button class="btn" data-merge>Merge into canonical</button>
            <button class="btn ghost" data-dismiss title="These are different people — don\u2019t suggest again">Not the same</button>
          </div>
        </div>
        <div class="variant-rows">${rows}</div>`;
      card.querySelector('[data-merge]').addEventListener('click', () => mergeVariantGroup(card, g));
      card.querySelector('[data-dismiss]').addEventListener('click', () => dismissVariantGroup(g));
      wrap.appendChild(card);
    });

    // Bulk-merge bar (bottom) \u2014 mirror of the top bar so long lists don\u2019t force a scroll back up.
    if (groups.length > 1) {
      const bulkBottom = document.createElement('div');
      bulkBottom.className = 'variant-bulk-bar';
      bulkBottom.dataset.bulkBar = 'bottom';
      bulkBottom.innerHTML = `
        <div class="variant-bulk-text">
          Done reviewing? Batch-merge every group whose canonical you\u2019ve chosen \u2014 single GitHub push.
        </div>
        <button type="button" class="btn" data-merge-all>Merge all <span data-merge-all-count>${groups.length}</span> groups</button>`;
      bulkBottom.querySelector('[data-merge-all]').addEventListener('click', () => mergeAllVariantGroups());
      wrap.appendChild(bulkBottom);
    }

    // Render existing merges list
    if (aliasList) {
      aliasList.innerHTML = '';
      if (state.nameAliases.size === 0) {
        aliasList.innerHTML = '<p class="subtitle" style="margin:0;color:var(--muted);font-size:0.85rem;">No merges yet.</p>';
      } else {
        // Group by canonical target
        const byCanon = new Map();
        for (const [variant, canonical] of state.nameAliases.entries()) {
          if (!byCanon.has(canonical)) byCanon.set(canonical, []);
          byCanon.get(canonical).push(variant);
        }
        Array.from(byCanon.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .forEach(([canonical, variants]) => {
            const row = document.createElement('div');
            row.className = 'alias-row';
            row.innerHTML = `
              <div class="alias-canonical">${escapeHtml(canonical)}</div>
              <div class="alias-variants">${variants.map(v => `<span class="alias-pill">${escapeHtml(v)}<button type="button" class="alias-remove" data-variant="${escapeHtml(v)}" title="Undo this merge">×</button></span>`).join('')}</div>`;
            row.querySelectorAll('[data-variant]').forEach(btn => {
              btn.addEventListener('click', () => unmergeVariant(btn.dataset.variant));
            });
            aliasList.appendChild(row);
          });
      }
    }
  }

  // Apply one card's merge to in-memory state only — shared by the per-group
  // "Merge into canonical" button and the batch "Merge all groups" button.
  // Returns { canonName, chosen } on success, or { error } describing why the
  // card was skipped. Callers decide when to re-render, toast, and push.
  function applyVariantMergeInMemory(cardEl) {
    const canonical = cardEl.querySelector('[data-canonical]:checked');
    if (!canonical) return { error: 'no-canonical' };
    const canonName = canonical.value;
    const chosen = Array.from(cardEl.querySelectorAll('[data-member]:checked'))
      .map(cb => cb.value).filter(n => n !== canonName);
    if (!chosen.length) return { error: 'no-variants' };

    // Add aliases. Also compose transitively (if the canonical was itself the
    // target of an alias, we'd never overwrite — but here the canonical is a
    // real author row, so it's a straight variant→canonical mapping).
    chosen.forEach(variant => { state.nameAliases.set(variant, canonName); });

    // If the canonical is iTaukei but any variant carried a scholar profile,
    // copy over any non-empty enriched fields into the canonical profile so
    // hand-filled data (photo, institution, etc.) isn't lost. Then drop the
    // variant profile entry.
    const canonProfile = state.profilesByKey.get(canonName) || null;
    chosen.forEach(variant => {
      const vp = state.profilesByKey.get(variant);
      if (!vp) return;
      if (canonProfile) {
        for (const [k, v] of Object.entries(vp)) {
          if (v && !canonProfile[k]) canonProfile[k] = v;
        }
        state.profilesByKey.set(canonName, canonProfile);
      }
      state.profilesByKey.delete(variant);
      // Variant is no longer a first-class author, so make sure it's not in the hide-list either.
      state.hiddenScholars.delete(variant);
    });

    return { canonName, chosen };
  }

  async function mergeVariantGroup(cardEl, group) {
    const result = applyVariantMergeInMemory(cardEl);
    if (result.error === 'no-canonical') { toast('Pick a canonical name first.', 'error'); return; }
    if (result.error === 'no-variants')  { toast('Select at least one variant to merge into the canonical name.', 'error'); return; }

    const { canonName, chosen } = result;
    rebuildAuthors();
    render();
    renderVariantPanel();

    toast(`Merged ${chosen.length} variant${chosen.length===1?'':'s'} into ${canonName}. Saving\u2026`);
    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try {
        await pushProfilesToGitHub(`merge variants into ${canonName}`);
        toast(`Merge saved. Public dashboard updates in ~1 minute.`, 'success');
      } catch (err) {
        console.error('merge push failed:', err);
        toast(`GitHub push failed \u2014 merge is only in this browser. ${err.message}`, 'error');
      }
    } else {
      toast('No GitHub token set \u2014 merge is only in this browser.', 'error');
    }
  }

  // Batch-merge every currently-rendered variant card in one shot with a
  // single GitHub push at the end. Skips cards where no canonical is picked
  // or no non-canonical checkboxes are ticked (nothing to merge).
  async function mergeAllVariantGroups() {
    const cards = Array.from(document.querySelectorAll('#variants-body .variant-group'));
    if (!cards.length) { toast('No variant groups to merge.', 'error'); return; }

    // Freeze the batch buttons so the admin can't double-click during the push.
    const bulkButtons = Array.from(document.querySelectorAll('#variants-body [data-merge-all]'));
    bulkButtons.forEach(b => { b.disabled = true; b.classList.add('is-busy'); });

    const mergedGroups = [];   // [{ canonName, chosen: [...] }]
    const skipped = [];        // [{ title, reason }]

    cards.forEach(card => {
      const title = (card.querySelector('.variant-title')?.textContent || '').trim();
      const result = applyVariantMergeInMemory(card);
      if (result.error) {
        skipped.push({ title, reason: result.error });
      } else {
        mergedGroups.push(result);
      }
    });

    if (!mergedGroups.length) {
      bulkButtons.forEach(b => { b.disabled = false; b.classList.remove('is-busy'); });
      toast('Nothing to merge — every group is missing a canonical selection or has all variants unchecked.', 'error');
      return;
    }

    rebuildAuthors();
    render();
    renderVariantPanel();

    const totalVariants = mergedGroups.reduce((n, g) => n + g.chosen.length, 0);
    const groupWord = mergedGroups.length === 1 ? 'group' : 'groups';
    const variantWord = totalVariants === 1 ? 'variant' : 'variants';
    toast(`Batch merging ${mergedGroups.length} ${groupWord} (${totalVariants} ${variantWord}). Saving in a single push\u2026`);

    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try {
        const trigger = mergedGroups.length === 1
          ? `batch merge into ${mergedGroups[0].canonName}`
          : `batch merge ${mergedGroups.length} groups (${totalVariants} variants)`;
        await pushProfilesToGitHub(trigger);
        const tail = skipped.length ? ` ${skipped.length} group${skipped.length===1?'':'s'} skipped (no canonical picked).` : '';
        toast(`Batch merge saved — ${mergedGroups.length} ${groupWord}, ${totalVariants} ${variantWord} folded in one push. Public dashboard updates in ~1 minute.${tail}`, 'success');
      } catch (err) {
        console.error('batch merge push failed:', err);
        toast(`GitHub push failed — merges applied in this browser only. ${err.message}`, 'error');
      }
    } else {
      toast('No GitHub token set — merges applied in this browser only.', 'error');
    }
  }

  async function dismissVariantGroup(group) {
    state.dismissedVariantGroups.add(group.id);
    renderVariantPanel();
    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try { await pushProfilesToGitHub(`dismiss variant suggestion ${group.suggestedCanonical}`); } catch (_) {}
    }
  }

  // =============== Manual merge (admin picks arbitrary rows) ==================
  // Lets the admin merge duplicate authors the automatic name-variant finder
  // missed — e.g. "Movono, Api" + "Movono, Apisalome". Selection is stored on
  // state so it survives search/filter re-renders.

  function toggleManualMergeSelect(name, on, rowEl) {
    if (on) state.manualMergeSelection.add(name);
    else state.manualMergeSelection.delete(name);
    if (rowEl) rowEl.classList.toggle('is-mm-selected', on);
    refreshManualMergeBar();
  }

  function clearManualMergeSelection() {
    state.manualMergeSelection.clear();
    document.querySelectorAll('#authors-body tr.is-mm-selected').forEach(tr => tr.classList.remove('is-mm-selected'));
    document.querySelectorAll('#authors-body [data-mm-select]:checked').forEach(cb => { cb.checked = false; });
    refreshManualMergeBar();
  }

  function refreshManualMergeBar() {
    const bar = document.getElementById('mm-bar');
    if (!bar) return;
    const count = state.manualMergeSelection.size;
    if (count < 2) { bar.classList.remove('is-visible'); return; }
    bar.classList.add('is-visible');
    document.getElementById('mm-bar-count').textContent = `${count} selected`;
    const names = Array.from(state.manualMergeSelection);
    document.getElementById('mm-bar-names').textContent = names.join(', ');
  }

  function openManualMergeModal() {
    const names = Array.from(state.manualMergeSelection);
    if (names.length < 2) { toast('Tick at least two authors to merge.', 'error'); return; }
    const authorByName = new Map(state.authors.map(a => [a.name, a]));
    // Suggest the row with the highest total as the default canonical.
    let suggested = names[0];
    let bestTotal = -1;
    names.forEach(n => {
      const a = authorByName.get(n);
      const t = a ? a.total : 0;
      if (t > bestTotal) { bestTotal = t; suggested = n; }
    });
    const list = document.getElementById('mm-radio-list');
    list.innerHTML = '';
    names.forEach(n => {
      const a = authorByName.get(n) || { total: 0, firstAuthored: 0 };
      const isDefault = n === suggested;
      const row = document.createElement('label');
      row.className = 'mm-radio-row';
      row.innerHTML = `
        <input type="radio" name="mm-canonical" value="${escapeHtml(n)}" ${isDefault ? 'checked' : ''} />
        <span class="mm-radio-name">${escapeHtml(n)}</span>
        <span class="mm-radio-stats">${a.total} pubs · ${a.firstAuthored} first-authored</span>
      `;
      list.appendChild(row);
    });
    document.getElementById('mm-modal-subtitle').textContent =
      `You've selected ${names.length} authors. Pick the canonical name below — the others will be recorded as aliases and their publications will fold into the canonical author.`;
    document.getElementById('mm-modal').classList.add('is-visible');
  }

  function closeManualMergeModal() {
    const el = document.getElementById('mm-modal');
    if (el) el.classList.remove('is-visible');
  }

  async function confirmManualMerge() {
    const chosen = document.querySelector('#mm-radio-list input[name="mm-canonical"]:checked');
    if (!chosen) { toast('Pick a canonical name first.', 'error'); return; }
    const canonName = chosen.value;
    const variants = Array.from(state.manualMergeSelection).filter(n => n !== canonName);
    if (!variants.length) { toast('At least one variant must be different from the canonical.', 'error'); return; }

    // Same logic as mergeVariantGroup — record aliases, roll enriched fields
    // into the canonical profile, drop variant profile entries.
    variants.forEach(v => { state.nameAliases.set(v, canonName); });
    const canonProfile = state.profilesByKey.get(canonName) || null;
    variants.forEach(v => {
      const vp = state.profilesByKey.get(v);
      if (!vp) return;
      if (canonProfile) {
        for (const [k, val] of Object.entries(vp)) {
          if (val && !canonProfile[k]) canonProfile[k] = val;
        }
        state.profilesByKey.set(canonName, canonProfile);
      }
      state.profilesByKey.delete(v);
      state.hiddenScholars.delete(v);
    });

    closeManualMergeModal();
    clearManualMergeSelection();
    rebuildAuthors();
    render();
    renderVariantPanel();

    toast(`Merged ${variants.length} variant${variants.length===1?'':'s'} into ${canonName}. Saving\u2026`);
    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try {
        await pushProfilesToGitHub(`manual merge into ${canonName}`);
        toast('Merge saved. Public dashboard updates in ~1 minute.', 'success');
      } catch (err) {
        console.error('manual merge push failed:', err);
        toast(`GitHub push failed \u2014 merge is only in this browser. ${err.message}`, 'error');
      }
    } else {
      toast('No GitHub token set \u2014 merge is only in this browser.', 'error');
    }
  }

  async function unmergeVariant(variant) {
    if (!state.nameAliases.has(variant)) return;
    const canonical = state.nameAliases.get(variant);
    state.nameAliases.delete(variant);
    rebuildAuthors();
    render();
    renderVariantPanel();
    toast(`Undid merge of ${variant} into ${canonical}. Saving\u2026`);
    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try {
        await pushProfilesToGitHub(`unmerge ${variant}`);
        toast('Undo saved.', 'success');
      } catch (err) {
        toast(`GitHub push failed. ${err.message}`, 'error');
      }
    }
  }

  function render() {
    const authors = state.authors.filter(passesFilter);
    const body = $('#authors-body');
    body.innerHTML = '';
    authors.slice(0, 500).forEach(a => {
      const iT = isItaukei(a);
      const stat = statusFlag(a);
      const p = state.profilesByKey.get(a.name);
      const displayName = p && p.salutation ? `${p.salutation} ${a.name}` : a.name;
      const tr = document.createElement('tr');
      if (iT) tr.classList.add('is-itaukei');
      if (state.filter.status === 'new' || (!iT && a.total >= 3)) tr.classList.add('is-new');
      const isMMSel = state.manualMergeSelection.has(a.name);
      if (isMMSel) tr.classList.add('is-mm-selected');
      tr.innerHTML = `
        <td class="select-col">
          <input type="checkbox" data-mm-select title="Select for manual merge" ${isMMSel ? 'checked' : ''} />
        </td>
        <td class="name-col">${displayName}</td>
        <td class="count-col">${a.total}</td>
        <td class="count-col">${a.firstAuthored}</td>
        <td class="status-col">
          <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" data-toggle-itaukei ${iT ? 'checked' : ''} />
          </label>
        </td>
        <td class="status-col">${
          !iT ? (a.total >= 3 ? '<span class="flag new">Untriaged</span>' : '<span class="flag pending">\u2014</span>')
              : (stat === 'filled' ? '<span class="flag filled">Filled</span>'
                                   : '<span class="flag pending">Blank</span>')
        }</td>
        <td class="action-col">
          <button class="btn ghost" data-edit ${!iT ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''}>Edit</button>
        </td>
      `;
      tr.querySelector('[data-toggle-itaukei]').addEventListener('change', ev => {
        toggleItaukei(a, ev.target.checked);
      });
      tr.querySelector('[data-mm-select]').addEventListener('change', ev => {
        toggleManualMergeSelect(a.name, ev.target.checked, tr);
      });
      const editBtn = tr.querySelector('[data-edit]');
      editBtn.addEventListener('click', () => { if (!editBtn.disabled) openEdit(a); });
      body.appendChild(tr);
    });
    refreshManualMergeBar();
    // Filter count text
    $('#filter-count').textContent = `${authors.length} of ${state.authors.length} authors shown`;
    // Stats
    const total = state.authors.length;
    const itaukei = Array.from(state.profilesByKey.keys()).length;
    const enriched = state.authors.filter(a => statusFlag(a) === 'filled').length;
    const newC = state.authors.filter(a => !isItaukei(a) && a.total >= 3).length;
    $('#stat-total').textContent = total;
    $('#stat-itaukei').textContent = itaukei;
    $('#stat-enriched').textContent = enriched;
    $('#stat-new').textContent = newC;
  }

  async function toggleItaukei(author, on) {
    if (on) {
      // Re-adding: clear from hide-list AND add empty profile
      state.hiddenScholars.delete(author.name);
      if (!state.profilesByKey.has(author.name)) {
        const [last, first] = author.name.split(',').map(s => s.trim());
        // Do NOT bake author.total / firstAuthored / types into the saved
        // profile — those are Zotero-derived counts that change every sync.
        // Public dashboard always reads them fresh from the snapshot instead.
        state.profilesByKey.set(author.name, {
          name: author.name, slug: slugify(`${first}-${last}`),
          last, first, salutation: '', village: '', paternalProvince: '',
          institution: '', institutionUrl: '', googleScholarUrl: '', photo: ''
        });
        toast(`Marked ${author.name} as iTaukei. Click "Edit" to add their profile.`);
      }
    } else {
      // Removing: drop profile AND add to explicit hide-list so the public
      // dashboard hides them even though they still exist as a Zotero collection.
      state.profilesByKey.delete(author.name);
      state.hiddenScholars.add(author.name);
      toast(`Removed ${author.name} from iTaukei list. Saving\u2026`);
    }
    render();
    // Persist to GitHub so the change survives refresh AND propagates to the public dashboard.
    if (localStorage.getItem(GH_TOKEN_KEY)) {
      try {
        await pushProfilesToGitHub(on ? `toggle on ${author.name}` : `toggle off ${author.name}`);
        toast(on ? `${author.name} saved.` : `${author.name} removed and hidden from public dashboard.`, 'success');
      } catch (err) {
        console.error('toggleItaukei push failed:', err);
        toast(`GitHub push failed \u2014 change is only in this browser. ${err.message}`, 'error');
      }
    } else {
      toast('No GitHub token set \u2014 change is only in this browser. Paste a token to persist.', 'error');
    }
  }

  // ==================== edit modal ====================
  let editingAuthor = null;
  // When the 'Non-iTaukei dad' checkbox is ticked, the Paternal Province
  // select is disabled and visually greyed out — Ron only fills the Maternal
  // Province instead. Unticking restores the paternal control.
  function applyNonItaukeiDadState(nonItaukeiDad) {
    const sel = document.getElementById('pf-paternal-province');
    if (!sel) return;
    sel.disabled = !!nonItaukeiDad;
    sel.style.opacity = nonItaukeiDad ? '0.4' : '';
    sel.style.cursor = nonItaukeiDad ? 'not-allowed' : '';
    if (nonItaukeiDad) sel.value = '';
  }

  function openEdit(author) {
    editingAuthor = author;
    const p = state.profilesByKey.get(author.name) || {};
    $('#profile-modal-title').textContent = `Edit profile: ${author.name}`;
    $('#profile-modal-subtitle').textContent = `${author.total} publications, ${author.firstAuthored} first-authored.`;
    $('#pf-salutation').value = p.salutation || '';
    const [openLast, openFirst] = (author.name || '').split(',').map(s => (s || '').trim());
    $('#pf-last').value = openLast || p.last || '';
    $('#pf-first').value = openFirst || p.first || '';
    $('#pf-village').value = p.village || '';
    $('#pf-paternal-province').value = p.paternalProvince || '';
    // Maternal province + non-iTaukei-dad flag. For scholars whose father is
    // non-iTaukei but mother is iTaukei (e.g. Aporosa Apo → Naduri village,
    // Macuata Province via mother), Ron records the maternal province and
    // ticks the checkbox. The public dashboard falls back to maternal when
    // paternal is blank so the scholar still appears in their mother's
    // confederacy on the paternal-province chart.
    $('#pf-maternal-province').value = p.maternalProvince || '';
    const nonIT = !!p.nonItaukeiDad;
    $('#pf-non-itaukei-dad').checked = nonIT;
    applyNonItaukeiDadState(nonIT);
    $('#pf-institution').value = p.institution || '';
    $('#pf-institution-url').value = p.institutionUrl || '';
    // Sector + Country of work. If the profile has no value yet, fall back to
    // the auto-seeded rule-based guess (guessSector / guessInstitutionCountry
    // in loadData) so the form always shows a sensible starting value.
    $('#pf-sector').value = p.sector || guessSector(p) || '';
    $('#pf-institution-country').value = p.institutionCountry || guessInstitutionCountry(p) || '';
    $('#pf-department').value = p.department || '';
    $('#pf-department-url').value = p.departmentUrl || '';
    $('#pf-profile-url').value = p.profileUrl || '';
    $('#pf-masters-uni').value = (p.masters && p.masters.university) || '';
    $('#pf-masters-country').value = (p.masters && p.masters.country) || '';
    $('#pf-phd-uni').value = (p.phd && p.phd.university) || '';
    $('#pf-phd-country').value = (p.phd && p.phd.country) || '';
    // Show auto-detected suggestions from Zotero snapshot if we haven't already saved them
    const detected = state.graduateStudiesByName && state.graduateStudiesByName.get(p.name);
    const hint = $('[data-detected-grad]');
    if (hint) {
      if (detected && (detected.masters || detected.phd)) {
        const bits = [];
        if (detected.masters) bits.push(`<strong>Masters:</strong> ${escapeHtml(detected.masters.university || '')} · ${escapeHtml(detected.masters.country || 'unknown country')}`);
        if (detected.phd) bits.push(`<strong>PhD:</strong> ${escapeHtml(detected.phd.university || '')} · ${escapeHtml(detected.phd.country || 'unknown country')}`);
        hint.innerHTML = '<strong style="color:#0e7490;">Auto-detected from Zotero theses:</strong> ' + bits.join(' &middot; ') + '. Click a suggestion to prefill.';
        hint.style.display = '';
        hint.style.cursor = 'pointer';
        hint.onclick = () => {
          if (detected.masters) {
            $('#pf-masters-uni').value = detected.masters.university || '';
            $('#pf-masters-country').value = detected.masters.country || '';
          }
          if (detected.phd) {
            $('#pf-phd-uni').value = detected.phd.university || '';
            $('#pf-phd-country').value = detected.phd.country || '';
          }
        };
      } else {
        hint.style.display = 'none';
      }
    }
    $('#pf-title').value = p.title || '';
    $('#pf-scholar-url').value = p.googleScholarUrl || '';
    $('#pf-orcid-url').value = p.orcidUrl || '';
    $('#pf-photo').value = p.photo || '';
    setPhotoPreview(p.photo || '');
    $('#profile-modal').classList.add('is-visible');
  }

  // ==================== photo drop zone ====================
  // Holds the most-recently dropped image (Blob) so "Download for repo" works
  // even after the field has been overwritten with a repo path.
  let lastDroppedBlob = null;

  function setPhotoPreview(src) {
    const el = $('#pf-photo-preview');
    if (!el) return;
    if (src && src.trim()) {
      el.style.backgroundImage = `url(${JSON.stringify(src)})`;
      el.textContent = '';
    } else {
      el.style.backgroundImage = '';
      el.textContent = 'no photo';
    }
  }

  // Resize an image file to a square JPEG (cover-cropped, centered)
  function fileToSquareJpeg(file, size = 400, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image load failed'));
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(0, 0, size, size);
          const scale = Math.max(size / img.width, size / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          canvas.toBlob(blob => {
            if (!blob) return reject(new Error('encode failed'));
            const r2 = new FileReader();
            r2.onload = () => resolve({ dataUrl: r2.result, blob });
            r2.onerror = () => reject(new Error('read encoded failed'));
            r2.readAsDataURL(blob);
          }, 'image/jpeg', quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      toast('Please drop an image file (JPEG or PNG).');
      return;
    }
    try {
      const { dataUrl, blob } = await fileToSquareJpeg(file);
      lastDroppedBlob = blob;
      const kb = Math.round(blob.size / 1024);

      // Show the preview immediately from the resized blob
      setPhotoPreview(dataUrl);

      const token = localStorage.getItem(GH_TOKEN_KEY);
      if (token && editingAuthor) {
        // Direct upload to GitHub — photo field stores the repo path, not base64
        const [last, first] = editingAuthor.name.split(',').map(s => s.trim());
        const existing = state.profilesByKey.get(editingAuthor.name) || {};
        const slug = existing.slug || slugify(`${first}-${last}`);
        const path = `${GH_PHOTO_DIR}/${slug}.jpg`;
        toast(`Uploading ${slug}.jpg to GitHub…`);
        try {
          await githubUploadPhoto(path, blob, `admin: update profile photo for ${editingAuthor.name}`);
          $('#pf-photo').value = path;
          toast(`Uploaded to ${path} (≈${kb} KB). Photo field now points there.`);
          return;
        } catch (err) {
          console.error(err);
          toast('GitHub upload failed — falling back to inline base64. ' + err.message);
        }
      }

      // Fallback: store as inline base64 (works immediately, bloats JSON)
      $('#pf-photo').value = dataUrl;
      const hint = token ? '' : ' Add a GitHub token in Data source to upload directly to img/scholars/ instead.';
      toast(`Photo added inline (≈${kb} KB, 400 × 400 JPEG).` + hint);
    } catch (err) {
      console.error(err);
      toast('Couldn’t process that image.');
    }
  }

  // Convert a Blob to base64 without the leading "data:...;base64," prefix
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result || '';
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // UTF-8 safe base64. Chunked because String.fromCharCode(...huge) overflows
  // the call stack — profiles JSON can be many hundreds of KB once even a few
  // photos are inline base64.
  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const chunkSize = 0x8000; // 32 KB per chunk
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  // Generic GitHub upload. `content` may be a Blob (binary, e.g. photos) or a
  // string (text, e.g. JSON). Requires a Personal Access Token in localStorage.
  async function githubUploadFile(path, content, message) {
    const token = localStorage.getItem(GH_TOKEN_KEY);
    if (!token) throw new Error('no-token');
    const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    // Fetch the CURRENT sha of the file. Returns a diagnostic object so the caller
    // can include the exact fetch outcome in error messages — no need to open DevTools.
    // Cache-busted with a query param only. We deliberately do NOT set Cache-Control
    // in the request headers because that header is not on the CORS-safelist and can
    // trigger unwanted preflight behaviour with some proxies.
    async function fetchCurrentSha() {
      const url = `${apiUrl}?ref=${GH_BRANCH}&_=${Date.now()}`;
      let head;
      try {
        head = await fetch(url, { headers, cache: 'no-store' });
      } catch (netErr) {
        return { sha: undefined, status: 0, error: 'network: ' + (netErr.message || netErr) };
      }
      if (head.status === 404) return { sha: undefined, status: 404, note: 'file-is-new' };
      if (!head.ok) {
        const errText = await head.text().catch(() => '');
        return { sha: undefined, status: head.status, error: errText.slice(0, 150) };
      }
      const j = await head.json().catch(() => null);
      if (!j || typeof j.sha !== 'string') {
        return { sha: undefined, status: head.status, error: 'response has no sha field' };
      }
      return { sha: j.sha, status: head.status };
    }
    const base64 = (content instanceof Blob) ? await blobToBase64(content) : utf8ToBase64(content);

    async function attemptPut(sha) {
      const body = { message, content: base64, branch: GH_BRANCH };
      if (sha) body.sha = sha;
      return fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
    }

    let shaRes = await fetchCurrentSha();
    let put = await attemptPut(shaRes.sha);

    // Retry once if:
    //   409 = sha we sent is stale (file changed between GET and PUT)
    //   422 = sha wasn't supplied but the file exists (our GET returned undefined)
    if (put.status === 409 || put.status === 422) {
      const retryRes = await fetchCurrentSha();
      if (retryRes.sha) {
        put = await attemptPut(retryRes.sha);
        shaRes = retryRes; // record the retry outcome for diagnostics
      } else {
        // Retry SHA fetch also failed — surface both failures
        shaRes = { sha: undefined, status: retryRes.status, error: 'retry: ' + (retryRes.error || 'no sha') };
      }
    }

    if (!put.ok) {
      const errBody = await put.text();
      const short = errBody.length > 200 ? errBody.slice(0, 200) + '…' : errBody;
      const shaDiag = shaRes.sha
        ? `sha=${shaRes.sha.slice(0, 8)}…`
        : `sha-fetch=${shaRes.status}${shaRes.error ? ' (' + shaRes.error + ')' : ''}`;
      throw new Error(`GitHub PUT failed ${put.status}. ${shaDiag}. ${short}`);
    }
    return path;
  }

  // Legacy alias kept for photo drop paths
  const githubUploadPhoto = githubUploadFile;

  // Serialize the entire in-memory scholars map to the JSON shape the public
  // site reads from data/scholar-profiles.json.
  function serializeProfilesJson() {
    const scholars = Array.from(state.profilesByKey.values()).sort((a, b) => {
      const na = (a.name || '').toLowerCase();
      const nb = (b.name || '').toLowerCase();
      return na.localeCompare(nb);
    });
    const hiddenScholars = Array.from(state.hiddenScholars).sort();
    // Sort aliases for stable diffs
    const nameAliases = {};
    Array.from(state.nameAliases.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([variant, canonical]) => { nameAliases[variant] = canonical; });
    const dismissedVariantGroups = Array.from(state.dismissedVariantGroups).sort();
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'admin-dashboard',
      scholars,
      hiddenScholars,
      nameAliases,
      dismissedVariantGroups
    }, null, 2) + '\n';
  }

  // ==================== Rename + auto-merge stub ====================
  // Considered a "stub" if the row has no village, no institution, no ORCID,
  // no photo, and total publications is either missing or zero. These are the
  // hollow rows created accidentally through the Zotero author list or when a
  // rename was previously attempted through a manual add-scholar flow.
  function isStubProfileRow(row) {
    if (!row) return false;
    const hasVillage = !!(row.village && row.village.trim());
    const hasInstitution = !!(row.institution && row.institution.trim());
    const hasOrcid = !!(row.orcidUrl && row.orcidUrl.trim());
    const hasPhoto = !!(row.photo && row.photo.trim());
    const hasPubs = !!(row.total && Number(row.total) > 0);
    return !hasVillage && !hasInstitution && !hasOrcid && !hasPhoto && !hasPubs;
  }

  // Fill blanks on `into` with any non-empty value from `from`. Never overwrites
  // populated fields on `into`. Skips identity fields (name/slug/last/first) so
  // the caller controls those explicitly after the merge.
  function mergeStubInto(into, from) {
    if (!from) return into;
    const identity = new Set(['name', 'slug', 'last', 'first']);
    Object.entries(from).forEach(([k, v]) => {
      if (identity.has(k)) return;
      if (v === undefined || v === null) return;
      const existing = into[k];
      const existingBlank = existing === undefined
        || existing === null
        || (typeof existing === 'string' && !existing.trim())
        || (Array.isArray(existing) && !existing.length);
      if (existingBlank) into[k] = v;
    });
    return into;
  }

  // Rename an in-memory scholar from oldName to newName, auto-merging any
  // stub row that already holds newName. Returns { renamed: true, mergedStub }
  // or { renamed: false } if nothing to do. Does NOT push — caller decides.
  function applyRenameInMemory(oldName, newName, newLast, newFirst) {
    if (!oldName || !newName || oldName === newName) return { renamed: false };
    const oldRow = state.profilesByKey.get(oldName);
    if (!oldRow) throw new Error(`No profile found for "${oldName}".`);

    // Refuse if newName already resolves to a non-stub (would clobber a real
    // scholar). Ron can dismiss aliases separately.
    const existingNewRow = state.profilesByKey.get(newName);
    let mergedStub = false;
    if (existingNewRow) {
      if (!isStubProfileRow(existingNewRow)) {
        throw new Error(`A scholar named "${newName}" already exists with real data \u2014 merge them through the Variants tab first.`);
      }
      // Absorb any non-empty fields from the stub, then drop it.
      mergeStubInto(oldRow, existingNewRow);
      state.profilesByKey.delete(newName);
      mergedStub = true;
    }

    // Rename identity fields on the row (slug stays for URL / photo path
    // stability; Ron can rename the slug manually if desired).
    oldRow.name = newName;
    oldRow.last = newLast;
    oldRow.first = newFirst;

    // Re-key the map.
    state.profilesByKey.delete(oldName);
    state.profilesByKey.set(newName, oldRow);

    // Repoint every alias that pointed at oldName, then add oldName itself as
    // an alias to newName so past Zotero creators (e.g. "Nunia Thomas" →
    // "Thomas, Nunia") still resolve.
    state.nameAliases.forEach((canonical, variant) => {
      if (canonical === oldName) state.nameAliases.set(variant, newName);
    });
    state.nameAliases.set(oldName, newName);

    return { renamed: true, mergedStub };
  }

  // Fetch, patch, re-encrypt, and push scholar-insights.json.enc so the AI
  // summary follows a rename. If the old name has no insight entry, this is a
  // silent no-op (still returns { pushed: false }). Requires an unlocked db.
  async function pushInsightsRenameToGitHub(oldName, newName) {
    if (!localStorage.getItem(GH_TOKEN_KEY)) return { skipped: true };
    if (!window.dbGate || !window.dbGate.isUnlocked()) {
      throw new Error('Database is locked \u2014 unlock first (Reload from source and enter passcode).');
    }
    // Pull the current decrypted insights file.
    let insightsJson;
    try {
      insightsJson = await window.dbGate.fetchJson('data/scholar-insights.json.enc');
    } catch (err) {
      // Insights bundle isn't essential for the rename. Log and skip so the
      // profile-only rename still ships.
      console.warn('[rename] could not fetch insights bundle:', err);
      return { skipped: true, reason: 'fetch-failed' };
    }
    if (!insightsJson || !insightsJson.insights) return { skipped: true, reason: 'no-insights-map' };
    const map = insightsJson.insights;
    if (!Object.prototype.hasOwnProperty.call(map, oldName)) {
      return { pushed: false, reason: 'no-insight-for-old-name' };
    }
    // Rebuild the object with keys in the same order, swapping the renamed one.
    // If the new name already had an insight (extremely unlikely for a stub),
    // we keep the new-name insight and drop the old one silently.
    const newMap = {};
    Object.entries(map).forEach(([k, v]) => {
      if (k === oldName) {
        if (!Object.prototype.hasOwnProperty.call(map, newName)) newMap[newName] = v;
      } else {
        newMap[k] = v;
      }
    });
    insightsJson.insights = newMap;
    insightsJson.generatedAt = new Date().toISOString();
    insightsJson.source = 'admin-dashboard';

    const json = JSON.stringify(insightsJson, null, 2) + '\n';
    const encBytes = await window.dbGate.encryptForUpload(json);
    const encBlob = new Blob([encBytes], { type: 'application/octet-stream' });
    await githubUploadFile('data/scholar-insights.json.enc', encBlob, `admin: rename insight key ${oldName} \u2192 ${newName}`);
    return { pushed: true, bytes: encBytes.length };
  }

  // Push data/scholar-profiles.json.enc to GitHub. The plaintext .json is
  // gitignored (only .enc blobs ship), so we encrypt with the currently
  // active session key + salt from db-gate before uploading. Silent no-op
  // if no token set.
  async function pushProfilesToGitHub(triggerName) {
    if (!localStorage.getItem(GH_TOKEN_KEY)) return { skipped: true };
    const json = serializeProfilesJson();
    const msg = `admin: update scholar profiles${triggerName ? ' (' + triggerName + ')' : ''}`;

    // Encrypt so the blob lands with the same salt as every other .enc file
    // already deployed \u2014 preserves the shared-salt invariant.
    if (!window.dbGate || !window.dbGate.isUnlocked()) {
      throw new Error('Database is locked \u2014 unlock first (Reload from source and enter passcode).');
    }
    const encBytes = await window.dbGate.encryptForUpload(json);
    const encBlob = new Blob([encBytes], { type: 'application/octet-stream' });
    await githubUploadFile('data/scholar-profiles.json.enc', encBlob, msg);
    return { pushed: true, bytes: encBytes.length };
  }

  function wirePhotoDropzone() {
    const dz = $('#pf-photo-dz');
    const fileInput = $('#pf-photo-file');
    const urlInput = $('#pf-photo');
    if (!dz || !fileInput || !urlInput) return;

    // Click / keyboard opens file picker
    dz.addEventListener('click', () => fileInput.click());
    dz.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fileInput.click(); }
    });

    // File picker
    fileInput.addEventListener('change', ev => {
      const f = ev.target.files && ev.target.files[0];
      if (f) handlePhotoFile(f);
      fileInput.value = '';
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
      dz.addEventListener(evt, ev => {
        ev.preventDefault(); ev.stopPropagation();
        dz.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dz.addEventListener(evt, ev => {
        ev.preventDefault(); ev.stopPropagation();
        dz.classList.remove('is-dragover');
      });
    });
    dz.addEventListener('drop', ev => {
      const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) handlePhotoFile(f);
    });

    // Manual URL toggle — reveals the hidden URL input for pasting
    $('#pf-photo-url-toggle').addEventListener('click', () => {
      const hidden = urlInput.style.display === 'none';
      urlInput.style.display = hidden ? 'block' : 'none';
      if (hidden) urlInput.focus();
    });
    urlInput.addEventListener('input', () => setPhotoPreview(urlInput.value.trim()));

    // Clear
    $('#pf-photo-clear').addEventListener('click', () => {
      urlInput.value = '';
      lastDroppedBlob = null;
      setPhotoPreview('');
      toast('Photo cleared.');
    });

    // "Upload/Download for repo" — if a GitHub token is set, uploads directly
    // to img/scholars/<slug>.jpg via the API; otherwise falls back to a browser
    // download so you can drop the file into the repo manually.
    $('#pf-photo-download').addEventListener('click', async () => {
      if (!lastDroppedBlob) {
        toast('Drop or select a photo first.');
        return;
      }
      if (!editingAuthor) return;
      const [last, first] = editingAuthor.name.split(',').map(s => s.trim());
      const existing = state.profilesByKey.get(editingAuthor.name) || {};
      const slug = existing.slug || slugify(`${first}-${last}`);
      const filename = `${slug}.jpg`;
      const repoPath = `img/scholars/${filename}`;

      if (localStorage.getItem(GH_TOKEN_KEY)) {
        // Direct upload path
        toast(`Uploading ${filename} to GitHub…`);
        try {
          await githubUploadPhoto(repoPath, lastDroppedBlob, `admin: update profile photo for ${editingAuthor.name}`);
          urlInput.value = repoPath;
          toast(`Uploaded to ${repoPath}. Photo field now points there.`);
          return;
        } catch (err) {
          console.error(err);
          toast('GitHub upload failed — falling back to browser download. ' + err.message);
        }
      }

      // Fallback: trigger a browser download and point the field at the expected repo path
      const a = document.createElement('a');
      a.href = URL.createObjectURL(lastDroppedBlob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 200);
      urlInput.value = repoPath;
      toast(`Downloaded ${filename}. Field now points to ${repoPath} — add the file to img/scholars/ and commit.`);
    });
  }
  function closeEdit() {
    $('#profile-modal').classList.remove('is-visible');
    editingAuthor = null;
    lastDroppedBlob = null;
    // Re-hide the URL fallback input for the next open
    const urlInput = $('#pf-photo');
    if (urlInput) urlInput.style.display = 'none';
  }

  // ==================== Submission paste helper ====================
  // Takes JSON pasted from a submission email and opens the matching scholar's
  // Edit modal with the proposed values pre-filled. Ron reviews and saves.
  function findAuthorByName(name) {
    if (!name) return null;
    const target = name.trim().toLowerCase();
    // 1) Exact match against known authors
    let hit = state.authors.find(a => a.name.toLowerCase() === target);
    if (hit) return hit;
    // 2) Match through alias table (variant → canonical)
    const canon = state.nameAliases.get(name);
    if (canon) {
      hit = state.authors.find(a => a.name.toLowerCase() === canon.toLowerCase());
      if (hit) return hit;
    }
    // 3) Loose match by "Last, First-token"
    const [last, first] = name.split(',').map(s => (s || '').trim());
    if (last && first) {
      const firstTok = first.split(/\s+/)[0].toLowerCase();
      hit = state.authors.find(a => {
        const [l, f] = a.name.split(',').map(s => (s || '').trim());
        return l && f && l.toLowerCase() === last.toLowerCase()
            && f.split(/\s+/)[0].toLowerCase() === firstTok;
      });
      if (hit) return hit;
    }
    return null;
  }

  function applyPastedSubmission() {
    const ta = $('#submission-paste');
    const status = $('#submission-status');
    const raw = (ta && ta.value || '').trim();
    if (!raw) { status.textContent = 'Paste the JSON first.'; return; }
    let data;
    try { data = JSON.parse(raw); }
    catch (err) {
      status.textContent = 'That doesn\u2019t look like valid JSON — double-check you copied the whole block.';
      return;
    }
    const name = data.scholar_name || (data.profile && data.profile.name) || '';
    const author = findAuthorByName(name);
    if (!author) {
      status.textContent = `Couldn\u2019t find a scholar named “${name || '(unknown)'}” in the current authors list.`;
      return;
    }
    // Ensure the scholar is flagged iTaukei so their profile can be edited.
    if (!isItaukei(author)) {
      // Create an empty profile so openEdit can populate it. This mirrors
      // toggleItaukei's re-add branch but skips the auto-push, since we're
      // about to open the Edit modal and Ron will Save anyway.
      const [last, first] = author.name.split(',').map(s => s.trim());
      state.profilesByKey.set(author.name, {
        name: author.name, slug: slugify(`${first}-${last}`),
        last, first, salutation: '', village: '', paternalProvince: '',
        institution: '', institutionUrl: '', googleScholarUrl: '', photo: ''
      });
      state.hiddenScholars.delete(author.name);
      render();
    }
    // Overlay the pasted profile fields ONTO the existing saved profile so we
    // don't wipe filled fields when the submitter left something blank.
    const p = Object.assign({}, state.profilesByKey.get(author.name) || {});
    const src = data.profile || {};
    const nonEmpty = (v) => v != null && String(v).trim() !== '';
    if (nonEmpty(src.salutation))       p.salutation = src.salutation;
    if (nonEmpty(src.village))          p.village = src.village;
    if (nonEmpty(src.paternalProvince)) p.paternalProvince = src.paternalProvince;
    if (nonEmpty(src.title))            p.title = src.title;
    if (nonEmpty(src.institution))      p.institution = src.institution;
    if (nonEmpty(src.institutionUrl))   p.institutionUrl = src.institutionUrl;
    if (nonEmpty(src.department))       p.department = src.department;
    if (nonEmpty(src.departmentUrl))    p.departmentUrl = src.departmentUrl;
    if (nonEmpty(src.profileUrl))       p.profileUrl = src.profileUrl;
    if (nonEmpty(src.googleScholarUrl)) p.googleScholarUrl = src.googleScholarUrl;
    if (nonEmpty(src.orcidUrl))         p.orcidUrl = src.orcidUrl;
    if (nonEmpty(src.photo))            p.photo = src.photo;
    const m = data.masters || {}, ph = data.phd || {};
    if (nonEmpty(m.university) || nonEmpty(m.country)) {
      p.masters = Object.assign({}, p.masters || {}, {
        university: m.university || (p.masters && p.masters.university) || '',
        country:    m.country    || (p.masters && p.masters.country)    || ''
      });
    }
    if (nonEmpty(ph.university) || nonEmpty(ph.country)) {
      p.phd = Object.assign({}, p.phd || {}, {
        university: ph.university || (p.phd && p.phd.university) || '',
        country:    ph.country    || (p.phd && p.phd.country)    || ''
      });
    }
    state.profilesByKey.set(author.name, p);

    // Open the existing Edit modal. It re-reads from state.profilesByKey.
    openEdit(author);

    // Attach a submitter-provenance hint above the modal form.
    const meta = data.submitter ? `Submitted by ${data.submitter.name} <${data.submitter.email}> (${data.submitter.relationship}) on ${new Date(data.submittedAt || Date.now()).toLocaleString()}.` : '';
    const notes = (data.notes || '').trim();
    const subtitle = $('#profile-modal-subtitle');
    if (subtitle) {
      const baseText = subtitle.textContent;
      subtitle.innerHTML = escapeHtml(baseText)
        + (meta   ? `<br><em style="color:#0e7490;">${escapeHtml(meta)}</em>` : '')
        + (notes  ? `<br><em style="color:#0e7490;">Notes: ${escapeHtml(notes)}</em>` : '');
    }
    status.textContent = `Loaded submission for ${author.name}. Review the fields and click Save changes.`;
  }

  function wireControls() {
    // Search + status filters
    let searchTimer;
    $('#filter-search').addEventListener('input', ev => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filter.q = ev.target.value.trim(); render(); }, 150);
    });
    $('#filter-status').addEventListener('change', ev => { state.filter.status = ev.target.value; render(); });

    // Manual-merge bar + modal wiring
    const mmBarMerge = document.getElementById('mm-bar-merge');
    const mmBarClear = document.getElementById('mm-bar-clear');
    const mmModalCancel = document.getElementById('mm-modal-cancel');
    const mmModalConfirm = document.getElementById('mm-modal-confirm');
    const mmModal = document.getElementById('mm-modal');
    if (mmBarMerge) mmBarMerge.addEventListener('click', openManualMergeModal);
    if (mmBarClear) mmBarClear.addEventListener('click', clearManualMergeSelection);
    if (mmModalCancel) mmModalCancel.addEventListener('click', closeManualMergeModal);
    if (mmModalConfirm) mmModalConfirm.addEventListener('click', confirmManualMerge);
    if (mmModal) mmModal.addEventListener('click', ev => { if (ev.target === mmModal) closeManualMergeModal(); });

    // Sheet URL config
    $('#sheet-save').addEventListener('click', () => {
      const url = $('#sheet-url').value.trim();
      if (url) localStorage.setItem(SHEET_URL_KEY, url);
      else localStorage.removeItem(SHEET_URL_KEY);
      toast('Google Sheet URL saved. Reloading data\u2026');
      setTimeout(() => loadData().then(render), 300);
    });
    $('#reload-btn').addEventListener('click', () => { loadData().then(render); });

    // Submission paste helper wiring
    const applyBtn = $('#submission-apply');
    const clearBtn = $('#submission-clear');
    if (applyBtn) applyBtn.addEventListener('click', applyPastedSubmission);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      $('#submission-paste').value = '';
      $('#submission-status').textContent = '';
    });

    // ============== Force sync from Zotero ==============
    // Triggers the GitHub Action `refresh-zotero-snapshot.yml` via API, then
    // polls until the workflow run completes, then re-loads admin data so
    // Ron sees the freshly synced snapshot without leaving the page.
    const WORKFLOW_FILE = 'refresh-zotero-snapshot.yml';
    const syncBtn = $('#sync-zotero-btn');
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      const token = localStorage.getItem(GH_TOKEN_KEY);
      if (!token) {
        toast('Paste a GitHub PAT below first — the Force Sync button needs it to trigger the Action.', 'error');
        return;
      }
      syncBtn.disabled = true;
      const origLabel = syncBtn.textContent;
      const setLabel = t => { syncBtn.textContent = t; };
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      };
      try {
        setLabel('Triggering sync…');
        // 1. POST workflow_dispatch
        const dispatchUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;
        const dispatchRes = await fetch(dispatchUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ref: 'main' })
        });
        if (!dispatchRes.ok) {
          const errBody = await dispatchRes.text();
          // 403 usually means the PAT lacks Actions:write permission
          if (dispatchRes.status === 403 || dispatchRes.status === 404) {
            toast(
              `Your GitHub PAT can't trigger Actions (status ${dispatchRes.status}). Regenerate it with “Actions: Read and write” permission, or click “Run workflow” directly on GitHub.`,
              'error'
            );
            window.open(`https://github.com/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}`, '_blank');
            throw new Error(`dispatch ${dispatchRes.status}: ${errBody.slice(0,120)}`);
          }
          throw new Error(`dispatch failed (${dispatchRes.status}): ${errBody.slice(0,120)}`);
        }
        toast('Sync started on GitHub. Waiting for it to finish…', 'success');
        // 2. Find the workflow run we just kicked off. There is a small delay
        // before it appears in the runs list, so poll a few times.
        const runsUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?event=workflow_dispatch&per_page=3`;
        let runId = null;
        for (let attempt = 0; attempt < 10 && !runId; attempt++) {
          await new Promise(r => setTimeout(r, 3000));
          setLabel(`Waiting for run to appear (${(attempt + 1) * 3}s)…`);
          const r = await fetch(runsUrl + '&_=' + Date.now(), { headers });
          if (!r.ok) continue;
          const j = await r.json();
          const recent = (j.workflow_runs || []).find(w => (Date.now() - new Date(w.created_at).getTime()) < 90000);
          if (recent) runId = recent.id;
        }
        if (!runId) throw new Error('Timed out waiting for the workflow run to appear.');
        // 3. Poll run status until it completes
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 4000));
          const rr = await fetch(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`, { headers });
          if (!rr.ok) continue;
          const rj = await rr.json();
          setLabel(`${rj.status === 'completed' ? 'Finalizing' : 'Syncing'}… (${Math.round((i + 1) * 4)}s)`);
          if (rj.status === 'completed') {
            if (rj.conclusion === 'success') {
              toast('Sync complete. Reloading admin data…', 'success');
              await loadData();
              render();
              // GH Pages takes ~30-60s more to serve the new JSON to the public
              // dashboard, so nudge Ron to hard-refresh that separately.
              toast('Public dashboard will show the new data within ~1 min (Cmd+Shift+R once).', 'success');
            } else {
              toast(`Sync workflow finished with status: ${rj.conclusion}. See the Actions tab.`, 'error');
              window.open(rj.html_url, '_blank');
            }
            return;
          }
        }
        toast('Sync is taking longer than usual — check the Actions tab.', 'error');
        window.open(`https://github.com/${GH_OWNER}/${GH_REPO}/actions/runs/${runId}`, '_blank');
      } catch (err) {
        console.error(err);
        toast(`Sync failed: ${err.message}`, 'error');
      } finally {
        syncBtn.disabled = false;
        setLabel(origLabel);
      }
    });

    // GitHub token (for direct photo uploads)
    const ghInput = $('#gh-token');
    if (ghInput) ghInput.value = localStorage.getItem(GH_TOKEN_KEY) || '';
    const ghSaveBtn = $('#gh-token-save');
    if (ghSaveBtn) ghSaveBtn.addEventListener('click', () => {
      const t = ($('#gh-token').value || '').trim();
      if (t) {
        localStorage.setItem(GH_TOKEN_KEY, t);
        toast('GitHub token saved to this browser. Dropped photos will now upload directly to img/scholars/.');
      } else {
        localStorage.removeItem(GH_TOKEN_KEY);
        toast('GitHub token cleared. Dropped photos will embed inline as base64.');
      }
    });

    // Push to GitHub (bulk)
    $('#push-github').addEventListener('click', async () => {
      if (!localStorage.getItem(GH_TOKEN_KEY)) {
        toast('Save a GitHub token in Data source first.');
        return;
      }
      const count = state.profilesByKey.size;
      toast(`Pushing ${count} profiles to GitHub…`);
      try {
        await pushProfilesToGitHub('bulk push');
        toast(`Pushed ${count} profiles to data/scholar-profiles.json.enc. Public site updates within ~1 min.`);
      } catch (err) {
        console.error(err);
        toast('GitHub push failed: ' + err.message);
      }
    });

    // Export buttons
    $('#export-csv').addEventListener('click', () => {
      const rows = Array.from(state.profilesByKey.values());
      openOutput('Copy this table into your Google Sheet',
        'Ctrl / Cmd + A to select all, then paste into cell A1 of your Google Sheet. This is tab-separated \u2014 Sheets pastes each column into its own cell natively, so names with commas (e.g. \u201cFinau, Glenn\u201d) stay in one cell.',
        toCsv(rows));
    });
    $('#export-json').addEventListener('click', () => {
      const rows = Array.from(state.profilesByKey.values());
      const json = JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: 'admin dashboard export',
        scholars: rows
      }, null, 2);
      openOutput('Copy this JSON into data/scholar-profiles.json', 'Replace the entire contents of data/scholar-profiles.json in the repo, then commit.', json);
    });

    // Profile modal
    wirePhotoDropzone();
    // Non-iTaukei-dad toggle greys out Paternal Province live — the value
    // is only persisted when Ron actually hits Save.
    const nonITDadCb = document.getElementById('pf-non-itaukei-dad');
    if (nonITDadCb) nonITDadCb.addEventListener('change', ev => applyNonItaukeiDadState(ev.target.checked));
    $('#pf-cancel').addEventListener('click', closeEdit);
    $('#pf-clear').addEventListener('click', () => {
      if (!editingAuthor) return;
      state.profilesByKey.delete(editingAuthor.name);
      toast(`${editingAuthor.name} removed from iTaukei list.`);
      closeEdit();
      render();
    });
    $('#profile-form').addEventListener('submit', async ev => {
      ev.preventDefault();
      try {
        await onSaveProfile();
      } catch (err) {
        console.error('Save failed:', err);
        toast('Save failed: ' + (err && err.message || String(err)) + ' (see console for details)');
      }
    });

    async function onSaveProfile() {
      if (!editingAuthor) {
        toast('No author is being edited — close and reopen the modal.');
        return;
      }
      const oldName = editingAuthor.name;
      const inputLast = ($('#pf-last').value || '').trim();
      const inputFirst = ($('#pf-first').value || '').trim();
      if (!inputLast || !inputFirst) {
        toast('Last and first name are both required.');
        return;
      }
      const newName = `${inputLast}, ${inputFirst}`;
      const isRename = newName !== oldName;

      // Auto-merge stub + repoint aliases before writing form fields, so
      // subsequent state.profilesByKey.get(...) calls see the renamed row.
      let renameSummary = null;
      if (isRename) {
        try {
          renameSummary = applyRenameInMemory(oldName, newName, inputLast, inputFirst);
        } catch (err) {
          console.error('[rename] failed:', err);
          toast('Rename blocked: ' + err.message);
          return;
        }
      }

      const workingName = isRename ? newName : oldName;
      const p = state.profilesByKey.get(workingName) || {};
      const last = inputLast;
      const first = inputFirst;
      Object.assign(p, {
        name: workingName,
        slug: p.slug || slugify(`${first}-${last}`),
        last, first,
        salutation: $('#pf-salutation').value,
        village: $('#pf-village').value.trim(),
        paternalProvince: $('#pf-paternal-province').value,
        maternalProvince: $('#pf-maternal-province').value,
        nonItaukeiDad: !!$('#pf-non-itaukei-dad').checked,
        institution: $('#pf-institution').value.trim(),
        institutionUrl: $('#pf-institution-url').value.trim(),
        sector: $('#pf-sector').value,
        institutionCountry: $('#pf-institution-country').value.trim(),
        department: $('#pf-department').value.trim(),
        departmentUrl: $('#pf-department-url').value.trim(),
        profileUrl: $('#pf-profile-url').value.trim(),
        masters: (function(){
          const u = $('#pf-masters-uni').value.trim(), c = $('#pf-masters-country').value.trim();
          return (u || c) ? { university: u, country: c } : null;
        })(),
        phd: (function(){
          const u = $('#pf-phd-uni').value.trim(), c = $('#pf-phd-country').value.trim();
          return (u || c) ? { university: u, country: c } : null;
        })(),
        title: $('#pf-title').value.trim(),
        googleScholarUrl: $('#pf-scholar-url').value.trim(),
        orcidUrl: $('#pf-orcid-url').value.trim(),
        photo: $('#pf-photo').value.trim(),
        lastUpdate: new Date().toISOString(),
        total: editingAuthor.total,
        firstAuthored: editingAuthor.firstAuthored,
        types: editingAuthor.types
      });
      const savedName = workingName;   // capture before closeEdit() nulls it
      state.profilesByKey.set(savedName, p);
      // Keep editingAuthor.name in sync so any downstream code that reads it
      // before closeEdit() nulls it (e.g. photo-download flow) sees the new
      // canonical name.
      editingAuthor.name = savedName;
      closeEdit();
      // Rebuild the authors index so publications reflow onto the renamed
      // scholar (via the freshly-added alias). Skip when nothing changed.
      if (isRename && state.snapshot) rebuildAuthors(state.snapshot);
      render();

      // Auto-push data/scholar-profiles.json to GitHub if a token is set,
      // eliminating the copy-paste-into-Sheets round-trip.
      if (localStorage.getItem(GH_TOKEN_KEY)) {
        toast(isRename
          ? `Saved locally. Renaming ${oldName} → ${savedName} on GitHub…`
          : `Saved locally. Pushing to GitHub…`);
        try {
          await pushProfilesToGitHub(isRename ? `rename: ${oldName} → ${savedName}` : savedName);
          let insightsMsg = '';
          if (isRename) {
            try {
              const r = await pushInsightsRenameToGitHub(oldName, savedName);
              if (r && r.pushed) insightsMsg = ' Insight key updated.';
            } catch (err) {
              console.error('[rename] insights push failed:', err);
              insightsMsg = ' Insight key push failed — see console.';
            }
          }
          const mergeBit = renameSummary && renameSummary.mergedStub ? ' (stub auto-merged)' : '';
          toast(isRename
            ? `Renamed ${oldName} → ${savedName}${mergeBit}.${insightsMsg} Public site updates within ~1 min.`
            : `Saved & pushed to GitHub. Public site updates within ~1 min.`);
        } catch (err) {
          console.error(err);
          toast('Saved locally, but GitHub push failed: ' + err.message);
        }
      } else {
        const mergeBit = renameSummary && renameSummary.mergedStub ? ' (stub auto-merged)' : '';
        toast(isRename
          ? `Renamed ${oldName} → ${savedName}${mergeBit} locally. Set a GitHub token in Data source to sync.`
          : `Saved profile for ${savedName}. Set a GitHub token in Data source to sync automatically.`);
      }
    }

    // Paste-in insights panel
    wireInsightsPastePanel();

    // Output modal
    $('#output-close').addEventListener('click', () => $('#output-modal').classList.remove('is-visible'));
    $('#output-copy').addEventListener('click', () => {
      const t = $('#save-output');
      t.select();
      document.execCommand('copy');
      toast('Copied to clipboard.');
    });
  }

  // ============ Paste-in Insights (keywords + summary + sources) ============
  // Lets Ron paste one or more scholar insight objects (same shape the AI
  // pipeline emits) directly into the admin and push them into
  // data/scholar-insights.json.enc without hand-editing the file. Names are
  // resolved through the alias table so pasting "Savou, Rusila" or
  // "Savou-Wara, Rusila" both land on the current canonical entry.

  function normalizeInsightEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (Array.isArray(raw.keywords)) out.keywords = raw.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim());
    if (typeof raw.summary === 'string') out.summary = raw.summary;
    if (typeof raw.summaryFormat === 'string') out.summaryFormat = raw.summaryFormat;
    if (Array.isArray(raw.sources)) {
      out.sources = raw.sources
        .filter(s => s && typeof s === 'object' && typeof s.url === 'string' && s.url.trim())
        .map(s => ({ title: (typeof s.title === 'string' ? s.title.trim() : '') || s.url.trim(), url: s.url.trim() }));
    }
    // Preserve any extra fields the pipeline may have added (publicationCount,
    // signature, regeneratedAt, etc.) so we don't strip metadata when re-saving.
    for (const [k, v] of Object.entries(raw)) {
      if (['keywords','summary','summaryFormat','sources'].includes(k)) continue;
      out[k] = v;
    }
    return out;
  }

  function resolveInsightTargetName(rawName) {
    // Try exact match in existing insights first, then alias table, then
    // profile keys, then fall back to the raw name (creates a new entry).
    return state.nameAliases.get(rawName) || rawName;
  }

  function renderInsightsPasteReport(rows) {
    const box = document.getElementById('insights-paste-report');
    if (!box) return;
    if (!rows.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    const html = [
      '<div style="border:1px solid var(--border); border-radius:8px; overflow:hidden;">',
      '<table style="width:100%; border-collapse:collapse; font-size:0.88rem;">',
      '<thead style="background:#f6f5f0;"><tr>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Pasted name</th>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Resolves to</th>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Action</th>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Keywords</th>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Summary length</th>',
      '<th style="text-align:left; padding:8px 12px; border-bottom:1px solid var(--border);">Sources</th>',
      '</tr></thead><tbody>',
      ...rows.map(r => {
        const badge = r.action === 'replace'
          ? '<span style="background:#e0f2f1; color:#00695c; padding:2px 8px; border-radius:99px; font-size:0.78rem; font-weight:600;">Replace</span>'
          : r.action === 'new'
            ? '<span style="background:#e3f2fd; color:#0d47a1; padding:2px 8px; border-radius:99px; font-size:0.78rem; font-weight:600;">New</span>'
            : '<span style="background:#fdecea; color:#8a2b2b; padding:2px 8px; border-radius:99px; font-size:0.78rem; font-weight:600;">Skip</span>';
        const via = r.pastedName !== r.canonicalName ? ` <span style="color:var(--muted); font-size:0.8rem;">(via alias)</span>` : '';
        return `<tr>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);">${escapeHtml(r.pastedName)}</td>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);"><strong>${escapeHtml(r.canonicalName)}</strong>${via}</td>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);">${badge}</td>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);">${r.keywordCount}</td>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);">${r.summaryChars}</td>
          <td style="padding:8px 12px; border-bottom:1px solid var(--border);">${r.sourceCount}</td>
        </tr>`;
      }),
      '</tbody></table></div>',
      '<div style="display:flex; gap:10px; margin-top:12px; align-items:center; flex-wrap:wrap;">',
      `<button type="button" class="btn primary" id="insights-paste-apply">Apply ${rows.filter(r=>r.action!=='skip').length} change${rows.filter(r=>r.action!=='skip').length===1?'':'s'} and push to GitHub</button>`,
      '<button type="button" class="btn ghost" id="insights-paste-cancel">Cancel</button>',
      '<span style="color:var(--muted); font-size:0.85rem;">Public dashboard updates in ~1 minute after push.</span>',
      '</div>'
    ].join('');
    box.innerHTML = html;
    box.style.display = '';

    document.getElementById('insights-paste-cancel').addEventListener('click', () => {
      box.style.display = 'none';
      box.innerHTML = '';
    });
    document.getElementById('insights-paste-apply').addEventListener('click', async () => {
      await applyInsightsPaste(rows);
    });
  }

  async function previewInsightsPaste() {
    const ta = document.getElementById('insights-paste-input');
    const status = document.getElementById('insights-paste-status');
    const raw = (ta.value || '').trim();
    if (!raw) { toast('Paste at least one insight object first.', 'error'); return; }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (err) { toast(`Invalid JSON: ${err.message}`, 'error'); return; }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast('Expected an object mapping scholar names to insight objects.', 'error');
      return;
    }

    // Load existing insights so we can label replace vs new.
    if (!window.dbGate || !window.dbGate.isUnlocked()) {
      toast('Database is locked — click "Reload from source" and enter your passcode first.', 'error');
      return;
    }
    let existing;
    try { existing = await window.dbGate.fetchJson('data/scholar-insights.json.enc'); }
    catch (err) { toast(`Could not load current insights: ${err.message}`, 'error'); return; }
    const existingMap = (existing && existing.insights) || {};

    const rows = [];
    for (const [pastedName, rawEntry] of Object.entries(parsed)) {
      const canonical = resolveInsightTargetName(pastedName);
      const normalized = normalizeInsightEntry(rawEntry);
      if (!normalized) {
        rows.push({ pastedName, canonicalName: canonical, action: 'skip',
                    keywordCount: 0, summaryChars: 0, sourceCount: 0, normalized: null });
        continue;
      }
      const action = Object.prototype.hasOwnProperty.call(existingMap, canonical) ? 'replace' : 'new';
      rows.push({
        pastedName,
        canonicalName: canonical,
        action,
        keywordCount: (normalized.keywords || []).length,
        summaryChars: (normalized.summary || '').length,
        sourceCount: (normalized.sources || []).length,
        normalized,
      });
    }

    const applyCount = rows.filter(r => r.action !== 'skip').length;
    status.textContent = `Parsed ${rows.length} entr${rows.length===1?'y':'ies'} — ${applyCount} to apply, ${rows.length - applyCount} skipped.`;
    renderInsightsPasteReport(rows);
  }

  async function applyInsightsPaste(rows) {
    const status = document.getElementById('insights-paste-status');
    if (!localStorage.getItem(GH_TOKEN_KEY)) {
      toast('No GitHub token set — cannot push. Add a token in Data source.', 'error');
      return;
    }
    if (!window.dbGate || !window.dbGate.isUnlocked()) {
      toast('Database is locked — reload from source with the passcode first.', 'error');
      return;
    }
    status.textContent = 'Fetching current insights bundle…';

    let insightsJson;
    try { insightsJson = await window.dbGate.fetchJson('data/scholar-insights.json.enc'); }
    catch (err) { toast(`Fetch failed: ${err.message}`, 'error'); status.textContent = ''; return; }
    if (!insightsJson || typeof insightsJson !== 'object') insightsJson = { insights: {} };
    if (!insightsJson.insights) insightsJson.insights = {};

    const applied = [];
    rows.forEach(r => {
      if (r.action === 'skip' || !r.normalized) return;
      // Preserve pre-existing metadata fields the paste didn't overwrite (e.g.
      // publicationCount, signature, regeneratedAt) so we don't wipe them.
      const prior = insightsJson.insights[r.canonicalName] || {};
      const merged = Object.assign({}, prior, r.normalized);
      merged.regeneratedAt = new Date().toISOString();
      insightsJson.insights[r.canonicalName] = merged;
      applied.push(r.canonicalName);
    });

    if (!applied.length) { toast('Nothing to apply.', 'error'); status.textContent = ''; return; }

    insightsJson.generatedAt = new Date().toISOString();
    insightsJson.source = 'admin-paste';

    status.textContent = `Encrypting and pushing ${applied.length} entr${applied.length===1?'y':'ies'} to GitHub…`;

    try {
      const jsonStr = JSON.stringify(insightsJson, null, 2) + '\n';
      const encBytes = await window.dbGate.encryptForUpload(jsonStr);
      const encBlob = new Blob([encBytes], { type: 'application/octet-stream' });
      const label = applied.length <= 3 ? applied.join(', ') : `${applied.length} scholars`;
      await githubUploadFile('data/scholar-insights.json.enc', encBlob, `admin: paste-in insights (${label})`);
    } catch (err) {
      console.error('[insights-paste] push failed:', err);
      toast(`GitHub push failed: ${err.message}`, 'error');
      status.textContent = '';
      return;
    }

    status.textContent = `Pushed. Public dashboard updates in ~1 minute.`;
    toast(`Saved insights for ${applied.length} scholar${applied.length===1?'':'s'}.`, 'success');
    // Clear input + report on success.
    document.getElementById('insights-paste-input').value = '';
    const box = document.getElementById('insights-paste-report');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  }

  function wireInsightsPastePanel() {
    const previewBtn = document.getElementById('insights-paste-preview');
    const clearBtn = document.getElementById('insights-paste-clear');
    if (previewBtn) previewBtn.addEventListener('click', previewInsightsPaste);
    if (clearBtn) clearBtn.addEventListener('click', () => {
      document.getElementById('insights-paste-input').value = '';
      const box = document.getElementById('insights-paste-report');
      if (box) { box.style.display = 'none'; box.innerHTML = ''; }
      document.getElementById('insights-paste-status').textContent = '';
    });
  }

  function openOutput(title, subtitle, content) {
    $('#output-modal-title').textContent = title;
    $('#output-modal-subtitle').textContent = subtitle;
    $('#save-output').value = content;
    $('#output-modal').classList.add('is-visible');
  }

})();
