/* ==========================================================================
   iTaukei scholar mobility — alluvial diagram
   D3-based SVG implementation that mirrors build_alluvial_v5.py (Python
   matplotlib mockup) in the browser. Ports:
     - Level 1: region -> region
     - Level 2: region -> country -> country -> region
     - Level 3: region -> country -> university -> university -> country -> region
   with the same colour scheme, block gaps (halved), ISO3 country prefixes,
   colour swatches next to leaf labels, black label text, and multi-line
   "Where iTaukei / scholars did / their Masters" (or "their PhD") headers with
   'iTaukei' underlined.
   Ribbon colour = country of Master's degree (source colour).
   ========================================================================== */

/* ------------------------- constants ---------------------------------- */

// Region colours (from chord chart legend)
const REGION_COLORS = {
  "Oceania":  "#20808E",
  "Americas": "#8B2E3F",
  "Europe":   "#2C6DA8",
  "Asia":     "#E9AF34",
  "Africa":   "#848456"
};
// Country colours (from chord chart legend)
const COUNTRY_COLORS = {
  "Fiji":           "#20808E",
  "Australia":      "#DA7101",
  "New Zealand":    "#D97BA0",  // pink (disambiguated from Japan/China gold)
  "USA":            "#8B2E3F",
  "United Kingdom": "#2C6DA8",
  "Malta":          "#7B4F8A",
  "Germany":        "#5591C7",
  "Japan":          "#E9AF34",
  "China":          "#E9AF34"
};
// Fallback ISO3 codes if UNSD not provided
const EMBEDDED_ISO3 = {
  "Fiji":"FJI","Australia":"AUS","New Zealand":"NZL","USA":"USA",
  "United States":"USA","United States of America":"USA",
  "United Kingdom":"GBR","UK":"GBR",
  "Malta":"MLT","Germany":"DEU","Japan":"JPN","China":"CHN",
  "Canada":"CAN","France":"FRA","Netherlands":"NLD","Sweden":"SWE",
  "Norway":"NOR","Denmark":"DNK","Ireland":"IRL","Spain":"ESP",
  "Italy":"ITA","Switzerland":"CHE","Papua New Guinea":"PNG",
  "Solomon Islands":"SLB","Vanuatu":"VUT","Samoa":"WSM","Tonga":"TON"
};
// Fallback UNSD region map (used if no UNSD file loaded and default fetch fails)
const EMBEDDED_UNSD = {
  "Fiji":"Oceania","Australia":"Oceania","New Zealand":"Oceania",
  "USA":"Americas","United States":"Americas",
  "United Kingdom":"Europe","UK":"Europe","Malta":"Europe","Germany":"Europe",
  "Japan":"Asia","China":"Asia",
  "Papua New Guinea":"Oceania","Solomon Islands":"Oceania",
  "Vanuatu":"Oceania","Samoa":"Oceania","Tonga":"Oceania",
  "Canada":"Americas","France":"Europe","Netherlands":"Europe",
  "Sweden":"Europe","Norway":"Europe","Denmark":"Europe","Ireland":"Europe",
  "Spain":"Europe","Italy":"Europe","Switzerland":"Europe"
};
const REGION_ORDER = ["Oceania","Americas","Europe","Asia","Africa"];
const NEUTRAL_TEXT = "#000000";

// Short display names for the country column (level 2/3 mid column)
const COUNTRY_SHORT = { "New Zealand": "NZ", "United Kingdom": "UK" };

/* ------------------------- CSV parsing -------------------------------- */

