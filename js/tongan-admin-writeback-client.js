/**
 * tongan-admin-writeback-client.js
 *
 * Sister clone of js/admin-writeback-client.js for the Tongan Scholar
 * Database admin. Thin client for the Tongan Apps Script writeback web app
 * (its own future `.gs` deployment, fully separate from the iTaukei
 * `master-writeback.gs` deployment/secret). Handles:
 *   - persistence of the endpoint URL + shared secret in localStorage
 *   - ping / describe / write operations
 *   - request signing (clientTs + secret) and 5-minute replay window
 *
 * The endpoint URL and secret are entered by the user later via the Data
 * source tab UI, exactly like the iTaukei admin \u2014 nothing is hardcoded
 * here. The localStorage keys below are Tongan-namespaced
 * (`tonganlab_writeback_endpoint` / `tonganlab_writeback_secret`) so this
 * client NEVER reads or collides with the iTaukei
 * `vavelab_writeback_endpoint` / `vavelab_writeback_secret` keys stored in
 * the same browser.
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

  var LS_ENDPOINT = 'tonganlab_writeback_endpoint';
  var LS_SECRET   = 'tonganlab_writeback_secret';

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
      signal: AbortSignal.timeout(90000),
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    var out;
    try { out = await res.json(); }
    catch (_) { out = { status: 'error', error: 'non-JSON response (HTTP ' + res.status + ')' }; }
    return out;
  }

  // A successful server response follows durable writes. Do not reread every
  // submission after it. On a lost response, retain the selection for safe retry.
  async function reviewPost(payload) {
    try { return await callPost(payload); }
    catch (err) { return {status:'error',error:'Save acknowledgement was lost. Your selection is retained. Retry safely or refresh this queue to check the recorded outcome.'}; }
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
  // write(changes, opts) supports { dryRun: true } for the Phase 3.4
  // three-way preview classification. Without opts it behaves identically
  // to the old signature so existing callers keep working.
  async function write(changes, opts) {
    var payload = { action: 'write', changes: changes };
    if (opts && opts.dryRun) payload.dryRun = true;
    return callPost(payload);
  }
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
    reviewCapabilities: function () { return callPost({action:'reviewCapabilities'}); },
    reviewQueueCounts: function () { return callPost({action:'reviewQueueCounts'}); },
    reviewScholarSelection: function (submissionId, selectedChanges, selectedFiles, reviewNotes) { return reviewPost({action:'reviewScholarSelection',submissionId,selectedChanges,selectedFiles,reviewNotes}); },
    readScholarSubmission: function (submissionId) { return callPost({action:'readScholarProfileSubmissions',submissionId}); },
    beginScholarReview: function (submissionId, selectedChanges, selectedFiles, reviewNotes) { return reviewPost({action:'beginScholarReview',submissionId:submissionId,selectedChanges:selectedChanges,selectedFiles:selectedFiles,reviewNotes:reviewNotes}); },
    recordAttachmentReview: function (submissionId, fileId, disposition, evidence) { return reviewPost({action:'recordScholarAttachmentReview',submissionId:submissionId,fileId:fileId,disposition:disposition,evidence:evidence}); },
    finishScholarReview: function (submissionId, reviewNotes) { return reviewPost({action:'finishScholarReview',submissionId:submissionId,reviewNotes:reviewNotes}); },
    banScholarSubmitter: function (submissionId, reason) { return callPost({action:'banScholarSubmitter',submissionId:submissionId,reason:reason,confirmed:true}); },
    readScholarSubmissions: function (status) { return callGetWithParams('readScholarProfileSubmissions', {status: status || ''}); },
    readGeographySubmissions: function (status) { return callGetWithParams('readPublicationGeographySubmissions', {status: status || ''}); },
    readSubmissionAttachment: function (submissionId, fileId) { return callGetWithParams('readScholarSubmissionAttachment', {submissionId: submissionId, fileId: fileId}); },
    approveScholarSubmission: function (submissionId, selectedChanges, reviewNotes) { return reviewPost({action:'approveScholarProfileSubmission', submissionId:submissionId, selectedChanges:selectedChanges, reviewNotes:reviewNotes}); },
    resolveScholarSubmission: function (submissionId, decision, reviewNotes) { return reviewPost({action:'resolveScholarProfileSubmission', submissionId:submissionId, decision:decision, reviewNotes:reviewNotes}); },
    resolveGeographySubmission: function (submissionId, decision, reviewNotes) { return reviewPost({action:'resolvePublicationGeographySubmission', submissionId:submissionId, decision:decision, reviewNotes:reviewNotes}); },
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
