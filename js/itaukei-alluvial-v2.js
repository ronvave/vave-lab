/* ==========================================================================
   iTaukei scholar mobility — alluvial v2
   Six-column layout: M-Region → M-Country → M-University → P-University →
   P-Country → P-Region. Every country is given its own colour; ribbons take
   the colour of the scholar's Master's country to make each origin traceable
   across the whole flow.
   ========================================================================== */

/* ------------------------- constants ---------------------------------- */

const REGION_COLORS = {
  "Oceania":  "#20808E",
  "Americas": "#8B2E3F",
  "Europe":   "#2C6DA8",
  "Asia":     "#E9AF34",
  "Africa":   "#848456"
};
// Seed colours reused from v1 so Fiji stays teal, Australia stays orange, etc.
const COUNTRY_COLOR_SEED = {
  "Fiji":            "#20808E",
  "Australia":       "#DA7101",
  "New Zealand":     "#D97BA0",
  "USA":             "#8B2E3F",
  "United Kingdom":  "#2C6DA8",
  "Malta":           "#7B4F8A",
  "Germany":         "#5591C7",
  "Japan":           "#E9AF34",
  "China":           "#C46B2B",
  // Extras — distinct hues for the countries that showed up in Ron's mockup
  "Papua New Guinea":"#37946E",
  "Italy":           "#B0413E",
  "Trinidad and Tobago": "#6C4A9C",
  "Solomon Islands": "#3D6E8C",
  "Vanuatu":         "#A56A2A",
  "Samoa":           "#4F7F5A",
  "Tonga":           "#9E4A6C",
  "Canada":          "#C24A4A",
  "France":          "#3A6BB0",
  "Netherlands":     "#D77400",
  "Ireland":         "#4F8C57",
  "Spain":           "#B85C1A",
  "Switzerland":     "#7A4A9C",
  "Sweden":          "#3D7BB0",
  "Norway":          "#7A5A9C",
  "Denmark":         "#B0413E"
};

const EMBEDDED_ISO3 = {
  "Fiji":"FJI","Australia":"AUS","New Zealand":"NZL","USA":"USA",
  "United States":"USA","United States of America":"USA",
  "United Kingdom":"GBR","UK":"GBR",
  "Malta":"MLT","Germany":"DEU","Japan":"JPN","China":"CHN",
  "Canada":"CAN","France":"FRA","Netherlands":"NLD","Sweden":"SWE",
  "Norway":"NOR","Denmark":"DNK","Ireland":"IRL","Spain":"ESP",
  "Italy":"ITA","Switzerland":"CHE","Papua New Guinea":"PNG",
  "Solomon Islands":"SLB","Vanuatu":"VUT","Samoa":"WSM","Tonga":"TON",
  "Trinidad and Tobago":"TTO"
};

const EMBEDDED_UNSD = {
  "Fiji":"Oceania","Australia":"Oceania","New Zealand":"Oceania",
  "USA":"Americas","United States":"Americas",
  "United Kingdom":"Europe","UK":"Europe","Malta":"Europe","Germany":"Europe",
  "Japan":"Asia","China":"Asia",
  "Papua New Guinea":"Oceania","Solomon Islands":"Oceania",
  "Vanuatu":"Oceania","Samoa":"Oceania","Tonga":"Oceania",
  "Canada":"Americas","France":"Europe","Netherlands":"Europe",
  "Sweden":"Europe","Norway":"Europe","Denmark":"Europe","Ireland":"Europe",
  "Spain":"Europe","Italy":"Europe","Switzerland":"Europe",
  "Trinidad and Tobago":"Americas"
};

const REGION_ORDER = ["Oceania","Americas","Europe","Asia","Africa"];
const NEUTRAL_TEXT = "#000000";
const COUNTRY_SHORT = { "New Zealand": "NZ", "United Kingdom": "UK" };

let currentUnsd = Object.assign({}, EMBEDDED_UNSD);
let currentIso3 = Object.assign({}, EMBEDDED_ISO3);
let currentCountryColor = Object.assign({}, COUNTRY_COLOR_SEED);

/* ------------------------- CSV parsing -------------------------------- */

function rowsFromCsv(csvText){
  return d3.csvParse(csvText, d => {
    const m_uni = (d.m_uni || "").trim();
    const p_uni = (d.p_uni || "").trim();
    const m_country = (d.m_country || "").trim();
    const p_country = (d.p_country || "").trim();
    if(!m_uni || !p_uni || !m_country || !p_country) return null;
    let scholar = (d.scholar || d.Scholar || "").trim();
    if(!scholar){
      const last  = (d.last  || d.Last  || "").trim();
      const first = (d.first || d.First || "").trim();
      if(last && first) scholar = last + ", " + first;
      else if(last)     scholar = last;
      else if(first)    scholar = first;
    }
    return {
      m_uni, m_country,
      m_region: (d.m_region || "").trim() || null,
      p_uni, p_country,
      p_region: (d.p_region || "").trim() || null,
      scholar:  scholar || null,
      m_year:   (d.m_year   || "").toString().trim() || null,
      p_year:   (d.p_year   || "").toString().trim() || null,
      m_title:  (d.m_title  || "").trim() || null,
      p_title:  (d.p_title  || "").trim() || null
    };
  });
}

