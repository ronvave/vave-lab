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
  "New Zealand":    "#E9AF34",
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
    return {
      m_uni, m_country,
      m_region: (d.m_region || "").trim() || null,
      p_uni, p_country,
      p_region: (d.p_region || "").trim() || null,
      scholar:  (d.scholar || d.Scholar || "").trim() || null
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
  // Turn each scholar into one flow with count 1 (aggregated later).
  const flows = [];
  for(const r of rows){
    flows.push({
      m_region:  resolveRegion(r, "m"),
      m_country: r.m_country,
      m_uni:     r.m_uni,
      p_region:  resolveRegion(r, "p"),
      p_country: r.p_country,
      p_uni:     r.p_uni
    });
  }
  return flows;
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
    if(!grouped.has(k)) grouped.set(k, { ...f, count:0 });
    grouped.get(k).count++;
  }
  const flowList = [...grouped.values()];

  // For each side, we need to know: for a given (region, country, uni),
  // what leaf block it corresponds to and what fraction each flow gets.
  const leftIdx  = new Map(leftLeaves.map(b  => [b.region+"|"+b.country+"|"+b.uni, b]));
  const rightIdx = new Map(rightLeaves.map(b => [b.region+"|"+b.country+"|"+b.uni, b]));

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

  // Group flowList by left leaf block, order within group by right-side rank.
  const byLeft = d3.group(flowList, f => f.m_region+"|"+f.m_country+"|"+f.m_uni);
  for(const [, fs] of byLeft){
    fs.sort((a,b) => cmp(rank(a.p_region,a.p_country,a.p_uni), rank(b.p_region,b.p_country,b.p_uni)));
    const leaf = leftIdx.get(fs[0].m_region+"|"+fs[0].m_country+"|"+fs[0].m_uni);
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
    const leaf = rightIdx.get(fs[0].p_region+"|"+fs[0].p_country+"|"+fs[0].p_uni);
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
  return flowList;
}

/* ------------------------- drawing ------------------------------------ */