function rowsFromCsv(csvText){
  return d3.csvParse(csvText, d => {
    const m_uni = (d.m_uni || "").trim();
    const p_uni = (d.p_uni || "").trim();
    const m_country = (d.m_country || "").trim();
    const p_country = (d.p_country || "").trim();
    if(!m_uni || !p_uni || !m_country || !p_country) return null;
    // Build a scholar display name. Prefer explicit "scholar" column; else
    // fall back to "last, first" if those columns exist.
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
    const iso3    = (r["ISO-alpha3 Code"] || r.iso3 || r.ISO3 || r["ISO-alpha3"] || "").trim();
    if(country && iso3) map[country] = iso3;
  }
  return map;
}

/* ------------------------- model building ----------------------------- */

let currentUnsd = Object.assign({}, EMBEDDED_UNSD);
let currentIso3 = Object.assign({}, EMBEDDED_ISO3);

function resolveRegion(row, side){
  // Prefer m_region/p_region from the CSV if present; else look up UNSD.
  const embedded = side === "m" ? row.m_region : row.p_region;
  if(embedded) return normaliseRegion(embedded);
  const country  = side === "m" ? row.m_country : row.p_country;
  return normaliseRegion(currentUnsd[country] || "Other");
}
function normaliseRegion(r){
  // UNSD uses "Oceania", "Americas", "Europe", "Asia", "Africa".
  // Chord CSV sometimes writes "Pacific" or "North America"; fold those in.
  if(!r) return "Other";
  const s = r.trim();
  if(/^oceania$/i.test(s) || /pacific/i.test(s)) return "Oceania";
  if(/^americas?$/i.test(s) || /north america|latin america|caribbean/i.test(s)) return "Americas";
  if(/^europe$/i.test(s)) return "Europe";
  if(/^asia$/i.test(s)) return "Asia";
  if(/^africa$/i.test(s)) return "Africa";
  return s;
}

function buildFlows(rows){
  // Turn each scholar into one flow with count 1 (aggregated later). We carry
  // through the scholar name, years, and thesis titles so the ribbon tooltip
  // can list every scholar that flows through a given pair.
  const flows = [];
  for(const r of rows){
    flows.push({
      m_region:  resolveRegion(r, "m"),
      m_country: r.m_country,
      m_uni:     r.m_uni,
      p_region:  resolveRegion(r, "p"),
      p_country: r.p_country,
      p_uni:     r.p_uni,
      scholar:   r.scholar || null,
      m_year:    r.m_year  || null,
      p_year:    r.p_year  || null,
      m_title:   r.m_title || null,
      p_title:   r.p_title || null
    });
  }
  return flows;
}

function escapeHtmlA(s){
  return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function iso3(country){
  return currentIso3[country] || (country.length === 3 ? country.toUpperCase() : country.slice(0,3).toUpperCase());
}
function shortCountry(country){ return COUNTRY_SHORT[country] || country; }

/* ------------------------- layout math -------------------------------- */

/**
 * Build the block layout for one side (left = Master's, right = PhD).
 * Returns an array of columns; each column is an array of blocks:
 *   { key, kind: "region"|"country"|"uni", region, country, uni?, count,
 *     y0, y1, x0, x1 }
 * plus a lookup map from a flow to the (region-y, country-y, uni-y) it belongs to
 * so ribbons can be drawn later.
 */
function layoutSide(flows, level, side, geom){
  // side = "m" or "p"
  const {
    plotTop, plotBottom, blockX,
    leafGap, countryGap, regionGap, barW
  } = geom;

  // ----- aggregate -----
  // Collect entities present on this side, grouped by region -> country -> uni.
  const regions = new Map(); // region -> { count, countries: Map(country -> {count, unis: Map(uni -> count)}) }
  for(const f of flows){
    const reg = side === "m" ? f.m_region : f.p_region;
    const ctr = side === "m" ? f.m_country : f.p_country;
    const uni = side === "m" ? f.m_uni : f.p_uni;
    if(!regions.has(reg)) regions.set(reg, { count:0, countries: new Map() });
    const R = regions.get(reg); R.count++;
    if(!R.countries.has(ctr)) R.countries.set(ctr, { count:0, unis: new Map() });
    const C = R.countries.get(ctr); C.count++;
    C.unis.set(uni, (C.unis.get(uni)||0) + 1);
  }
  // Order regions by canonical list, others alphabetical after.
  const orderedRegions = [...regions.keys()].sort((a,b) => {
    const ai = REGION_ORDER.indexOf(a), bi = REGION_ORDER.indexOf(b);
    if(ai === -1 && bi === -1) return d3.ascending(a,b);
    if(ai === -1) return 1;
    if(bi === -1) return -1;
    return ai - bi;
  });

  // ----- total gap accounting -----
  // Between consecutive leaf items: add gaps depending on whether region and
  // country boundaries change. Sum of all "waste" gaps subtracted from
  // available height so blocks always fit.
  const items = []; // sequence of {region, country, uni?, count}
  for(const r of orderedRegions){
    const R = regions.get(r);
    const orderedCountries = [...R.countries.keys()].sort((a,b) => R.countries.get(b).count - R.countries.get(a).count);
    for(const c of orderedCountries){
      const C = R.countries.get(c);
      const orderedUnis = [...C.unis.entries()].sort((a,b) => b[1] - a[1]);
      for(const [u, n] of orderedUnis){
        items.push({ region:r, country:c, uni:u, count:n });
      }
    }
  }

  // Whitespace: between adjacent items, add leafGap always; extra countryGap
  // when country changes; extra regionGap when region changes.
  let totalGaps = 0;
  for(let i=1;i<items.length;i++){
    const prev = items[i-1], cur = items[i];
    totalGaps += leafGap;
    if(prev.country !== cur.country) totalGaps += countryGap;
    if(prev.region  !== cur.region)  totalGaps += regionGap;
  }

  const plotH = plotBottom - plotTop;
  const availH = plotH - totalGaps;
  const totalCount = items.reduce((s,it) => s + it.count, 0) || 1;
  const unit = availH / totalCount;  // pixels per scholar

  // ----- lay out leaf (uni) blocks -----
  let y = plotTop;
  const leafBlocks = [];
  for(let i=0;i<items.length;i++){
    if(i>0){
      const prev = items[i-1], cur = items[i];
      y += leafGap;
      if(prev.country !== cur.country) y += countryGap;
      if(prev.region  !== cur.region)  y += regionGap;
    }
    const h = items[i].count * unit;
    leafBlocks.push({
      kind:"uni",
      region: items[i].region,
      country: items[i].country,
      uni: items[i].uni,
      count: items[i].count,
      y0: y, y1: y+h
    });
    y += h;
  }

  // ----- derive country and region blocks by union of leaves -----
  const countryBlocks = [];
  for(const r of orderedRegions){
    const R = regions.get(r);
    const orderedCountries = [...R.countries.keys()].sort((a,b) => R.countries.get(b).count - R.countries.get(a).count);
    for(const c of orderedCountries){
      const leaves = leafBlocks.filter(b => b.region === r && b.country === c);
      if(!leaves.length) continue;
      countryBlocks.push({
        kind:"country", region:r, country:c,
        count: R.countries.get(c).count,
        y0: d3.min(leaves, d => d.y0),
        y1: d3.max(leaves, d => d.y1)
      });
    }
  }
  const regionBlocks = [];
  for(const r of orderedRegions){
    const leaves = leafBlocks.filter(b => b.region === r);
    if(!leaves.length) continue;
    regionBlocks.push({
      kind:"region", region:r,
      count: regions.get(r).count,
      y0: d3.min(leaves, d => d.y0),
      y1: d3.max(leaves, d => d.y1)
    });
  }

  // ----- assign column X positions -----
  // Left side: columns march inward (region col outside, then country, then uni)
  //   For left: x1 is the ribbon-facing edge (rightmost for left side)
  // Right side: mirrored.
  const cols = [];
  if(level === 1){
    cols.push({ kind:"region", blocks: regionBlocks });
  } else if(level === 2){
    cols.push({ kind:"region",  blocks: regionBlocks });
    cols.push({ kind:"country", blocks: countryBlocks });
  } else { // level 3
    cols.push({ kind:"region",  blocks: regionBlocks });
    cols.push({ kind:"country", blocks: countryBlocks });
    cols.push({ kind:"uni",     blocks: leafBlocks });
  }
  // Assign x0/x1 to each block based on side + column index
  for(let ci=0; ci<cols.length; ci++){
    const col = cols[ci];
    const pos = blockX(side, ci, cols.length, level);
    for(const b of col.blocks){
      b.x0 = pos.x0; b.x1 = pos.x1;
    }
  }

  return { cols, regionBlocks, countryBlocks, leafBlocks, orderedRegions };
}

/* ------------------------- flow-position mapping ---------------------- */

/**
 * For ribbon drawing we need to know, for each flow, the vertical stripe
 * within the leaf block on each side that the flow occupies. We give each
 * flow a proportional slice within the leaf block, ordered by the *other*
 * side's country/region to reduce crossings.
 */
function assignRibbonPositions(flows, leftLeaves, rightLeaves){
  // Group flows by (m_uni, p_uni) and sum counts (an alluvial ribbon = one
  // group). For our data every flow has count 1, but grouping still helps
  // for repeated pairs.
  const key = f => f.m_region+"|"+f.m_country+"|"+f.m_uni+"||"+f.p_region+"|"+f.p_country+"|"+f.p_uni;
  const grouped = new Map();
  for(const f of flows){
    const k = key(f);
    if(!grouped.has(k)) grouped.set(k, { ...f, count:0, flows: [] });
    const g = grouped.get(k);
    g.count++;
    // Keep the raw per-scholar record so the hover tooltip can list them.
    g.flows.push({
      scholar: f.scholar,
      m_year:  f.m_year,
      p_year:  f.p_year,
      m_title: f.m_title,
      p_title: f.p_title,
      m_uni:   f._orig_m_uni     || f.m_uni,
      p_uni:   f._orig_p_uni     || f.p_uni,
      m_country: f._orig_m_country || f.m_country,
      p_country: f._orig_p_country || f.p_country
    });
  }
  const flowList = [...grouped.values()];

  // For each side, we need to know: for a given (region, country, uni),
  // what leaf block it corresponds to and what fraction each flow gets.
  const leftIdx  = new Map(leftLeaves.map(b  => [b.region+"|"+b.country+"|"+b.uni, b]));
  const rightIdx = new Map(rightLeaves.map(b => [b.region+"|"+b.country+"|"+b.uni, b]));
  // Secondary lookup by (country|uni) alone so a flow whose m_region/p_region
  // disagrees with the aggregation (e.g. a CSV row that spells the region
  // differently from all the others under the same country+uni pair) still
  // finds its leaf block. Without this fallback the ribbon is silently
  // dropped even though the leaf visibly renders.
  const leftIdxCountryUni  = new Map(leftLeaves.map(b  => [b.country+"|"+b.uni, b]));
  const rightIdxCountryUni = new Map(rightLeaves.map(b => [b.country+"|"+b.uni, b]));

  // Ribbon vertical order within a leaf block: order left-side ribbons by
  // right-side region/country/uni order; and vice versa. Use REGION_ORDER
  // then alphabetical.
  function rank(reg, ctr, uni){
    const ri = REGION_ORDER.indexOf(reg);
    return [ri === -1 ? 99 : ri, ctr || "", uni || ""];
  }
  function cmp(a, b){
    for(let i=0;i<a.length;i++){
      if(a[i] < b[i]) return -1;
      if(a[i] > b[i]) return 1;
    }
    return 0;
  }

  // Track flows whose leaf lookup only succeeded via the country+uni fallback
  // so we can surface a console warning below.
  const orphanLeft = [];
  const orphanRight = [];

  // Group flowList by left leaf block, order within group by right-side rank.
  const byLeft = d3.group(flowList, f => f.m_region+"|"+f.m_country+"|"+f.m_uni);
  for(const [, fs] of byLeft){
    fs.sort((a,b) => cmp(rank(a.p_region,a.p_country,a.p_uni), rank(b.p_region,b.p_country,b.p_uni)));
    let leaf = leftIdx.get(fs[0].m_region+"|"+fs[0].m_country+"|"+fs[0].m_uni);
    if(!leaf){
      leaf = leftIdxCountryUni.get(fs[0].m_country+"|"+fs[0].m_uni);
      if(leaf){
        orphanLeft.push({key: fs[0].m_region+"|"+fs[0].m_country+"|"+fs[0].m_uni,
                          leafRegion: leaf.region, count: fs.length});
      }
    }
    if(!leaf) continue;
    const totalN = d3.sum(fs, d => d.count);
    const unit = (leaf.y1 - leaf.y0) / totalN;
    let cursor = leaf.y0;
    for(const f of fs){
      f.left_y0 = cursor;
      f.left_y1 = cursor + f.count * unit;
      cursor = f.left_y1;
    }
  }
  // Right-side grouping mirrors: order by left rank.
  const byRight = d3.group(flowList, f => f.p_region+"|"+f.p_country+"|"+f.p_uni);
  for(const [, fs] of byRight){
    fs.sort((a,b) => cmp(rank(a.m_region,a.m_country,a.m_uni), rank(b.m_region,b.m_country,b.m_uni)));
    let leaf = rightIdx.get(fs[0].p_region+"|"+fs[0].p_country+"|"+fs[0].p_uni);
    if(!leaf){
      leaf = rightIdxCountryUni.get(fs[0].p_country+"|"+fs[0].p_uni);
      if(leaf){
        orphanRight.push({key: fs[0].p_region+"|"+fs[0].p_country+"|"+fs[0].p_uni,
                           leafRegion: leaf.region, count: fs.length});
      }
    }
    if(!leaf) continue;
    const totalN = d3.sum(fs, d => d.count);
    const unit = (leaf.y1 - leaf.y0) / totalN;
    let cursor = leaf.y0;
    for(const f of fs){
      f.right_y0 = cursor;
      f.right_y1 = cursor + f.count * unit;
      cursor = f.right_y1;
    }
  }
  if(orphanLeft.length || orphanRight.length){
    console.warn("[alluvial] region mismatch recovered via country+uni fallback",
                 { orphanLeft, orphanRight });
  }
  return flowList;
}

/* ------------------------- drawing ------------------------------------ */

// Column geometry: given side (m/p), column index, total cols, and level,
// return the x0/x1 of each column's block bar in the 1600x900 viewport.
function makeGeom(level, viewH){
  const VIEW_W = 1600;
  const VIEW_H = viewH || 900;
  // 2-line side headers up top (title + stat line). No side-totals block at
  // the bottom — the count breakdown was moved into the header line so the
  // ribbon area can expand vertically.
  const plotTop = 80;
  const plotBottom = VIEW_H - 40;
  const BAR_W = 24;                          // block bar width in px
  // Whitespace between leaf blocks, in pixels. Kept in absolute pixel units so
  // the layout stays consistent when VIEW_H grows with the number of scholars.
  const leafGap    = 1;    // between consecutive uni rows in the same country
  const countryGap = 2;    // extra when country changes
  const regionGap  = 5;    // extra when region changes

  // Horizontal positions: leave outer margin for labels+swatches
  const labelMargin = 340;  // px reserved on each outer side for uni labels
  const midStart = labelMargin;               // where left-side region column starts
  const midEnd   = VIEW_W - labelMargin;      // where right-side region column ends
  const midW     = midEnd - midStart;         // width available for the ribbon area

  // Column gap between consecutive block bars on the same side.
  // Tight gap (Ron's preferred spacing): Region and Country columns sit
  // close together on both sides, at every level.
  const COL_GAP = 4;

  function blockX(side, colIdx, colCount, lvl){
    // Left side, colIdx 0 = outermost (region), then country, then uni.
    // Right side mirrored.
    if(side === "m"){
      // start at midStart, march right
      const x0 = midStart + colIdx * (BAR_W + COL_GAP);
      return { x0, x1: x0 + BAR_W };
    } else {
      // right side: colIdx 0 = outermost (region), then country, then uni.
      // Mirror: outermost is rightmost.
      const x1 = midEnd - colIdx * (BAR_W + COL_GAP);
      return { x0: x1 - BAR_W, x1 };
    }
  }

  return {
    VIEW_W, VIEW_H,
    plotTop, plotBottom,
    leafGap, countryGap, regionGap,
    BAR_W, COL_GAP,
    midStart, midEnd, midW,
    labelMargin,
    blockX
  };
}

// Ribbon path: cubic Bezier connecting two rectangles.
function ribbonPath(x0, y0Top, y0Bot, x1, y1Top, y1Bot){
  // Two horizontal edges + smooth Bezier joins on top and bottom.
  const mid = (x0 + x1) / 2;
  const topPath = `M ${x0} ${y0Top} C ${mid} ${y0Top}, ${mid} ${y1Top}, ${x1} ${y1Top}`;
  const bottomPath = `L ${x1} ${y1Bot} C ${mid} ${y1Bot}, ${mid} ${y0Bot}, ${x0} ${y0Bot} Z`;
  return topPath + " " + bottomPath;
}

// Underlined-word support: draw text with a manual underline under one word.
function drawUnderlinedHeader(g, x, y, before, word, after, fontSize){
  // Draw the full line centered, then draw a rule under just `word`. We use
  // a hidden measurement text to compute pixel widths in the browser.
  const grp = g.append("g").attr("class","col-header");
  const full = before + word + after;
  const t = grp.append("text")
    .attr("x", x).attr("y", y)
    .attr("text-anchor","middle")
    .attr("class","col-header-line")
    .attr("style", `font-size:${fontSize}px;`)
    .text(full);
  // Measure using getComputedTextLength on a sub-tspan approach: append
  // measurement text off-screen, then remove.
  const measure = g.append("text")
    .attr("x", -9999).attr("y", -9999)
    .attr("class","col-header-line")
    .attr("style", `font-size:${fontSize}px; visibility:hidden;`);
  measure.text(before);
  const wBefore = measure.node().getComputedTextLength();
  measure.text(word);
  const wWord = measure.node().getComputedTextLength();
  measure.text(after);
  const wAfter = measure.node().getComputedTextLength();
  measure.remove();
  const wTotal = wBefore + wWord + wAfter;
  const startX = x - wTotal/2;
  const wordX0 = startX + wBefore;
  const wordX1 = wordX0 + wWord;
  grp.append("line")
    .attr("x1", wordX0).attr("x2", wordX1)
    .attr("y1", y + 3).attr("y2", y + 3)
    .attr("stroke", NEUTRAL_TEXT).attr("stroke-width", 1.4);
  return grp;
}

// Count the leaf rows and running gap total that layoutSide will produce
// for a given side, so we can size VIEW_H before the actual layout runs.
function preScanSide(flows, level, side){
  const regions = new Map();
  for(const f of flows){
    const reg = side === "m" ? f.m_region  : f.p_region;
    const ctr = side === "m" ? f.m_country : f.p_country;
    const uni = side === "m" ? f.m_uni     : f.p_uni;
    if(!regions.has(reg)) regions.set(reg, { countries: new Map() });
    const R = regions.get(reg);
    if(!R.countries.has(ctr)) R.countries.set(ctr, { unis: new Map() });
    const C = R.countries.get(ctr);
    C.unis.set(uni, (C.unis.get(uni)||0) + 1);
  }
  // Build item sequence in the same order layoutSide does.
  const items = [];
  for(const [reg, R] of regions){
    for(const [ctr, C] of R.countries){
      for(const [uni, n] of C.unis){
        items.push({ region: reg, country: ctr, uni, count: n });
      }
    }
  }
  return items;
}

// Given the item sequence and geom gaps, return the total gap px between rows.
function gapSum(items, leafGap, countryGap, regionGap){
  let g = 0;
  for(let i=1; i<items.length; i++){
    const p = items[i-1], c = items[i];
    g += leafGap;
    if(p.country !== c.country) g += countryGap;
    if(p.region  !== c.region)  g += regionGap;
  }
  return g;
}

function draw(flows, level){
  const svg = d3.select("#alluvial-chart");
  svg.selectAll("*").remove();

  // Compute a dynamic canvas height so each leaf row has a legible minimum
  // vertical space. Grows as more scholars are added.
  const MIN_ROW_PX = 14;   // minimum block height (px) for a 1-scholar leaf at Level 3
  const initGeom = makeGeom(level, 900);
  const leftItems  = preScanSide(flows, level, "m");
  const rightItems = preScanSide(flows, level, "p");
  // Only the deepest level (uni leaves) benefits from the row-min guarantee.
  // At Levels 1 and 2 there are far fewer leaves, so the 900px canvas is fine.
  let viewH = 900;
  if(level === 3){
    const requiredForSide = (items) => {
      const totalCount = items.reduce((s, it) => s + it.count, 0);
      const gaps = gapSum(items, initGeom.leafGap, initGeom.countryGap, initGeom.regionGap);
      // plotH must satisfy: (plotH - gaps) / totalCount >= MIN_ROW_PX * totalCount / totalCount
      // But we care about the SHORTEST leaf, which is (count=1) row = unit px.
      // Ensure unit = (plotH - gaps) / totalCount >= MIN_ROW_PX.
      return MIN_ROW_PX * totalCount + gaps;
    };
    const requiredPlotH = Math.max(requiredForSide(leftItems), requiredForSide(rightItems));
    // plotTop=80, bottom margin=40 → chrome = 120
    const requiredViewH = Math.ceil(requiredPlotH + 120);
    viewH = Math.max(900, requiredViewH);
  }
  // Update SVG viewBox so the browser scales the chart to the new height.
  svg.attr("viewBox", `0 0 1600 ${viewH}`);

  const geom = makeGeom(level, viewH);
  const { VIEW_W, VIEW_H, plotTop, plotBottom, midStart, midEnd, midW } = geom;

  const left  = layoutSide(flows, level, "m", geom);
  const right = layoutSide(flows, level, "p", geom);

  // ---- assign ribbon vertical slices within leaf blocks ----
  // At level < 3 the "leaves" are the country column (level 2) or region
  // column (level 1). Treat those as leaf blocks for ribbon-anchor purposes.
  function pickLeaves(side, sideLayout){
    if(level === 3) return sideLayout.leafBlocks;
    if(level === 2) return sideLayout.countryBlocks.map(b => ({...b, uni: b.country}));
    return sideLayout.regionBlocks.map(b => ({...b, country: b.region, uni: b.region}));
  }
  // For level 1/2 we need to align flows by their aggregation key that
  // matches the leaf. We synthesize m_uni/p_uni to fit.
  const flowsForLayout = flows.map(f => ({
    ...f,
    // Preserve the underlying per-scholar values so the hover tooltip can
    // still name the exact institutions even at aggregated levels.
    _orig_m_uni: f.m_uni,
    _orig_p_uni: f.p_uni,
    _orig_m_country: f.m_country,
    _orig_p_country: f.p_country,
    m_uni: level === 3 ? f.m_uni : (level === 2 ? f.m_country : f.m_region),
    p_uni: level === 3 ? f.p_uni : (level === 2 ? f.p_country : f.p_region),
    m_country: level === 1 ? f.m_region : f.m_country,
    p_country: level === 1 ? f.p_region : f.p_country
  }));
  const leftLeaves  = pickLeaves("m", left);
  const rightLeaves = pickLeaves("p", right);
  const flowList = assignRibbonPositions(flowsForLayout, leftLeaves, rightLeaves);

  // ---- draw ribbons FIRST (behind blocks) ----
  const gRibbons = svg.append("g").attr("class","ribbons");
  const tooltip = document.getElementById("alluvial-tip");
  // Chord-style tooltip positioning: keep it centered above the cursor and
  // flip below when near the top edge.
  function moveTip(ev){
    const r = tooltip.getBoundingClientRect();
    const w = r.width, h = r.height, pad = 14;
    let x = ev.clientX, y = ev.clientY - pad;
    x = Math.max(w/2 + 6, Math.min(x, window.innerWidth - w/2 - 6));
    if(y - h < 6) y = ev.clientY + pad + h;
    tooltip.style.left = x + "px";
    tooltip.style.top  = y + "px";
  }
  function showTip(evt, html){
    tooltip.innerHTML = html;
    tooltip.style.opacity = "1";
    moveTip(evt);
  }
  function hideTip(){ tooltip.style.opacity = "0"; }

  // Build tooltip HTML for one ribbon (may bundle several scholars).
  function tipForFlow(f){
    const arrow = " \u2192 ";
    let label;
    if(level === 3){
      label = `${iso3(f._orig_m_country||f.m_country)}: ${f._orig_m_uni||f.m_uni}${arrow}${iso3(f._orig_p_country||f.p_country)}: ${f._orig_p_uni||f.p_uni}`;
    } else if(level === 2){
      label = `${f.m_country}${arrow}${f.p_country}`;
    } else {
      label = `${f.m_region}${arrow}${f.p_region}`;
    }
    const head  = '<div class="tip-path">' + escapeHtmlA(label) + '</div>';
    const count = '<div class="tip-count">' + f.count + ' scholar' + (f.count===1?"":"s") + '</div>';
    const rows  = (f.flows || []).slice();
    // Sort scholars alphabetically for a stable list.
    rows.sort((a,b) => (a.scholar||"").localeCompare(b.scholar||""));
    const SHOW = 8;
    const items = rows.slice(0, SHOW).map(s => {
      const name = escapeHtmlA(s.scholar || "(unnamed)");
      const yrs  = [s.m_year, s.p_year].filter(Boolean).join(arrow);
      const yr   = yrs ? ' <span class="tip-year">('+escapeHtmlA(yrs)+')</span>' : "";
      const title = s.p_title || s.m_title;
      const t = title ? '<span class="tip-title">'+escapeHtmlA(title)+'</span>' : "";
      return '<li><span class="tip-name">'+name+'</span>'+yr+t+'</li>';
    }).join("");
    const more = rows.length > SHOW ? '<div class="tip-more">+ '+(rows.length-SHOW)+' more</div>' : "";
    return head + count + '<ul>' + items + '</ul>' + more;
  }

  // Determine x anchors: right edge of the innermost left col, left edge of
  // innermost right col.
  const leftInnerX  = level === 3 ? left.leafBlocks[0].x1  : (level === 2 ? left.countryBlocks[0].x1  : left.regionBlocks[0].x1);
  const rightInnerX = level === 3 ? right.leafBlocks[0].x0 : (level === 2 ? right.countryBlocks[0].x0 : right.regionBlocks[0].x0);

  // Sort ribbons by count desc so big ones don't sit on top of small ones
  // making them invisible.
  flowList.sort((a,b) => b.count - a.count);
  for(const f of flowList){
    if(f.left_y0 == null || f.right_y0 == null) continue;
    const color = COUNTRY_COLORS[f.m_country] || REGION_COLORS[f.m_region] || "#999";
    const path = ribbonPath(leftInnerX, f.left_y0, f.left_y1, rightInnerX, f.right_y0, f.right_y1);
    // Origin country (m_country) is exposed as a data-* attribute so external
    // scripts (e.g. the slideshow QA tool that highlights ribbons by Masters
    // origin) can filter ribbons without re-parsing the underlying data.
    const mCountry = f._orig_m_country || f.m_country || "";
    gRibbons.append("path")
      .attr("class","ribbon")
      .attr("data-m-country", mCountry)
      .attr("d", path)
      .attr("fill", color)
      .attr("fill-opacity", 0.55)
      .attr("stroke","none")
      .on("mouseover", (e) => {
        showTip(e, tipForFlow(f));
        gRibbons.selectAll("path.ribbon").classed("dim", true);
        d3.select(e.currentTarget).classed("dim", false);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", () => {
        hideTip();
        gRibbons.selectAll("path.ribbon").classed("dim", false);
      });
  }

  // ---- draw block bars ----
  const gBlocks = svg.append("g").attr("class","blocks");
  function drawSide(side, sideLayout){
    for(let ci=0; ci<sideLayout.cols.length; ci++){
      const col = sideLayout.cols[ci];
      for(const b of col.blocks){
        const color = b.kind === "region" ? REGION_COLORS[b.region]
                    : b.kind === "country" ? (COUNTRY_COLORS[b.country] || REGION_COLORS[b.region])
                    : (COUNTRY_COLORS[b.country] || REGION_COLORS[b.region]);
        // Tag country blocks with data-* so external scripts (e.g. the
        // origin-country checkbox filter) can order countries by their
        // top-to-bottom position on the Masters side without depending on
        // ribbon geometry, which can be perturbed by ribbon assignment or
        // by fill-opacity hiding.
        const blockRect = gBlocks.append("rect")
          .attr("x", b.x0).attr("y", b.y0)
          .attr("width", b.x1 - b.x0).attr("height", b.y1 - b.y0)
          .attr("fill", color || "#999");
        if(b.kind === "country"){
          blockRect
            .attr("data-side", side)
            .attr("data-country", b.country);
        }

        // Vertical label inside region column — only render if the label
        // (rotated 90°) fits within the block's height. Otherwise skip.
        // Inside vertical label — only render if the rotated label fits
        // the block height. When it doesn't, we fall back to a small side
        // label placed to the outer side of the block below.
        if(b.kind === "region"){
          const label = `${b.region} (${b.count})`;
          const fs = 12;
          if(approxTextWidth(label, fs) + 10 <= (b.y1 - b.y0)){
            const cx = (b.x0 + b.x1)/2;
            const cy = (b.y0 + b.y1)/2;
            gBlocks.append("text")
              .attr("class","block-label")
              .attr("x", cx).attr("y", cy)
              .attr("text-anchor","middle").attr("dominant-baseline","middle")
              .attr("transform", `rotate(-90 ${cx} ${cy})`)
              .attr("fill", readableOn(color))
              .attr("style",`font-size:${fs}px; font-weight:600;`)
              .text(label);
            b._labelInside = true;
          }
        }
        if(b.kind === "country"){
          const label = `${shortCountry(b.country)} (${b.count})`;
          const fs = 11;
          if(approxTextWidth(label, fs) + 8 <= (b.y1 - b.y0)){
            const cx = (b.x0 + b.x1)/2;
            const cy = (b.y0 + b.y1)/2;
            gBlocks.append("text")
              .attr("class","block-label")
              .attr("x", cx).attr("y", cy)
              .attr("text-anchor","middle").attr("dominant-baseline","middle")
              .attr("transform", `rotate(-90 ${cx} ${cy})`)
              .attr("fill", readableOn(color))
              .attr("style",`font-size:${fs}px; font-weight:600;`)
              .text(label);
            b._labelInside = true;
          }
        }
      }
      // Side labels for region blocks whose inside label was skipped.
      // Only meaningful at level 1 and level 2, where the region column is
      // outermost. At level 3 the leaf labels already carry country + uni info.
      if(col.kind === "region" && level !== 3){
        for(const b of col.blocks){
          if(b._labelInside) continue;
          const cy = (b.y0 + b.y1)/2;
          const txt = `${b.region} (${b.count})`;
          if(side === "m"){
            gBlocks.append("text")
              .attr("class","region-side-label")
              .attr("x", b.x0 - 8).attr("y", cy)
              .attr("text-anchor","end").attr("dominant-baseline","middle")
              .attr("fill","#000")
              .attr("style","font-size:11px;")
              .text(txt);
          } else {
            gBlocks.append("text")
              .attr("class","region-side-label")
              .attr("x", b.x1 + 8).attr("y", cy)
              .attr("text-anchor","start").attr("dominant-baseline","middle")
              .attr("fill","#000")
              .attr("style","font-size:11px;")
              .text(txt);
          }
        }
      }
    }
  }
  drawSide("m", left);
  drawSide("p", right);

  // ---- leaf labels (only for level 3), placed OUTSIDE the region column ----
  // ISO3 country code lives inside a padded colored tag; university label
  // sits alongside the tag in black. Master's side is right-aligned;
  // PhD side is left-aligned.
  const gLabels = svg.append("g").attr("class","labels");
  if(level === 3){
    const TAG_FS       = 10;                 // ISO3 code font size
    const TAG_PAD_X    = 8;                  // horizontal padding inside tag
    const TAG_GAP_REG  = 4;                  // gap from region column to tag (matches COL_GAP)
    const TAG_GAP_TXT  = 8;                  // gap from tag to label text
    const LABEL_FS     = 11;                 // uni label font size
    const TAG_TEXT_MIN = 11;                 // hide ISO3 text if tag shorter than this

    function drawLeafLabels(side, sideLayout){
      // The region column is the outermost column on each side.
      const uniCol    = sideLayout.cols[sideLayout.cols.length - 1];
      const regionCol = sideLayout.cols[0];
      const regionOuterX = (side === "m") ? regionCol.blocks[0].x0 : regionCol.blocks[0].x1;

      for(const b of uniCol.blocks){
        const color   = COUNTRY_COLORS[b.country] || REGION_COLORS[b.region] || "#999";
        const codeIso = iso3(b.country);
        const label   = `${b.uni} (${b.count})`;
        const cy      = (b.y0 + b.y1)/2;
        const tagW    = approxTextWidth(codeIso, TAG_FS) + 2 * TAG_PAD_X;
        // Tag height = university block height (i.e. matches this row's ribbon width).
        const tagH    = Math.max(1, b.y1 - b.y0);
        const tagY0   = b.y0;
        const showTagText = tagH >= TAG_TEXT_MIN;

        if(side === "m"){
          const tagX1 = regionOuterX - TAG_GAP_REG;
          const tagX0 = tagX1 - tagW;
          gLabels.append("rect").attr("class","swatch")
            .attr("x", tagX0).attr("y", tagY0)
            .attr("width", tagW).attr("height", tagH)
            .attr("fill", color);
          if(showTagText){
            gLabels.append("text")
              .attr("class","leaf-tag-text")
              .attr("x", (tagX0 + tagX1)/2).attr("y", cy)
              .attr("text-anchor","middle").attr("dominant-baseline","middle")
              .attr("fill", readableOn(color))
              .attr("style",`font-size:${TAG_FS}px; font-weight:600;`)
              .text(codeIso);
          }
          gLabels.append("text")
            .attr("class","leaf-label")
            .attr("x", tagX0 - TAG_GAP_TXT).attr("y", cy)
            .attr("text-anchor","end").attr("dominant-baseline","middle")
            .attr("fill","#000")
            .attr("style",`font-size:${LABEL_FS}px;`)
            .text(label);
        } else {
          const tagX0 = regionOuterX + TAG_GAP_REG;
          const tagX1 = tagX0 + tagW;
          gLabels.append("rect").attr("class","swatch")
            .attr("x", tagX0).attr("y", tagY0)
            .attr("width", tagW).attr("height", tagH)
            .attr("fill", color);
          if(showTagText){
            gLabels.append("text")
              .attr("class","leaf-tag-text")
              .attr("x", (tagX0 + tagX1)/2).attr("y", cy)
              .attr("text-anchor","middle").attr("dominant-baseline","middle")
              .attr("fill", readableOn(color))
              .attr("style",`font-size:${TAG_FS}px; font-weight:600;`)
              .text(codeIso);
          }
          gLabels.append("text")
            .attr("class","leaf-label")
            .attr("x", tagX1 + TAG_GAP_TXT).attr("y", cy)
            .attr("text-anchor","start").attr("dominant-baseline","middle")
            .attr("fill","#000")
            .attr("style",`font-size:${LABEL_FS}px;`)
            .text(label);
        }
      }
    }
    drawLeafLabels("m", left);
    drawLeafLabels("p", right);
  }

  // ---- three-column header row (left / center / right) ----
  // Wide single-line "Where iTaukei scholars did their <phase>" over the
  // stack, with a second line summarising the level-3 counts (universities |
  // countries | regions). Center column shows the total scholar count.
  {
    const gHead = svg.append("g").attr("class","headers");
    const cols  = left.cols;
    const rcols = right.cols;
    // Left / right anchors for the flush-aligned side headers. The right
    // anchor is pulled in ~100px so the on-page fullscreen expand button in
    // the top-right of the canvas doesn't clip "...their PhD"; the left
    // anchor is pushed in the same amount so the two sides stay balanced.
    const leftBlockX  = 140;
    const rightBlockX = 1460;
    const titleFS = 20;
    const statFS  = 17;
    const y1 = 30; // main header baseline
    const y2 = 55; // stat line baseline

    // Level-adaptive count summary (matches the on-page footer that used to sit
    // below the chart). L3 shows all three tiers; L2 drops the university tier;
    // L1 shows only the region count.
    function statLine(sideLayout){
      const nUni = sideLayout.leafBlocks.length;
      const nCtr = sideLayout.countryBlocks.length;
      const nReg = sideLayout.regionBlocks.length;
      const parts = [];
      if(level === 3) parts.push(nUni + " " + (nUni === 1 ? "University" : "Universities"));
      if(level >= 2)  parts.push(nCtr + " " + (nCtr === 1 ? "Country" : "Countries"));
      parts.push(nReg + " " + (nReg === 1 ? "Region" : "Regions"));
      return parts.join("  |  ");
    }

    // Left title + stats (flush-left).
    gHead.append("text").attr("class","col-header-line")
      .attr("x", leftBlockX).attr("y", y1)
      .attr("text-anchor", "start")
      .attr("style", `font-size:${titleFS}px; font-weight:700; fill:#000;`)
      .text("Where iTaukei scholars did their Masters");
    gHead.append("text").attr("class","col-header-line")
      .attr("x", leftBlockX).attr("y", y2)
      .attr("text-anchor", "start")
      .attr("style", `font-size:${statFS}px; fill:#000;`)
      .text(statLine(left));

    // Right title + stats (flush-right).
    gHead.append("text").attr("class","col-header-line")
      .attr("x", rightBlockX).attr("y", y1)
      .attr("text-anchor", "end")
      .attr("style", `font-size:${titleFS}px; font-weight:700; fill:#000;`)
      .text("Where iTaukei scholars did their PhD");
    gHead.append("text").attr("class","col-header-line")
      .attr("x", rightBlockX).attr("y", y2)
      .attr("text-anchor", "end")
      .attr("style", `font-size:${statFS}px; fill:#000;`)
      .text(statLine(right));

    // Center title: total scholar count. Uses distinct scholar rows if
    // available, otherwise falls back to the flow count.
    const totalScholars = (function(){
      const seen = new Set();
      for(const f of flows){
        if(f.scholar) seen.add(f.scholar);
      }
      return seen.size || flows.length;
    })();
    const centerX = (leftBlockX + rightBlockX) / 2;
    gHead.append("text").attr("class","col-header-line")
      .attr("x", centerX).attr("y", y1)
      .attr("text-anchor", "middle")
      .attr("style", `font-size:${titleFS}px; font-weight:700; fill:#000;`)
      .text(totalScholars + " iTaukei Scholars");
  }

  // Notify the PNG export controls that the SVG viewBox may have changed so
  // the width/height inputs stay in sync with the current chart aspect.
  if(typeof window.__alluvialSyncExportSize === "function") window.__alluvialSyncExportSize();

  // Notify the origin-country filter (checkbox row above the chart) that the
  // ribbons have been redrawn so it can re-populate the checkboxes and
  // re-apply the current selection. Ribbons are re-created on every draw so
  // any previous inline fill-opacity is lost — the filter needs to re-run.
  if(typeof window.__alluvialFilterRefresh === "function") window.__alluvialFilterRefresh();
}

// Uses the WCAG 2.x relative-luminance formula (sRGB gamma-decoded, then
// weighted 0.2126 R / 0.7152 G / 0.0722 B) and picks whichever of black or
// white gives more contrast against the fill. The simple YIQ average this
// used to run leaned on green far too heavily, so muted mid-tone reds/blues
// like "#8B2E3F" (Americas / USA), "#2C6DA8" (Europe / UK) and "#7B4F8A"
// (Malta), plus warm oranges like "#DA7101" (Australia), came back as
// "light" and got black text — which then reads poorly on those dark fills.
function readableOn(hexColor){
  if(!hexColor) return "#000";
  const c = d3.color(hexColor);
  if(!c) return "#000";
  const {r,g,b} = c.rgb();
  const chan = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? (s / 12.92) : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126*chan(r) + 0.7152*chan(g) + 0.0722*chan(b);
  // WCAG contrast ratios against pure white (L=1) and pure black (L=0):
  //   white: (1 + 0.05) / (L + 0.05)
  //   black: (L + 0.05) / (0 + 0.05)
  // We bias toward white so mid-tone chromatic fills like Germany’s
  // "#5591C7" (mid blue) flip to white text — those read as “dark” to the
  // eye even though the math is close to even. Black is chosen only when it
  // wins by a comfortable margin (roughly, WCAG lightness above ~0.55).
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack > 2.0 * contrastWhite ? "#000" : "#fff";
}

// Rough pixel width for a text string in the default UI font at the given size.
// Used to decide whether a rotated label will fit inside a block.
function approxTextWidth(text, fontSize){
  return (text || "").length * fontSize * 0.55;
}

/* ------------------------- upload / render pipeline ------------------- */

const statusEl = document.getElementById("alluvial-status");
const uploadMsg = document.getElementById("upload-msg");
function setMsg(text, kind){
  uploadMsg.textContent = text || "";
  uploadMsg.classList.remove("is-error","is-ok");
  if(kind === "error") uploadMsg.classList.add("is-error");
  if(kind === "ok")    uploadMsg.classList.add("is-ok");
}

let currentFlows = null;
let currentLevel = 3;

function renderFromMobility(csvText, label){
  const rows = rowsFromCsv(csvText);
  if(!rows.length){ setMsg("That file has no usable rows (need m_uni, m_country, p_uni, p_country).", "error"); return false; }
  currentFlows = buildFlows(rows);
  draw(currentFlows, currentLevel);
  if(typeof refreshGeneratedStamp === "function") refreshGeneratedStamp();
  // The scholar count is now shown in the source caption itself, so the
  // extra status line only mentions which dataset is active.
  statusEl.textContent = (label||"Uploaded CSV");
  setMsg("Chart updated from "+(label||"your CSV")+" ("+currentFlows.length+" scholars).", "ok");
  return true;
}

function validateMobility(csvText){
  const rows = rowsFromCsv(csvText);
  if(!rows.length) return { ok:false, error:"Need at least one row with m_uni, m_country, p_uni, p_country." };
  return { ok:true, rows };
}

// -------- file reading (identical logic to chord page) --------
function isExcel(file){
  return /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name)
      || file.type==="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      || file.type==="application/vnd.ms-excel";
}
function readTextFile(file){
  return new Promise((resolve,reject)=>{
    const fr = new FileReader();
    fr.onload  = () => resolve(String(fr.result).replace(/^\ufeff/, ""));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(file);
  });
}
function readExcelAsCsv(file){
  return new Promise((resolve,reject)=>{
    if(typeof XLSX==="undefined"){ reject(new Error("xlsx-lib-missing")); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try{
        const wb = XLSX.read(new Uint8Array(fr.result), {type:"array"});
        const first = wb.SheetNames[0];
        if(!first){ reject(new Error("no-sheets")); return; }
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[first], {blankrows:false});
        resolve(csv);
      }catch(err){ reject(err); }
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file);
  });
}
function readFile(file){ return isExcel(file) ? readExcelAsCsv(file) : readTextFile(file); }