function unsdMapFromCsv(csvText){
  const rows = d3.csvParse(csvText);
  const map = {};
  for(const r of rows){
    const country = (r["Country or Area"] || r.country || r.Country || "").trim();
    const region  = (r["Region Name"] || r.region || r.Region || "").trim();
    if(country && region) map[country] = region;
  }
  return map;
}

function iso3MapFromCsv(csvText){
  const rows = d3.csvParse(csvText);
  const map = {};
  for(const r of rows){
    const country = (r["Country or Area"] || r.country || r.Country || "").trim();
    const iso     = (r["ISO-alpha3 Code"] || r.iso3 || r.ISO3 || r["ISO-alpha3"] || "").trim();
    if(country && iso) map[country] = iso;
  }
  return map;
}

function resolveRegion(row, side){
  const embedded = side === "m" ? row.m_region : row.p_region;
  if(embedded) return normaliseRegion(embedded);
  const country  = side === "m" ? row.m_country : row.p_country;
  return normaliseRegion(currentUnsd[country] || "Other");
}
function normaliseRegion(r){
  if(!r) return "Other";
  const s = r.trim();
  if(/^oceania$/i.test(s) || /pacific/i.test(s)) return "Oceania";
  if(/^americas?$/i.test(s) || /north america|latin america|caribbean/i.test(s)) return "Americas";
  if(/^europe$/i.test(s)) return "Europe";
  if(/^asia$/i.test(s)) return "Asia";
  if(/^africa$/i.test(s)) return "Africa";
  return s;
}

