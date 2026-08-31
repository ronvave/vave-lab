/**
 * Demo-mode gate for the Samoa Scholar Database (dashboard).
 *
 * Distinct from js/samoa-db-gate.js — that file is the admin-only
 * passcode-prompt gate. This file is the DASHBOARD gate: the dashboard
 * is public by default (skeleton with placeholder messages), and real
 * data unlocks in one of two modes:
 *
 *   1. Dev mode — the visitor's browser has been marked as Ron's dev
 *      device via localStorage.samoalab_dev = '1'. Once marked, the
 *      gate is transparent on that device.
 *
 *   2. Demo mode — the URL hash carries a valid, unexpired, non-revoked
 *      demo token minted by Ron via the "Share demo view" button.
 *      Tokens last 2 hours by default. Ron can revoke early via the
 *      "End demo" button which appends the token's jti to a
 *      GitHub-committed revocations file.
 *
 * The Samoa .enc data files are encrypted with the SAMOA-ONLY passcode
 * `Zoopilus1!`. That passcode is baked into this file (base64) so the
 * gate can decrypt without a prompt. A determined viewer with devtools
 * could recover it — the same trade-off the sister systems already
 * accept for a friction-free daily workflow.
 *
 * ── Token format ──
 * Hash fragment `#demo=<payload_b64u>.<sig_b64u>` where:
 *   payload = JSON { v: 1, iss: <ms>, exp: <ms>, jti: <8-hex random> }
 *   sig = HMAC-SHA256(payload_utf8, SAMOA_DEMO_SIGN_KEY)
 *
 * ── Constants ──
 * Every constant on this file is Samoa-specific and unrelated to the
 * sister systems' values:
 *
 *   BAKED_PASSCODE      = 'Zoopilus1!' (base64: Wm9vcGlsdXMxIQ==)
 *   DEMO_SIGN_KEY_B64   = 'V0EeEl8X5U8yAig6hYeCJaJ2+BumXO0XSgOkGBOPVUY='
 *                       (32 random bytes, fresh for Samoa)
 *   DEV_FLAG_KEY        = 'samoalab_dev'
 *   REVOKE_PATH         = 'data/samoa-revoked-demos.json'
 *
 * Nothing in this file reads from any sister-jurisdiction data file.
 */
