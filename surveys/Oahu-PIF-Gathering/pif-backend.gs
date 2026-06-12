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

// ─── Email notifications ────────────────────────────────
// On every submission, we email a PDF copy of the responses to:
//   - The submitter themselves (q3_email from the form)
//   - With BCC to the organizers listed below
// If the submitter didn't provide a valid email, we fall back to sending
// only to the BCC list so a copy is never lost.
const NOTIFY_BCC = [
  "ronvave@hawaii.edu",
  "Inoke.Hafoka@byuh.edu",
  "Sione.Funaki@byuh.edu",
  "tammy8@hawaii.edu"
];
// Used as fallback recipient when the submitter has no email address.
const NOTIFY_FALLBACK = "ronvave@hawaii.edu";

// Public-facing URLs included in every confirmation email
const DASHBOARD_URL = "https://ronvave.github.io/vave-lab/surveys/Oahu-PIF-Gathering/pif-dashboard.html";
const SIGNUP_URL    = "https://go.hawaii.edu/7Hi";

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

// Loose email validator (good enough to avoid sending to obviously bad addresses).
function isValidEmail_(s) {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());
}

function buildConfirmationHtml_(body, answersHtml) {
  var firstName = String(body.q1_name || "").trim().split(/\s+/)[0] || "there";
  return '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#1f2328;line-height:1.5;">' +
    '<p>Aloha ' + escapeHtml_(firstName) + ',</p>' +
    '<p>Thank you for completing the <strong>Pacific Islander Faculty Beach Gathering</strong> planning form. ' +
      'A copy of your responses is attached as a PDF for your records.</p>' +
    '<p style="margin:1.2em 0 0.4em 0;"><strong>Live results dashboard</strong><br>' +
      'You can check the latest summary of everyone’s responses any time at:<br>' +
      '<a href="' + DASHBOARD_URL + '">' + DASHBOARD_URL + '</a></p>' +
    '<p style="margin:1.2em 0 0.4em 0;"><strong>Sign-up sheet for contributions</strong><br>' +
      'If you indicated you can bring food, drinks, or equipment, please also add your name and item to the shared sign-up sheet so we avoid duplicates:<br>' +
      '<a href="' + SIGNUP_URL + '">' + SIGNUP_URL + '</a></p>' +
    '<p>Mahalo nui loa,<br>Ron Vave (on behalf of planning team: Inoke &amp; ʻUlise from BYUH, and Tammy from UHM)</p>' +
    '<hr style="margin:1.5em 0;border:none;border-top:1px solid #d0d7de;">' +
    '<h2 style="font-size:14px;margin:0 0 8px 0;color:#57606a;">Your responses</h2>' +
    answersHtml +
    '</body></html>';
}

function sendSubmissionEmail_(body) {
  var name        = body.q1_name        || "(no name)";
  var institution = body.q2_institution || body.q2_other || "(not provided)";
  var department  = body.q3b_department || "(not provided)";
  var submitterEmail = String(body.q3_email || "").trim();

  // Build the answers table (used both for the email body and the PDF).
  var answersHtml = buildSubmissionHtml_(body);

  // PDF attachment
  var safeName = String(name).replace(/[^A-Za-z0-9\-_]+/g, "_").slice(0, 40) || "submission";
  var datePart = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Pacific/Honolulu", "yyyyMMdd-HHmmss");
  var pdfBlob  = Utilities.newBlob(answersHtml, "text/html", "submission.html")
                          .getAs("application/pdf")
                          .setName("PIF-Submission-" + safeName + "-" + datePart + ".pdf");

  // Decide recipient: submitter if valid, otherwise fallback to organizer.
  var toAddress = isValidEmail_(submitterEmail) ? submitterEmail : NOTIFY_FALLBACK;

  // Build the friendly confirmation HTML body for the email itself.
  var emailHtml = buildConfirmationHtml_(body, answersHtml);

  var subject = "Your PIF Beach Gathering survey response — " + name + " (" + institution + ")";
  var plain   =
    "Aloha,\n\n" +
    "Thank you for completing the Pacific Islander Faculty Beach Gathering planning form. " +
    "A copy of your responses is attached as a PDF.\n\n" +
    "Live results dashboard:\n" + DASHBOARD_URL + "\n\n" +
    "Sign-up sheet for contributions (food, drinks, equipment):\n" + SIGNUP_URL + "\n\n" +
    "Submission summary:\n" +
    "  Name: "        + name        + "\n" +
    "  Institution: " + institution + "\n" +
    "  Department: "  + department  + "\n\n" +
    "Mahalo nui loa,\nRon Vave (on behalf of planning team: Inoke & ʻUlise from BYUH, and Tammy from UHM)";

  MailApp.sendEmail({
    to:          toAddress,
    bcc:         NOTIFY_BCC.join(","),
    subject:     subject,
    body:        plain,
    htmlBody:    emailHtml,
    attachments: [pdfBlob],
    name:        "PIF Beach Gathering Survey",
    replyTo:     NOTIFY_FALLBACK
  });
}