function iso3(country){
  return currentIso3[country] || (country.length === 3 ? country.toUpperCase() : country.slice(0,3).toUpperCase());
}
function shortCountry(country){ return COUNTRY_SHORT[country] || country; }
function escapeHtmlA(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

/* ------------------------- country palette ---------------------------- */

// Distinct-hue fallback for countries not in the seed. Chosen to be visually
// separable from the seed colours above.
const FALLBACK_COUNTRY_PALETTE = [
  "#4E7C47","#8E5A2F","#3F6B87","#996B3D","#5A5A8B","#A85A78","#4A6B4F",
  "#7A4A2F","#3D5E7A","#8A3A5A","#5E7A3A","#4A6F6F","#7A4F5E","#3F5A3F",
  "#6B4A78","#8A5A3F","#4A5A6B","#7A5A47","#5A4A6B","#8A4A4A"
];
function colorForCountry(country){
  if(currentCountryColor[country]) return currentCountryColor[country];
  // Deterministic pick from fallback palette based on country name hash.
  let h = 0;
  for(let i=0; i<country.length; i++) h = (h * 31 + country.charCodeAt(i)) >>> 0;
  const c = FALLBACK_COUNTRY_PALETTE[h % FALLBACK_COUNTRY_PALETTE.length];
  currentCountryColor[country] = c;
  return c;
}

/* ------------------------- flow aggregation --------------------------- */

function buildFlows(rows){
  // Each row is one scholar. Group by full 6-tuple so identical paths merge
  // into a single ribbon whose count = number of scholars sharing that path.
  const key = r => [
    resolveRegion(r,"m"), r.m_country, r.m_uni,
    r.p_uni, r.p_country, resolveRegion(r,"p")
  ].join("|");
  const byKey = new Map();
  for(const r of rows){
    const k = key(r);
    if(!byKey.has(k)){
      byKey.set(k, {
        m_region:  resolveRegion(r,"m"),
        m_country: r.m_country,
        m_uni:     r.m_uni,
        p_uni:     r.p_uni,
        p_country: r.p_country,
        p_region:  resolveRegion(r,"p"),
        count: 0,
        scholars: []
      });
    }
    const f = byKey.get(k);
    f.count += 1;
    f.scholars.push({
      name: r.scholar || null,
      m_year: r.m_year, p_year: r.p_year,
      m_title: r.m_title, p_title: r.p_title
    });
  }
  return Array.from(byKey.values());
}

/* ------------------------- column layout ------------------------------ */

// Build the ordered list of unique items in one column, grouped by region/
// country as appropriate. Returns items in the sort order:
//   region → country (alpha within region) → uni (alpha within country)
function buildColumn(flows, kind, side){
  // kind: "region" | "country" | "uni"; side: "m" | "p"
  const regKey = side === "m" ? "m_region"  : "p_region";
  const ctrKey = side === "m" ? "m_country" : "p_country";
  const uniKey = side === "m" ? "m_uni"     : "p_uni";
  const buckets = new Map(); // region → country → uni → count
  for(const f of flows){
    const reg = f[regKey], ctr = f[ctrKey], uni = f[uniKey];
    if(!buckets.has(reg)) buckets.set(reg, new Map());
    const R = buckets.get(reg);
    if(kind === "region"){
      R._count = (R._count || 0) + f.count;
    } else {
      if(!R.has(ctr)) R.set(ctr, new Map());
      const C = R.get(ctr);
      if(kind === "country"){
        C._count = (C._count || 0) + f.count;
      } else {
        C.set(uni, (C.get(uni) || 0) + f.count);
      }
    }
  }
  // Emit in region order then alpha within
  const items = [];
  const regs = REGION_ORDER.filter(r => buckets.has(r))
    .concat([...buckets.keys()].filter(r => !REGION_ORDER.includes(r)).sort());
  for(const reg of regs){
    const R = buckets.get(reg);
    if(kind === "region"){
      items.push({ kind:"region", region:reg, country:null, uni:null, count:R._count||0, key:reg });
      continue;
    }
    const countries = [...R.keys()].filter(k => k !== "_count").sort();
    for(const ctr of countries){
      const C = R.get(ctr);
      if(kind === "country"){
        items.push({ kind:"country", region:reg, country:ctr, uni:null, count:C._count||0, key:reg+"|"+ctr });
        continue;
      }
      const unis = [...C.keys()].filter(k => k !== "_count").sort();
      for(const uni of unis){
        items.push({ kind:"uni", region:reg, country:ctr, uni, count:C.get(uni), key:reg+"|"+ctr+"|"+uni });
      }
    }
  }
  return items;
}

// Assign y-positions to each item in a column. Returns items decorated with
// {y0, y1} in plot coordinates, respecting per-row minimum, leaf/country/
// region gaps in pixels.
function layoutColumn(items, totalCount, plotTop, plotBottom, gaps){
  // Sum required gap between consecutive items.
  let gapSum = 0;
  for(let i=1; i<items.length; i++){
    const p = items[i-1], c = items[i];
    gapSum += gaps.leaf;
    if(p.kind !== "region" && p.country !== c.country) gapSum += gaps.country;
    if(p.region !== c.region) gapSum += gaps.region;
  }
  const plotH = plotBottom - plotTop;
  const unit = Math.max(0, (plotH - gapSum) / Math.max(1, totalCount));
  let y = plotTop;
  for(let i=0; i<items.length; i++){
    if(i > 0){
      const p = items[i-1], c = items[i];
      y += gaps.leaf;
      if(p.kind !== "region" && p.country !== c.country) y += gaps.country;
      if(p.region  !== c.region)  y += gaps.region;
    }
    const h = unit * items[i].count;
    items[i].y0 = y;
    items[i].y1 = y + h;
    y += h;
  }
  return { items, unit };
}

/* ------------------------- ribbon path -------------------------------- */

function ribbonPath(x0, y0Top, y0Bot, x1, y1Top, y1Bot){
  const mx = (x0 + x1) / 2;
  return "M" + x0 + "," + y0Top +
         "C" + mx + "," + y0Top + " " + mx + "," + y1Top + " " + x1 + "," + y1Top +
         "L" + x1 + "," + y1Bot +
         "C" + mx + "," + y1Bot + " " + mx + "," + y0Bot + " " + x0 + "," + y0Bot + "Z";
}

// Given a flow's total width `w`, split it across the ribbon endpoint on both
// columns. Each endpoint tracks its running "used" offset so ribbons stack
// inside the block without overlap.
function assignRibbonOffsets(flows, columns){
  // columns is an array [col0Items, col1Items, ...]. We need, for each flow,
  // the y0/y1 slice inside each of the 6 blocks it touches. Use maps keyed by
  // block key → {used, item}.
  const maps = columns.map(items => {
    const m = new Map();
    for(const it of items) m.set(it.key, { item: it, used: 0 });
    return m;
  });
  // Sort flows for stable stacking: by region-order then country then uni on
  // the left, so ribbons stack top-to-bottom consistently across columns.
  const regRank = r => {
    const i = REGION_ORDER.indexOf(r);
    return i === -1 ? 99 : i;
  };
  flows.sort((a,b) => {
    return regRank(a.m_region) - regRank(b.m_region)
      || a.m_country.localeCompare(b.m_country)
      || a.m_uni.localeCompare(b.m_uni)
      || regRank(a.p_region) - regRank(b.p_region)
      || a.p_country.localeCompare(b.p_country)
      || a.p_uni.localeCompare(b.p_uni);
  });

  // The 6 columns in order.
  const keyFor = (f, colIdx) => {
    switch(colIdx){
      case 0: return f.m_region;
      case 1: return f.m_region + "|" + f.m_country;
      case 2: return f.m_region + "|" + f.m_country + "|" + f.m_uni;
      case 3: return f.p_region + "|" + f.p_country + "|" + f.p_uni;
      case 4: return f.p_region + "|" + f.p_country;
      case 5: return f.p_region;
    }
  };

  for(const f of flows){
    f.slices = new Array(6);
    for(let ci=0; ci<6; ci++){
      const key = keyFor(f, ci);
      const entry = maps[ci].get(key);
      if(!entry){ f.slices[ci] = null; continue; }
      const item = entry.item;
      const height = item.y1 - item.y0;
      const totalCount = item.count;
      const w = (height / Math.max(1,totalCount)) * f.count;
      const yTop = item.y0 + entry.used;
      const yBot = yTop + w;
      entry.used += w;
      f.slices[ci] = { yTop, yBot };
    }
  }
}

/* ------------------------- geometry ----------------------------------- */

const COLUMN_LABELS = [
  "Master\u2019s Region", "Master\u2019s Country", "Master\u2019s University",
  "PhD University", "PhD Country", "PhD Region"
];

function makeGeom(viewH){
  const VIEW_W = 1600;
  const VIEW_H = viewH || 900;
  const plotTop = 118;
  const plotBottom = VIEW_H - 90;         // leaves room for side-totals text
  const BAR_W = 22;
  const gaps = { leaf: 1, country: 2, region: 5 };

  // Six evenly spaced columns. Reserve label margins on outer sides for the
  // Master's-uni / PhD-uni university text so long names don't clip.
  const outerMargin = 330;                 // label space on far left / far right
  const usableW = VIEW_W - outerMargin*2;
  const step = usableW / 5;                // 6 columns → 5 gaps
  const xs = [0,1,2,3,4,5].map(i => outerMargin + i*step);

  // Column widths (bar). Middle columns (uni columns) get labels between them,
  // so the inter-uni gap is where the ribbons dominate; other gaps are wide.
  return { VIEW_W, VIEW_H, plotTop, plotBottom, BAR_W, gaps, xs };
}

/* ------------------------- drawing ------------------------------------ */

function drawUnderlinedHeader(g, x, y, before, word, after, fontSize){
  // Renders " where iTaukei / scholars did / their Master's" style header with
  // "iTaukei" underlined. Simpler here: just centered plain text on 1 line.
  g.append("text")
    .attr("x", x).attr("y", y)
    .attr("text-anchor","middle")
    .attr("style", `font-family:var(--font-body); font-size:${fontSize}px; fill:#000; font-weight:600;`)
    .text(before + word + after);
}

function readableOn(hex){
  const h = hex.replace("#","");
  const r = parseInt(h.substr(0,2),16), g = parseInt(h.substr(2,2),16), b = parseInt(h.substr(4,2),16);
  const l = 0.2126*r + 0.7152*g + 0.0722*b;
  return l > 150 ? "#000" : "#fff";
}
function approxTextWidth(text, fs){ return text.length * fs * 0.55; }

function draw(flows){
  const svg = d3.select("#alluvial-chart");
  svg.selectAll("*").remove();

  // 1. Build the 6 columns of items
  const cols = [
    buildColumn(flows, "region",  "m"),
    buildColumn(flows, "country", "m"),
    buildColumn(flows, "uni",     "m"),
    buildColumn(flows, "uni",     "p"),
    buildColumn(flows, "country", "p"),
    buildColumn(flows, "region",  "p"),
  ];
  const totalCount = flows.reduce((s,f)=>s+f.count, 0);

  // 2. Determine dynamic VIEW_H so uni rows never fall below MIN_ROW_PX per
  //    scholar. Both uni columns matter for the min-height check.
  const MIN_ROW_PX = 14;
  const geomInit = makeGeom(900);
  const needForCol = (items) => {
    let gapSum = 0;
    for(let i=1; i<items.length; i++){
      const p = items[i-1], c = items[i];
      gapSum += geomInit.gaps.leaf;
      if(p.kind !== "region" && p.country !== c.country) gapSum += geomInit.gaps.country;
      if(p.region !== c.region) gapSum += geomInit.gaps.region;
    }
    return MIN_ROW_PX * totalCount + gapSum;
  };
  const requiredPlotH = Math.max(needForCol(cols[2]), needForCol(cols[3]));
  const requiredViewH = Math.ceil(requiredPlotH + 118 + 90);
  const viewH = Math.max(900, requiredViewH);
  svg.attr("viewBox", `0 0 1600 ${viewH}`);

  const geom = makeGeom(viewH);
  const { VIEW_W, VIEW_H, plotTop, plotBottom, BAR_W, gaps, xs } = geom;

  // 3. Layout each column vertically
  cols.forEach(items => layoutColumn(items, totalCount, plotTop, plotBottom, gaps));

  // 4. Assign per-flow y-slices inside each block
  assignRibbonOffsets(flows, cols);

  // 5. Draw ribbons — five segments per flow, all coloured by Master's country
  const gRib = svg.append("g").attr("class","ribbons");
  const gBlk = svg.append("g").attr("class","blocks");
  const gLab = svg.append("g").attr("class","labels");

  for(const f of flows){
    const color = colorForCountry(f.m_country);
    const tooltip = buildTooltipHtml(f);
    for(let ci=0; ci<5; ci++){
      const s0 = f.slices[ci], s1 = f.slices[ci+1];
      if(!s0 || !s1) continue;
      const x0 = xs[ci] + BAR_W;
      const x1 = xs[ci+1];
      const path = ribbonPath(x0, s0.yTop, s0.yBot, x1, s1.yTop, s1.yBot);
      gRib.append("path")
        .attr("class","ribbon")
        .attr("d", path)
        .attr("fill", color)
        .attr("opacity", 0.55)
        .attr("data-tip", tooltip)
        .attr("data-key", f.m_country + "->" + f.p_country);
    }
  }

  // 6. Draw blocks (bars) on each column
  cols.forEach((items, ci) => {
    const x0 = xs[ci];
    for(const it of items){
      let fill;
      if(it.kind === "region")       fill = REGION_COLORS[it.region] || "#666";
      else if(it.kind === "country") fill = colorForCountry(it.country);
      else                            fill = colorForCountry(it.country); // uni block = country colour
      gBlk.append("rect")
        .attr("x", x0).attr("y", it.y0)
        .attr("width", BAR_W).attr("height", Math.max(1, it.y1 - it.y0))
        .attr("fill", fill);
    }
  });

  // 7. Column labels (top)
  for(let ci=0; ci<6; ci++){
    const cx = xs[ci] + BAR_W/2;
    drawUnderlinedHeader(gLab, cx, plotTop - 60, "", COLUMN_LABELS[ci], "", 14);
  }
  // Master's / PhD side headers (bigger, above the column labels)
  const centerM = (xs[0] + xs[2] + BAR_W)/2;
  const centerP = (xs[3] + xs[5] + BAR_W)/2;
  gLab.append("text").attr("x", centerM).attr("y", plotTop - 88)
    .attr("text-anchor","middle")
    .attr("style","font-family:var(--font-body); font-size:18px; font-weight:700; fill:#000;")
    .text("Where iTaukei scholars did their Master\u2019s");
  gLab.append("text").attr("x", centerP).attr("y", plotTop - 88)
    .attr("text-anchor","middle")
    .attr("style","font-family:var(--font-body); font-size:18px; font-weight:700; fill:#000;")
    .text("Where iTaukei scholars did their PhD");

  // 8. Text labels for each block
  //    - Region blocks: rotated region name + count inside the bar
  //    - Country blocks: rotated short country + count inside the bar
  //    - Uni blocks: horizontal uni name outside (left of leftmost uni col,
  //                  right of rightmost uni col), with ISO3 tag inside
  cols.forEach((items, ci) => {
    const x0 = xs[ci];
    const isLeftSide = ci < 3;
    for(const it of items){
      const cy = (it.y0 + it.y1) / 2;
      const bH = it.y1 - it.y0;
      if(it.kind === "region"){
        const txt = it.region + " (" + it.count + ")";
        const fill = REGION_COLORS[it.region] || "#666";
        gLab.append("text")
          .attr("transform", `translate(${x0 + BAR_W/2}, ${cy}) rotate(-90)`)
          .attr("text-anchor","middle")
          .attr("dominant-baseline","central")
          .attr("style", `font-family:var(--font-body); font-size:11px; font-weight:700; fill:${readableOn(fill)};`)
          .text(txt);
      } else if(it.kind === "country"){
        const txt = shortCountry(it.country) + " (" + it.count + ")";
        const fill = colorForCountry(it.country);
        // Rotate if block is tall enough; else place ISO3 tag horizontally next to bar.
        if(bH >= approxTextWidth(txt, 10) + 4){
          gLab.append("text")
            .attr("transform", `translate(${x0 + BAR_W/2}, ${cy}) rotate(-90)`)
            .attr("text-anchor","middle").attr("dominant-baseline","central")
            .attr("style", `font-family:var(--font-body); font-size:10px; font-weight:700; fill:${readableOn(fill)};`)
            .text(txt);
        }
      } else {
        // University leaf
        const iso = iso3(it.country);
        const ctrColor = colorForCountry(it.country);
        // ISO3 tag inside the leaf bar (only if bar tall enough)
        if(bH >= 11){
          gLab.append("text")
            .attr("x", x0 + BAR_W/2).attr("y", cy)
            .attr("text-anchor","middle").attr("dominant-baseline","central")
            .attr("style", `font-family:var(--font-body); font-size:10px; font-weight:700; fill:${readableOn(ctrColor)};`)
            .text(iso);
        }
        // Uni name label on the outside
        const labelX = isLeftSide ? (x0 - 10) : (x0 + BAR_W + 10);
        const anchor = isLeftSide ? "end" : "start";
        gLab.append("text")
          .attr("x", labelX).attr("y", cy)
          .attr("text-anchor", anchor).attr("dominant-baseline","central")
          .attr("style", "font-family:var(--font-body); font-size:11px; font-weight:400; fill:#000;")
          .text(it.uni + " (" + it.count + ")");
      }
    }
  });

  // 9. Per-side distinct-count totals below the column stack
  const gTot = svg.append("g").attr("class","side-totals");
  const nRegM = cols[0].length, nCtrM = cols[1].length, nUniM = cols[2].length;
  const nUniP = cols[3].length, nCtrP = cols[4].length, nRegP = cols[5].length;
  const linesM = [
    nUniM + " " + (nUniM===1?"university":"universities"),
    nCtrM + " " + (nCtrM===1?"country":"countries"),
    nRegM + " " + (nRegM===1?"region":"regions"),
  ];
  const linesP = [
    nUniP + " " + (nUniP===1?"university":"universities"),
    nCtrP + " " + (nCtrP===1?"country":"countries"),
    nRegP + " " + (nRegP===1?"region":"regions"),
  ];
  function paintTot(cx, lines){
    for(let i=0; i<lines.length; i++){
      gTot.append("text")
        .attr("x", cx).attr("y", plotBottom + 22 + i*17)
        .attr("text-anchor","middle")
        .attr("style", "font-family:var(--font-body); font-size:13px; fill:#28251d; font-weight:500;")
        .text(lines[i]);
    }
  }
  paintTot(centerM, linesM);
  paintTot(centerP, linesP);

  // 10. Ribbon hover — dim others, show tooltip
  setupTooltips(svg);

  if(typeof window.__alluvialV2SyncExport === "function") window.__alluvialV2SyncExport();
}

function buildTooltipHtml(f){
  const scholars = f.scholars.map(s => {
    const parts = [];
    if(s.name) parts.push(escapeHtmlA(s.name));
    const yrs = [];
    if(s.m_year) yrs.push("M: " + escapeHtmlA(s.m_year));
    if(s.p_year) yrs.push("PhD: " + escapeHtmlA(s.p_year));
    if(yrs.length) parts.push("(" + yrs.join(", ") + ")");
    return parts.join(" ");
  }).filter(Boolean);
  return "<div style=\"font-weight:700;margin-bottom:4px;\">"
    + escapeHtmlA(f.m_uni) + " &rarr; " + escapeHtmlA(f.p_uni)
    + "</div><div style=\"margin-bottom:4px;color:#8a93a0;\">"
    + escapeHtmlA(f.m_country) + " (" + escapeHtmlA(f.m_region) + ") \u2192 "
    + escapeHtmlA(f.p_country) + " (" + escapeHtmlA(f.p_region) + ")"
    + "</div><div><strong>" + f.count + "</strong> scholar" + (f.count===1?"":"s") + "</div>"
    + (scholars.length ? "<ul style=\"margin:4px 0 0 0;padding-left:16px;\">"
        + scholars.map(s => "<li>" + s + "</li>").join("") + "</ul>" : "");
}

function setupTooltips(svg){
  const tip = document.getElementById("alluvial-tip");
  if(!tip) return;
  Object.assign(tip.style, {
    position:"fixed", background:"#ffffff", border:"1px solid #d4d1ca",
    borderRadius:"8px", padding:"8px 10px", fontSize:"12px",
    color:"#28251d", boxShadow:"0 4px 12px rgba(0,0,0,0.12)",
    pointerEvents:"none", zIndex:"9999", display:"none", maxWidth:"340px"
  });
  const ribs = svg.selectAll("path.ribbon");
  ribs.on("mouseenter", function(ev){
    const html = this.getAttribute("data-tip");
    tip.innerHTML = html;
    tip.style.display = "block";
    ribs.classed("dim", true);
    d3.select(this).classed("dim", false);
  }).on("mousemove", function(ev){
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if(x + w > window.innerWidth - 8)  x = ev.clientX - w - 14;
    if(y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }).on("mouseleave", function(){
    tip.style.display = "none";
    ribs.classed("dim", false);
  });
}

/* ------------------------- I/O plumbing ------------------------------- */

const statusEl = document.getElementById("alluvial-status");
const uploadMsg = document.getElementById("upload-msg");
function setMsg(text, kind){
  if(!uploadMsg) return;
  uploadMsg.textContent = text || "";
  uploadMsg.className = "upload-msg" + (kind ? " upload-msg--" + kind : "");
}

function refreshGeneratedStamp(label){
  const cap = document.getElementById("alluvial-cap");
  const gen = document.getElementById("alluvial-generated");
  const now = new Date();
  const opts = { weekday:"long", year:"numeric", month:"long", day:"numeric",
                 hour:"numeric", minute:"2-digit", timeZone:"Pacific/Honolulu" };
  const stamp = now.toLocaleString("en-US", opts) + " HST";
  const nSch = document.querySelector("path.ribbon") ? undefined : undefined; // placeholder
  if(cap){
    // Count total scholars via ribbons? Just use lastKnown from render.
    const n = window.__alluvialV2LastCount || 0;
    cap.textContent = "Source: iTaukei Research Database" + (n ? " (" + n + " scholars)" : "") + ".";
  }
  if(gen){
    gen.textContent = "Generated " + stamp + (label ? " \u00b7 " + label : "");
  }
}

function renderFromMobility(csvText, label){
  try{
    const rows = rowsFromCsv(csvText);
    if(!rows || rows.length === 0){
      setMsg("No scholar rows found.", "err");
      if(statusEl) statusEl.textContent = "No data.";
      return;
    }
    const flows = buildFlows(rows);
    window.__alluvialV2LastCount = rows.length;
    draw(flows);
    refreshGeneratedStamp(label);
    if(statusEl) statusEl.textContent = "";
    setMsg(label ? ("Chart updated from " + label + " (" + rows.length + " scholars).") : "", "ok");
  } catch(err){
    console.error(err);
    setMsg("Could not read this file. " + (err.message || err), "err");
  }
}

function validateMobility(csvText){
  const rows = rowsFromCsv(csvText);
  return rows && rows.length > 0;
}

function isExcel(file){
  return /\.xlsx?$/i.test(file.name);
}
function readTextFile(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Read failed"));
    r.readAsText(file);
  });
}
function readExcelAsCsv(file){
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      try{
        const wb = XLSX.read(new Uint8Array(r.result), { type:"array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_csv(ws));
      } catch(e){ reject(e); }
    };
    r.onerror = () => reject(new Error("Read failed"));
    r.readAsArrayBuffer(file);
  });
}
function readFile(file){ return isExcel(file) ? readExcelAsCsv(file) : readTextFile(file); }