// Column geometry: given side (m/p), column index, total cols, and level,
// return the x0/x1 of each column's block bar in the 1600x900 viewport.
function makeGeom(level){
  const VIEW_W = 1600, VIEW_H = 900;
  const plotTop = level === 3 ? 130 : 110;   // leave room for headers
  const plotBottom = VIEW_H - 40;
  const BAR_W = 24;                          // block bar width in px
  // Halved gaps vs. prior (in pixel units for the 900px-tall canvas)
  const scale = (plotBottom - plotTop) / 100; // map 0-100 axis units to px
  const leafGap    = 0.15 * scale;
  const countryGap = 0.30 * scale;
  const regionGap  = 0.75 * scale;

  // Horizontal positions: leave outer margin for labels+swatches
  const labelMargin = 340;  // px reserved on each outer side for uni labels
  const midStart = labelMargin;               // where left-side region column starts
  const midEnd   = VIEW_W - labelMargin;      // where right-side region column ends
  const midW     = midEnd - midStart;         // width available for the ribbon area

  // Column gap between consecutive block bars on the same side.
  const COL_GAP = 12;

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

function draw(flows, level){
  const svg = d3.select("#alluvial-chart");
  svg.selectAll("*").remove();
  const geom = makeGeom(level);
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
  function showTip(evt, html){
    tooltip.innerHTML = html;
    tooltip.style.left = evt.clientX + "px";
    tooltip.style.top  = (evt.clientY - 12) + "px";
    tooltip.style.opacity = "1";
  }
  function hideTip(){ tooltip.style.opacity = "0"; }

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
    gRibbons.append("path")
      .attr("class","ribbon")
      .attr("d", path)
      .attr("fill", color)
      .attr("fill-opacity", 0.55)
      .attr("stroke","none")
      .on("mousemove", (e) => {
        const label = level === 3
          ? `${iso3(f.m_country)}: ${f.m_uni} \u2192 ${iso3(f.p_country)}: ${f.p_uni}`
          : (level === 2 ? `${f.m_country} \u2192 ${f.p_country}` : `${f.m_region} \u2192 ${f.p_region}`);
        showTip(e, `<div class="tip-path">${label}</div><div class="tip-count">${f.count} scholar${f.count>1?"s":""}</div>`);
        gRibbons.selectAll("path.ribbon").classed("dim", true);
        d3.select(e.currentTarget).classed("dim", false);
      })
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
        gBlocks.append("rect")
          .attr("x", b.x0).attr("y", b.y0)
          .attr("width", b.x1 - b.x0).attr("height", b.y1 - b.y0)
          .attr("fill", color || "#999");

        // Vertical label inside region and country columns (not on uni column)
        if(b.kind === "region" && (b.y1 - b.y0) > 30){
          const cx = (b.x0 + b.x1)/2;
          const cy = (b.y0 + b.y1)/2;
          const label = `${b.region} (${b.count})`;
          gBlocks.append("text")
            .attr("class","block-label")
            .attr("x", cx).attr("y", cy)
            .attr("text-anchor","middle").attr("dominant-baseline","middle")
            .attr("transform", `rotate(-90 ${cx} ${cy})`)
            .attr("fill", readableOn(color))
            .attr("style","font-size:12px;")
            .text(label);
        }
        if(b.kind === "country" && (b.y1 - b.y0) > 26){
          const cx = (b.x0 + b.x1)/2;
          const cy = (b.y0 + b.y1)/2;
          const label = `${shortCountry(b.country)} (${b.count})`;
          gBlocks.append("text")
            .attr("class","block-label")
            .attr("x", cx).attr("y", cy)
            .attr("text-anchor","middle").attr("dominant-baseline","middle")
            .attr("transform", `rotate(-90 ${cx} ${cy})`)
            .attr("fill", readableOn(color))
            .attr("style","font-size:11px;")
            .text(label);
        }
      }
      // Small-region side labels (for regions too short to fit on-bar text)
      if(col.kind === "region"){
        for(const b of col.blocks){
          if((b.y1 - b.y0) <= 30){
            // Draw a horizontal label to the outer side of this block
            const cy = (b.y0 + b.y1)/2;
            if(side === "m"){
              gBlocks.append("text")
                .attr("class","region-side-label")
                .attr("x", b.x0 - 8).attr("y", cy)
                .attr("text-anchor","end").attr("dominant-baseline","middle")
                .text(`${b.region} (${b.count})`);
            } else {
              gBlocks.append("text")
                .attr("class","region-side-label")
                .attr("x", b.x1 + 8).attr("y", cy)
                .attr("text-anchor","start").attr("dominant-baseline","middle")
                .text(`${b.region} (${b.count})`);
            }
          }
        }
      }
    }
  }
  drawSide("m", left);
  drawSide("p", right);

  // ---- leaf labels (only for level 3, on the uni column) ----
  const gLabels = svg.append("g").attr("class","labels");
  if(level === 3){
    function drawLeafLabels(side, sideLayout){
      const uniCol = sideLayout.cols[sideLayout.cols.length - 1];
      for(const b of uniCol.blocks){
        const color = COUNTRY_COLORS[b.country] || REGION_COLORS[b.region] || "#999";
        const codeIso = iso3(b.country);
        const text = `${codeIso}: ${b.uni}  (${b.count})`;
        const cy = (b.y0 + b.y1)/2;
        const SW = 9;                    // swatch size (px)
        const PAD = 6;                   // gap between swatch and text
        if(side === "m"){
          // swatch just left of the block, text to the left of the swatch
          const sqX = b.x0 - PAD - SW;
          const sqY = cy - SW/2;
          gLabels.append("rect").attr("class","swatch")
            .attr("x", sqX).attr("y", sqY).attr("width", SW).attr("height", SW)
            .attr("fill", color);
          gLabels.append("text")
            .attr("class","leaf-label")
            .attr("x", sqX - PAD).attr("y", cy)
            .attr("text-anchor","end").attr("dominant-baseline","middle")
            .text(text);
        } else {
          const sqX = b.x1 + PAD;
          const sqY = cy - SW/2;
          gLabels.append("rect").attr("class","swatch")
            .attr("x", sqX).attr("y", sqY).attr("width", SW).attr("height", SW)
            .attr("fill", color);
          gLabels.append("text")
            .attr("class","leaf-label")
            .attr("x", sqX + SW + PAD).attr("y", cy)
            .attr("text-anchor","start").attr("dominant-baseline","middle")
            .text(text);
        }
      }
    }
    drawLeafLabels("m", left);
    drawLeafLabels("p", right);
  }

  // ---- column headers ----
  const gHead = svg.append("g").attr("class","headers");
  if(level === 3){
    // Multi-line: "Where iTaukei / scholars did / their Masters" (or PhD)
    const cols = left.cols;
    const centerLeft  = (cols[0].blocks[0].x0 + cols[cols.length-1].blocks[0].x1)/2;
    const rcols = right.cols;
    const centerRight = (rcols[rcols.length-1].blocks[0].x0 + rcols[0].blocks[0].x1)/2;
    const FS = 15;
    const y0 = 30, lineH = 22;
    function multi(cx, third){
      drawUnderlinedHeader(gHead, cx, y0,        "Where ", "iTaukei", "", FS);
      gHead.append("text").attr("class","col-header-line")
        .attr("x", cx).attr("y", y0 + lineH)
        .attr("text-anchor","middle")
        .attr("style", `font-size:${FS}px;`)
        .text("scholars did");
      gHead.append("text").attr("class","col-header-line")
        .attr("x", cx).attr("y", y0 + 2*lineH)
        .attr("text-anchor","middle")
        .attr("style", `font-size:${FS}px;`)
        .text(third);
    }
    multi(centerLeft,  "their Master\u2019s");
    multi(centerRight, "their PhD");
  } else {
    const cols = left.cols;
    const centerLeft  = (cols[0].blocks[0].x0 + cols[cols.length-1].blocks[0].x1)/2;
    const rcols = right.cols;
    const centerRight = (rcols[rcols.length-1].blocks[0].x0 + rcols[0].blocks[0].x1)/2;
    gHead.append("text").attr("class","col-header col-header-line")
      .attr("x", centerLeft).attr("y", 60)
      .attr("text-anchor","middle")
      .attr("style","font-size:18px; font-weight:600;")
      .text("Master\u2019s — flow from");
    gHead.append("text").attr("class","col-header col-header-line")
      .attr("x", centerRight).attr("y", 60)
      .attr("text-anchor","middle")
      .attr("style","font-size:18px; font-weight:600;")
      .text("PhD — flow to");
  }
}

