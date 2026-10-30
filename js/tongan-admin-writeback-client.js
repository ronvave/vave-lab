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

  async function callGet(action) { return callPost({action: action}); }

  // Read-only actions are safe to repeat. Google's result hand-off (script.googleusercontent.com)
  // occasionally answers 404 even though the script ran; retry those reads up to twice.
  var SAFE_READS = ['readNewsSubmissions','previewNewsLink','readScholarProfileSubmissions','readPublicationGeographySubmissions','reviewQueueCounts','reviewCapabilities','readAttachmentAnalysis','readScholarSubmissionAttachment','readChangeLog','ping','describe'];
  async function callPost(payload) {
    var safe = payload && SAFE_READS.indexOf(payload.action) >= 0, out;
    for (var attempt = 0; attempt < (safe ? 3 : 1); attempt++) {
      if (attempt) await new Promise(function (r) { var t = typeof setTimeout === 'function' ? setTimeout : null; if (t) t(r, 1200 * attempt); else r(); });
      out = await callPostOnce(payload);
      if (!out || !out._transport) break;
    }
    if (out && out._transport) delete out._transport;
    return out;
  }
  async function callPostOnce(payload) {
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
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(90000),
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    var out;
    try { out = await res.json(); }
    catch (_) { out = { status: 'error', _transport: true, error: 'Tonga review service returned HTTP ' + res.status + ' instead of review data. Refresh again; if this persists, check the deployed Web app URL using Data source & GitHub → Test connection. No fresh queue data was received.' }; }
    return out;
  }

  // A successful server response follows durable writes. Do not reread every
  // submission after it. On a lost response, retain the selection for safe retry.
  async function reviewPost(payload) {
    try { return await callPost(payload); }
    catch (err) { return {status:'error',error:'Save acknowledgement was lost. Your selection is retained. Retry safely or refresh this queue to check the recorded outcome.'}; }
  }

  // Authenticated reads use the same uncached POST transport as reviewer login.
  async function callGetWithParams(action, params) {
    return callPost(Object.assign({}, params, {action: action}));
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
    readAttachmentAnalysis: submissionId => callPost({action:'readAttachmentAnalysis',submissionId}),
    refreshAttachmentProposals: params => callPost(Object.assign({},params,{action:'refreshAttachmentProposals'})),
    analyseScholarAttachment: params => callPost(Object.assign({},params,{action:'analyseScholarAttachment'})),
    editAttachmentProposal: params => callPost(Object.assign({},params,{action:'editAttachmentProposal'})),
    approveAttachmentProposals: params => reviewPost(Object.assign({},params,{action:'approveAttachmentProposals'})),
    seedFormProposals: params => callPost(Object.assign({},params,{action:'seedFormProposals'})),
    crossrefAttachmentProposal: params => callPost(Object.assign({},params,{action:'crossrefAttachmentProposal'})),
    reviewCapabilities: function () { return callPost({action:'reviewCapabilities'}); },
    reviewQueueCounts: function () { return callPost({action:'reviewQueueCounts'}); },
    reviewScholarSelection: function (submissionId, selectedChanges, selectedFiles, reviewNotes) { return reviewPost({action:'reviewScholarSelection',submissionId,selectedChanges,selectedFiles,reviewNotes}); },
    readScholarSubmission: function (submissionId) { return callPost({action:'readScholarProfileSubmissions',submissionId}); },
    beginScholarReview: function (submissionId, selectedChanges, selectedFiles, reviewNotes) { return reviewPost({action:'beginScholarReview',submissionId:submissionId,selectedChanges:selectedChanges,selectedFiles:selectedFiles,reviewNotes:reviewNotes}); },
    recordAttachmentReview: function (submissionId, fileId, disposition, evidence) { return reviewPost({action:'recordScholarAttachmentReview',submissionId:submissionId,fileId:fileId,disposition:disposition,evidence:evidence}); },
    finishScholarReview: function (submissionId, reviewNotes) { return reviewPost({action:'finishScholarReview',submissionId:submissionId,reviewNotes:reviewNotes}); },
    finishScholarSubmission: function (submissionId, note, reviewNotes) { return reviewPost({action:'finishScholarSubmission',submissionId:submissionId,note:note,reviewNotes:reviewNotes}); },
    closeScholarReviewItems: function (submissionId, items, note, reviewNotes) { return reviewPost({action:'closeScholarReviewItems',submissionId:submissionId,items:items,note:note,reviewNotes:reviewNotes}); },
    banScholarSubmitter: function (submissionId, reason) { return callPost({action:'banScholarSubmitter',submissionId:submissionId,reason:reason,confirmed:true}); },
    readScholarSubmissions: function (status) { return callGetWithParams('readScholarProfileSubmissions', {status: status || ''}); },
    // News Story Submissions (Panel A4 "Share a story" links).
    readNewsSubmissions: function (status) { return callGetWithParams('readNewsSubmissions', {status: status || ''}); },
    previewNewsLink: function (url, scholars) { return callPost({action:'previewNewsLink', url:url, scholars:scholars}); },
    resolveNewsSubmission: function (submissionId, decision, story, reviewNotes) { return reviewPost({action:'resolveNewsSubmission', submissionId:submissionId, decision:decision, story:story, reviewNotes:reviewNotes}); },
    readGeographySubmissions: function (status) { return callGetWithParams('readPublicationGeographySubmissions', {status: status || ''}); },
    readSubmissionAttachment: function (submissionId, fileId) { return callGetWithParams('readScholarSubmissionAttachment', {submissionId: submissionId, fileId: fileId}); },
    approveScholarSubmission: function (submissionId, selectedChanges, reviewNotes) { return reviewPost({action:'approveScholarProfileSubmission', submissionId:submissionId, selectedChanges:selectedChanges, reviewNotes:reviewNotes}); },
    resolveScholarSubmission: function (submissionId, decision, reviewNotes) { return reviewPost({action:'resolveScholarProfileSubmission', submissionId:submissionId, decision:decision, reviewNotes:reviewNotes}); },
    resolveGeographySubmission: function (submissionId, decision, reviewNotes, selectedKeys) { var p={action:'resolvePublicationGeographySubmission', submissionId:submissionId, decision:decision, reviewNotes:reviewNotes}; if (Array.isArray(selectedKeys)) p.selectedKeys = selectedKeys; return reviewPost(p); },
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
