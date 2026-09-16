/*
 * Master-file panel overrides loader.
 *
 * The pre-2026-09-13 override implementation is preserved verbatim in
 * master-file-panel-overrides-core.js. Keeping this tiny loader lets us layer
 * focused repairs without rewriting the stable panel-override bundle.
 */
(function () {
  'use strict';

  function load(src, done) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { if (done) done(); };
    s.onerror = function () {
      console.error('Failed to load dashboard override:', src);
      if (done) done();
    };
    document.head.appendChild(s);
  }

  load('js/master-file-panel-overrides-core.js?v=20260913-geo1', function () {
    load('js/master-file-geography-repair.js?v=20260913-geo2', function () {
      load('js/master-file-geography-authoritative.js?v=20260913-geo3');
    });
  });
})();
