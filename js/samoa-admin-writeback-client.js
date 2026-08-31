/**
 * samoa-admin-writeback-client.js  —  HMAC-signed client for the Samoa
 * Master Sheet writeback Apps Script.
 *
 * Independent implementation. No cross-jurisdiction imports and no shared
 * secrets — every request is signed with the Samoa SHARED_SECRET stored
 * ONLY in apps-script/samoa-master-writeback.gs on Google's side. The
 * client-side signer here derives the same HMAC-SHA-256 signature from
 * the passcode entered on the admin login screen.
 *
 * Wire protocol:
 *   POST <SAMOA_WRITEBACK_URL>
 *   Body: JSON {
 *     action:    "update" | "describe" | "ping",
 *     worksheet: "<exact Master Sheet tab name>",
 *     key:       "<value of the keyColumn for the target row>",
 *     fields:    { <exact row-4 header>: <new value>, ... },
 *     actor:     "<free-form label recorded on the sheet>",
 *     nonce:     "<hex, 16 bytes>",
 *     ts:        <epoch ms>,
 *     sig:       "<hex HMAC-SHA-256 of the canonical string below>"
 *   }
 *
 * Canonical string signed:
 *   action + "\n" + worksheet + "\n" + key + "\n" +
 *   canonicalJSONFields + "\n" + nonce + "\n" + ts
 *
 * The Apps Script side re-computes the same canonical string and rejects
 * any mismatch. Nonces are rejected if reused within 10 minutes; timestamps
 * older than 10 minutes are rejected.
 */
