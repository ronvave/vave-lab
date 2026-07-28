/**
 * Passcode gate for the iTaukei Research Database.
 *
 * The page ships with encrypted data files (.enc). Nothing renders until the
 * visitor enters the correct passcode; that passcode is then used to derive
 * per-file AES-GCM keys and decrypt each file client-side. A correct entry
 * caches the passcode in localStorage for 30 days so approved devices skip
 * the prompt on future visits.
 *
 * ── Design (per-file salt, no shared invariant) ──
 * Each .enc file is fully self-describing:
 *
 *   magic (4) || salt (16) || iv (12) || ciphertext+tag
 *   magic  = "IVAV"
 *   KDF    = PBKDF2-HMAC-SHA256, 200,000 iterations, 32-byte key
 *   cipher = AES-GCM (16-byte tag included in the tail)
 *
 * We derive a fresh AES key from (passcode, salt-from-that-file) for every
 * decrypt. There is NO shared-salt invariant across files, so writers (this
 * page, the auto-refresh workflow, the admin browser) can each re-encrypt a
 * single file with a fresh random salt without breaking the others. Derived
 * per-file keys are cached in-memory for the session so we only pay the
 * PBKDF2 cost once per file per page load.
 *
 * ── 30-day session ──
 * We prove the passcode is correct with a static verifier hash before
 * caching it:
 *
 *   VERIFIER_HASH = PBKDF2-HMAC-SHA256(passcode, "vavelab-db-verifier-v1",
 *                                     200,000 iters, 32 bytes)
 *
 * The correct-passcode hash is baked into this file as VERIFIER_HASH_HEX.
 * On successful match we stash { p: b64(passcode), exp } in localStorage
 * with a 30-day expiry so the visitor is not prompted again. Explicit
 * "Lock now" clears the entry.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'vavelab.db.session.v2';
  var REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var PBKDF2_ITERATIONS = 200000;
  var MAGIC = new Uint8Array([0x49, 0x56, 0x41, 0x56]); // "IVAV"

  // Verifier constants — used to prove a passcode is correct BEFORE we try
  // to decrypt any file, so a wrong entry fails fast with a clear message.
  var VERIFIER_SALT = new TextEncoder().encode('vavelab-db-verifier-v1');
  var VERIFIER_HASH_HEX =
    'e85cedd8f7060909eb31bf83953d4f2b451eb30a1f9044e384453b881189faf8';

  // Every file the database fetches. Maps the plaintext .json URL that
  // itaukei-database.js / admin.js request onto the on-disk .enc URL.
  var ENC_FILES = {
    'data/itaukei-zotero-snapshot.json': 'data/itaukei-zotero-snapshot.json.enc',
    'data/fiji-provinces.geojson':       'data/fiji-provinces.geojson.enc',
    'data/world-universities.json':      'data/world-universities.json.enc',
    'data/fiji-provinces.json':          'data/fiji-provinces.json.enc',
    'data/scholar-profiles.json':        'data/scholar-profiles.json.enc',
    'data/last-sync.json':               'data/last-sync.json.enc',
    'data/itaukei-graduate-studies.json':'data/itaukei-graduate-studies.json.enc',
    'data/scholar-insights.json':        'data/scholar-insights.json.enc',
    // Panel C1 body-composition chart — gender x publication-type aggregates.
    'data/body-composition.json':        'data/body-composition.json.enc'
  };

  // In-memory state once the visitor is verified. Never leaves the page.
  //   cachedPasscode: string — the passcode itself, kept in memory so we can
  //     derive a fresh per-file AES key on demand.
  //   keyBySaltHex: Map<hex-salt-string, CryptoKey> — memoises PBKDF2 output
  //     for each file's salt so we only pay the cost once per file per page
  //     load, no matter how many times itaukei-database.js re-fetches.
  var cachedPasscode = null;
  var keyBySaltHex = Object.create(null);

  // ---------- Low-level crypto ----------

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

  function b64encode(buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64decode(str) {
    var s = atob(str);
    var bytes = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  function bust(url) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  // PBKDF2(passcode, salt) → 256-bit raw key material. We derive a
  // WebCrypto AES-GCM key from that material so it can be used directly
  // with crypto.subtle.decrypt / encrypt.
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
      false, // no need to export — we re-derive on demand
      ['decrypt', 'encrypt']
    );
  }

  // Verifier hash of a passcode, used to fail fast on the wrong entry
  // without touching any encrypted file.
  async function verifierHashHex(passcode) {
    var baseKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passcode),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: VERIFIER_SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      256
    );
    return bytesToHex(new Uint8Array(bits));
  }

  // Get (or lazily derive + memoise) the AES-GCM key for one file's salt.
  async function keyForSalt(saltBytes) {
    if (!cachedPasscode) {
      throw new Error('Database is locked \u2014 no passcode in memory.');
    }
    var hex = bytesToHex(saltBytes);
    if (keyBySaltHex[hex]) return keyBySaltHex[hex];
    var key = await deriveAesKey(cachedPasscode, saltBytes);
    keyBySaltHex[hex] = key;
    return key;
  }

  // Read an IVAV blob (ArrayBuffer or Uint8Array) and return { key, iv, ct }
  // ready to hand to crypto.subtle.decrypt.
  function parseBlob(blob) {
    var bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    if (bytes.length < 4 + 16 + 12 + 16) throw new Error('Encrypted blob too short.');
    if (!bytesEqual(bytes.slice(0, 4), MAGIC)) throw new Error('Not an IVAV blob.');
    return {
      salt: bytes.slice(4, 20),
      iv: bytes.slice(20, 32),
      ct: bytes.slice(32)
    };
  }

  async function decryptBlob(blob) {
    var parts = parseBlob(blob);
    var key = await keyForSalt(parts.salt);
    var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: parts.iv }, key, parts.ct);
    return new TextDecoder().decode(plainBuf);
  }

  // Encrypt a UTF-8 string into an IVAV blob using a FRESH random salt +
  // fresh random IV. Because per-file salts are independent, this can be
  // used to update any one .enc file without touching the others.
  async function encryptString(plaintext) {
    if (!cachedPasscode) {
      throw new Error('Database is locked \u2014 no passcode in memory.');
    }
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveAesKey(cachedPasscode, salt);
    var body = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    var bodyBytes = new Uint8Array(body);
    var out = new Uint8Array(4 + 16 + 12 + bodyBytes.length);
    out.set(MAGIC, 0);
    out.set(salt, 4);
    out.set(iv, 20);
    out.set(bodyBytes, 32);
    // Memoise so a subsequent decrypt of the same freshly-uploaded file
    // (e.g. after admin push, if the page refetches) is instant.
    keyBySaltHex[bytesToHex(salt)] = key;
    return out; // Uint8Array, ready to upload as bytes
  }

  // ---------- Session persistence ----------

  function loadStoredSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.p || !parsed.exp) return null;
      if (parsed.exp < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function storeSession(passcode) {
    // We base64-encode the passcode as light obfuscation against casual
    // devtools inspection. Anyone with hands-on device access inside the
    // 30-day window can still recover it — that's the accepted trade-off
    // for skipping the prompt on every visit.
    var record = {
      p: b64encode(new TextEncoder().encode(passcode)),
      exp: Date.now() + REMEMBER_MS
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    cachedPasscode = null;
    keyBySaltHex = Object.create(null);
  }

  // Verify a passcode against the static verifier hash. Returns true on
  // match, false otherwise. This is deterministic and touches NO network.
  async function verifyPasscode(passcode) {
    var got = await verifierHashHex(passcode);
    return got === VERIFIER_HASH_HEX;
  }

  // ---------- Public fetch API used by itaukei-database.js + admin.js ----------

  async function fetchJsonEncrypted(url) {
    var encUrl = ENC_FILES[url];
    if (!encUrl) {
      // Not an encrypted target — fall through to a normal fetch (e.g. Google
      // Sheets CSVs pulled by admin.html).
      var r0 = await fetch(bust(url), { cache: 'no-store' });
      if (!r0.ok) throw new Error('Fetch failed: ' + url + ' (' + r0.status + ')');
      return r0.json();
    }
    if (!cachedPasscode) throw new Error('Database is locked \u2014 no passcode.');
    var res = await fetch(bust(encUrl), { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed: ' + encUrl + ' (' + res.status + ')');
    var text = await decryptBlob(await res.arrayBuffer());
    return JSON.parse(text);
  }

  // Admin helper: encrypt an updated plaintext JSON body for upload. Uses a
  // fresh per-file salt so pushing this file DOES NOT need to be coordinated
  // with any other .enc file already on origin — every file is independent.
  async function encryptForUpload(plaintext) {
    return encryptString(plaintext);
  }

  // ---------- Lock-screen UI ----------

  function buildLockScreenHtml() {
    return ''
      + '<section class="db-gate" role="dialog" aria-modal="true" aria-labelledby="db-gate-title">'
      +   '<div class="db-gate__panel">'
      +     '<div class="db-gate__badge" aria-hidden="true">'
      +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>'
      +     '</div>'
      +     '<h1 id="db-gate-title" class="db-gate__title">Preview access</h1>'
      +     '<p class="db-gate__lede">This database is being previewed with a small group of colleagues while feedback is gathered. If Prof. Ron Vave has shared a passcode with you, enter it below.</p>'
      +     '<form class="db-gate__form" novalidate>'
      +       '<label for="db-gate-input" class="db-gate__label">Passcode</label>'
      +       '<input id="db-gate-input" type="password" autocomplete="current-password" spellcheck="false" autocapitalize="off" required />'
      +       '<button type="submit" class="db-gate__submit"><span data-gate-submit-label>Unlock database</span></button>'
      +       '<p class="db-gate__error" data-gate-error hidden></p>'
      +       '<p class="db-gate__hint">Access is remembered on this device for 30 days.</p>'
      +     '</form>'
      +     '<p class="db-gate__foot">Curated by <a href="https://ronvave.github.io/vave-lab/" target="_blank" rel="noopener">Prof. Ron Vave</a> \u00b7 University of Hawai\u02bbi at M\u0101noa</p>'
      +   '</div>'
      + '</section>';
  }

  function injectLockScreenStyles() {
    if (document.getElementById('db-gate-styles')) return;
    var css = ''
      + '.db-gate{min-height:calc(100vh - 80px);display:flex;align-items:center;justify-content:center;padding:var(--space-4,32px) var(--space-3,24px);background:linear-gradient(180deg,#f8f5f0 0%,#efe8dc 60%,#e8ded0 100%);}'
      + '.db-gate__panel{width:100%;max-width:460px;background:#fff;border:1px solid rgba(15,57,33,0.12);border-radius:14px;padding:36px 32px 28px;box-shadow:0 20px 50px -22px rgba(15,57,33,0.28),0 6px 16px -8px rgba(15,57,33,0.14);text-align:center;}'
      + '.db-gate__badge{display:inline-flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:14px;background:rgba(14,116,144,0.10);color:#0F3921;margin:0 auto 18px;}'
      + '.db-gate__title{font-family:"Cormorant Garamond",Georgia,serif;font-weight:600;font-size:1.9rem;line-height:1.15;margin:0 0 10px;color:#0F3921;letter-spacing:-0.01em;}'
      + '.db-gate__lede{margin:0 0 22px;color:#4a5b52;font-size:0.98rem;line-height:1.55;}'
      + '.db-gate__form{display:flex;flex-direction:column;gap:12px;text-align:left;}'
      + '.db-gate__label{font-family:"DM Sans",system-ui,sans-serif;font-weight:600;font-size:0.78rem;letter-spacing:0.08em;text-transform:uppercase;color:#0F3921;}'
      + '.db-gate__form input[type="password"]{-webkit-appearance:none;appearance:none;width:100%;padding:12px 14px;font-family:"DM Sans",system-ui,sans-serif;font-size:1rem;border:1.5px solid rgba(15,57,33,0.20);border-radius:10px;background:#fbfaf7;color:#0F3921;transition:border-color 0.15s ease,box-shadow 0.15s ease;}'
      + '.db-gate__form input[type="password"]:focus{outline:none;border-color:#0E7490;box-shadow:0 0 0 3px rgba(14,116,144,0.18);}'
      + '.db-gate__submit{margin-top:6px;padding:12px 18px;border:none;border-radius:10px;background:#0F3921;color:#fff;font-family:"DM Sans",system-ui,sans-serif;font-weight:600;font-size:0.98rem;letter-spacing:0.01em;cursor:pointer;transition:background 0.15s ease,transform 0.05s ease;}'
      + '.db-gate__submit:hover{background:#12442a;}'
      + '.db-gate__submit:active{transform:translateY(1px);}'
      + '.db-gate__submit:disabled{opacity:0.7;cursor:progress;}'
      + '.db-gate__error{margin:2px 0 0;color:#8B3A0F;font-size:0.9rem;font-weight:500;}'
      + '.db-gate__hint{margin:8px 0 0;color:#7a8880;font-size:0.83rem;text-align:center;}'
      + '.db-gate__foot{margin:22px 0 0;color:#7a8880;font-size:0.82rem;}'
      + '.db-gate__foot a{color:#0E7490;text-decoration:underline;text-underline-offset:3px;}'
      + '.db-gate-locknow{position:fixed;bottom:16px;right:16px;padding:8px 14px;font-family:"DM Sans",system-ui,sans-serif;font-size:0.82rem;font-weight:600;color:#0F3921;background:#fff;border:1px solid rgba(15,57,33,0.20);border-radius:999px;cursor:pointer;box-shadow:0 6px 16px -8px rgba(15,57,33,0.20);z-index:9999;}'
      + '.db-gate-locknow:hover{background:#f5efe4;}'
      + 'body.db-gate-locked main > *:not(.db-gate){display:none !important;}'
      + 'body.db-gate-locked [data-db-hide-when-locked]{display:none !important;}';
    var style = document.createElement('style');
    style.id = 'db-gate-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectLockNowButton() {
    if (document.getElementById('db-gate-locknow')) return;
    var btn = document.createElement('button');
    btn.id = 'db-gate-locknow';
    btn.className = 'db-gate-locknow';
    btn.type = 'button';
    btn.textContent = 'Lock now';
    btn.title = 'Clear the 30-day session on this device and require the passcode again.';
    btn.addEventListener('click', function () {
      clearSession();
      // Full reload — simplest way to re-boot the gate and unmount panels.
      location.reload();
    });
    document.body.appendChild(btn);
  }

  function renderLockScreen(onUnlock) {
    injectLockScreenStyles();
    document.body.classList.add('db-gate-locked');
    var main = document.querySelector('main');
    if (!main) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = buildLockScreenHtml();
    var gate = wrap.firstElementChild;
    main.insertBefore(gate, main.firstChild);

    var input = gate.querySelector('#db-gate-input');
    var form = gate.querySelector('form');
    var errEl = gate.querySelector('[data-gate-error]');
    var btn = form.querySelector('button');
    var btnLabel = form.querySelector('[data-gate-submit-label]');
    setTimeout(function () { input.focus(); }, 60);

    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var pass = (input.value || '').trim();
      if (!pass) return;
      errEl.hidden = true;
      btn.disabled = true;
      btnLabel.textContent = 'Unlocking\u2026';
      try {
        var ok = await verifyPasscode(pass);
        if (!ok) throw new Error('bad-passcode');
        cachedPasscode = pass;
        storeSession(pass);
        injectLockNowButton();
        gate.style.transition = 'opacity 0.25s ease';
        gate.style.opacity = '0';
        setTimeout(function () {
          gate.remove();
          document.body.classList.remove('db-gate-locked');
          onUnlock();
        }, 240);
      } catch (e) {
        errEl.textContent = 'That passcode did not unlock the database. Please try again.';
        errEl.hidden = false;
        btnLabel.textContent = 'Unlock database';
        btn.disabled = false;
        input.select();
      }
    });
  }

  // ---------- Boot ----------

  async function boot(onReady) {
    // Ensure lock CSS is available immediately so hidden real content stays hidden.
    injectLockScreenStyles();
    document.body.classList.add('db-gate-locked');

    var stored = loadStoredSession();
    if (stored) {
      try {
        var pass = new TextDecoder().decode(b64decode(stored.p));
        // Re-verify against the static hash — cheap sanity check that the
        // stored value is still the current passcode (e.g. hasn't been
        // rotated in a new build).
        var ok = await verifyPasscode(pass);
        if (ok) {
          cachedPasscode = pass;
          document.body.classList.remove('db-gate-locked');
          injectLockNowButton();
          onReady();
          return;
        }
        // Stored passcode no longer matches — passcode was rotated. Fall
        // through to a fresh lock screen.
        clearSession();
      } catch (e) {
        clearSession();
      }
    }
    renderLockScreen(onReady);
  }

  // Best-effort unlock using localStorage only. Doesn't touch the UI — no
  // lock screen is shown even if there is no stored session. Useful for
  // side-panel pages (e.g. itaukei-body-composition.html embedded as an
  // iframe in the research database) that want to opportunistically decrypt
  // an .enc file when the visitor is already unlocked, without ever
  // prompting a passcode of their own. Returns true if a valid session was
  // adopted and future fetchJson() calls will decrypt cleanly.
  async function tryUnlockFromStorage() {
    if (cachedPasscode) return true;
    var stored = loadStoredSession();
    if (!stored) return false;
    try {
      var pass = new TextDecoder().decode(b64decode(stored.p));
      var ok = await verifyPasscode(pass);
      if (!ok) { clearSession(); return false; }
      cachedPasscode = pass;
      return true;
    } catch (e) {
      clearSession();
      return false;
    }
  }

  // Expose the API for itaukei-database.js and admin.js.
  window.dbGate = {
    boot: boot,
    fetchJson: fetchJsonEncrypted,
    clearSession: clearSession,
    encryptForUpload: encryptForUpload,
    isUnlocked: function () { return !!cachedPasscode; },
    tryUnlockFromStorage: tryUnlockFromStorage
  };
})();