const LS_MOBILITY_KEY  = "vavelab:alluvial2:mobility";
const LS_MOBILITY_NAME = "vavelab:alluvial2:mobility:name";
const LS_UNSD_KEY      = "vavelab:alluvial2:unsd";
const LS_UNSD_NAME     = "vavelab:alluvial2:unsd:name";

function saveMobility(csv, name){
  try{ localStorage.setItem(LS_MOBILITY_KEY, csv); localStorage.setItem(LS_MOBILITY_NAME, name); }catch(e){}
}
function saveUnsd(csv, name){
  try{ localStorage.setItem(LS_UNSD_KEY, csv); localStorage.setItem(LS_UNSD_NAME, name); }catch(e){}
}
function clearMobility(){ localStorage.removeItem(LS_MOBILITY_KEY); localStorage.removeItem(LS_MOBILITY_NAME); }
function clearUnsd(){ localStorage.removeItem(LS_UNSD_KEY); localStorage.removeItem(LS_UNSD_NAME); }

/* ------------------------- boot --------------------------------------- */

async function boot(){
  // Restore any previously uploaded UNSD file first (affects region resolution)
  try{
    const unsdCsv = localStorage.getItem(LS_UNSD_KEY);
    if(unsdCsv){
      currentUnsd = Object.assign({}, EMBEDDED_UNSD, unsdMapFromCsv(unsdCsv));
      currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso3MapFromCsv(unsdCsv));
      const nm = localStorage.getItem(LS_UNSD_NAME);
      const fEl = document.getElementById("file-unsd");
      if(fEl && nm) fEl.textContent = nm;
    }
  } catch(e){ console.warn("UNSD restore failed", e); }

  const stored = localStorage.getItem(LS_MOBILITY_KEY);
  if(stored){
    const nm = localStorage.getItem(LS_MOBILITY_NAME);
    const fEl = document.getElementById("file-mobility");
    if(fEl && nm) fEl.textContent = nm;
    renderFromMobility(stored, nm);
    return;
  }
  try{
    const resp = await fetch("itaukei-chord-data/mobility.csv");
    const txt = await resp.text();
    renderFromMobility(txt, "Default data");
  } catch(e){
    console.error("Could not load default mobility.csv", e);
    if(statusEl) statusEl.textContent = "Could not load default data.";
  }
}

