/**
 * Passcode gate for the iTaukei Research Database.
 *
 * The page ships with encrypted data files (.enc). Nothing renders until the
 * visitor enters the correct passcode, which we use to derive an AES-GCM key
 * and decrypt each file client-side. A correct entry stores a "session key"
 * in localStorage (base64 raw AES key + expiry) so approved devices skip the
 * prompt on future visits.
 *
 * We NEVER store the passcode itself. We store the derived 256-bit key +
 * expiry, and validate it works by attempting one probe decrypt before
 * letting the rest of the app boot. If probe decryption fails we clear the
 * stored key and re-prompt.
 *
 * File format (produced by scripts/encrypt_data.py):
 *   magic (4) || salt (16) || iv (12) || ciphertext+tag
 *   magic = "IVAV"
 *   PBKDF2-HMAC-SHA256, 200,000 iterations, 32-byte key
 *   AES-GCM
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'vavelab.db.sessionKey.v1';
  var REMEMBER_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  var PBKDF2_ITERATIONS = 200000;
  var MAGIC = new Uint8Array([0x49, 0x56, 0x41, 0x56]); // "IVAV"

  // Every file the database fetches. This is the one place that maps public
  // .json URLs onto the encrypted .enc URLs on disk.
  var ENC_FILES = {
    'data/itaukei-zotero-snapshot.json': 'data/itaukei-zotero-snapshot.json.enc',
    'data/fiji-provinces.geojson':       'data/fiji-provinces.geojson.enc',
    'data/world-universities.json':      'data/world-universities.json.enc',
    'data/fiji-provinces.json':          'data/fiji-provinces.json.enc',
    'data/scholar-profiles.json':        'data/scholar-profiles.json.enc',
    'data/last-sync.json':               'data/last-sync.json.enc',
    'data/itaukei-graduate-studies.json':'data/itaukei-graduate-studies.json.enc',
    'data/scholar-insights.json':        'data/scholar-insights.json.enc'
  };

  // In-memory AES key once the visitor is verified. Never leaves the page.
  var cachedKey = null;
  var activeSalt = null; // 16 bytes; matches the salt of the currently-deployed .enc set

  // ---------- Low-level crypto ----------

  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
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

  async function deriveKey(passcode, salt) {
    var enc = new TextEncoder();
    var baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(passcode), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true, // extractable so we can persist the raw bytes
      ['decrypt']
    );
  }

  // Each .enc file is: magic(4) || salt(16) || iv(12) || ciphertext+tag.
  // Salt is shared across every file in a build so the client only pays the
  // PBKDF2 cost once per session; iv is per-file.
  async function decryptBlob(cryptoKey, blob) {
    var bytes = new Uint8Array(blob);
    if (bytes.length < 4 + 16 + 12 + 16) throw new Error('Encrypted blob too short.');
    if (!bytesEqual(bytes.slice(0, 4), MAGIC)) throw new Error('Not an IVAV blob.');
    var iv = bytes.slice(20, 32);
    var ct = bytes.slice(32);
    var plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, cryptoKey, ct);
    return new TextDecoder().decode(plainBuf);
  }

  // Given a passcode + one encrypted probe file, extract that file's salt,
  // derive the AES key, and probe-decrypt to confirm the passcode is right.
  // Returns { key, salt } on success; throws if the passcode is wrong (the
  // AES-GCM auth tag fails to verify).
  async function keyFromPasscode(passcode, probeUrl) {
    var res = await fetch(bust(probeUrl), { cache: 'no-store' });
    if (!res.ok) throw new Error('probe fetch failed: ' + res.status);
    var blob = new Uint8Array(await res.arrayBuffer());
    if (!bytesEqual(blob.slice(0, 4), MAGIC)) throw new Error('probe not IVAV');
    var salt = blob.slice(4, 20);
    var key = await deriveKey(passcode, salt);
    // Probe-decrypt to verify passcode. Throws if wrong.
    await decryptBlob(key, blob.buffer);
    return { key: key, salt: salt };
  }

  // Encrypt a UTF-8 string into an IVAV blob using the currently active salt
  // + key. Admin uses this when pushing an updated plaintext JSON \u2014 the
  // resulting .enc lands with the SAME salt as every other deployed file, so
  // the shared-salt invariant is preserved without a full re-encrypt round.
  async function encryptString(plaintext, cryptoKey, salt) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var body = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      cryptoKey,
      new TextEncoder().encode(plaintext)
    );
    var bodyBytes = new Uint8Array(body);
    var out = new Uint8Array(4 + 16 + 12 + bodyBytes.length);
    out.set(MAGIC, 0);
    out.set(salt, 4);
    out.set(iv, 20);
    out.set(bodyBytes, 32);
    return out; // Uint8Array, ready to be uploaded as base64
  }

  // ---------- Session-key persistence ----------

  function loadStoredSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Backwards-compatible: older records only stored k+exp; new ones also
      // stash the active salt so the admin encrypt helper can produce blobs
      // compatible with the currently-deployed set.
      if (!parsed || !parsed.k || !parsed.exp) return null;
      if (parsed.exp < Date.now()) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      return null;
    }
  }

  async function storeSession(cryptoKey, salt) {
    var raw = await crypto.subtle.exportKey('raw', cryptoKey);
    var record = {
      k: b64encode(raw),
      s: salt ? b64encode(salt) : null,
      exp: Date.now() + REMEMBER_MS
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  }

  async function restoreSessionKey(rawB64) {
    var raw = b64decode(rawB64);
    // Import as extractable + encrypt-capable too so admin can encrypt fresh
    // JSON blobs without re-entering the passcode.
    return crypto.subtle.importKey(
      'raw', raw, { name: 'AES-GCM' }, true, ['decrypt', 'encrypt']
    );
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    cachedKey = null;
  }

  // ---------- Public API used by itaukei-database.js ----------

  function bust(url) {
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now();
  }

  async function fetchJsonEncrypted(url) {
    var encUrl = ENC_FILES[url];
    if (!encUrl) {
      // Not an encrypted file \u2014 fall through to a normal fetch (e.g. Google
      // Sheets CSVs pulled by admin.html).
      var r0 = await fetch(bust(url), { cache: 'no-store' });
      if (!r0.ok) throw new Error('Fetch failed: ' + url + ' (' + r0.status + ')');
      return r0.json();
    }
    if (!cachedKey) throw new Error('Database is locked \u2014 no session key.');
    var res = await fetch(bust(encUrl), { cache: 'no-store' });
    if (!res.ok) throw new Error('Fetch failed: ' + encUrl + ' (' + res.status + ')');
    var buf = await res.arrayBuffer();
    var text = await decryptBlob(cachedKey, buf);
    if (url.slice(-8) === '.geojson') {
      // GeoJSON is JSON but we already decode to text; parse the same way.
    }
    return JSON.parse(text);
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
      + '@media (prefers-color-scheme: dark){}'
      + 'body.db-gate-locked main > *:not(.db-gate){display:none !important;}'
      + 'body.db-gate-locked [data-db-hide-when-locked]{display:none !important;}';
    var style = document.createElement('style');
    style.id = 'db-gate-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function renderLockScreen(onUnlock) {
    injectLockScreenStyles();
    document.body.classList.add('db-gate-locked');
    // Insert as the first child of <main>
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
        var probeUrl = ENC_FILES['data/last-sync.json'];
        var result = await keyFromPasscode(pass, probeUrl);
        cachedKey = result.key;
        activeSalt = result.salt;
        await storeSession(cachedKey, activeSalt);
        gate.style.transition = 'opacity 0.25s ease';
        gate.style.opacity = '0';
        setTimeout(function () {
          gate.remove();
          document.body.classList.remove('db-gate-locked');
          onUnlock();
        }, 240);
      } catch (e) {
        // Wrong passcode \u2014 fails the AES-GCM auth tag check.
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
    // Ensure lock-CSS is available immediately so hidden real content stays hidden.
    injectLockScreenStyles();
    document.body.classList.add('db-gate-locked');

    var stored = loadStoredSession();
    if (stored) {
      try {
        cachedKey = await restoreSessionKey(stored.k);
        // Verify the stored key still decrypts (in case files were re-encrypted
        // with a new passcode, i.e. the admin rotated it). Also read the fresh
        // salt from the probe so admin encrypts land in the deployed set.
        var probeUrl = ENC_FILES['data/last-sync.json'];
        var res = await fetch(bust(probeUrl), { cache: 'no-store' });
        if (res.ok) {
          var buf = await res.arrayBuffer();
          var bytes = new Uint8Array(buf);
          activeSalt = bytes.slice(4, 20);
          await decryptBlob(cachedKey, buf);
          // Refresh the persisted salt if it drifted (workflow re-encrypt).
          if (!stored.s || stored.s !== b64encode(activeSalt)) {
            await storeSession(cachedKey, activeSalt);
          }
          document.body.classList.remove('db-gate-locked');
          onReady();
          return;
        }
      } catch (e) {
        // Stored key no longer works \u2014 fall through to lock screen.
        clearSession();
      }
    }
    renderLockScreen(onReady);
  }

  // High-level helper for admin.js: encrypt a plaintext string against the
  // currently active session key + salt so the resulting blob decrypts inside
  // the same deployed set. Returns a Uint8Array ready for base64/upload.
  async function encryptForUpload(plaintext) {
    if (!cachedKey || !activeSalt) {
      throw new Error('Database is locked \u2014 no session key/salt to encrypt with.');
    }
    return encryptString(plaintext, cachedKey, activeSalt);
  }

  // Expose the API for itaukei-database.js.
  window.dbGate = {
    boot: boot,
    fetchJson: fetchJsonEncrypted,
    clearSession: clearSession,
    encryptForUpload: encryptForUpload,
    isUnlocked: function () { return !!(cachedKey && activeSalt); }
  };
})();
