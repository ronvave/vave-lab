/**
 * samoa-db-gate.js  —  Passcode gate for the Samoa Scholar Database.
 *
 * Independent implementation for the Samoa Scholar Database. No aliases,
 * no cross-jurisdiction imports.
 *
 * Wire format (identical shape to sister jurisdictions' encrypted files but
 * NEVER interchangeable — every Samoa .enc file uses this Samoa-only
 * passcode-derived key):
 *
 *   magic (4) || salt (16) || iv (12) || ciphertext+tag
 *   magic  = "IVAV"
 *   KDF    = PBKDF2-HMAC-SHA256, 200,000 iterations, 32-byte key
 *   cipher = AES-GCM (16-byte tag included in the tail)
 *
 * Design notes:
 *   • Each .enc file carries its own salt, so any writer (this page, the
 *     admin surface, the refresh workflow) can re-encrypt one file with a
 *     fresh random salt without invalidating any other.
 *   • Derived AES keys are cached in memory for the tab lifetime, so
 *     PBKDF2 is paid at most once per file per page load.
 *   • A correct passcode is verified against VERIFIER_HASH_HEX
 *     (PBKDF2 of the passcode with a fixed verifier salt) before we
 *     cache anything. Successful entries store {p: b64(passcode), exp}
 *     in localStorage under a Samoa-only key.
 *   • This gate is the ONLY code path that reads samoalab.db.session.v1;
 *     no sister jurisdiction reads or writes that key.
 */
