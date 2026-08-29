/**
 * Demo-mode gate for the Tongan Scholar Database (dashboard).
 *
 * Sister clone of js/demo-gate.js (iTaukei). Uses its own baked passcode
 * and its own HMAC demo-token signing key, both distinct from the iTaukei
 * originals — see TONGAN-DASHBOARD-BUILD-NOTES.md at the repo root for the
 * chosen values and rationale. Nothing in this file reads from or writes
 * to any iTaukei-prefixed data file.
 *
 * Replaces the earlier passcode-gate (db-gate.js). The dashboard is now
 * public by default — anyone who lands on the URL sees a skeleton with
 * placeholder messages where the sensitive panels used to render. The
 * real data unlocks only when:
 *
 *   1. Dev mode — the visitor's browser has been marked as Ron's dev
 *      device via localStorage.vavelab_dev = '1'. Once marked, the
 *      gate is transparent forever on that device.
 *
 *   2. Demo mode — the URL hash contains a valid, unexpired, non-revoked
 *      token issued by Ron (from the "Share demo view" button). Tokens
 *      last 2 hours by default. Ron can end a demo early by pressing
 *      "End demo", which appends the token's jti to a revocations file
 *      committed to GitHub — after which the URL is dead for everyone.
 *
 * ── Trade-off with the old passcode gate ──
 * The .enc data files stay encrypted with their own Tongan passcode-derived
 * key (distinct from the iTaukei system's), but that passcode is now baked into this file
 * so the gate can decrypt without prompting. A determined viewer with
 * devtools could grep the bundle and pull the passcode out. That's a
 * lower bar than before — accepted trade-off for a friction-free daily
 * workflow. Anyone who wants to leak the data during a demo could just
 * screenshot it anyway; the gate defends against casual re-visits, not
 * against a determined viewer sitting through the demo.
 *
 * ── Token format ──
 * Hash fragment `#demo=<payload_b64u>.<sig_b64u>` where:
 *   payload = JSON { v: 1, iss: <ms>, exp: <ms>, jti: <8-hex random> }
 *   sig = HMAC-SHA256(payload_utf8, DEMO_SIGN_KEY)
 * Payload and sig are base64url encoded (no padding).
 *
 * ── Revocations ──
 * data/revoked-demos.json is a plaintext JSON `{ jtis: [...] }`. Anyone
 * loading the page fetches it; if the current token's jti is in the
 * list, the token is rejected and the public shell renders. Ron's
 * End-demo button commits an updated file via the same GitHub PAT flow
 * admin.js already uses.
 */
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────
  var DEMO_TTL_MS = 2 * 60 * 60 * 1000;      // 2 hours
  var DEV_FLAG_KEY = 'vavelab_dev';           // localStorage marker for Ron's device
  var GH_TOKEN_KEY = 'vavelab_gh_token';      // GitHub PAT (shared with admin.js)
  var GH_OWNER = 'ronvave';
  var GH_REPO = 'vave-lab';
  var REVOKE_PATH = 'data/tongan-revoked-demos.json';
  var PBKDF2_ITERATIONS = 200000;
  var MAGIC = new Uint8Array([0x49, 0x56, 0x41, 0x56]); // "IVAV"

  // Passcode baked in so the gate can decrypt .enc files without a
  // prompt. See the module comment for the trade-off note. Kept as
  // base64 so a casual grep of "Arachnid1" doesn't hit; anyone with
  // devtools can still recover it. This is by design.
  var BAKED_PASSCODE = atob('T25nb29uZ285IQ==');

  // HMAC signing key for demo tokens. Base64 of a fixed random 32-byte
  // string, embedded here for the same trade-off reason. If someone
  // extracts this and the passcode, they can mint their own tokens.
  // Revocations still work against forged tokens because the "End demo"
  // button revokes by jti, and Ron can add any jti to the revocations
  // list at any time.
  // NOTE: this key is unique to the Tongan Scholar Database and differs
  // from the iTaukei system's DEMO_SIGN_KEY_B64 — see
  // TONGAN-DASHBOARD-BUILD-NOTES.md.
  var DEMO_SIGN_KEY_B64 = 'epASqFw3UP4CMHUrm4BMwXSX48PS8vvoIIHD6pByLyM=';

  // ── State ────────────────────────────────────────────────────────────
  var mode = 'public';       // 'public' | 'dev' | 'demo'
  var activeToken = null;    // { payload, sig, raw } when mode === 'demo'
  var revokedJtis = null;    // Set<string> once fetched
  var cachedPasscode = null;
  var keyBySaltHex = Object.create(null);
  var derivedSignKey = null;

  // ── Byte / base64 helpers ────────────────────────────────────────────
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
    }
    return hex;
  }
  function randomHex(nBytes) {
    var bytes = new Uint8Array(nBytes);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }
  function b64ToBytes(str) {
    var s = atob(str);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }
  function b64uEncode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(str) {
    var pad = str.length % 4;
    if (pad === 2) str += '==';
    else if (pad === 3) str += '=';
    else if (pad === 1) throw new Error('invalid base64url');
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    return b64ToBytes(str);
  }
  function bust(url) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  // ── Decryption plumbing (same wire format as db-gate.js) ─────────────
  async function deriveAesKey(passcode, salt) {
    var baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passcode),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt', 'encrypt']
    );
  }
  async function keyForSalt(saltBytes) {
    if (!cachedPasscode) throw new Error('Gate not unlocked.');
    var hex = bytesToHex(saltBytes);
    if (keyBySaltHex[hex]) return keyBySaltHex[hex];
    var key = await deriveAesKey(cachedPasscode, saltBytes);
    keyBySaltHex[hex] = key;
    return key;
  }
  function parseBlob(blob) {
    var bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    if (bytes.length < 4 + 16 + 12 + 16) throw new Error('Encrypted blob too short.');
    if (!bytesEqual(bytes.slice(0, 4), MAGIC)) throw new Error('Not an IVAV blob.');
    return { salt: bytes.slice(4, 20), iv: bytes.slice(20, 32), ct: bytes.slice(32) };
  }
  async function decryptBlob(blob) {
    var parts = parseBlob(blob);
    var key = await keyForSalt(parts.salt);
    var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parts.iv }, key, parts.ct);
    return new TextDecoder().decode(plainBuf);
  }
  async function encryptString(plaintext) {
    if (!cachedPasscode) throw new Error('Gate not unlocked.');
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveAesKey(cachedPasscode, salt);
    var body = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(plaintext)
    );
    var bodyBytes = new Uint8Array(body);
    var out = new Uint8Array(4 + 16 + 12 + bodyBytes.length);
    out.set(MAGIC, 0);
    out.set(salt, 4);
    out.set(iv, 20);
    out.set(bodyBytes, 32);
    keyBySaltHex[bytesToHex(salt)] = key;
    return out;
  }

  // Encrypted-file map (same as db-gate.js).
  //
  // The Master-file V2 preview (itaukei-research-database-master.html) also
  // uses this gate. Its eight `data/itaukei-master-*.json` + `last-master-sync.json`
  // targets are registered here so `dbGate.fetchJson(masterUrl)` transparently
  // fetches and decrypts the .enc counterpart. Production (Zotero) dashboard
  // never fetches those URLs, so this map is a strict superset and does not
  // affect production behaviour.
  var ENC_FILES = {
    'data/tongan-zotero-snapshot.json': 'data/tongan-zotero-snapshot.json.enc',
    'data/tonga-districts.geojson':      'data/tonga-districts.geojson.enc',
    // NOTE: world-universities.json is NOT actually fetched by the V2
    // Master-file dashboard code path (js/tongan-database-master.js never
    // calls fetchJson('data/world-universities.json') — same as the
    // upstream iTaukei file). Mapped here to a Tonga-prefixed target
    // rather than the shared iTaukei-encrypted file (which uses a
    // different passcode and could never be decrypted by this gate) in
    // case a future code path needs it.
    'data/world-universities.json':      'data/tongan-world-universities.json.enc',
    'data/tonga-districts.json':         'data/tonga-districts.json.enc',
    'data/tongan-scholar-profiles.json': 'data/tongan-scholar-profiles.json.enc',
    'data/tongan-last-sync.json':        'data/tongan-last-sync.json.enc',
    'data/tongan-graduate-studies.json': 'data/tongan-graduate-studies.json.enc',
    'data/tongan-scholar-insights.json': 'data/tongan-scholar-insights.json.enc',
    // Master-file V2 preview snapshots (refreshed every 2h by
    // .github/workflows/refresh-tongan-master-file.yml, once created).
    // Only the V2 preview page fetches these; the production dashboard
    // does not.
    'data/tongan-master-scholars.json':     'data/tongan-master-scholars.json.enc',
    'data/tongan-master-publications.json': 'data/tongan-master-publications.json.enc',
    'data/tongan-master-authorship.json':   'data/tongan-master-authorship.json.enc',
    'data/tongan-master-researcher-authorship.json':
      'data/tongan-master-researcher-authorship.json.enc',
    'data/tongan-master-grad-degrees.json': 'data/tongan-master-grad-degrees.json.enc',
    'data/tongan-master-mobility.json':     'data/tongan-master-mobility.json.enc',
    'data/tongan-master-geography.json':    'data/tongan-master-geography.json.enc',
    'data/tongan-master-aggregates.json':   'data/tongan-master-aggregates.json.enc',
    // Master-derived Panel B2 world-points payload. Built by
    // scripts/master_b2_worldpoints.py from the authoritative Master
    // Graduate Degrees snapshot. Drives the country → university →
    // scholar drilldown in Panel B2 with completion filtering,
    // discipline-string rejection, and canonical C_Uni grouping.
    'data/tongan-master-worldpoints.json':  'data/tongan-master-worldpoints.json.enc',
    'data/tongan-last-master-sync.json':     'data/tongan-last-master-sync.json.enc',
    // Panel C1 body-composition chart, V2 (Master-file) variant. Same schema
    // as the V1 file; the iframe fetches this when the parent URL passes
    // ?src=master.
    'data/tongan-body-composition-master.json': 'data/tongan-body-composition-master.json.enc',
    'data/tongan-body-composition.json':        'data/tongan-body-composition.json.enc',
    // Admin V2 enrichment sidecar (Scholar-ID keyed): photo path, sector,
    // institutionUrl, departmentUrl, updatedAt. Written by Admin V2 on
    // every save. Only the .enc variant exists on disk—this mapping tells
    // the gate to transparently redirect the plaintext URL to the
    // encrypted counterpart, matching how every other .enc-backed file
    // works. Without this entry, master-file-adapter.js would silently
    // 404 and lose photo/lastUpdate/institutionUrl/sector overlay data
    // for every scholar. (Fix 2026-08-23 for Joeli's photo + Last update.)
    'data/tongan-scholar-enrichment.json':   'data/tongan-scholar-enrichment.json.enc',
    // Admin V2 research-insights sidecar (Scholar-ID keyed): keywords,
    // summaryHtml, summaryFormat, sources. Written by Admin V2 whenever
    // the 'Research insights' JSON is pasted + saved. Same registration
    // pattern as scholar-enrichment.json above. Without this entry,
    // master-file-adapter.js's fetchJson('data/scholar-insights-master.json')
    // 404s and every Panel F card reports '(none yet)' + 'Insight not yet
    // generated for this scholar', even after successful admin pushes.
    // (Fix 2026-08-23 for Joeli's insights not surfacing after admin paste.)
    'data/tongan-scholar-insights-master.json': 'data/tongan-scholar-insights-master.json.enc'
  };

  async function fetchJsonEncrypted(url) {
    var encUrl = ENC_FILES[url];
    if (!encUrl) {
      var r0 = await fetch(bust(url), { cache: 'no-store' });
      if (!r0.ok) throw new Error('Fetch failed: ' + url + ' (' + r0.status + ')');
      return r0.json();
    }
    if (!cachedPasscode) throw new Error('Gate not unlocked.');
    var res = await fetch(bust(encUrl), { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed: ' + encUrl + ' (' + res.status + ')');
    var text = await decryptBlob(await res.arrayBuffer());
    return JSON.parse(text);
  }

  // Dashboard panels B3 and C1 run in same-origin iframes. They need to read
  // the committed aggregate snapshots without opening the full demo/admin
  // shell. Keep this narrowly scoped to embedded documents; normal top-level
  // pages still follow boot() and its public/demo/dev access rules.
  function unlockEmbeddedRead() {
    var embedded = false;
    try {
      embedded = window.self !== window.top ||
        new URLSearchParams(location.search).get('embedded') === '1';
    } catch (e) {
      embedded = true;
    }
    if (!embedded) return false;
    cachedPasscode = BAKED_PASSCODE;
    return true;
  }

  // ── Token signing / verifying ────────────────────────────────────────
  async function getSignKey() {
    if (derivedSignKey) return derivedSignKey;
    derivedSignKey = await crypto.subtle.importKey(
      'raw',
      b64ToBytes(DEMO_SIGN_KEY_B64),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    return derivedSignKey;
  }
  async function signPayloadBytes(payloadBytes) {
    var key = await getSignKey();
    var sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
    return new Uint8Array(sig);
  }
  async function verifyPayloadBytes(payloadBytes, sigBytes) {
    var key = await getSignKey();
    return crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
  }
  async function mintToken(ttlMs) {
    var now = Date.now();
    var payload = { v: 1, iss: now, exp: now + (ttlMs || DEMO_TTL_MS), jti: randomHex(8) };
    var payloadJson = JSON.stringify(payload);
    var payloadBytes = new TextEncoder().encode(payloadJson);
    var sig = await signPayloadBytes(payloadBytes);
    return { payload: payload, raw: b64uEncode(payloadBytes) + '.' + b64uEncode(sig) };
  }
  async function parseAndVerifyToken(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return null;
    var parts = rawStr.split('.');
    if (parts.length !== 2) return null;
    try {
      var payloadBytes = b64uDecode(parts[0]);
      var sigBytes = b64uDecode(parts[1]);
      var ok = await verifyPayloadBytes(payloadBytes, sigBytes);
      if (!ok) return null;
      var payload = JSON.parse(new TextDecoder().decode(payloadBytes));
      if (!payload || payload.v !== 1) return null;
      if (typeof payload.exp !== 'number') return null;
      return { payload: payload, raw: rawStr };
    } catch (e) {
      return null;
    }
  }

  // ── Revocations list ─────────────────────────────────────────────────
  async function loadRevocations() {
    if (revokedJtis) return revokedJtis;
    try {
      var res = await fetch(bust(REVOKE_PATH), { cache: 'no-store' });
      if (!res.ok) {
        // File may not exist yet — treat as empty.
        revokedJtis = new Set();
        return revokedJtis;
      }
      var data = await res.json();
      var arr = (data && Array.isArray(data.jtis)) ? data.jtis : [];
      revokedJtis = new Set(arr);
    } catch (e) {
      revokedJtis = new Set();
    }
    return revokedJtis;
  }

  // ── URL / hash helpers ───────────────────────────────────────────────
  function readTokenFromHash() {
    var h = location.hash || '';
    if (h.charAt(0) === '#') h = h.substr(1);
    if (!h) return null;
    var params = h.split('&');
    for (var i = 0; i < params.length; i++) {
      var kv = params[i].split('=');
      if (kv[0] === 'demo' && kv[1]) return decodeURIComponent(kv[1]);
    }
    return null;
  }
  function removeTokenFromHash() {
    var h = location.hash || '';
    if (h.charAt(0) === '#') h = h.substr(1);
    if (!h) return;
    var kept = h.split('&').filter(function (kv) { return kv.indexOf('demo=') !== 0; });
    var newHash = kept.length ? ('#' + kept.join('&')) : '';
    // Replace history entry so a Back-button press doesn't restore the token.
    history.replaceState(null, '', location.pathname + location.search + newHash);
  }
  function writeTokenToHash(rawToken) {
    var h = location.hash || '';
    if (h.charAt(0) === '#') h = h.substr(1);
    var parts = h ? h.split('&').filter(function (kv) { return kv.indexOf('demo=') !== 0; }) : [];
    parts.unshift('demo=' + encodeURIComponent(rawToken));
    history.replaceState(null, '', location.pathname + location.search + '#' + parts.join('&'));
  }

  // ── Dev mode ─────────────────────────────────────────────────────────
  function isDevMarked() {
    try { return localStorage.getItem(DEV_FLAG_KEY) === '1'; }
    catch (e) { return false; }
  }
  function markDev() {
    try { localStorage.setItem(DEV_FLAG_KEY, '1'); } catch (e) {}
  }
  function unmarkDev() {
    try { localStorage.removeItem(DEV_FLAG_KEY); } catch (e) {}
  }
  // Accept `?dev=1` in the URL as a one-time opt-in: sets the flag and
  // strips the param from the URL so no shared screenshot leaks it.
  function handleDevOptIn() {
    var params = new URLSearchParams(location.search);
    if (params.get('dev') === '1') {
      markDev();
      params.delete('dev');
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
    if (params.get('dev') === '0') {
      unmarkDev();
      params.delete('dev');
      var qs2 = params.toString();
      history.replaceState(null, '', location.pathname + (qs2 ? '?' + qs2 : '') + location.hash);
    }
  }

  // ── Public shell ─────────────────────────────────────────────────────
  function injectShellStyles() {
    if (document.getElementById('demo-gate-styles')) return;
    var css = ''
      + '.demo-gate-shell{min-height:calc(100vh - 120px);display:flex;align-items:center;justify-content:center;padding:48px 24px;background:linear-gradient(180deg,#f8f5f0 0%,#efe8dc 60%,#e8ded0 100%);}'
      + '.demo-gate-shell__panel{width:100%;max-width:520px;background:#fff;border:1px solid rgba(15,57,33,0.12);border-radius:14px;padding:36px 32px 30px;box-shadow:0 20px 50px -22px rgba(15,57,33,0.28),0 6px 16px -8px rgba(15,57,33,0.14);text-align:center;}'
      + '.demo-gate-shell__badge{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:rgba(14,116,144,0.10);color:#0F3921;margin:0 auto 18px;}'
      + '.demo-gate-shell__title{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:1.9rem;line-height:1.15;margin:0 0 12px;color:#0F3921;letter-spacing:-0.01em;}'
      + '.demo-gate-shell__body{margin:0 0 8px;color:#28251d;font-size:1rem;line-height:1.6;}'
      + '.demo-gate-shell__foot{margin:22px 0 0;color:#7a8880;font-size:0.85rem;}'
      + '.demo-gate-shell__foot a{color:#0E7490;text-decoration:underline;text-underline-offset:3px;}'
      + '.demo-gate-shell__reason{margin:14px 0 0;padding:10px 14px;background:#fdf1e6;color:#8B3A0F;border-radius:8px;font-size:0.9rem;text-align:left;}'
      + 'body.demo-gate-locked main > *:not(.demo-gate-shell){display:none !important;}'
      // Demo controls (Share demo view / End demo / countdown).
      + '.demo-gate-controls{position:fixed;bottom:16px;right:16px;display:flex;flex-direction:row;align-items:stretch;gap:8px;z-index:9999;font-family:"DM Sans",system-ui,sans-serif;}'
      + '.demo-gate-controls button{padding:10px 16px;font-size:0.85rem;font-weight:600;border-radius:999px;border:1px solid rgba(15,57,33,0.20);background:#fff;color:#0F3921;cursor:pointer;box-shadow:0 6px 16px -8px rgba(15,57,33,0.20);transition:background 0.15s ease,transform 0.05s ease;}'
      + '.demo-gate-controls button:hover{background:#f5efe4;}'
      + '.demo-gate-controls button:active{transform:translateY(1px);}'
      + '.demo-gate-controls button.is-primary{background:#0F3921;color:#fff;border-color:#0F3921;}'
      + '.demo-gate-controls button.is-primary:hover{background:#12442a;}'
      + '.demo-gate-controls button.is-danger{background:#8B3A0F;color:#fff;border-color:#8B3A0F;}'
      + '.demo-gate-controls button.is-danger:hover{background:#6E2E0B;}'
      + '.demo-gate-controls__timer{display:inline-flex;align-items:center;padding:10px 14px;font-size:0.82rem;font-weight:600;color:#0F3921;background:#fff;border:1px solid rgba(15,57,33,0.20);border-radius:999px;box-shadow:0 6px 16px -8px rgba(15,57,33,0.20);font-variant-numeric:tabular-nums;}'
      + '.demo-gate-toast{position:fixed;bottom:70px;right:16px;padding:10px 14px;background:#0F3921;color:#fff;border-radius:8px;font-family:"DM Sans",system-ui,sans-serif;font-size:0.88rem;font-weight:500;box-shadow:0 8px 20px -8px rgba(15,57,33,0.35);z-index:9999;max-width:320px;line-height:1.4;}'
      + '.demo-gate-toast--error{background:#8B3A0F;}';
    var style = document.createElement('style');
    style.id = 'demo-gate-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildShellHtml(reason) {
    var reasonBlock = reason ? '<p class="demo-gate-shell__reason">' + reason + '</p>' : '';
    return ''
      + '<section class="demo-gate-shell" role="region" aria-label="Preview access">'
      +   '<div class="demo-gate-shell__panel">'
      +     '<div class="demo-gate-shell__badge" aria-hidden="true">'
      +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
      +     '</div>'
      +     '<h1 class="demo-gate-shell__title">Tongan Scholar Database</h1>'
      +     '<p class="demo-gate-shell__body">Demo mode.</p>'
      +     reasonBlock
      +     '<p class="demo-gate-shell__foot">Curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Prof. Ron Vave</a> \u00b7 University of Hawai\u02bbi at M\u0101noa</p>'
      +   '</div>'
      + '</section>';
  }

  function renderPublicShell(reason) {
    injectShellStyles();
    document.body.classList.add('demo-gate-locked');
    var main = document.querySelector('main');
    if (!main) return;
    // Remove any previously injected shell (safety on re-entry).
    var existing = main.querySelector('.demo-gate-shell');
    if (existing) existing.remove();
    var wrap = document.createElement('div');
    wrap.innerHTML = buildShellHtml(reason);
    main.insertBefore(wrap.firstElementChild, main.firstChild);
    wireBadgeTripleClick();
  }

  // Admin-unlock affordances (undocumented on purpose):
  //   1. Keyboard: Ctrl+Alt+D  (or Ctrl+Option+D on Mac) prompts for the
  //      passcode. Correct passcode marks the device dev + reloads.
  //      Alt+Shift+A is a second fallback chord in case an extension
  //      has claimed Ctrl+Alt+D on Ron's device.
  //      Ctrl+Shift+D was avoided because Chrome / Safari reserve it
  //      for the browser's own "Bookmark all tabs" chord and swallow
  //      keydown events for it before the page ever sees them.
  //      NOTE: the keyboard listener MUST be wired regardless of mode
  //      (public / demo / dev). Previously it was only wired inside
  //      renderPublicShell() so keys did nothing on a demo URL, which
  //      stranded Ron when he opened his own demo link on a fresh
  //      device.
  //   2. Mouse:   triple-click the padlock badge on the public shell.
  //      Only relevant when the shell is visible (i.e. public mode).
  var adminKeysWired = false;
  function wireAdminUnlockKeys() {
    if (adminKeysWired) return;
    adminKeysWired = true;
    document.addEventListener('keydown', function (e) {
      // Ctrl+Alt+D  (Windows/Linux)  =  Ctrl+Option+D  (macOS).
      var comboA = e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD');
      // Fallback: Alt+Shift+A (browser-safe on Chrome/Firefox/Safari).
      var comboB = e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && (e.key === 'A' || e.key === 'a' || e.code === 'KeyA');
      if (comboA || comboB) {
        e.preventDefault();
        promptAdminUnlock();
      }
    });
  }

  function wireBadgeTripleClick() {
    var badge = document.querySelector('.demo-gate-shell__badge');
    if (!badge || badge.dataset.tripleClickWired === '1') return;
    badge.dataset.tripleClickWired = '1';
    badge.style.cursor = 'default';
    var clicks = 0;
    var clickTimer = null;
    badge.addEventListener('click', function () {
      clicks++;
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(function () { clicks = 0; }, 900);
      if (clicks >= 3) {
        clicks = 0;
        promptAdminUnlock();
      }
    });
  }

  function promptAdminUnlock() {
    var entered = window.prompt('Admin passcode:');
    if (entered === null) return;
    if (entered !== BAKED_PASSCODE) {
      showToast('Wrong passcode.', true);
      return;
    }
    // Correct passcode. What happens next depends on the current mode.
    if (mode === 'demo') {
      // Live demo in progress: reveal the End-demo pill so Ron can
      // wind it down. Do NOT mark the device dev — that would strip
      // the token from the URL on next reload.
      revealDemoControls();
      showToast('Demo controls revealed.');
      return;
    }
    if (mode === 'dev' && readTokenFromHash()) {
      // Ron is on his own dev machine and there's a demo token in the
      // URL (he just clicked Share). Expose the End-demo pill so he
      // can revoke without reloading in a non-dev browser.
      revealDevEndDemoControls();
      showToast('End-demo controls revealed.');
      return;
    }
    // Public shell (or any other state): mark the device dev + reload
    // without any query string.
    markDev();
    var url = location.pathname + location.hash;
    location.replace(url);
  }

  function removePublicShell() {
    document.body.classList.remove('demo-gate-locked');
    var el = document.querySelector('.demo-gate-shell');
    if (el) el.remove();
  }

  // ── Demo controls (Share / End / countdown) ──────────────────────────
  function showToast(message, isError) {
    var el = document.createElement('div');
    el.className = 'demo-gate-toast' + (isError ? ' demo-gate-toast--error' : '');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 350);
    }, isError ? 4500 : 2500);
  }

  function formatRemaining(ms) {
    if (ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var hrs = Math.floor(totalSec / 3600);
    var mins = Math.floor((totalSec % 3600) / 60);
    if (hrs > 0) return hrs + 'h ' + (mins < 10 ? '0' : '') + mins + 'm';
    var secs = totalSec % 60;
    return mins + ':' + (secs < 10 ? '0' : '') + secs;
  }

  function injectDevControls() {
    injectShellStyles();
    if (document.getElementById('demo-gate-controls')) return;
    // If Ron already has a demo token in the URL (i.e. he generated one
    // earlier and hasn't ended it yet), don't show the Share pill — he
    // asked for the dev screen to look quiet during a live demo, and
    // clicking Share again would just mint another token. Ron can still
    // reset by clearing the hash or pressing Ctrl+Alt+D + entering the
    // passcode to reveal the End-demo pill.
    if (readTokenFromHash()) return;
    var wrap = document.createElement('div');
    wrap.id = 'demo-gate-controls';
    wrap.className = 'demo-gate-controls';
    wrap.innerHTML = ''
      + '<button type="button" class="is-primary" data-demo-share title="Generate a 2-hour demo URL and copy it to clipboard">Share demo view</button>';
    document.body.appendChild(wrap);
    wrap.querySelector('[data-demo-share]').addEventListener('click', onShareDemo);
  }

  function injectDemoControls() {
    // On a demo URL we intentionally show NOTHING on-screen — no
    // countdown, no "End demo" pill, no "this is a demo" banner. Ron
    // shares the link, gives the demo, and nothing on the page hints
    // at the time limit. To end a demo early Ron opens the Admin page
    // (which reads the same GitHub revocations file) or uses the
    // admin-key chord below to expose the pill for one session.
    //
    // Behind the scenes the token is still parsed, verified, and
    // enforced (expiry + revocations). The countdown runs invisibly
    // so an expired token still forces a reload into the public shell.
    injectShellStyles();
    startCountdown();
  }

  // Dev-mode variant: Ron is on his own machine (mode === 'dev') but
  // there's a demo token in the URL. Parse it, populate activeToken,
  // then render the End-demo pill so he can revoke without leaving
  // dev mode.
  async function revealDevEndDemoControls() {
    if (document.getElementById('demo-gate-controls')) return;
    var rawToken = readTokenFromHash();
    if (!rawToken) return;
    if (!activeToken) {
      var verified = await parseAndVerifyToken(rawToken);
      if (!verified) { showToast('Token in URL is not valid.', true); return; }
      activeToken = verified;
    }
    var wrap = document.createElement('div');
    wrap.id = 'demo-gate-controls';
    wrap.className = 'demo-gate-controls';
    wrap.innerHTML = ''
      + '<span class="demo-gate-controls__timer" data-demo-timer></span>'
      + '<button type="button" class="is-danger" data-demo-end title="End the demo and revoke the URL for everyone">End demo</button>';
    document.body.appendChild(wrap);
    wrap.querySelector('[data-demo-end]').addEventListener('click', onEndDemo);
    startCountdown();
  }

  // Reveal the demo pill (timer + End-demo button) on-demand. Called
  // from promptAdminUnlock when the current mode is 'demo' — lets Ron
  // wind down a live demo without leaving "Demo · 1h 23m" on-screen
  // for the whole session.
  function revealDemoControls() {
    if (mode !== 'demo') return;
    if (document.getElementById('demo-gate-controls')) return;
    var wrap = document.createElement('div');
    wrap.id = 'demo-gate-controls';
    wrap.className = 'demo-gate-controls';
    wrap.innerHTML = ''
      + '<span class="demo-gate-controls__timer" data-demo-timer></span>'
      + '<button type="button" class="is-danger" data-demo-end title="End the demo and revoke the URL for everyone">End demo</button>';
    document.body.appendChild(wrap);
    wrap.querySelector('[data-demo-end]').addEventListener('click', onEndDemo);
    // Kick off / refresh the countdown so the newly-inserted timer
    // pill starts populating right away.
    startCountdown();
  }

  var countdownTimer = null;
  function startCountdown() {
    stopCountdown();
    if (!activeToken) return;
    // The timer element is optional — it only exists when the demo pill
    // has been revealed via the admin-key chord. When it's absent the
    // countdown still runs so an expired token forces a reload into
    // the public shell.
    var update = function () {
      var remaining = activeToken.payload.exp - Date.now();
      var timerEl = document.querySelector('[data-demo-timer]');
      if (remaining <= 0) {
        if (timerEl) timerEl.textContent = 'Demo expired';
        stopCountdown();
        // Force reload into public shell after a short grace pause.
        setTimeout(function () { location.reload(); }, 1200);
        return;
      }
      if (timerEl) timerEl.textContent = 'Demo \u00b7 ' + formatRemaining(remaining);
    };
    update();
    countdownTimer = setInterval(update, 1000);
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  }

  async function onShareDemo() {
    // Hide the Share pill immediately so the moment the URL flips to
    // demo, no "Demo" wording is visible on-screen. The reload will
    // rebuild controls; in demo mode nothing is rendered by default.
    var pill = document.getElementById('demo-gate-controls');
    if (pill) pill.style.display = 'none';
    try {
      var t = await mintToken(DEMO_TTL_MS);
      writeTokenToHash(t.raw);
      var fullUrl = location.origin + location.pathname + location.search + location.hash;
      try {
        await navigator.clipboard.writeText(fullUrl);
        showToast('URL copied to clipboard.');
      } catch (e) {
        showToast('URL is in the address bar (clipboard copy blocked).');
      }
      // Reload so the page comes up in demo mode. Nothing on-screen will
      // say "demo" — Ron can end the demo any time with the admin-key
      // chord and revoke the URL through the Admin page.
      setTimeout(function () { location.reload(); }, 600);
    } catch (e) {
      if (pill) pill.style.display = '';
      showToast('Could not create URL: ' + e.message, true);
    }
  }

  async function onEndDemo() {
    if (!activeToken) return;
    var jti = activeToken.payload.jti;
    var btn = document.querySelector('[data-demo-end]');
    if (btn) { btn.disabled = true; btn.textContent = 'Ending\u2026'; }
    try {
      await revokeJti(jti);
      showToast('Demo ended. This URL will no longer work.');
      // Strip the token from the URL, then reload into public shell.
      removeTokenFromHash();
      setTimeout(function () { location.reload(); }, 900);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'End demo'; }
      showToast('Could not revoke: ' + e.message, true);
    }
  }

  // ── GitHub-committed revocations ─────────────────────────────────────
  async function fetchRevokeFileFromGitHub() {
    var token = localStorage.getItem(GH_TOKEN_KEY);
    if (!token) throw new Error('No GitHub token stored. Save one in the Admin page first.');
    var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + REVOKE_PATH;
    var res = await fetch(apiUrl, {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (res.status === 404) {
      return { sha: null, content: { jtis: [] } };
    }
    if (!res.ok) throw new Error('GitHub fetch failed: ' + res.status);
    var data = await res.json();
    var text = '';
    try { text = atob(data.content.replace(/\n/g, '')); } catch (e) { text = ''; }
    var content = { jtis: [] };
    try { content = text ? JSON.parse(text) : { jtis: [] }; } catch (e) {}
    if (!Array.isArray(content.jtis)) content.jtis = [];
    return { sha: data.sha || null, content: content };
  }

  async function commitRevokeFile(content, sha, message) {
    var token = localStorage.getItem(GH_TOKEN_KEY);
    if (!token) throw new Error('No GitHub token.');
    var apiUrl = 'https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + '/contents/' + REVOKE_PATH;
    var body = { message: message, content: btoa(JSON.stringify(content, null, 2)) };
    if (sha) body.sha = sha;
    var res = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var txt = await res.text();
      throw new Error('GitHub PUT failed: ' + res.status + ' ' + txt.slice(0, 200));
    }
    return res.json();
  }

  async function revokeJti(jti) {
    var current = await fetchRevokeFileFromGitHub();
    if (current.content.jtis.indexOf(jti) === -1) {
      current.content.jtis.push(jti);
    }
    current.content.updatedAt = new Date().toISOString();
    await commitRevokeFile(
      current.content,
      current.sha,
      'demo: revoke token ' + jti
    );
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  async function boot(onReady) {
    handleDevOptIn();
    injectShellStyles();
    // Wire the admin unlock keyboard chords immediately so they work
    // regardless of which mode we end up in (public / demo / dev).
    wireAdminUnlockKeys();

    // Dev mode wins over everything.
    if (isDevMarked()) {
      mode = 'dev';
      cachedPasscode = BAKED_PASSCODE;
      // Wait for DOM to be ready before injecting controls.
      var wireDev = function () { injectDevControls(); };
      if (document.body) wireDev();
      else document.addEventListener('DOMContentLoaded', wireDev);
      onReady();
      return;
    }

    // Otherwise, look for a demo token.
    var rawToken = readTokenFromHash();
    if (!rawToken) {
      renderPublicShell();
      return;
    }
    var verified = await parseAndVerifyToken(rawToken);
    if (!verified) {
      renderPublicShell('This demo link is not valid.');
      return;
    }
    var now = Date.now();
    if (verified.payload.exp < now) {
      renderPublicShell('This demo link has expired.');
      return;
    }
    var revoked = await loadRevocations();
    if (revoked.has(verified.payload.jti)) {
      renderPublicShell('This demo link has ended.');
      return;
    }

    // Valid demo — unlock and render controls.
    mode = 'demo';
    activeToken = verified;
    cachedPasscode = BAKED_PASSCODE;
    var wireDemo = function () { injectDemoControls(); };
    if (document.body) wireDemo();
    else document.addEventListener('DOMContentLoaded', wireDemo);
    onReady();
  }

  // ── Compatibility API — matches the shape admin.js expects from dbGate ──
  window.demoGate = {
    boot: boot,
    fetchJson: fetchJsonEncrypted,
    encryptForUpload: encryptString,
    unlockEmbeddedRead: unlockEmbeddedRead,
    isUnlocked: function () { return !!cachedPasscode; },
    getMode: function () { return mode; }
  };

  // Legacy alias so existing itaukei-database.js callers continue to work
  // during the swap. New code should reference demoGate directly.
  window.dbGate = window.demoGate;
})();