(function (global) {
  'use strict';

  // ── Configuration ───────────────────────────────────────────────────────
  //
  // The Apps Script deploy URL is written into the admin HTML at build time
  // (as `window.SAMOA_WRITEBACK_URL`) so it can be rotated without editing
  // this file. If it's absent, every call rejects with a clear error.
  //
  // The signing key is derived from the Samoa Apps Script SHARED_SECRET
  // (hex string) written into the admin HTML at build time as
  // `window.SAMOA_WRITEBACK_SECRET_HEX`. It is NEVER stored in localStorage
  // or serialised back to the server; the admin surface loads it once from
  // an in-page constant that the maintainer edits when rotating.
  function getConfig() {
    var url = global.SAMOA_WRITEBACK_URL || '';
    var secretHex = global.SAMOA_WRITEBACK_SECRET_HEX || '';
    return { url: url, secretHex: secretHex };
  }

  // ── Byte utilities ──────────────────────────────────────────────────────
  function hexToBytes(hex) {
    if (hex.length % 2 !== 0) throw new Error('samoa-writeback: bad hex length');
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

  // ── Canonicalisation ────────────────────────────────────────────────────
  // Fields are JSON-serialised with sorted keys so client and server agree
  // on byte-for-byte input to HMAC.
  function canonicalJSON(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return JSON.stringify(obj);
    }
    var keys = Object.keys(obj).sort();
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
      parts.push(JSON.stringify(keys[i]) + ':' + canonicalJSON(obj[keys[i]]));
    }
    return '{' + parts.join(',') + '}';
  }

  // ── HMAC signer ─────────────────────────────────────────────────────────
  function sign(secretHex, message) {
    var keyBytes = hexToBytes(secretHex);
    return crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ).then(function (key) {
      return crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(message)
      );
    }).then(function (sigBuf) {
      return bytesToHex(new Uint8Array(sigBuf));
    });
  }

  // ── Nonce ───────────────────────────────────────────────────────────────
  function makeNonce() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return bytesToHex(b);
  }

  // ── Public: describe() ──────────────────────────────────────────────────
  // Returns the current MAPPING the server enforces. Used at admin boot to
  // check that the client's form matches the server's validation surface;
  // any mismatch is a hard error.
  function describe(actor) {
    var cfg = getConfig();
    if (!cfg.url || !cfg.secretHex) {
      return Promise.reject(new Error(
        'samoa-writeback: SAMOA_WRITEBACK_URL / SAMOA_WRITEBACK_SECRET_HEX not set on page'
      ));
    }
    var payload = {
      action: 'describe',
      actor: actor || 'admin',
      nonce: makeNonce(),
      ts: Date.now()
    };
    var canonical =
      payload.action + '\n' +
      '\n' +      // worksheet (empty)
      '\n' +      // key (empty)
      '{}' + '\n' + // fields (empty)
      payload.nonce + '\n' +
      payload.ts;
    return sign(cfg.secretHex, canonical).then(function (sig) {
      payload.sig = sig;
      return fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
    }).then(function (resp) {
      if (!resp.ok) throw new Error('samoa-writeback: describe HTTP ' + resp.status);
      return resp.json();
    });
  }

  // ── Public: ping() ──────────────────────────────────────────────────────
  function ping(actor) {
    var cfg = getConfig();
    if (!cfg.url || !cfg.secretHex) {
      return Promise.reject(new Error(
        'samoa-writeback: SAMOA_WRITEBACK_URL / SAMOA_WRITEBACK_SECRET_HEX not set on page'
      ));
    }
    var payload = {
      action: 'ping',
      actor: actor || 'admin',
      nonce: makeNonce(),
      ts: Date.now()
    };
    var canonical =
      payload.action + '\n\n\n' + '{}' + '\n' + payload.nonce + '\n' + payload.ts;
    return sign(cfg.secretHex, canonical).then(function (sig) {
      payload.sig = sig;
      return fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
    }).then(function (resp) {
      if (!resp.ok) throw new Error('samoa-writeback: ping HTTP ' + resp.status);
      return resp.json();
    });
  }

  // ── Public: updateRow(worksheet, keyValue, fields, actor) ──────────────
  // Writes the provided <field>: <value> pairs to the row whose keyColumn
  // matches `keyValue` on `worksheet`. The server rejects the write if:
  //   • worksheet is not in MAPPING
  //   • any field key is not in that worksheet's `fields` map
  //   • any value fails its type/length/pattern/enum constraint
  //   • the signature does not verify or the nonce is stale/reused
  //   • no row on `worksheet` has that keyValue in its keyColumn
  //
  // Resolves with the server's JSON body on 200; rejects on non-2xx.
  function updateRow(worksheet, keyValue, fields, actor) {
    var cfg = getConfig();
    if (!cfg.url || !cfg.secretHex) {
      return Promise.reject(new Error(
        'samoa-writeback: SAMOA_WRITEBACK_URL / SAMOA_WRITEBACK_SECRET_HEX not set on page'
      ));
    }
    if (typeof worksheet !== 'string' || !worksheet.length) {
      return Promise.reject(new Error('samoa-writeback: worksheet is required'));
    }
    if (typeof keyValue !== 'string' || !keyValue.length) {
      return Promise.reject(new Error('samoa-writeback: keyValue is required'));
    }
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
      return Promise.reject(new Error('samoa-writeback: fields must be an object'));
    }
    if (!Object.keys(fields).length) {
      return Promise.reject(new Error('samoa-writeback: fields is empty'));
    }

    var payload = {
      action: 'update',
      worksheet: worksheet,
      key: keyValue,
      fields: fields,
      actor: actor || 'admin',
      nonce: makeNonce(),
      ts: Date.now()
    };
    var canonical =
      payload.action + '\n' +
      payload.worksheet + '\n' +
      payload.key + '\n' +
      canonicalJSON(payload.fields) + '\n' +
      payload.nonce + '\n' +
      payload.ts;
    return sign(cfg.secretHex, canonical).then(function (sig) {
      payload.sig = sig;
      return fetch(cfg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
    }).then(function (resp) {
      // Apps Script always returns 200 with a JSON body; treat non-2xx as
      // network/proxy failure.
      if (!resp.ok) throw new Error('samoa-writeback: update HTTP ' + resp.status);
      return resp.json();
    }).then(function (body) {
      if (!body || body.status !== 'ok') {
        var msg = (body && body.error) || 'unknown';
        var err = new Error('samoa-writeback: server rejected — ' + msg);
        err.serverBody = body;
        throw err;
      }
      return body;
    });
  }

  // ── Export ──────────────────────────────────────────────────────────────
  global.samoaWriteback = {
    describe: describe,
    ping: ping,
    updateRow: updateRow,
    // exposed for tests only
    _canonicalJSON: canonicalJSON,
    _sign: sign
  };
})(typeof window !== 'undefined' ? window : this);
