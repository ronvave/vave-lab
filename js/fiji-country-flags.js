/* Fiji dashboard, Panels B2 and B5: a small rectangular country flag next to
   each country name in the country lists. Decorates rows after the dashboard
   renders them (and re-renders), without changing their text or behaviour. */
(function () {
  'use strict';
  var ISO = {
    'Tonga': 'to', 'Fiji': 'fj', 'Samoa': 'ws', 'Western Samoa': 'ws', 'American Samoa': 'as',
    'New Zealand': 'nz', 'Aotearoa': 'nz', 'Australia': 'au',
    'United States': 'us', 'United States of America': 'us', 'USA': 'us', 'Hawaii': 'us', 'Hawai\u02bbi': 'us',
    'United Kingdom': 'gb', 'UK': 'gb', 'England': 'gb', 'Scotland': 'gb', 'Wales': 'gb', 'Great Britain': 'gb',
    'Canada': 'ca', 'Japan': 'jp', 'China': 'cn', 'Malta': 'mt', 'India': 'in', 'Philippines': 'ph',
    'Papua New Guinea': 'pg', 'Solomon Islands': 'sb', 'Vanuatu': 'vu', 'Kiribati': 'ki',
    'Cook Islands': 'ck', 'Niue': 'nu', 'Tuvalu': 'tv', 'Nauru': 'nr', 'Naoero': 'nr', 'Palau': 'pw',
    'Federated States of Micronesia': 'fm', 'Micronesia': 'fm', 'Marshall Islands': 'mh',
    'French Polynesia': 'pf', 'New Caledonia': 'nc', 'Wallis and Futuna': 'wf', 'Tokelau': 'tk',
    'Guam': 'gu', 'Northern Mariana Islands': 'mp', 'Pitcairn Islands': 'pn',
    'Germany': 'de', 'France': 'fr', 'Netherlands': 'nl', 'Belgium': 'be', 'Switzerland': 'ch', 'Austria': 'at',
    'Ireland': 'ie', 'Italy': 'it', 'Spain': 'es', 'Portugal': 'pt', 'Norway': 'no', 'Sweden': 'se',
    'Denmark': 'dk', 'Finland': 'fi', 'Iceland': 'is', 'Greece': 'gr', 'Poland': 'pl', 'Russia': 'ru',
    'Israel': 'il', 'Turkey': 'tr', 'United Arab Emirates': 'ae', 'Saudi Arabia': 'sa', 'Qatar': 'qa',
    'Singapore': 'sg', 'Malaysia': 'my', 'Indonesia': 'id', 'Thailand': 'th', 'Vietnam': 'vn', 'Viet Nam': 'vn',
    'Cambodia': 'kh', 'Bangladesh': 'bd', 'Pakistan': 'pk', 'Sri Lanka': 'lk', 'Nepal': 'np',
    'South Korea': 'kr', 'Republic of Korea': 'kr', 'Korea': 'kr', 'Taiwan': 'tw', 'Hong Kong': 'hk', 'Macao': 'mo', 'Macau': 'mo',
    'Timor-Leste': 'tl', 'East Timor': 'tl', 'Mongolia': 'mn',
    'Trinidad and Tobago': 'tt', 'Trinidad & Tobago': 'tt', 'Jamaica': 'jm', 'Barbados': 'bb',
    'Mexico': 'mx', 'Brazil': 'br', 'Argentina': 'ar', 'Chile': 'cl', 'Peru': 'pe', 'Colombia': 'co',
    'South Africa': 'za', 'Kenya': 'ke', 'Nigeria': 'ng', 'Egypt': 'eg', 'Ghana': 'gh', 'Ethiopia': 'et'
  };
  function decorate(root) {
    root.querySelectorAll('.db-world-country-row__name').forEach(function (n) {
      if (n.querySelector(':scope > .tcf-flag')) return;
      var name = (n.textContent || '').trim();
      var iso = ISO[name];
      var f;
      if (iso) {
        f = document.createElement('img');
        f.src = 'https://flagcdn.com/w80/' + iso + '.png';
        f.alt = ''; f.loading = 'lazy'; f.width = 30; f.height = 20;
      } else {
        f = document.createElement('span'); // keeps names aligned when no flag is known
      }
      f.className = 'tcf-flag' + (iso ? '' : ' tcf-flag--none');
      f.setAttribute('aria-hidden', 'true');
      n.insertBefore(f, n.firstChild); // inside the name, so row layouts and text stay the same
    });
  }
  function watch(sel) {
    var p = document.querySelector(sel); if (!p) return;
    decorate(p);
    new MutationObserver(function () { decorate(p); }).observe(p, { childList: true, subtree: true });
  }
  function run() { watch('[data-panel="B2"]'); watch('[data-panel="B5"]'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
