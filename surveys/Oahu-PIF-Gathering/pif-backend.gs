/**
 * Pacific Islander Faculty Beach Gathering — Apps Script Backend
 *
 * Handles:
 *   POST  → append a new survey response to the sheet
 *   GET   ?action=list → return all responses as JSON (used by the dashboard)
 *
 * Setup (one-time):
 *   1. Create a Google Sheet titled "PIF Beach Gathering Responses"
 *   2. Copy its Sheet ID from the URL and paste below
 *   3. Deploy as Web App: Execute as = Me, Access = Anyone
 *   4. Paste the /exec URL into BOTH pif-survey.html and pif-dashboard.html
 *      (replacing REPLACE_WITH_DEPLOYMENT_ID)
 *
 * Maintained by Dr. Ron Vave — ronvave@hawaii.edu
 */

const SHEET_ID   = "REPLACE_WITH_SHEET_ID";
const SHEET_NAME = "Responses";

// Column order written to the sheet (also used as keys when returning JSON)
const COLUMNS = [
  "timestamp",
  "q1_name",
  "q2_institution", "q2_other",
  "q3_email",
  "q3b_department",
  "q4_ranking_1", "q4_ranking_2", "q4_ranking_3", "q4_not_available", "q4_other_date",
  "q5_time",
  "q6_side", "q6_other",
  "q7_markers",
  "q8_food", "q8_other",
  "q9_bring",
  "q10_who", "q10_other",
  "q11_family_count",
  "q12_activities", "q12_other",
  "q13_equipment",
  "q14_help",
  "q16_invite",
  "q17_needs",
  "q18_other"
];

// ───────────────────────────────────────────────────────
// SHEET HELPERS
// ───────────────────────────────────────────────────────
function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  // Ensure header row exists
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ───────────────────────────────────────────────────────
// POST — append response
// ───────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = e && e.postData ? JSON.parse(e.postData.contents) : {};
    const sheet = getSheet_();

    if (!body.timestamp) body.timestamp = new Date().toISOString();

    const row = COLUMNS.map(c => body[c] !== undefined && body[c] !== null ? String(body[c]) : "");
    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ───────────────────────────────────────────────────────
// GET — list responses (used by dashboard)
// ───────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || "list";
  try {
    if (action === "list") {
      const sheet = getSheet_();
      const lastRow = sheet.getLastRow();
      const lastCol = Math.max(sheet.getLastColumn(), COLUMNS.length);
      if (lastRow < 2) {
        return jsonOut_({ ok: true, responses: [] });
      }
      const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      const headers = values[0].map(h => String(h).trim());
      const out = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i];
        // Skip fully empty rows
        if (row.every(v => v === "" || v === null)) continue;
        const obj = {};
        headers.forEach((h, j) => { if (h) obj[h] = row[j]; });
        // Strip personal identifiers from the public payload
        delete obj.q1_name;
        delete obj.q3_email;
        out.push(obj);
      }
      return jsonOut_({ ok: true, responses: out });
    }
    return jsonOut_({ ok: false, error: "unknown action" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