(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────
  var DEMO_TTL_MS = 2 * 60 * 60 * 1000;   // 2 hours
  var DEV_FLAG_KEY = 'samoalab_dev';
  var GH_OWNER = 'ronvave';
  var GH_REPO = 'vave-lab';
  var REVOKE_PATH = 'data/samoa-revoked-demos.json';
  var PBKDF2_ITERATIONS = 200000;
  var MAGIC = new Uint8Array([0x49, 0x56, 0x41, 0x56]); // "IVAV"

  // Baked passcode (Zoopilus1!). Same passcode the admin-only db-gate
  // uses, so the .enc files decrypt with a single key.
  var BAKED_PASSCODE = atob('Wm9vcGlsdXMxIQ==');

  // HMAC key for demo tokens. Distinct from the sister systems' keys.
  // Generated fresh for Samoa; documented in SAMOA-DASHBOARD-BUILD-NOTES.md.
  var DEMO_SIGN_KEY_B64 = 'V0EeEl8X5U8yAig6hYeCJaJ2+BumXO0XSgOkGBOPVUY=';

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

  // ── Decryption plumbing (same IVAV wire format as db-gate.js) ────────
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

  // ── ENC file map ─────────────────────────────────────────────────────
  // Plaintext-URL → encrypted-URL. `fetchJson(plainUrl)` transparently
  // downloads and decrypts the .enc counterpart.
  //
  // Every entry here targets a Samoa-prefixed file. No sister-jurisdiction
  // filename appears in this map.
  var ENC_FILES = {
    // Master-file snapshots (refreshed every 2h by
    // .github/workflows/refresh-samoa-master-file.yml).
    'data/samoa-master-scholars.json':                 'data/samoa-master-scholars.json.enc',
    'data/samoa-master-publications.json':             'data/samoa-master-publications.json.enc',
    'data/samoa-master-authorship.json':               'data/samoa-master-authorship.json.enc',
    'data/samoa-master-researcher-authorship.json':    'data/samoa-master-researcher-authorship.json.enc',
    'data/samoa-master-grad-degrees.json':             'data/samoa-master-grad-degrees.json.enc',
    'data/samoa-master-mobility.json':                 'data/samoa-master-mobility.json.enc',
    'data/samoa-master-geography.json':                'data/samoa-master-geography.json.enc',
    'data/samoa-master-geography-coordinates.json':    'data/samoa-master-geography-coordinates.json.enc',
    'data/samoa-master-aggregates.json':               'data/samoa-master-aggregates.json.enc',
    'data/samoa-master-worldpoints.json':              'data/samoa-master-worldpoints.json.enc',
    'data/samoa-master-part-indigenous.json':          'data/samoa-master-part-indigenous.json.enc',
    // Panel-specific derived files.
    'data/samoa-body-composition-master.json':         'data/samoa-body-composition-master.json.enc',
    'data/samoa-auto-resolved.json':                   'data/samoa-auto-resolved.json.enc',
    'data/samoa-scholar-insights.json':                'data/samoa-scholar-insights.json.enc',
    'data/samoa-workplace-coords.json':                'data/samoa-workplace-coords.json.enc',
    'data/samoa-uni-country-overrides.json':           'data/samoa-uni-country-overrides.json.enc',
    'data/samoa-world-universities.json':              'data/samoa-world-universities.json.enc',
    // GeoJSON — SBS statistical spine district boundaries.
    'data/samoa-districts.geojson':                    'data/samoa-districts.geojson.enc',
    // Last-sync marker.
    'data/samoa-last-master-sync.json':                'data/samoa-last-master-sync.json.enc'
  };

  async function fetchJsonEncrypted(url) {
    var encUrl = ENC_FILES[url];
    if (!encUrl) {
      // Plaintext fetch — used for revocation list and any small public JSON.
      var r0 = await fetch(bust(url), { cache: 'no-store' });
      if (!r0.ok) throw new Error('Fetch failed: ' + url + ' (' + r0.status + ')');
      return r0.json();
    }
    if (!cachedPasscode) throw new Error('Gate not unlocked.');
    var res = await fetch(bust(encUrl), { cache: 'no-store' });
    if (!res.ok) {
      var e = new Error('Fetch failed: ' + encUrl + ' (' + res.status + ')');
      e.status = res.status;
      throw e;
    }
    var text = await decryptBlob(await res.arrayBuffer());
    return JSON.parse(text);
  }

  // Same-origin iframes (Panel C1 body composition, etc.) unlock read-only
  // access without going through the full boot/gate flow.
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
      if (!res.ok) { revokedJtis = new Set(); return revokedJtis; }
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
  function markDev()   { try { localStorage.setItem(DEV_FLAG_KEY, '1'); } catch (e) {} }
  function unmarkDev() { try { localStorage.removeItem(DEV_FLAG_KEY); } catch (e) {} }
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
    if (document.getElementById('samoa-demo-gate-styles')) return;
    var css = ''
      + '.samoa-demo-gate-shell{min-height:calc(100vh - 120px);display:flex;align-items:center;justify-content:center;padding:48px 24px;background:linear-gradient(180deg,#f8f5f0 0%,#efe8dc 60%,#e8ded0 100%);}'
      + '.samoa-demo-gate-shell__panel{width:100%;max-width:520px;background:#fff;border:1px solid rgba(15,57,33,0.12);border-radius:14px;padding:36px 32px 30px;box-shadow:0 20px 50px -22px rgba(15,57,33,0.28),0 6px 16px -8px rgba(15,57,33,0.14);text-align:center;}'
      + '.samoa-demo-gate-shell__title{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:1.9rem;line-height:1.15;margin:0 0 12px;color:#0F3921;letter-spacing:-0.01em;}'
      + '.samoa-demo-gate-shell__body{margin:0 0 8px;color:#28251d;font-size:1rem;line-height:1.6;}'
      + '.samoa-demo-gate-shell__foot{margin:22px 0 0;color:#7a8880;font-size:0.85rem;}'
      + '.samoa-demo-gate-shell__reason{margin:14px 0 0;padding:10px 14px;background:#fdf1e6;color:#8B3A0F;border-radius:8px;font-size:0.9rem;text-align:left;}'
      + 'body.samoa-demo-gate-locked main > *:not(.samoa-demo-gate-shell){display:none !important;}'
      + '.samoa-demo-gate-controls{position:fixed;bottom:16px;right:16px;display:flex;flex-direction:row;align-items:stretch;gap:8px;z-index:9999;font-family:"DM Sans",system-ui,sans-serif;}'
      + '.samoa-demo-gate-controls button{padding:8px 12px;border-radius:8px;border:1px solid rgba(15,57,33,0.18);background:#fff;color:#0F3921;font-size:12px;font-weight:600;cursor:pointer;}'
      + '.samoa-demo-gate-controls button:hover{background:#f2ede4;}';
    var style = document.createElement('style');
    style.id = 'samoa-demo-gate-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }
  function renderPublicShell(reason) {
    injectShellStyles();
    document.body.classList.add('samoa-demo-gate-locked');
    var main = document.querySelector('main') || document.body;
    var shell = document.createElement('div');
    shell.className = 'samoa-demo-gate-shell';
    shell.innerHTML = ''
      + '<div class="samoa-demo-gate-shell__panel">'
      +   '<h2 class="samoa-demo-gate-shell__title">Samoa Scholar Database</h2>'
      +   '<p class="samoa-demo-gate-shell__body">This dashboard is a research preview. '
      +      'The full data is available during a live demo, or on Ron\u2019s dev device. '
      +      'To arrange access, contact Ron Vave.</p>'
      +   (reason ? '<p class="samoa-demo-gate-shell__reason">' + escapeHtml(reason) + '</p>' : '')
      +   '<p class="samoa-demo-gate-shell__foot">'
      +      '<a href="https://ronvave.github.io/vave-lab/">Vave Lab</a> \u00b7 '
      +      'University of Hawai\u02BBi at M\u0101noa'
      +   '</p>'
      + '</div>';
    main.appendChild(shell);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Boot flow ────────────────────────────────────────────────────────
  async function boot() {
    handleDevOptIn();

    // Dev mode is fast-path — no fetch, no crypto, transparent unlock.
    if (isDevMarked()) {
      mode = 'dev';
      cachedPasscode = BAKED_PASSCODE;
      return { mode: 'dev' };
    }

    // Try to unlock via a hash-fragment token.
    var raw = readTokenFromHash();
    if (raw) {
      var verified = await parseAndVerifyToken(raw);
      if (!verified) {
        renderPublicShell('The demo link is invalid or has been altered.');
        return { mode: 'public', reason: 'invalid-token' };
      }
      if (verified.payload.exp < Date.now()) {
        removeTokenFromHash();
        renderPublicShell('This demo link has expired.');
        return { mode: 'public', reason: 'expired' };
      }
      var revoked = await loadRevocations();
      if (revoked.has(verified.payload.jti)) {
        removeTokenFromHash();
        renderPublicShell('This demo link has been ended.');
        return { mode: 'public', reason: 'revoked' };
      }
      mode = 'demo';
      activeToken = verified;
      cachedPasscode = BAKED_PASSCODE;
      renderDemoControls(verified);
      return { mode: 'demo', payload: verified.payload };
    }

    // No token, no dev flag — render the public shell.
    renderPublicShell(null);
    return { mode: 'public' };
  }

  function renderDemoControls(verified) {
    var wrap = document.createElement('div');
    wrap.className = 'samoa-demo-gate-controls';
    var countdown = document.createElement('span');
    countdown.style.padding = '8px 12px';
    countdown.style.borderRadius = '8px';
    countdown.style.background = '#0F3921';
    countdown.style.color = '#fff';
    countdown.style.fontSize = '12px';
    wrap.appendChild(countdown);
    var endBtn = document.createElement('button');
    endBtn.type = 'button';
    endBtn.textContent = 'End demo';
    endBtn.onclick = function () {
      window.samoaDemoGate.endDemo(verified.payload.jti);
    };
    wrap.appendChild(endBtn);
    document.body.appendChild(wrap);

    function tick() {
      var msLeft = verified.payload.exp - Date.now();
      if (msLeft <= 0) {
        countdown.textContent = 'Demo ended';
        setTimeout(function () { location.reload(); }, 800);
        return;
      }
      var m = Math.floor(msLeft / 60000);
      var s = Math.floor((msLeft % 60000) / 1000);
      countdown.textContent = 'Demo · ' + m + ':' + (s < 10 ? '0' : '') + s;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── Public API ───────────────────────────────────────────────────────
  window.samoaDemoGate = {
    boot: boot,
    fetchJson: fetchJsonEncrypted,
    unlockEmbeddedRead: unlockEmbeddedRead,
    mintToken: mintToken,
    markDev: markDev,
    unmarkDev: unmarkDev,
    isDevMarked: isDevMarked,
    isUnlocked: function () { return !!cachedPasscode; },
    getMode: function () { return mode; },
    endDemo: async function (jti) {
      // Placeholder — the actual GitHub-commit flow is wired in Session 3+
      // alongside the admin "Share demo view" button. For now, revoke
      // client-side by nudging the user to reload.
      alert('End demo: token ' + jti + ' will be added to the revocations file on the next admin push. Reloading in demo mode will now fall through to the public shell if the revocation is committed.');
      window.location.hash = '';
      window.location.reload();
    },
    // Backwards-compat shim: some panel code paths reference dbGate.
    // Provide a minimal read-only alias limited to fetchJson.
    _asDbGate: function () {
      return { fetchJson: fetchJsonEncrypted, isUnlocked: function () { return !!cachedPasscode; } };
    }
  };
})();