let lastMobilityText = null;
// Persistence keys for the last uploaded datasets. On page load, whichever
// was last used is restored; the Reset button clears both.
const LS_MOBILITY_KEY  = "vavelab:alluvial:mobility";
const LS_MOBILITY_NAME = "vavelab:alluvial:mobility:name";
const LS_UNSD_KEY      = "vavelab:alluvial:unsd";
const LS_UNSD_NAME     = "vavelab:alluvial:unsd:name";
function lsGet(key){ try { return localStorage.getItem(key); } catch(_){ return null; } }
function lsSet(key, val){ try { localStorage.setItem(key, val); } catch(_){} }
function lsDel(key){ try { localStorage.removeItem(key); } catch(_){} }

async function init(){
  const savedMob      = lsGet(LS_MOBILITY_KEY);
  const savedMobName  = lsGet(LS_MOBILITY_NAME) || "";
  const savedUnsd     = lsGet(LS_UNSD_KEY);
  const savedUnsdName = lsGet(LS_UNSD_NAME) || "";
  try{
    let unsdText = savedUnsd;
    if(!unsdText){
      unsdText = await fetch("itaukei-chord-data/unsd.csv").then(r => { if(!r.ok) throw 0; return r.text(); });
    }
    currentUnsd = unsdMapFromCsv(unsdText);
    currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso3MapFromCsv(unsdText));
    if(savedUnsd && savedUnsdName){
      const el = document.getElementById("file-unsd");
      if(el){ el.textContent = savedUnsdName; document.getElementById("dz-unsd").classList.add("is-loaded"); }
    }

    let mobText = savedMob;
    let mobLabel = savedMobName || "Previously uploaded CSV";
    if(!mobText){
      mobText = await fetch("itaukei-chord-data/mobility.csv").then(r => { if(!r.ok) throw 0; return r.text(); });
      mobLabel = "Default data";
    } else {
      const el = document.getElementById("file-mobility");
      if(el){ el.textContent = savedMobName; document.getElementById("dz-mobility").classList.add("is-loaded"); }
    }
    lastMobilityText = mobText;
    renderFromMobility(mobText, mobLabel);
  } catch(e){
    setMsg("Could not load default data — upload a CSV to render the chart.", "error");
  }
}