// Choose black/white text for readability on a filled block.
function readableOn(hexColor){
  if(!hexColor) return "#000";
  const c = d3.color(hexColor);
  if(!c) return "#000";
  const {r,g,b} = c.rgb();
  const l = (0.299*r + 0.587*g + 0.114*b) / 255;
  return l > 0.6 ? "#000" : "#fff";
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
  statusEl.textContent = (label||"Uploaded CSV")+": "+currentFlows.length+" scholars.";
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
async function init(){
  try{
    const [mob, unsd] = await Promise.all([
      fetch("itaukei-chord-data/mobility.csv").then(r => { if(!r.ok) throw 0; return r.text(); }),
      fetch("itaukei-chord-data/unsd.csv").then(r => { if(!r.ok) throw 0; return r.text(); })
    ]);
    currentUnsd = unsdMapFromCsv(unsd);
    currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso3MapFromCsv(unsd));
    lastMobilityText = mob;
    renderFromMobility(mob, "Default data");
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
  if(ok) lastMobilityText = text;
  return ok;
});

wireDropzone("dz-unsd","input-unsd","file-unsd", (text, name)=>{
  const map = unsdMapFromCsv(text);
  if(!Object.keys(map).length){ setMsg('That UNSD file has no rows with "Country or Area" + "Region Name" columns.', "error"); return false; }
  currentUnsd = map;
  const iso = iso3MapFromCsv(text);
  if(Object.keys(iso).length) currentIso3 = Object.assign({}, EMBEDDED_ISO3, iso);
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
    if(currentFlows) draw(currentFlows, currentLevel);
  });
});

/* ------------------------- PNG download ------------------------------- */
(function(){
  const BASE_W = 1600, BASE_H = 900;
  const ASPECT = BASE_H / BASE_W;
  const wIn = document.getElementById("dl-width");
  const hIn = document.getElementById("dl-height");
  const dpiIn = document.getElementById("dl-dpi");
  const hint = document.getElementById("dl-hint");
  const btn = document.getElementById("dl-btn");
  if(!wIn||!hIn||!dpiIn||!btn) return;
  const clampNum=(v,min,max,dflt)=>{ v=parseFloat(v); if(!isFinite(v)) v=dflt; return Math.min(max,Math.max(min,v)); };
  function outPixels(){
    const cssW=clampNum(wIn.value,200,20000,BASE_W);
    const cssH=clampNum(hIn.value,200,20000,Math.round(BASE_W*ASPECT));
    const dpi=clampNum(dpiIn.value,72,1200,300);
    const scale=dpi/96;
    return {cssW,cssH,dpi,pxW:Math.round(cssW*scale),pxH:Math.round(cssH*scale)};
  }
  function refreshHint(){ const o=outPixels(); hint.innerHTML="Output: "+o.pxW+" &times; "+o.pxH+" px at "+o.dpi+" DPI"; }
  let syncing=false;
  wIn.addEventListener("input", ()=>{ if(syncing)return; syncing=true; const w=clampNum(wIn.value,200,20000,BASE_W); hIn.value=Math.round(w*ASPECT); syncing=false; refreshHint(); });
  hIn.addEventListener("input", ()=>{ if(syncing)return; syncing=true; const h=clampNum(hIn.value,200,20000,Math.round(BASE_W*ASPECT)); wIn.value=Math.round(h/ASPECT); syncing=false; refreshHint(); });
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
  async function download(){
    const o=outPixels();
    btn.disabled=true; const label=btn.textContent; btn.textContent="Rendering\u2026";
    try{
      const chart=document.getElementById("alluvial-chart");
      const c=await svgToImage(chart,o.pxW,o.pxH);
      const canvas=document.createElement("canvas");
      canvas.width=o.pxW; canvas.height=o.pxH;
      const ctx=canvas.getContext("2d");
      ctx.fillStyle="#ffffff"; ctx.fillRect(0,0,o.pxW,o.pxH);
      ctx.drawImage(c.img,0,0,o.pxW,o.pxH);
      URL.revokeObjectURL(c.url);
      canvas.toBlob((blob)=>{
        const url=URL.createObjectURL(blob);
        const a=document.createElement("a");
        a.href=url; a.download="itaukei-alluvial_level"+currentLevel+"_"+o.pxW+"x"+o.pxH+"_"+o.dpi+"dpi.png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(url),1500);
        btn.textContent=label; btn.disabled=false;
      },"image/png");
    }catch(err){
      console.error("PNG export failed",err);
      btn.textContent=label; btn.disabled=false;
      alert("Sorry, the image could not be generated in this browser.");
    }
  }
  btn.addEventListener("click", download);
})();

init();
