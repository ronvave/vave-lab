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
  const PASSWORD_HASH = '801e61f51a774fc3b896ec5b4ae80d2bea4972145678a144598766ccc57cee54';
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
    authors: [],               // all unique authors (sorted by total desc)
    filter: { q: '', status: 'all' }
  };

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
    await loadData();
    wireControls();
    render();
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
    const [snap, profilesJson, graduate] = await Promise.all([
      // Cache-bust query string forces fresh fetch every time so admin never
      // shows a stale copy of the JSON right after a save/push.
      fetch(`data/itaukei-zotero-snapshot.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()),
      fetch(`data/scholar-profiles.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ scholars: [] })),
      fetch(`data/itaukei-graduate-studies.json?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ scholars: {} }))
    ]);
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
    // Load the explicit hide-list. Names in here are removed from the public dashboard
    // even though they still exist as Zotero collection subs.
    state.hiddenScholars = new Set(Array.isArray(profilesJson.hiddenScholars) ? profilesJson.hiddenScholars : []);

    // Build unique-author list from Zotero items
    const authorMap = new Map();
    snap.items.forEach(it => {
      const creators = it.creators || [];
      creators.forEach((c, idx) => {
        const canonical = canonicalName(c);
        if (!canonical) return;
        if (!authorMap.has(canonical)) {
          authorMap.set(canonical, { name: canonical, total: 0, firstAuthored: 0, types: {} });
        }
        const rec = authorMap.get(canonical);
        rec.total += 1;
        if (idx === 0) rec.firstAuthored += 1;
        rec.types[it.itemType] = (rec.types[it.itemType] || 0) + 1;
      });
    });
    state.authors = Array.from(authorMap.values()).sort((a, b) => b.total - a.total);
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
      tr.innerHTML = `
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
      const editBtn = tr.querySelector('[data-edit]');
      editBtn.addEventListener('click', () => { if (!editBtn.disabled) openEdit(a); });
      body.appendChild(tr);
    });
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
        state.profilesByKey.set(author.name, {
          name: author.name, slug: slugify(`${first}-${last}`),
          last, first, salutation: '', village: '', paternalProvince: '',
          institution: '', institutionUrl: '', googleScholarUrl: '', photo: '',
          total: author.total, firstAuthored: author.firstAuthored, types: author.types
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
  function openEdit(author) {
    editingAuthor = author;
    const p = state.profilesByKey.get(author.name) || {};
    $('#profile-modal-title').textContent = `Edit profile: ${author.name}`;
    $('#profile-modal-subtitle').textContent = `${author.total} publications, ${author.firstAuthored} first-authored.`;
    $('#pf-salutation').value = p.salutation || '';
    $('#pf-village').value = p.village || '';
    $('#pf-paternal-province').value = p.paternalProvince || '';
    $('#pf-institution').value = p.institution || '';
    $('#pf-institution-url').value = p.institutionUrl || '';
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
    return JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'admin-dashboard',
      scholars,
      hiddenScholars
    }, null, 2) + '\n';
  }

  // Push data/scholar-profiles.json to GitHub. Silent no-op if no token set.
  async function pushProfilesToGitHub(triggerName) {
    if (!localStorage.getItem(GH_TOKEN_KEY)) return { skipped: true };
    const json = serializeProfilesJson();
    const msg = `admin: update scholar profiles${triggerName ? ' (' + triggerName + ')' : ''}`;
    await githubUploadFile('data/scholar-profiles.json', json, msg);
    return { pushed: true, bytes: json.length };
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

  function wireControls() {
    // Search + status filters
    let searchTimer;
    $('#filter-search').addEventListener('input', ev => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filter.q = ev.target.value.trim(); render(); }, 150);
    });
    $('#filter-status').addEventListener('change', ev => { state.filter.status = ev.target.value; render(); });

    // Sheet URL config
    $('#sheet-save').addEventListener('click', () => {
      const url = $('#sheet-url').value.trim();
      if (url) localStorage.setItem(SHEET_URL_KEY, url);
      else localStorage.removeItem(SHEET_URL_KEY);
      toast('Google Sheet URL saved. Reloading data\u2026');
      setTimeout(() => loadData().then(render), 300);
    });
    $('#reload-btn').addEventListener('click', () => { loadData().then(render); });

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
        toast(`Pushed ${count} profiles to data/scholar-profiles.json. Public site updates within ~1 min.`);
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
      const p = state.profilesByKey.get(editingAuthor.name) || {};
      const [last, first] = editingAuthor.name.split(',').map(s => s.trim());
      Object.assign(p, {
        name: editingAuthor.name,
        slug: p.slug || slugify(`${first}-${last}`),
        last, first,
        salutation: $('#pf-salutation').value,
        village: $('#pf-village').value.trim(),
        paternalProvince: $('#pf-paternal-province').value,
        institution: $('#pf-institution').value.trim(),
        institutionUrl: $('#pf-institution-url').value.trim(),
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
      const savedName = editingAuthor.name;   // capture before closeEdit() nulls it
      state.profilesByKey.set(savedName, p);
      closeEdit();
      render();

      // Auto-push data/scholar-profiles.json to GitHub if a token is set,
      // eliminating the copy-paste-into-Sheets round-trip.
      if (localStorage.getItem(GH_TOKEN_KEY)) {
        toast(`Saved locally. Pushing to GitHub…`);
        try {
          await pushProfilesToGitHub(savedName);
          toast(`Saved & pushed to GitHub. Public site updates within ~1 min.`);
        } catch (err) {
          console.error(err);
          toast('Saved locally, but GitHub push failed: ' + err.message);
        }
      } else {
        toast(`Saved profile for ${savedName}. Set a GitHub token in Data source to sync automatically.`);
      }
    }

    // Output modal
    $('#output-close').addEventListener('click', () => $('#output-modal').classList.remove('is-visible'));
    $('#output-copy').addEventListener('click', () => {
      const t = $('#save-output');
      t.select();
      document.execCommand('copy');
      toast('Copied to clipboard.');
    });
  }

  function openOutput(title, subtitle, content) {
    $('#output-modal-title').textContent = title;
    $('#output-modal-subtitle').textContent = subtitle;
    $('#save-output').value = content;
    $('#output-modal').classList.add('is-visible');
  }

})();