// -------- dropzone wiring --------
function wireDropzone(zoneId, inputId, fileLabelId, onFile){
  const zone  = document.getElementById(zoneId);
  const input = document.getElementById(inputId);
  const fileLabel = document.getElementById(fileLabelId);
  const open = () => input.click();
  zone.addEventListener("click", open);
  zone.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } });
  zone.addEventListener("dragover",  e=>{ e.preventDefault(); zone.classList.add("is-dragover"); });
  zone.addEventListener("dragleave", ()=> zone.classList.remove("is-dragover"));
  zone.addEventListener("drop", e=>{
    e.preventDefault(); zone.classList.remove("is-dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) handle(f);
  });
  input.addEventListener("change", ()=>{ const f=input.files && input.files[0]; if(f) handle(f); });
  async function handle(file){
    const csvOk   = /\.csv$/i.test(file.name) || file.type==="text/csv";
    const excelOk = isExcel(file);
    if(!csvOk && !excelOk){ setMsg("Please choose a .csv or .xlsx file.", "error"); return; }
    try{
      const text = await readFile(file);
      const ok = onFile(text, file.name);
      if(ok){ fileLabel.textContent = file.name; zone.classList.add("is-loaded"); }
    }catch(err){
      if(err && err.message==="xlsx-lib-missing"){ setMsg("Excel support failed to load — check your connection, or upload a .csv instead.", "error"); }
      else if(err && err.message==="no-sheets"){ setMsg("That Excel file has no worksheets.", "error"); }
      else { setMsg("Could not read that file.", "error"); }
    }
  }
}

