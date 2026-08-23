/**
 * admin-writeback-client.js
 *
 * Thin client for the Apps Script `master-writeback.gs` web app. Handles:
 *   - persistence of the endpoint URL + shared secret in localStorage
 *   - ping / describe / write operations
 *   - request signing (clientTs + secret) and 5-minute replay window
 *
 * The secret never leaves this browser. It is not sent to GitHub, not sent
 * to any AI, and not written to any downloaded file. It travels only over
 * HTTPS to the script.google.com endpoint.
 *
 * All responses go through `contentService.createTextOutput(...)` on the
 * server, so we always parse JSON and inspect `.status`. HTTP status codes
 * from Apps Script are always 200; the semantic status is in the payload.
 */
(function () {
  'use strict';

  var LS_ENDPOINT = 'vavelab_writeback_endpoint';
  var LS_SECRET   = 'vavelab_writeback_secret';

  function getEndpoint() { try { return localStorage.getItem(LS_ENDPOINT) || ''; } catch (_) { return ''; } }
  function getSecret()   { try { return localStorage.getItem(LS_SECRET)   || ''; } catch (_) { return ''; } }
  function setEndpoint(v) { try { if (v) localStorage.setItem(LS_ENDPOINT, v); else localStorage.removeItem(LS_ENDPOINT); } catch (_) {} }
  function setSecret(v)   { try { if (v) localStorage.setItem(LS_SECRET,   v); else localStorage.removeItem(LS_SECRET);   } catch (_) {} }
  function clear()        { setEndpoint(''); setSecret(''); }

  function requireConfigured() {
    if (!getEndpoint()) throw new Error('Master write-back endpoint URL is not set (Data source tab \u2192 Master write-back endpoint).');
    if (!getSecret())   throw new Error('Master write-back shared secret is not set (Data source tab \u2192 Master write-back endpoint).');
  }

  async function callGet(action) {
    requireConfigured();
    var url = getEndpoint() +
      (getEndpoint().indexOf('?') === -1 ? '?' : '&') +
      'action=' + encodeURIComponent(action) +
      '&secret=' + encodeURIComponent(getSecret()) +
      '&clientTs=' + Date.now();
    var res = await fetch(url, { method: 'GET', redirect: 'follow' });
    var body;
    try { body = await res.json(); }
    catch (_) { body = { status: 'error', error: 'non-JSON response (HTTP ' + res.status + ')' }; }
    return body;
  }

  async function callPost(payload) {
    requireConfigured();
    var url = getEndpoint();
    // Apps Script Content-Type quirk: to avoid the CORS preflight (which the
    // web-app endpoint doesn't support cleanly), we send text/plain and let
    // the server JSON.parse `e.postData.contents`.
    var body = Object.assign({}, payload, {
      secret:   getSecret(),
      clientTs: Date.now()
    });
    var res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    var out;
    try { out = await res.json(); }
    catch (_) { out = { status: 'error', error: 'non-JSON response (HTTP ' + res.status + ')' }; }
    return out;
  }

  // Extra GET with named params.
  async function callGetWithParams(action, params) {
    requireConfigured();
    var qs = 'action=' + encodeURIComponent(action) +
             '&secret=' + encodeURIComponent(getSecret()) +
             '&clientTs=' + Date.now();
    Object.keys(params || {}).forEach(function (k) {
      qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    });
    var url = getEndpoint() + (getEndpoint().indexOf('?') === -1 ? '?' : '&') + qs;
    var res = await fetch(url, { method: 'GET', redirect: 'follow' });
    try { return await res.json(); }
    catch (_) { return { status: 'error', error: 'non-JSON response (HTTP ' + res.status + ')' }; }
  }

  // Convenience wrappers.
  async function ping()     { return callGet('ping'); }
  async function describe() { return callGet('describe'); }
  async function write(changes) { return callPost({ action: 'write', changes: changes }); }
  async function readScholar(scholarId) {
    return callGetWithParams('readScholar', { scholarId: scholarId });
  }
  async function readRows(worksheet, scholarId) {
    return callGetWithParams('readRows', { worksheet: worksheet, scholarId: scholarId });
  }
  async function readChangeLog(limit) {
    return callGetWithParams('readChangeLog', { limit: limit || 50 });
  }

  window.adminWriteback = {
    getEndpoint: getEndpoint,
    getSecret:   getSecret,
    setEndpoint: setEndpoint,
    setSecret:   setSecret,
    clear:       clear,
    ping:        ping,
    describe:    describe,
    write:       write,
    readScholar: readScholar,
    readRows:    readRows,
    readChangeLog: readChangeLog,
    isConfigured: function () { return !!(getEndpoint() && getSecret()); }
  };
})();
