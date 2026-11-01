/* Pacific Co-authorship Networks
 * Data: the "coauthor" section of data/regional-scholars.json.enc (IVAV v1, AES-GCM,
 * PBKDF2-SHA256 200k), decrypted in the browser with the Regional passcode.
 * Builds co-authorship networks for Fiji, Tonga, Solomon Islands, Vanuatu and all four
 * combined, and computes standard social network measures on the network shown. */
(function () {
  'use strict';
  const ENC_URL = 'data/regional-scholars.json.enc';
  const CODES = ['FJI', 'TON', 'SLB', 'VUT'];
  const NAME = { FJI: 'Fiji', TON: 'Tonga', SLB: 'Solomon Islands', VUT: 'Vanuatu', ALL: 'Combined' };
  const PEOPLE = { FJI: 'iTaukei', TON: 'Tongan', SLB: 'Solomon Islander', VUT: 'ni-Vanuatu' };
  const COLORS = { FJI: '#2f86d6', TON: '#e0464f', SLB: '#14a99a', VUT: '#e9a40f' };
  const OUT = '#8a96a3';
  const COMM = ['#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b', '#e377c2', '#bcbd22', '#393b79', '#637939', '#843c39'];
  const TYPE = { journalArticle: 'Journal article', bookSection: 'Book chapter', book: 'Book', report: 'Report', thesisMasters: "Master's thesis", thesisPhd: 'PhD thesis' };

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (n == null || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US'));
  const dec = (x, d = 3) => (x == null || !isFinite(x) ? '—' : x.toFixed(d));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');

  let C = null; // decoded coauthor data
  const S = { scope: 'ALL', view: 'ind', from: null, to: null, min: 1, col: 'country', iso: false, rank: 'deg', sel: null };
  let G = null, sim = null;

  // ================= DECRYPTION =================
  async function deriveKey(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }
  async function decryptBundle(pass) {
    const res = await fetch(ENC_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error('missing');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (String.fromCharCode(...buf.slice(0, 4)) !== 'IVAV') throw new Error('format');
    const key = await deriveKey(pass, buf.slice(4, 20));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(20, 32) }, key, buf.slice(32));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function gunzipB64(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  function initGate() {
    const gate = $('#ps-gate'), form = $('#ps-gate-form'), err = $('#ps-gate-err'), input = $('#ps-pass');
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      err.textContent = 'Decrypting…';
      try {
        const data = await decryptBundle(input.value);
        if (!data.coauthor || !data.coauthor.gz) { err.textContent = 'The co-authorship data are not in the Regional bundle yet. They are added at the next Regional rebuild.'; return; }
        C = await gunzipB64(data.coauthor.gz);
        C.generated = data.generated;
        input.value = '';
        gate.hidden = true;
        document.body.style.overflow = '';
        boot();
      } catch (e) {
        err.textContent = e.message === 'missing' ? 'The encrypted regional data file is not available yet.' : 'That passcode did not unlock the data. Please try again.';
      }
    });
    document.body.style.overflow = 'hidden';
    input.focus();
  }

  // ================= GRAPH BUILDING =================
  // Node ids: 'p<idx>' for database scholars, 'x<idx>' for outside co-authors.
  function yearsOk(y) {
    const full = S.from === C.minY && S.to === C.maxY;
    if (y == null) return full;
    return y >= S.from && y <= S.to;
  }
  function buildGraph(scope, view, opts = {}) {
    const inScope = i => scope === 'ALL' || C.people[i][1] === scope;
    const nodes = new Map(); // id -> node
    const addNode = (id, kind, idx) => {
      let n = nodes.get(id);
      if (!n) {
        if (kind === 'p') { const p = C.people[idx]; n = { id, kind: inScope(idx) ? 'p' : 'o', idx, name: p[2], c: p[1] }; }
        else n = { id, kind: 'x', idx, name: C.ext[idx], c: '' };
        n.pubs = []; nodes.set(id, n);
      }
      return n;
    };
    const w = new Map(); // "a|b" -> {a,b,w,pubs}
    let partial = 0, pubsIn = 0;
    C.pubs.forEach((p, pi) => {
      if (!yearsOk(p[1])) return;
      const mine = p[3].filter(inScope);
      if (!mine.length) return;
      pubsIn++;
      if (p[5]) partial++;
      const ids = mine.map(i => addNode('p' + i, 'p', i).id);
      let others = [];
      if (view === 'ext') {
        others = p[3].filter(i => !inScope(i)).map(i => addNode('p' + i, 'p', i).id)
          .concat(p[4].map(i => addNode('x' + i, 'x', i).id));
      }
      ids.concat(others).forEach(id => nodes.get(id).pubs.push(pi));
      const all = ids.concat(others);
      for (let a = 0; a < all.length; a++) {
        for (let b = a + 1; b < all.length; b++) {
          // Ties must involve at least one scholar from the chosen network.
          if (a >= ids.length && b >= ids.length) continue;
          const k = all[a] < all[b] ? all[a] + '|' + all[b] : all[b] + '|' + all[a];
          let e = w.get(k);
          if (!e) { e = { s: k.split('|')[0], t: k.split('|')[1], w: 0, pubs: [] }; w.set(k, e); }
          e.w++; e.pubs.push(pi);
        }
      }
    });
    const min = opts.min || S.min;
    const edges = [...w.values()].filter(e => e.w >= min);
    const deg = new Map();
    edges.forEach(e => { deg.set(e.s, (deg.get(e.s) || 0) + 1); deg.set(e.t, (deg.get(e.t) || 0) + 1); });
    // Scholars in the chosen network: everyone on the roster for that scope.
    const roster = C.people.map((p, i) => i).filter(inScope);
    roster.forEach(i => addNode('p' + i, 'p', i));
    const keep = [...nodes.values()].filter(n => deg.get(n.id) || (opts.iso && n.kind === 'p'));
    const index = new Map(keep.map((n, i) => [n.id, i]));
    keep.forEach((n, i) => { n.i = i; n.deg = deg.get(n.id) || 0; });
    const adj = keep.map(() => new Map());
    edges.forEach(e => { const a = index.get(e.s), b = index.get(e.t); adj[a].set(b, e.w); adj[b].set(a, e.w); e.a = a; e.b = b; });
    keep.forEach(n => { n.str = 0; adj[n.i].forEach(v => { n.str += v; }); });
    return { scope, view, nodes: keep, edges, adj, roster: roster.length, pubsIn, partial };
  }

  // ================= MEASURES =================
  function components(g) {
    const comp = new Array(g.nodes.length).fill(-1), sizes = [];
    g.nodes.forEach((n, s) => {
      if (comp[s] >= 0 || !g.adj[s].size) return;
      const q = [s]; comp[s] = sizes.length; let k = 0;
      while (q.length) { const v = q.pop(); k++; g.adj[v].forEach((_, u) => { if (comp[u] < 0) { comp[u] = sizes.length; q.push(u); } }); }
      sizes.push(k);
    });
    return { comp, sizes: sizes.sort((a, b) => b - a) };
  }
  function clustering(g) {
    let sum = 0, cnt = 0, tri = 0, trip = 0;
    g.adj.forEach((nb, v) => {
      const k = nb.size; if (k < 2) return;
      const arr = [...nb.keys()]; let t = 0;
      for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (g.adj[arr[i]].has(arr[j])) t++;
      sum += t / (k * (k - 1) / 2); cnt++; tri += t; trip += k * (k - 1) / 2;
    });
    return { avg: cnt ? sum / cnt : 0, global: trip ? tri / trip : 0 };
  }
  function betweenness(g) {
    const n = g.nodes.length, cb = new Float64Array(n);
    for (let s = 0; s < n; s++) {
      if (!g.adj[s].size) continue;
      const st = [], P = Array.from({ length: n }, () => []), sigma = new Float64Array(n), d = new Int32Array(n).fill(-1);
      sigma[s] = 1; d[s] = 0; const q = [s]; let h = 0;
      while (h < q.length) {
        const v = q[h++]; st.push(v);
        g.adj[v].forEach((_, w) => {
          if (d[w] < 0) { d[w] = d[v] + 1; q.push(w); }
          if (d[w] === d[v] + 1) { sigma[w] += sigma[v]; P[w].push(v); }
        });
      }
      const delta = new Float64Array(n);
      while (st.length) { const w = st.pop(); P[w].forEach(v => { delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]); }); if (w !== s) cb[w] += delta[w]; }
    }
    const norm = n > 2 ? (n - 1) * (n - 2) : 1;
    return Array.from(cb, x => x / norm); // undirected: (x/2) / ((n-1)(n-2)/2)
  }
  function eigenvector(g) {
    const n = g.nodes.length; let x = new Float64Array(n).fill(1);
    for (let it = 0; it < 100; it++) {
      const y = new Float64Array(n);
      for (let v = 0; v < n; v++) { let s = x[v]; g.adj[v].forEach((w, u) => { if (u !== v) s += x[u]; }); y[v] = s; }
      let m = 0; for (let v = 0; v < n; v++) m = Math.max(m, y[v]);
      if (!m) break; for (let v = 0; v < n; v++) y[v] /= m; x = y;
    }
    return Array.from(x, (v, i) => (g.adj[i].size ? v : 0));
  }
  // Louvain community detection (weighted, undirected), deterministic node order.
  function louvain(g) {
    const N = g.nodes.length;
    let adj = g.adj.map(m => new Map(m));
    let member = Array.from({ length: N }, (_, i) => i); // original node -> current super node
    let m2 = 0; adj.forEach(m => m.forEach(w => { m2 += w; }));
    if (!m2) return { comm: new Array(N).fill(-1), q: 0, count: 0 };
    for (let level = 0; level < 20; level++) {
      const n = adj.length, k = new Float64Array(n), self = new Float64Array(n);
      adj.forEach((m, v) => m.forEach((w, u) => { k[v] += w; if (u === v) self[v] += w; }));
      const comm = Array.from({ length: n }, (_, i) => i), tot = Float64Array.from(k);
      let moved = true, any = false, passes = 0;
      while (moved && passes++ < 50) {
        moved = false;
        for (let v = 0; v < n; v++) {
          const cv = comm[v], links = new Map();
          adj[v].forEach((w, u) => { if (u !== v) links.set(comm[u], (links.get(comm[u]) || 0) + w); });
          tot[cv] -= k[v];
          let best = cv, gain = (links.get(cv) || 0) - tot[cv] * k[v] / m2;
          links.forEach((wc, c) => { const gn = wc - tot[c] * k[v] / m2; if (gn > gain + 1e-12) { gain = gn; best = c; } });
          tot[best] += k[v];
          if (best !== cv) { comm[v] = best; moved = true; any = true; }
        }
      }
      if (!any) break;
      const ids = new Map(); comm.forEach(c => { if (!ids.has(c)) ids.set(c, ids.size); });
      const nadj = Array.from({ length: ids.size }, () => new Map());
      adj.forEach((m, v) => m.forEach((w, u) => { const a = ids.get(comm[v]), b = ids.get(comm[u]); nadj[a].set(b, (nadj[a].get(b) || 0) + w); }));
      member = member.map(s => ids.get(comm[s]));
      adj = nadj;
    }
    // Modularity on the original graph
    const tot = new Map(), inn = new Map();
    g.adj.forEach((m, v) => m.forEach((w, u) => {
      const c = member[v]; tot.set(c, (tot.get(c) || 0) + w);
      if (member[u] === c) inn.set(c, (inn.get(c) || 0) + w);
    }));
    let q = 0; tot.forEach((t, c) => { q += (inn.get(c) || 0) / m2 - Math.pow(t / m2, 2); });
    // Number communities by size (largest first); isolates get -1.
    const size = new Map(); member.forEach((c, v) => { if (g.adj[v].size) size.set(c, (size.get(c) || 0) + 1); });
    const order = [...size.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    const rank = new Map(order.map((c, i) => [c, i]));
    return { comm: member.map((c, v) => (g.adj[v].size ? rank.get(c) : -1)), q, count: [...size.values()].filter(s => s >= 3).length, sizes: order.map(c => size.get(c)) };
  }
  function measures(g, full) {
    const nodes = g.nodes, n = nodes.length, E = g.edges.length;
    const connected = nodes.filter(x => x.deg > 0);
    const inds = connected.filter(x => x.kind === 'p');
    const nc = connected.length;
    const cc = components(g);
    const cl = clustering(g);
    const lv = louvain(g);
    const degs = connected.map(x => x.deg), dmax = Math.max(0, ...degs);
    const cent = nc > 2 ? degs.reduce((s, d) => s + (dmax - d), 0) / ((nc - 1) * (nc - 2)) : 0;
    let extTies = 0, ownTies = 0, cross = 0;
    g.edges.forEach(e => {
      const a = nodes[e.a], b = nodes[e.b];
      if (a.kind === 'p' && b.kind === 'p') { ownTies++; if (a.c !== b.c) cross++; } else extTies++;
    });
    const m = {
      roster: g.roster, withTies: inds.length, ties: E, ownTies, extTies, cross,
      outside: connected.filter(x => x.kind !== 'p').length,
      avgDeg: inds.length ? inds.reduce((s, x) => s + x.deg, 0) / inds.length : 0,
      density: nc > 1 ? (2 * E) / (nc * (nc - 1)) : 0,
      comps: cc.sizes.length, largest: cc.sizes[0] || 0, largestShare: nc ? (cc.sizes[0] || 0) / nc : 0,
      clustering: cl.avg, transitivity: cl.global, communities: lv.count, modularity: lv.q, centralization: cent,
      pubs: g.pubsIn, partial: g.partial, connected: nc,
    };
    if (full) { m.comm = lv.comm; m.btw = betweenness(g); m.eig = eigenvector(g); m.comp = cc.comp; m.commSizes = lv.sizes; }
    return m;
  }

  // ================= UI =================
  function seg(el, value, onPick) {
    el.querySelectorAll('button').forEach(b => {
      b.setAttribute('aria-checked', b.dataset.v === value ? 'true' : 'false');
      b.onclick = () => { el.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false')); onPick(b.dataset.v); };
    });
  }
  function boot() {
    const ys = C.pubs.map(p => p[1]).filter(y => y);
    C.minY = Math.min(...ys); C.maxY = Math.max(...ys);
    S.from = C.minY; S.to = C.maxY;
    const yopts = []; for (let y = C.maxY; y >= C.minY; y--) yopts.push(y);
    $('#co-from').innerHTML = yopts.slice().reverse().map(y => `<option${y === S.from ? ' selected' : ''}>${y}</option>`).join('');
    $('#co-to').innerHTML = yopts.map(y => `<option${y === S.to ? ' selected' : ''}>${y}</option>`).join('');
    $('#co-scope').innerHTML = ['ALL'].concat(CODES).map(c => `<button type="button" role="radio" data-v="${c}">${c === 'ALL' ? '' : `<span class="co-dot" style="background:${COLORS[c]}"></span>`}${NAME[c]}${c === 'ALL' ? ' (all four)' : ''}</button>`).join('');
    seg($('#co-scope'), S.scope, v => { S.scope = v; S.sel = null; render(); });
    seg($('#co-view'), S.view, v => { S.view = v; S.sel = null; render(); });
    seg($('#co-col'), S.col, v => { S.col = v; draw(); legend(); });
    seg($('#co-rank'), S.rank, v => { S.rank = v; topTable(); });
    $('#co-from').onchange = e => { S.from = +e.target.value; if (S.from > S.to) { S.to = S.from; $('#co-to').value = S.to; } render(); };
    $('#co-to').onchange = e => { S.to = +e.target.value; if (S.to < S.from) { S.from = S.to; $('#co-from').value = S.from; } render(); };
    $('#co-min').onchange = e => { S.min = +e.target.value; render(); };
    $('#co-iso').onchange = e => { S.iso = e.target.checked; render(); };
    $('#co-search').onchange = e => {
      const v = e.target.value.trim().toLowerCase();
      const n = G && G.nodes.find(x => x.name.toLowerCase() === v) || G && G.nodes.find(x => x.name.toLowerCase().includes(v));
      if (n) select(n.i, true);
    };
    setupCanvas();
    render();
  }

  function render() {
    G = buildGraph(S.scope, S.view, { iso: S.iso });
    G.m = measures(G, true);
    kpis(); legend(); layout(); side(); topTable(); compare(); crossCountry(); methods();
    $('#co-names').innerHTML = G.nodes.filter(n => n.kind === 'p').map(n => `<option value="${esc(n.name)}">`).join('');
  }

  function kpis() {
    const m = G.m, ext = S.view === 'ext';
    const yrs = S.from === C.minY && S.to === C.maxY ? 'all years' : `${S.from}–${S.to}`;
    $('#co-kpi-sub').textContent = `${NAME[S.scope]}${S.scope === 'ALL' ? ' network of Fiji, Tonga, Solomon Islands and Vanuatu' : ' network'} · ${ext ? 'Indigenous scholars and their outside co-authors' : 'Indigenous scholars only'} · ${yrs} · ${fmt(m.pubs)} publications with at least one scholar from this network.`;
    const tiles = [
      ['Scholars with co-author ties', fmt(m.withTies), `of ${fmt(m.roster)} scholars (${pct(m.withTies, m.roster)})`],
      ['Co-author ties', fmt(m.ties), ext ? `${fmt(m.ownTies)} between scholars, ${fmt(m.extTies)} with outside co-authors` : 'pairs who published together'],
      ['Average co-authors', dec(m.avgDeg, 1), 'per scholar with ties'],
      ['Density', dec(m.density, 4), 'share of possible ties present'],
      ['Separate groups', fmt(m.comps), `largest has ${fmt(m.largest)} people (${pct(m.largest, m.connected)})`],
      ['Clustering', dec(m.clustering, 2), 'how often co-authors also work together'],
      ['Research groups', fmt(m.communities), `groups of 3 or more · modularity ${dec(m.modularity, 2)}`],
      ['Centralization', dec(m.centralization, 3), 'how far ties gather on a few people'],
    ];
    if (ext) tiles.push(['Outside co-authors', fmt(m.outside), `${pct(m.extTies, m.ties)} of all ties`]);
    if (S.scope === 'ALL') tiles.push(['Ties across countries', fmt(m.cross), 'pairs of scholars from different countries']);
    $('#co-kpis').innerHTML = tiles.map(t => `<div class="co-kpi"><dt>${t[0]}</dt><dd>${t[1]}</dd><small>${t[2]}</small></div>`).join('');
    const cov = $('#co-cover');
    if (ext && m.partial) {
      cov.hidden = false;
      cov.textContent = `Outside co-authors are incomplete for this network: ${fmt(m.partial)} of ${fmt(m.pubs)} publications (${pct(m.partial, m.pubs)}) list only the lead author in the Master file, mostly in the Fiji and Tonga databases. Their other outside co-authors are not shown.`;
    } else cov.hidden = true;
  }

  function nodeColor(n) {
    if (S.col === 'comm') { const c = G.m.comm[n.i]; return c >= 0 && c < COMM.length && (G.m.commSizes[c] || 0) >= 3 ? COMM[c] : '#b8c2cc'; }
    if (n.kind === 'x') return OUT;
    return COLORS[n.c] || OUT;
  }
  function legend() {
    const el = $('#co-legend');
    if (S.col === 'comm') {
      const sizes = (G.m.commSizes || []).filter(s => s >= 3);
      el.innerHTML = '<b>Research groups (largest first)</b>' + sizes.slice(0, COMM.length).map((s, i) => `<span><i style="background:${COMM[i]}"></i>Group ${i + 1} · ${s} people</span>`).join('') + (sizes.length > COMM.length ? `<span><i style="background:#b8c2cc"></i>Smaller groups</span>` : '');
      return;
    }
    const cs = S.scope === 'ALL' ? CODES : (S.view === 'ext' ? CODES : [S.scope]);
    el.innerHTML = cs.filter(c => G.nodes.some(n => n.kind !== 'x' && n.c === c)).map(c => `<span><i style="background:${COLORS[c]}"></i>${PEOPLE[c]} scholar${S.scope !== 'ALL' && c !== S.scope ? ' (other database)' : ''}</span>`).join('') +
      (S.view === 'ext' ? `<span><i style="background:${OUT}"></i>Outside co-author</span>` : '');
  }

  // ---------- Canvas network ----------
  let cv, ctx, W = 0, H = 0, tf = { k: 1, x: 0, y: 0 }, hover = -1, dragN = null, panning = null;
  function setupCanvas() {
    cv = $('#co-cv'); ctx = cv.getContext('2d');
    const resize = () => { const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1; W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); draw(); };
    new ResizeObserver(resize).observe(cv); resize();
    const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left - tf.x) / tf.k, (e.clientY - r.top - tf.y) / tf.k]; };
    const find = e => { const [x, y] = pt(e); let best = -1, bd = Infinity; G.nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.y - y); if (d < Math.max(rad(n) + 3, 6 / tf.k) && d < bd) { bd = d; best = i; } }); return best; };
    cv.addEventListener('mousemove', e => {
      if (dragN) { const [x, y] = pt(e); dragN.fx = x; dragN.fy = y; dragN.moved = true; sim.alphaTarget(0.2).restart(); return; }
      if (panning) { tf.x = panning.tx + e.clientX - panning.x; tf.y = panning.ty + e.clientY - panning.y; draw(); return; }
      const h = find(e); if (h !== hover) { hover = h; draw(); }
      const tip = $('#co-tip');
      if (h >= 0) { const n = G.nodes[h]; tip.hidden = false; tip.innerHTML = `<b>${esc(n.name)}</b><br>${n.kind === 'x' ? 'Outside co-author' : esc(NAME[n.c])} · ${n.deg} co-author${n.deg === 1 ? '' : 's'} · ${n.str} joint publication${n.str === 1 ? '' : 's'}`; const r = cv.getBoundingClientRect(); tip.style.left = Math.min(e.clientX - r.left + 14, W - 270) + 'px'; tip.style.top = (e.clientY - r.top + 12) + 'px'; }
      else tip.hidden = true;
    });
    cv.addEventListener('mouseleave', () => { $('#co-tip').hidden = true; hover = -1; draw(); });
    cv.addEventListener('mousedown', e => {
      const h = find(e);
      if (h >= 0) { dragN = G.nodes[h]; dragN.moved = false; const [x, y] = pt(e); dragN.fx = x; dragN.fy = y; }
      else panning = { x: e.clientX, y: e.clientY, tx: tf.x, ty: tf.y, moved: false };
    });
    window.addEventListener('mouseup', e => {
      if (dragN) { const n = dragN; dragN = null; sim.alphaTarget(0); if (!n.moved) { n.fx = n.fy = null; select(n.i); } }
      else if (panning) { const moved = Math.hypot(e.clientX - panning.x, e.clientY - panning.y) > 3; panning = null; if (!moved && e.target === cv) { S.sel = null; side(); draw(); } }
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    $('#co-zin').onclick = () => zoomAt(W / 2, H / 2, 1.3);
    $('#co-zout').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.3);
    $('#co-zfit').onclick = fit;
  }
  function zoomAt(px, py, f) { const k = Math.max(0.1, Math.min(8, tf.k * f)); tf.x = px - (px - tf.x) * (k / tf.k); tf.y = py - (py - tf.y) * (k / tf.k); tf.k = k; draw(); }
  function fit() {
    const ns = G.nodes; if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ns.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
    const k = Math.min(4, 0.92 * Math.min(W / Math.max(1, x1 - x0 + 40), H / Math.max(1, y1 - y0 + 40)));
    tf.k = k; tf.x = W / 2 - k * (x0 + x1) / 2; tf.y = H / 2 - k * (y0 + y1) / 2; draw();
  }
  const rad = n => (n.kind === 'x' ? 2 + Math.sqrt(n.deg) * 0.9 : 3.2 + Math.sqrt(n.deg) * 1.9);
  function layout() {
    if (sim) sim.stop();
    const ns = G.nodes, links = G.edges.map(e => ({ source: e.a, target: e.b, w: e.w }));
    if (!ns.length) { draw(); return; }
    ns.forEach((n, i) => { const a = i * 2.39996, r = 8 * Math.sqrt(i + 1); n.x = Math.cos(a) * r; n.y = Math.sin(a) * r; n.vx = n.vy = 0; n.fx = n.fy = null; });
    sim = d3.forceSimulation(ns)
      .force('link', d3.forceLink(links).distance(l => 22 + 10 / l.w).strength(l => Math.min(1, 0.25 + 0.15 * l.w)))
      .force('charge', d3.forceManyBody().strength(n => (n.deg ? -26 - n.deg * 1.5 : -6)).distanceMax(360))
      .force('x', d3.forceX(0).strength(0.045)).force('y', d3.forceY(0).strength(0.06))
      .force('collide', d3.forceCollide(n => rad(n) + 1.5))
      .alphaDecay(0.035);
    sim.stop();
    for (let i = 0; i < 260; i++) sim.tick();
    fit();
    sim.on('tick', draw);
  }
  function draw() {
    if (!ctx || !G) return;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    if (!G.nodes.length) { ctx.fillStyle = '#000'; ctx.font = '15px Arial'; ctx.textAlign = 'center'; ctx.fillText('No co-author ties for these settings.', W / 2, H / 2); ctx.restore(); return; }
    ctx.translate(tf.x, tf.y); ctx.scale(tf.k, tf.k);
    const sel = S.sel, nb = sel != null ? G.adj[sel] : null;
    const on = i => sel == null || i === sel || nb.has(i);
    G.edges.forEach(e => {
      const a = G.nodes[e.a], b = G.nodes[e.b], hi = sel != null && (e.a === sel || e.b === sel);
      ctx.strokeStyle = hi ? 'rgba(7,36,67,.75)' : sel != null ? 'rgba(120,135,150,.08)' : 'rgba(80,95,115,.28)';
      ctx.lineWidth = (hi ? 1.2 : 0.6) * Math.min(4, Math.sqrt(e.w)) / tf.k * Math.min(tf.k, 1.6);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    G.nodes.forEach((n, i) => {
      ctx.globalAlpha = on(i) ? 1 : 0.15;
      ctx.beginPath(); ctx.arc(n.x, n.y, rad(n), 0, Math.PI * 2); ctx.fillStyle = nodeColor(n); ctx.fill();
      ctx.lineWidth = (i === sel || i === hover ? 2.2 : 0.8) / tf.k; ctx.strokeStyle = i === sel || i === hover ? '#000' : '#fff'; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // Labels: the most connected scholars, plus the selected scholar and co-authors.
    const top = G.nodes.filter(n => n.kind === 'p').sort((a, b) => b.deg - a.deg).slice(0, Math.round(8 + tf.k * 6)).map(n => n.i);
    const lab = new Set(sel != null ? [sel, ...[...nb.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.round(14 + tf.k * 8)).map(x => x[0])] : top);
    if (hover >= 0) lab.add(hover);
    ctx.font = `${12 / tf.k}px Arial`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    // Draw in priority order and skip any label that would overlap one already drawn.
    const boxes = [], fs = 12 / tf.k;
    const order = [...lab].sort((a, b) => (b === sel) - (a === sel) || (b === hover) - (a === hover) || G.nodes[b].deg - G.nodes[a].deg);
    order.forEach(i => {
      const n = G.nodes[i]; if (!n || !on(i)) return;
      const y = n.y - rad(n) - 4 / tf.k, w = ctx.measureText(n.name).width + 4 / tf.k;
      const bx = [n.x - w / 2, y - fs, n.x + w / 2, y + 2 / tf.k];
      if (i !== sel && i !== hover && boxes.some(b => bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1])) return;
      boxes.push(bx);
      ctx.lineWidth = 3 / tf.k; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(n.name, n.x, y);
      ctx.fillStyle = '#000'; ctx.fillText(n.name, n.x, y);
    });
    ctx.restore();
  }

  // ---------- Selection panel ----------
  function rankOf(arr, i) { const v = arr[i]; return 1 + G.nodes.reduce((s, n, j) => s + (n.kind === 'p' && arr[j] > v ? 1 : 0), 0); }
  function select(i, center) {
    S.sel = i; side(); draw();
    if (center) { const n = G.nodes[i]; tf.k = Math.max(tf.k, 1.6); tf.x = W / 2 - n.x * tf.k; tf.y = H / 2 - n.y * tf.k; draw(); }
  }
  function side() {
    const el = $('#co-side');
    if (S.sel == null || !G.nodes[S.sel]) { el.innerHTML = '<p class="co-side__hint">Click a circle to see the scholar\'s co-authors and shared publications. Circle size shows the number of co-authors. Drag a circle to move it, drag the background to pan, and scroll to zoom.</p>'; return; }
    const n = G.nodes[S.sel], m = G.m;
    const nbs = [...G.adj[S.sel].entries()].sort((a, b) => b[1] - a[1] || G.nodes[a[0]].name.localeCompare(G.nodes[b[0]].name));
    const pubs = n.pubs.filter((pi, k, arr) => arr.indexOf(pi) === k).map(pi => C.pubs[pi]).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const g = m.comm[S.sel];
    el.innerHTML = `<h3>${esc(n.name)}</h3><p class="co-meta">${n.kind === 'x' ? 'Outside co-author' : `${esc(PEOPLE[n.c])} scholar · ${esc(NAME[n.c])} database`}${g >= 0 && (m.commSizes[g] || 0) >= 3 ? ` · Research group ${g + 1}` : ''}</p>
      <div class="co-stats"><div><b>${n.deg}</b>co-authors</div><div><b>${n.str}</b>joint publications</div>
      ${n.kind === 'p' ? `<div><b>#${rankOf(m.btw, S.sel)}</b>for bridging</div><div><b>#${rankOf(m.eig, S.sel)}</b>for influence</div>` : ''}</div>
      <h4>Co-authors</h4><ul>${nbs.map(([j, w]) => { const o = G.nodes[j]; return `<li><button type="button" data-i="${j}">${esc(o.name)}</button> · ${o.kind === 'x' ? 'outside' : esc(NAME[o.c])} · ${w} publication${w === 1 ? '' : 's'}</li>`; }).join('') || '<li>None for these settings.</li>'}</ul>
      <h4>Publications in this network (${pubs.length})</h4><ul>${pubs.slice(0, 60).map(p => `<li class="co-pub"><em>${p[1] || 'n.d.'}</em> · ${esc(p[2])} <span>(${esc(TYPE[p[0]] || '')})</span></li>`).join('')}${pubs.length > 60 ? `<li>…and ${pubs.length - 60} more</li>` : ''}</ul>`;
    el.querySelectorAll('button[data-i]').forEach(b => { b.onclick = () => select(+b.dataset.i, true); });
  }

  // ---------- Tables ----------
  function topTable() {
    const m = G.m, key = S.rank;
    const val = (n) => key === 'deg' ? n.deg : key === 'str' ? n.str : key === 'btw' ? m.btw[n.i] : m.eig[n.i];
    const rows = G.nodes.filter(n => n.kind === 'p' && n.deg > 0).sort((a, b) => val(b) - val(a) || b.deg - a.deg).slice(0, 15);
    $('#co-top').innerHTML = `<thead><tr><th class="n">#</th><th>Scholar</th><th>Database</th><th class="n">Co-authors</th><th class="n">Joint publications</th><th class="n">Bridging</th><th class="n">Influence</th><th class="n">Research group</th></tr></thead><tbody>` +
      rows.map((n, k) => `<tr><td class="n">${k + 1}</td><td><button type="button" class="co-name" data-i="${n.i}">${esc(n.name)}</button></td><td><span class="co-flag" style="background:${COLORS[n.c]}"></span>${esc(NAME[n.c])}</td><td class="n">${n.deg}</td><td class="n">${n.str}</td><td class="n">${dec(m.btw[n.i], 4)}</td><td class="n">${dec(m.eig[n.i], 3)}</td><td class="n">${m.comm[n.i] >= 0 && (m.commSizes[m.comm[n.i]] || 0) >= 3 ? m.comm[n.i] + 1 : '—'}</td></tr>`).join('') + '</tbody>';
    $('#co-top').querySelectorAll('button[data-i]').forEach(b => { b.onclick = () => { select(+b.dataset.i, true); $('#co-net-title').scrollIntoView({ behavior: 'smooth' }); }; });
    const ex = $('#co-extop');
    if (S.view === 'ext') {
      const xs = G.nodes.filter(n => n.kind !== 'p').map(n => ({ n, k: [...G.adj[n.i].keys()].filter(j => G.nodes[j].kind === 'p').length })).sort((a, b) => b.k - a.k || b.n.str - a.n.str).slice(0, 12);
      ex.innerHTML = `<h3>Outside co-authors who work with the most scholars</h3><table class="co-table"><thead><tr><th>Co-author</th><th class="n">Scholars worked with</th><th class="n">Joint publications</th></tr></thead><tbody>${xs.map(x => `<tr><td><button type="button" class="co-name" data-i="${x.n.i}">${esc(x.n.name)}</button>${x.n.kind === 'o' ? ` (${esc(NAME[x.n.c])} database)` : ''}</td><td class="n">${x.k}</td><td class="n">${x.n.str}</td></tr>`).join('')}</tbody></table>`;
      ex.querySelectorAll('button[data-i]').forEach(b => { b.onclick = () => { select(+b.dataset.i, true); $('#co-net-title').scrollIntoView({ behavior: 'smooth' }); }; });
    } else ex.innerHTML = '';
  }
  function compare() {
    const ext = S.view === 'ext';
    const yrs = S.from === C.minY && S.to === C.maxY ? 'all years' : `${S.from}–${S.to}`;
    $('#co-cmp-sub').textContent = `Each country's network on its own, and all four combined, with the same settings (${ext ? 'with outside co-authors' : 'Indigenous scholars only'}, ${yrs}, ties of at least ${S.min} shared publication${S.min === 1 ? '' : 's'}).`;
    const rows = CODES.concat('ALL').map(c => { const g = buildGraph(c, S.view, {}); return [c, measures(g, false)]; });
    const cols = [
      ['Scholars', m => fmt(m.roster)], ['With ties', m => `${fmt(m.withTies)} (${pct(m.withTies, m.roster)})`], ['Ties', m => fmt(m.ties)],
      ['Avg co-authors', m => dec(m.avgDeg, 1)], ['Density', m => dec(m.density, 4)], ['Groups', m => fmt(m.comps)], ['Largest group', m => `${fmt(m.largest)} (${pct(m.largest, m.connected)})`],
      ['Clustering', m => dec(m.clustering, 2)], ['Research groups', m => fmt(m.communities)], ['Modularity', m => dec(m.modularity, 2)], ['Centralization', m => dec(m.centralization, 3)],
    ];
    if (ext) cols.push(['Outside co-authors', m => fmt(m.outside)], ['Ties outside', m => pct(m.extTies, m.ties)], ['Lead author only', m => pct(m.partial, m.pubs)]);
    cols.push(['Ties across countries', (m, c) => (c === 'ALL' ? fmt(m.cross) : '—')]);
    $('#co-cmp').innerHTML = `<thead><tr><th>Network</th>${cols.map(c => `<th class="n">${c[0]}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(([c, m]) => `<tr class="${c === 'ALL' ? 'is-all' : ''}"><td>${c === 'ALL' ? 'All four combined' : `<span class="co-flag" style="background:${COLORS[c]}"></span>${NAME[c]}`}</td>${cols.map(col => `<td class="n">${col[1](m, c)}</td>`).join('')}</tr>`).join('') + '</tbody>';
  }
  function crossCountry() {
    const g = buildGraph('ALL', 'ind', {});
    const M = {}; CODES.forEach(a => { M[a] = {}; CODES.forEach(b => { M[a][b] = 0; }); });
    const pairs = [];
    g.edges.forEach(e => {
      const a = g.nodes[e.a], b = g.nodes[e.b]; M[a.c][b.c]++; if (a.c !== b.c) { M[b.c][a.c]++; pairs.push([a, b, e.w]); }
    });
    $('#co-x').innerHTML = `<thead><tr><th></th>${CODES.map(c => `<th class="n">${NAME[c]}</th>`).join('')}</tr></thead><tbody>` +
      CODES.map(a => `<tr><th><span class="co-flag" style="background:${COLORS[a]}"></span>${NAME[a]}</th>${CODES.map(b => `<td class="n${a === b ? ' is-diag' : ''}">${a === b ? M[a][b] : M[a][b] || '·'}</td>`).join('')}</tr>`).join('') + '</tbody>';
    pairs.sort((x, y) => y[2] - x[2] || x[0].name.localeCompare(y[0].name));
    $('#co-xlist').innerHTML = `<h3>Scholar pairs across countries (${pairs.length})</h3>` + (pairs.length ? `<ul>${pairs.map(([a, b, w]) => `<li>${esc(a.name)} (${NAME[a.c]}) and ${esc(b.name)} (${NAME[b.c]}) · ${w} publication${w === 1 ? '' : 's'}</li>`).join('')}</ul>` : '<p>None for these settings.</p>');
  }
  function methods() {
    const cov = C.coverage || {};
    const line = c => { const v = cov[c] || {}; return `<li><b>${NAME[c]}</b>: ${fmt(v.pubs || 0)} publications linked to scholars; ${fmt(v.partial || 0)} of them (${pct(v.partial || 0, v.pubs || 0)}) list only the lead author.</li>`; };
    $('#co-methods').innerHTML = `
      <p><b>Scholars.</b> The Indigenous scholars shown on the Regional dashboard directory for each database (same roster and public display rules). Fiji: iTaukei; Tonga: Tongan; Solomon Islands: Solomon Islander; Vanuatu: ni-Vanuatu.</p>
      <p><b>Publications.</b> The six main types used in the Regional counts: journal articles, book chapters, books, reports, and Master's and PhD theses. Conference papers, preprints and other outputs are left out. A publication held in more than one database is counted once (same DOI, or else same title and year), which is how ties across countries appear.</p>
      <p><b>Ties.</b> Two people are tied when they are authors on the same publication; the tie weight is the number of shared publications. Scholars are linked to publications through each database's checked authorship records. In the view with outside co-authors, the other names in the author list are added and matched across publications by family name and first initial, so two different people with the same family name and initial are merged. Ties are kept only when at least one person is a scholar from the chosen network; ties among outside co-authors alone are left out. In a single-country network, scholars from the other three databases count as outside co-authors.</p>
      <p><b>Outside co-author coverage.</b> Many Fiji and Tonga records hold only the lead author and an author count, so outside co-authors are incomplete there. Solomon Islands and Vanuatu records hold the full author list.</p><ul>${CODES.map(line).join('')}</ul>
      <p><b>Measures</b> (worked out on people with at least one tie):</p><ul>
      <li><b>Density</b>: ties present divided by all possible ties.</li>
      <li><b>Separate groups</b>: connected components; the largest group share is the share of connected people in the biggest one.</li>
      <li><b>Clustering</b>: average local clustering coefficient (how often two co-authors of a person have also published together).</li>
      <li><b>Research groups</b>: communities found with the Louvain method on tie weights; modularity shows how clearly the network splits into groups (above 0.3 is usually clear).</li>
      <li><b>Centralization</b>: Freeman degree centralization (0 = ties spread evenly, 1 = one person holds every tie).</li>
      <li><b>Bridging</b>: normalised betweenness centrality, the share of shortest paths between others that pass through the person.</li>
      <li><b>Influence</b>: eigenvector centrality on ties (each tie counted once, so one heavily shared pair does not dominate), scaled so the highest is 1; it is highest for people tied to other well-connected people, mostly within the largest group.</li></ul>
      <p>Data from the four country Master files, read at the last Regional rebuild${C.generated ? ` (${esc(new Date(C.generated).toLocaleString())})` : ''}.</p>`;
  }

  document.addEventListener('DOMContentLoaded', initGate);
})();