wireDropzone("dz-mobility","input-mobility","file-mobility", (text, name)=>{
  const ok = renderFromMobility(text, name);
  if(ok){
    lastMobilityText = text;
    lsSet(LS_MOBILITY_KEY, text);
    lsSet(LS_MOBILITY_NAME, name || "Uploaded CSV");
  }
  return ok;
});

wireDropzone("dz-unsd","input-unsd","file-unsd", (text, name)=>{
  const map = unsdMapFromCsv(text);
  if(!Object.keys(map).length){ setMsg('That UNSD file has no rows with "Country or Area" + "Region Name" columns.', "error"); return false; }
  currentUnsd = map;
  const iso = iso3MapFromCsv(text);
  if(Object.keys(iso).length) currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso);
  lsSet(LS_UNSD_KEY, text);
  lsSet(LS_UNSD_NAME, name || "Uploaded UNSD CSV");
  if(lastMobilityText){ renderFromMobility(lastMobilityText, "Uploaded CSV"); }
  setMsg("Region reference updated from "+name+" ("+Object.keys(map).length+" countries).", "ok");
  return true;
});

document.getElementById("btn-reset").addEventListener("click", ()=>{
  lastMobilityText = null;
  document.getElementById("file-mobility").textContent = "";
  document.getElementById("file-unsd").textContent = "";
  document.getElementById("input-mobility").value = "";
  document.getElementById("input-unsd").value = "";
  document.getElementById("dz-mobility").classList.remove("is-loaded");
  document.getElementById("dz-unsd").classList.remove("is-loaded");
  currentUnsd = Object.assign({}, EMBEDDED_UNSD);
  currentIso3 = Object.assign({}, EMBEDDED_ISO3);
  // Wipe persisted uploads so a page reload also shows the shipped default.
  lsDel(LS_MOBILITY_KEY); lsDel(LS_MOBILITY_NAME);
  lsDel(LS_UNSD_KEY);     lsDel(LS_UNSD_NAME);
  setMsg("Reset to the default dataset.", "ok");
  init();
});

