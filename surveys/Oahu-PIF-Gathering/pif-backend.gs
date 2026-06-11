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

const SHEET_ID    = "REPLACE_WITH_SHEET_ID";
const SHEET_NAME  = "Responses";

// Email notifications: every new submission is emailed here with a PDF attachment.
const NOTIFY_EMAIL = "ronvave@hawaii.edu";

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
  "q7b_location_notes",
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

    // Send notification email with PDF of responses (best-effort, never blocks the submission).
    try {
      sendSubmissionEmail_(body);
    } catch (mailErr) {
      console.error("sendSubmissionEmail_ failed: " + mailErr);
    }

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

// ───────────────────────────────────────────────────────
// EMAIL NOTIFICATION + PDF
// ───────────────────────────────────────────────────────

// Human-readable labels for each column. Anything not listed falls back to the raw key.
const FIELD_LABELS = {
  timestamp:          "Submitted at",
  q1_name:            "Q1. Name",
  q2_institution:     "Q2. Institution",
  q2_other:           "Q2. Institution (other)",
  q3_email:           "Q4. Email",
  q3b_department:     "Q3. Department / Unit",
  q4_ranking_1:       "Q5. Date ranking #1",
  q4_ranking_2:       "Q5. Date ranking #2",
  q4_ranking_3:       "Q5. Date ranking #3",
  q4_not_available:   "Q5. Dates not available",
  q4_other_date:      "Q5. Other date",
  q5_time:            "Q6. Preferred time",
  q6_side:            "Q7. Side of island",
  q6_other:           "Q7. Side of island (other)",
  q7_markers:         "Q7. Beach pins (lat,lng)",
  q7b_location_notes: "Q8. Other location info",
  q8_food:            "Q9. Food preference",
  q8_other:           "Q9. Food (other)",
  q9_bring:           "Q10. What you can bring",
  q10_who:            "Q11. Faculty / family",
  q10_other:          "Q11. Other",
  q11_family_count:   "Q12. Family count",
  q12_activities:     "Q13. Activities",
  q12_other:          "Q13. Activities (other)",
  q13_equipment:      "Q14. Equipment",
  q14_help:           "Q15. Help with planning",
  q16_invite:         "Q16. Invite others",
  q17_needs:          "Q17. Accessibility / dietary needs",
  q18_other:          "Q18. Anything else"
};

function escapeHtml_(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSubmissionHtml_(body) {
  const name        = body.q1_name        || "(no name)";
  const institution = body.q2_institution || body.q2_other || "(not provided)";
  const department  = body.q3b_department || "(not provided)";
  const submitted   = body.timestamp ? new Date(body.timestamp).toString() : new Date().toString();

  let rows = "";
  COLUMNS.forEach(function (key) {
    var val = body[key];
    if (val === undefined || val === null || val === "") return;
    var label = FIELD_LABELS[key] || key;
    var display = String(val).replace(/\n/g, "<br>");
    rows += '<tr>' +
      '<td style="padding:6px 10px;border:1px solid #d0d7de;background:#f6f8fa;font-weight:600;width:38%;vertical-align:top;">' +
        escapeHtml_(label) +
      '</td>' +
      '<td style="padding:6px 10px;border:1px solid #d0d7de;vertical-align:top;">' +
        display +
      '</td>' +
    '</tr>';
  });

  return '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2328;">' +
    '<h1 style="font-size:18px;margin:0 0 4px 0;">PIF Beach Gathering — Survey Submission</h1>' +
    '<p style="margin:0 0 14px 0;color:#57606a;font-size:12px;">Submitted ' + escapeHtml_(submitted) + '</p>' +
    '<table style="border-collapse:collapse;border:1px solid #d0d7de;width:100%;font-size:13px;">' +
      '<tr><td style="padding:6px 10px;border:1px solid #d0d7de;background:#eef2f6;font-weight:700;width:38%;">Name</td>' +
      '<td style="padding:6px 10px;border:1px solid #d0d7de;">' + escapeHtml_(name) + '</td></tr>' +
      '<tr><td style="padding:6px 10px;border:1px solid #d0d7de;background:#eef2f6;font-weight:700;">Institution</td>' +
      '<td style="padding:6px 10px;border:1px solid #d0d7de;">' + escapeHtml_(institution) + '</td></tr>' +
      '<tr><td style="padding:6px 10px;border:1px solid #d0d7de;background:#eef2f6;font-weight:700;">Department</td>' +
      '<td style="padding:6px 10px;border:1px solid #d0d7de;">' + escapeHtml_(department) + '</td></tr>' +
      rows +
    '</table>' +
    '</body></html>';
}

function sendSubmissionEmail_(body) {
  if (!NOTIFY_EMAIL) return;

  var name        = body.q1_name        || "(no name)";
  var institution = body.q2_institution || body.q2_other || "(not provided)";
  var department  = body.q3b_department || "(not provided)";

  var html = buildSubmissionHtml_(body);

  // Convert HTML to a PDF blob.
  var safeName = String(name).replace(/[^A-Za-z0-9\-_]+/g, "_").slice(0, 40) || "submission";
  var datePart = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Pacific/Honolulu", "yyyyMMdd-HHmmss");
  var pdfBlob  = Utilities.newBlob(html, "text/html", "submission.html")
                          .getAs("application/pdf")
                          .setName("PIF-Submission-" + safeName + "-" + datePart + ".pdf");

  var subject = "PIF survey submission — " + name + " (" + institution + ")";
  var plain   = "New PIF Beach Gathering survey submission\n\n" +
                "Name: "        + name        + "\n" +
                "Institution: " + institution + "\n" +
                "Department: "  + department  + "\n\n" +
                "Full responses are attached as a PDF.";

  MailApp.sendEmail({
    to:          NOTIFY_EMAIL,
    subject:     subject,
    body:        plain,
    htmlBody:    html,
    attachments: [pdfBlob],
    name:        "PIF Beach Gathering Survey"
  });
}