/* ------------------------- uploader wiring ---------------------------- */

function wireDropzone(dzId, inputId, fileLabelId, onCsv){
  const dz = document.getElementById(dzId);
  const inp = document.getElementById(inputId);
  const fEl = document.getElementById(fileLabelId);
  if(!dz || !inp) return;
  const handle = async (file) => {
    if(!file) return;
    try{
      const csv = await readFile(file);
      if(fEl) fEl.textContent = file.name;
      onCsv(csv, file.name);
    } catch(err){
      setMsg("Could not read " + file.name + ": " + (err.message || err), "err");
    }
  };
  dz.addEventListener("click", () => inp.click());
  dz.addEventListener("keydown", (e) => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); inp.click(); } });
  inp.addEventListener("change", e => { if(e.target.files && e.target.files[0]) handle(e.target.files[0]); });
  ["dragover","dragenter"].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add("is-drag"); }));
  ["dragleave","drop"].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove("is-drag"); }));
  dz.addEventListener("drop", e => { if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handle(e.dataTransfer.files[0]); });
}

document.addEventListener("DOMContentLoaded", () => {
  wireDropzone("dz-mobility", "input-mobility", "file-mobility", (csv, name) => {
    if(!validateMobility(csv)){ setMsg("File loaded but no rows matched the expected columns.", "warn"); return; }
    saveMobility(csv, name);
    renderFromMobility(csv, name);
  });
  wireDropzone("dz-unsd", "input-unsd", "file-unsd", (csv, name) => {
    try{
      currentUnsd = Object.assign({}, EMBEDDED_UNSD, unsdMapFromCsv(csv));
      currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso3MapFromCsv(csv));
      saveUnsd(csv, name);
      // Re-render with the last mobility we have
      const m = localStorage.getItem(LS_MOBILITY_KEY);
      if(m) renderFromMobility(m, localStorage.getItem(LS_MOBILITY_NAME));
      setMsg("Region reference updated from " + name + ".", "ok");
    } catch(err){
      setMsg("Could not parse UNSD file: " + (err.message || err), "err");
    }
  });
  const btnReset = document.getElementById("btn-reset");
  if(btnReset){
    btnReset.addEventListener("click", async () => {
      clearMobility(); clearUnsd();
      currentUnsd = Object.assign({}, EMBEDDED_UNSD);
      currentIso3 = Object.assign({}, EMBEDDED_ISO3);
      document.getElementById("file-mobility").textContent = "";
      document.getElementById("file-unsd").textContent = "";
      const resp = await fetch("itaukei-chord-data/mobility.csv");
      renderFromMobility(await resp.text(), "Default data");
      setMsg("Reset to default data.", "ok");
    });
  }
  const btnTpl = document.getElementById("btn-template");
  if(btnTpl){
    btnTpl.addEventListener("click", (e) => {
      e.preventDefault();
      const csv = "scholar,m_uni,m_country,m_region,p_uni,p_country,p_region,m_year,p_year,m_title,p_title\n" +
                  "\"Doe, Jane\",University of the South Pacific,Fiji,Oceania,University of Queensland,Australia,Oceania,2015,2022,MA Thesis Title,PhD Dissertation Title\n";
      const blob = new Blob([csv], { type:"text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "itaukei-alluvial-template.csv";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // Expand button
  const expandBtn = document.getElementById("alluvial-expand");
  const wrap = document.getElementById("alluvial-wrap");
  if(expandBtn && wrap){
    const toggle = () => {
      const on = !wrap.classList.contains("is-fullscreen");
      wrap.classList.toggle("is-fullscreen", on);
      document.body.classList.toggle("alluvial-fs-on", on);
      expandBtn.textContent = on ? "Close \u2715" : "Expand \u21F1";
    };
    expandBtn.addEventListener("click", toggle);
    document.addEventListener("keydown", e => {
      if(e.key === "Escape" && wrap.classList.contains("is-fullscreen")) toggle();
    });
  }

  boot();
});

/* ------------------------- PNG download ------------------------------- */

(function(){
  const BASE_W = 1600;
  const wIn = document.getElementById("dl-width");
  const hIn = document.getElementById("dl-height");
  const dpiIn = document.getElementById("dl-dpi");
  const hint = document.getElementById("dl-hint");
  const btn = document.getElementById("dl-btn");
  if(!wIn||!hIn||!dpiIn||!btn) return;
  function currentAspect(){
    const svg = document.getElementById("alluvial-chart");
    if(!svg) return 900/BASE_W;
    const vb = (svg.getAttribute("viewBox") || "0 0 1600 900").trim().split(/\s+/);
    const w = parseFloat(vb[2]) || BASE_W;
    const h = parseFloat(vb[3]) || 900;
    return h / w;
  }
  const clampNum=(v,min,max,dflt)=>{ v=parseFloat(v); if(!isFinite(v)) v=dflt; return Math.min(max,Math.max(min,v)); };
  function outPixels(){
    const cssW=clampNum(wIn.value,200,20000,BASE_W);
    const cssH=clampNum(hIn.value,200,20000,Math.round(BASE_W*currentAspect()));
    const dpi=clampNum(dpiIn.value,72,1200,300);
    const scale=dpi/96;
    return {cssW,cssH,dpi,pxW:Math.round(cssW*scale),pxH:Math.round(cssH*scale)};
  }
  function refreshHint(){ const o=outPixels(); hint.innerHTML="Output: "+o.pxW+" &times; "+o.pxH+" px at "+o.dpi+" DPI"; }
  window.__alluvialV2SyncExport = function(){
    if(document.activeElement === hIn) return;
    const w = clampNum(wIn.value, 200, 20000, BASE_W);
    hIn.value = Math.round(w * currentAspect());
    refreshHint();
  };
  let syncing=false;
  wIn.addEventListener("input", ()=>{ if(syncing)return; syncing=true; const w=clampNum(wIn.value,200,20000,BASE_W); hIn.value=Math.round(w*currentAspect()); syncing=false; refreshHint(); });
  hIn.addEventListener("input", ()=>{ if(syncing)return; syncing=true; const h=clampNum(hIn.value,200,20000,Math.round(BASE_W*currentAspect())); wIn.value=Math.round(h/currentAspect()); syncing=false; refreshHint(); });
  dpiIn.addEventListener("input", refreshHint);
  refreshHint();

  function inlineStyles(src){
    const clone = src.cloneNode(true);
    return clone;
  }
  btn.addEventListener("click", async () => {
    const svg = document.getElementById("alluvial-chart");
    if(!svg) return;
    const o = outPixels();
    const vb = (svg.getAttribute("viewBox") || "0 0 1600 900").trim().split(/\s+/);
    const vbW = parseFloat(vb[2]), vbH = parseFloat(vb[3]);
    const clone = inlineStyles(svg);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", vbW);
    clone.setAttribute("height", vbH);
    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const url = "data:image/svg+xml;base64," + svg64;
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = o.pxW; canvas.height = o.pxH;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const link = document.createElement("a");
      // Timestamp: {day no-lead}{ShortMon}{Year}_{hour no-lead 1-12}{mm}{am|pm}
      const now = new Date();
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone:"Pacific/Honolulu", day:"numeric", month:"short", year:"numeric",
        hour:"numeric", minute:"2-digit", hour12:true
      }).formatToParts(now);
      const P = Object.fromEntries(parts.map(p=>[p.type,p.value]));
      const mon = P.month.replace(/\.$/,"");
      const suffix = P.day + mon + P.year + "_" + P.hour + P.minute + P.dayPeriod.toLowerCase();
      link.download = "itaukei-alluvial-v2_" + suffix + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    };
    img.src = url;
  });
})();