// -------- CSV template --------
const TEMPLATE_CSV = "Degree(s),scholar_id,scholar,last,first,New?,m_uni,m_city,m_country,m_region,m_lon,m_lat,m_year,m_title,p_uni,p_city,p_country,p_region,p_lon,p_lat,p_year,p_title\nBoth,1,\"Example, Ana\",Example,Ana,,University of the South Pacific,Suva,Fiji,Oceania,178.447,-18.149,2015,\"Master's thesis title\",University of Hawai\u02bbi at M\u0101noa,Honolulu,USA,Americas,-157.8171,21.2969,2021,\"PhD thesis title\"\nPhD only,2,\"Sample, Beni\",Sample,Beni,New,Massey University,Palmerston North,New Zealand,Oceania,175.618,-40.3855,,,University of Auckland,Auckland,New Zealand,Oceania,174.7679,-36.8523,2019,\"PhD thesis title\"\n";
document.getElementById("btn-template").addEventListener("click", (e)=>{
  e.preventDefault();
  const blob = new Blob(["\ufeff"+TEMPLATE_CSV], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "itaukei-alluvial-template.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
  setMsg("Template downloaded — fill it in and drop it back above.", "ok");
});

// -------- level toggle --------
document.querySelectorAll(".level-toggle button").forEach(btn => {
  btn.addEventListener("click", () => {
    const lvl = parseInt(btn.dataset.level, 10);
    if(!lvl || lvl === currentLevel) return;
    currentLevel = lvl;
    document.querySelectorAll(".level-toggle button").forEach(b => b.classList.toggle("is-active", b === btn));
    if(currentFlows) { draw(currentFlows, currentLevel); if(typeof refreshGeneratedStamp === "function") refreshGeneratedStamp(); }
  });
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
  // Aspect ratio is derived from the SVG's current viewBox so the exported PNG
  // matches the on-page chart when the canvas expands with more data.
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
  // Called by draw() after the viewBox is updated. Resyncs the height input to
  // the current aspect ratio, then refreshes the hint text.
  window.__alluvialSyncExportSize = function(){
    if(document.activeElement === hIn) return; // user editing height manually
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
    const clone=src.cloneNode(true);
    const from=src.querySelectorAll("*"), to=clone.querySelectorAll("*");
    const props=["fill","stroke","stroke-width","opacity","fill-opacity","stroke-opacity","font-family","font-size","font-weight","letter-spacing","text-anchor","dominant-baseline"];
    for(let i=0;i<from.length;i++){ const cs=getComputedStyle(from[i]); let s=""; props.forEach(p=>{ const v=cs.getPropertyValue(p); if(v) s+=p+":"+v+";"; }); to[i].setAttribute("style",s); }
    return clone;
  }
  function svgToImage(svgEl,w,h){
    return new Promise((resolve,reject)=>{
      const clone=inlineStyles(svgEl);
      clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
      clone.setAttribute("width",w); clone.setAttribute("height",h);
      const s=new XMLSerializer().serializeToString(clone);
      const blob=new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n'+s],{type:"image/svg+xml;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const img=new Image();
      img.onload=()=>{ resolve({img,url}); };
      img.onerror=(e)=>{ URL.revokeObjectURL(url); reject(e); };
      img.src=url;
    });
  }
  // Core render pipeline: builds a PNG blob at the current export size and
  // triggers a browser download with the given filename. Exposed on window
  // so external scripts (e.g. the origin-country batch exporter) can drive
  // the same rendering path without duplicating the SVG-to-canvas plumbing.
  async function renderPng(filename){
    const o = outPixels();
    const chart = document.getElementById("alluvial-chart");
    const c = await svgToImage(chart, o.pxW, o.pxH);
    const canvas = document.createElement("canvas");
    canvas.width = o.pxW; canvas.height = o.pxH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(c.img, 0, 0, o.pxW, o.pxH);
    URL.revokeObjectURL(c.url);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if(!blob){ reject(new Error("toBlob returned null")); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
        resolve(filename);
      }, "image/png");
    });
  }

  // Build the default filename for the manual Download PNG button and for
  // external batch exports. External callers pass an optional prefix (e.g.
  // "A2", "B0") that becomes the first segment of the filename.
  function defaultFilename(prefix){
    const stamp = window.__alluvialTimestamp || nowHawaiiTimestamp();
    const base = "itaukei-alluvial_level" + currentLevel + "_" + stamp.fileSuffix + ".png";
    return prefix ? (prefix + "_" + base) : base;
  }

  // Expose the render function and filename builder for the batch exporter.
  window.__alluvialRenderPng = renderPng;
  window.__alluvialDefaultFilename = defaultFilename;

  async function download(){
    btn.disabled = true; const label = btn.textContent; btn.textContent = "Rendering\u2026";
    try{
      await renderPng(defaultFilename());
    } catch(err){
      console.error("PNG export failed", err);
      alert("Sorry, the image could not be generated in this browser.");
    } finally {
      btn.textContent = label; btn.disabled = false;
    }
  }
  btn.addEventListener("click", download);
})();