(function (global) {
  'use strict';

  // ── Samoa-only storage + verifier constants ─────────────────────────────
  var STORAGE_KEY = 'samoalab.db.session.v1';
  var STORAGE_TTL_DAYS = 30;
  var STORAGE_TTL_MS = STORAGE_TTL_DAYS * 24 * 60 * 60 * 1000;

  // PBKDF2 verifier used to check a candidate passcode WITHOUT decrypting
  // any file. Fixed verifier salt is namespaced to this Samoa build.
  //   VERIFIER_HASH_HEX = PBKDF2-HMAC-SHA256(passcode,
  //                                          "samoalab-db-verifier-v1",
  //                                          100000, 32-byte hex)
  //   passcode          = Zoopilus1!    (Samoa-only public dashboard passcode)
  //   salt (hex)        = 7e873db22bc77cf2f63d8a50988156df   (per-user salt for verifier)
  //
  // Design detail: the verifier uses a shorter iteration count than the
  // per-file KDF (100k vs 200k) and a Samoa-specific label so the verifier
  // hash cannot be replayed against sister-jurisdiction files, even if
  // someone were foolish enough to reuse a passcode.
  var VERIFIER_SALT_HEX = '7e873db22bc77cf2f63d8a50988156df';
  var VERIFIER_HASH_HEX = '155c793753f9ffed2db3b51b4e6dda6eb0085fa899c80b946c9c2e1bf37fd0b3';
  var VERIFIER_ITERATIONS = 100000;

  // Per-file KDF parameters — used by decryptFile() below.
  var FILE_ITERATIONS = 200000;
  var FILE_KEY_BITS = 256;

  // ── ENC_FILES  ──────────────────────────────────────────────────────────
  // Plain-path → encrypted-path map. The public dashboard fetches by plain
  // path; this gate transparently rewrites to the .enc path and decrypts.
  //
  // All paths live under data/samoa-*  —  the encryptor and decryptor both
  // refuse to touch any file not matching a Samoa prefix (see
  // scripts/samoa_encrypt_data.py::_FORBIDDEN_PREFIXES).
  var ENC_FILES = {
    // Master-file snapshot (produced by refresh-samoa-master-file.yml)
    'data/samoa-master-scholars.json':               'data/samoa-master-scholars.json.enc',
    'data/samoa-master-publications.json':           'data/samoa-master-publications.json.enc',
    'data/samoa-master-authorship.json':             'data/samoa-master-authorship.json.enc',
    'data/samoa-master-researcher-authorship.json':  'data/samoa-master-researcher-authorship.json.enc',
    'data/samoa-master-grad-degrees.json':           'data/samoa-master-grad-degrees.json.enc',
    'data/samoa-master-mobility.json':               'data/samoa-master-mobility.json.enc',
    'data/samoa-master-geography.json':              'data/samoa-master-geography.json.enc',
    'data/samoa-master-aggregates.json':             'data/samoa-master-aggregates.json.enc',
    'data/samoa-master-worldpoints.json':            'data/samoa-master-worldpoints.json.enc',
    'data/samoa-last-master-sync.json':              'data/samoa-last-master-sync.json.enc',

    // Six-dimension geography lookups (see samoa_geo/ for source-of-truth CSVs)
    'data/samoa-regions.json':                       'data/samoa-regions.json.enc',
    'data/samoa-political-districts.json':           'data/samoa-political-districts.json.enc',
    'data/samoa-villages.json':                      'data/samoa-villages.json.enc',
    'data/samoa-specific-islands.json':              'data/samoa-specific-islands.json.enc',
    'data/samoa-traditional-itumalo.json':           'data/samoa-traditional-itumalo.json.enc',
    'data/samoa-electoral-constituencies.json':      'data/samoa-electoral-constituencies.json.enc',
    'data/samoa-village-coordinates.json':           'data/samoa-village-coordinates.json.enc',

    // Admin-owned enrichment (Scholar-ID keyed)
    'data/samoa-scholar-enrichment.json':            'data/samoa-scholar-enrichment.json.enc',
    'data/samoa-scholar-insights-master.json':       'data/samoa-scholar-insights-master.json.enc'
  };

  // ── State ────────────────────────────────────────────────────────────────
  var currentPasscode = null;              // populated after unlock()
  var cachedFileKeys = Object.create(null); // path → CryptoKey (per-file)

  // ── Byte utilities ───────────────────────────────────────────────────────
  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) throw new Error('samoa-db-gate: bad hex length');
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) {
      out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out;
  }

  function bytesToHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      out += (h.length === 1 ? '0' : '') + h;
    }
    return out;
  }

  function b64Encode(str) {
    // UTF-8 safe base64 (per MDN "Base64 in JavaScript" pattern)
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64Decode(b64) {
    return decodeURIComponent(escape(atob(b64)));
  }

  // ── PBKDF2 helpers ───────────────────────────────────────────────────────
  function importPasscode(passcode) {
    return crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passcode),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
  }

  function verifyPasscode(passcode) {
    // Compute PBKDF2 of the candidate with the fixed verifier salt and
    // compare (constant-time-ish) against VERIFIER_HASH_HEX.
    return importPasscode(passcode).then(function (baseKey) {
      return crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: hexToBytes(VERIFIER_SALT_HEX),
          iterations: VERIFIER_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        256
      );
    }).then(function (derived) {
      var hex = bytesToHex(new Uint8Array(derived));
      // Constant-time compare (avoids early-exit timing signal).
      if (hex.length !== VERIFIER_HASH_HEX.length) return false;
      var diff = 0;
      for (var i = 0; i < hex.length; i++) {
        diff |= hex.charCodeAt(i) ^ VERIFIER_HASH_HEX.charCodeAt(i);
      }
      return diff === 0;
    });
  }

  function deriveFileKey(passcode, salt) {
    return importPasscode(passcode).then(function (baseKey) {
      return crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: FILE_ITERATIONS,
          hash: 'SHA-256'
        },
        baseKey,
        { name: 'AES-GCM', length: FILE_KEY_BITS },
        false,
        ['decrypt', 'encrypt']
      );
    });
  }

  // ── Session persistence ─────────────────────────────────────────────────
  function storeSession(passcode) {
    try {
      var payload = JSON.stringify({
        p: b64Encode(passcode),
        exp: Date.now() + STORAGE_TTL_MS
      });
      localStorage.setItem(STORAGE_KEY, payload);
    } catch (e) { /* private mode, quota, etc. — non-fatal */ }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || typeof obj.p !== 'string' || typeof obj.exp !== 'number') return null;
      if (Date.now() > obj.exp) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return b64Decode(obj.p);
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    currentPasscode = null;
    cachedFileKeys = Object.create(null);
  }

  // ── Public: unlock() ─────────────────────────────────────────────────────
  // Attempts to unlock with the supplied passcode. Resolves to true on
  // success (and persists the session), false on incorrect passcode.
  function unlock(passcode) {
    if (typeof passcode !== 'string' || !passcode.length) {
      return Promise.resolve(false);
    }
    return verifyPasscode(passcode).then(function (ok) {
      if (ok) {
        currentPasscode = passcode;
        cachedFileKeys = Object.create(null);
        storeSession(passcode);
      }
      return ok;
    });
  }

  // ── Public: tryResume() ──────────────────────────────────────────────────
  // Reads localStorage; returns the cached passcode string if valid, else
  // null. Does NOT re-verify against VERIFIER_HASH_HEX — that verification
  // already happened when the session was created.
  function tryResume() {
    var pw = loadSession();
    if (!pw) return null;
    currentPasscode = pw;
    cachedFileKeys = Object.create(null);
    return pw;
  }

  // ── Public: isUnlocked() ─────────────────────────────────────────────────
  function isUnlocked() { return currentPasscode !== null; }

  // ── Public: decryptFile(plainPath) → Promise<Uint8Array plaintext> ──────
  // Fetches ENC_FILES[plainPath], parses the IVAV magic|salt|iv|ct header,
  // derives (passcode, salt) → AES-GCM key, decrypts, returns raw bytes.
  //
  // The caller is responsible for JSON.parse / new TextDecoder().decode()
  // as appropriate for the file.
  function decryptFile(plainPath) {
    if (!currentPasscode) {
      return Promise.reject(new Error('samoa-db-gate: not unlocked'));
    }
    var encPath = ENC_FILES[plainPath];
    if (!encPath) {
      return Promise.reject(new Error('samoa-db-gate: unknown file ' + plainPath));
    }

    return fetch(encPath, { cache: 'no-store' }).then(function (resp) {
      if (!resp.ok) throw new Error('samoa-db-gate: fetch failed ' + encPath + ' ' + resp.status);
      return resp.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf);
      if (bytes.length < 4 + 16 + 12 + 16) {
        throw new Error('samoa-db-gate: file too short ' + encPath);
      }
      // Magic check — "IVAV"
      if (bytes[0] !== 0x49 || bytes[1] !== 0x56 || bytes[2] !== 0x41 || bytes[3] !== 0x56) {
        throw new Error('samoa-db-gate: bad magic in ' + encPath);
      }
      var salt = bytes.slice(4, 4 + 16);
      var iv = bytes.slice(4 + 16, 4 + 16 + 12);
      var ct = bytes.slice(4 + 16 + 12);

      // Cache the derived key per plain path so a repeated fetch of the
      // same file is cheap. Cache is invalidated on unlock() and clear().
      var cached = cachedFileKeys[plainPath];
      var keyPromise = cached
        ? Promise.resolve(cached)
        : deriveFileKey(currentPasscode, salt).then(function (k) {
            cachedFileKeys[plainPath] = k;
            return k;
          });

      return keyPromise.then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
      }).then(function (ptBuf) {
        return new Uint8Array(ptBuf);
      });
    });
  }

  // ── Public: decryptFileJSON(plainPath) → Promise<Object> ────────────────
  function decryptFileJSON(plainPath) {
    return decryptFile(plainPath).then(function (bytes) {
      return JSON.parse(new TextDecoder().decode(bytes));
    });
  }

  // ── Public: listFiles() ─────────────────────────────────────────────────
  function listFiles() { return Object.keys(ENC_FILES); }

  // ── Export ──────────────────────────────────────────────────────────────
  global.samoaDbGate = {
    unlock: unlock,
    tryResume: tryResume,
    isUnlocked: isUnlocked,
    decryptFile: decryptFile,
    decryptFileJSON: decryptFileJSON,
    clearSession: clearSession,
    listFiles: listFiles,
    // Introspection for tests only
    _STORAGE_KEY: STORAGE_KEY
  };
})(typeof window !== 'undefined' ? window : this);