/* ---------- Generated-at timestamp (Hawaii) ---------- */
function nowHawaiiTimestamp(){
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const partsFrom = (opts) => Object.fromEntries(
    new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: "Pacific/Honolulu" }, opts))
      .formatToParts(new Date()).map(p => [p.type, p.value])
  );
  const numeric = partsFrom({ year:"numeric", month:"numeric", day:"numeric", hour:"numeric", minute:"2-digit", hour12:true });
  const day    = parseInt(numeric.day, 10);
  const month  = parseInt(numeric.month, 10);
  const year   = numeric.year;
  const hour   = parseInt(numeric.hour, 10);
  const minute = numeric.minute;
  const ampm   = (numeric.dayPeriod || "am").toLowerCase();
  const fileSuffix = day + MONTHS_SHORT[month-1] + year + "_" + hour + minute + ampm;
  // Long-form for the on-page caption + PNG footer.
  const longText = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
  }).format(new Date());
  return { fileSuffix, longText };
}
function refreshGeneratedStamp(){
  const stamp = nowHawaiiTimestamp();
  window.__alluvialTimestamp = stamp;
  const el = document.getElementById("alluvial-generated");
  if(el) el.textContent = "Generated "+stamp.longText;
  // The on-page Source caption was removed to give the alluvial plot more
  // vertical room, so nothing to update here besides the generated stamp.
}

/* ---------- Fullscreen expand/collapse ---------- */
(function initFullscreen(){
  const btn  = document.getElementById("alluvial-expand");
  const wrap = document.getElementById("alluvial-wrap");
  if(!btn || !wrap) return;
  function setFs(on){
    document.body.classList.toggle("alluvial-fs-on", on);
    wrap.classList.toggle("is-fullscreen", on);
    btn.textContent = on ? "Close \u2715" : "Expand \u21f1";
    btn.setAttribute("aria-label", on ? "Close fullscreen chart" : "Expand chart to fullscreen");
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setFs(!wrap.classList.contains("is-fullscreen"));
  });
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape" && wrap.classList.contains("is-fullscreen")) setFs(false);
  });
})();

refreshGeneratedStamp();
init();
