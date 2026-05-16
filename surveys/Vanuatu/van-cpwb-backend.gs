// =============================================================================
// vanuatu-cpwb-backend.gs
// Google Apps Script backend for the Vanuatu CPWB Survey
// =============================================================================
//
// SETUP INSTRUCTIONS FOR DR. RON VAVE:
//   1. Open Google Sheets and create a new spreadsheet.
//      Name the first sheet exactly: "Vanuatu CPWB survey form results"
//   2. In the spreadsheet menu: Extensions → Apps Script
//   3. Delete any placeholder code, then paste this entire file.
//   4. Save (Ctrl+S or ⌘S). Name the project "Vanuatu CPWB Backend".
//   5. Click Deploy → New deployment.
//      - Type: Web app
//      - Description: "Vanuatu CPWB Survey v1"
//      - Execute as: Me (your Google account)
//      - Who has access: Anyone
//   6. Click Deploy. Authorise access when prompted (click "Allow").
//   7. Copy the Web app URL (looks like:
//        https://script.google.com/macros/s/AKfycb.../exec )
//   8. Open vanuatu-cpwb-survey.html in a text editor, find the line:
//        const APPS_SCRIPT_URL = "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec";
//      and replace the whole URL with the one you just copied.
//   9. Save the HTML file. The survey now submits to your Google Sheet.
//
// TESTING:
//   - After deployment, visit the Web app URL in your browser.
//     You should see: {"status":"ok","service":"Vanuatu CPWB Survey Backend"}
//   - Submit a test response from the survey. Reload your Google Sheet
//     to confirm the row appeared.
//
// COLUMN HEADERS:
//   The script automatically creates column headers on first submission.
//   Do NOT manually add headers — they will be created automatically.
//
// =============================================================================

// Sheet name — must match exactly
var SHEET_NAME = "Vanuatu CPWB survey form results";

// Column headers in submission order
var HEADERS = [
  "Timestamp",
  "Language Used",
  // Step 1 — Profile
  "Respondent Name",
  "Email",
  "Respondent Role",
  "Age Range",
  "Gender",
  "Years of Residence",
  "Preferred Survey Language",
  // Step 2 — Location
  "Province",
  "Selected Island",
  "Selected Village Name",
  "Selected Village ID",
  "Island Other (free text)",
  "Village Other (free text)",
  "Tabu Area Local Name",
  "Latitude",
  "Longitude",
  // Step 3 — Awareness
  "Aware of Tabu Areas",
  "CPWB Types Known",
  "Other CPWB Type (described)",
  "Local Terms for Tabu Areas",
  // Step 4 — CPWB Modules
  // FPA
  "FPA Status",
  "FPA Declared For",
  "FPA Who Declares",
  "FPA Duration",
  "FPA Water Types",
  "FPA Rules",
  "FPA Sanctions",
  "FPA Additional Info",
  // CIPA
  "CIPA Status",
  "CIPA Who Declares",
  "CIPA Duration",
  "CIPA Water Types",
  "CIPA Sanctions",
  "CIPA Additional Info",
  // CircPA
  "CircPA Status",
  "CircPA Who Declares",
  "CircPA Duration",
  "CircPA Water Types",
  "CircPA Additional Info",
  // MecPA
  "MecPA Status",
  "MecPA Species/Resources",
  "MecPA Who Declares",
  "MecPA Duration",
  "MecPA Additional Info",
  // ConcPA
  "ConcPA Status",
  "ConcPA Context",
  "ConcPA Who Declares",
  "ConcPA Duration",
  "ConcPA Additional Info",
  // Step 5 — Chief block
  "Chief Declared Closure",
  "Chief Declaration Process",
  "Chief MPA Recognition",
  "Chief MPA Conflict",
  "Chief MPA Conflict Description",
  "Chief Support Needs",
  "Chief Additional Comments",
  // Step 6 — Community block
  "Community Compliance Level",
  "Compliance Factors",
  "Perceived Effectiveness",
  "Ecological Changes Observed",
  "Ecological Changes Description",
  "Willing to Support Documentation",
  "Community Additional Comments",
  // Step 8 — Feedback
  "Open Feedback",
  "Heard Via",
  "Want PDF Copy",
  "Willing for Follow-up",
  "Follow-up Contact"
];

// Map from header name to JSON field key
var FIELD_MAP = {
  "Timestamp":                     "timestamp",
  "Language Used":                 "language_used",
  "Respondent Name":               "resp_name",
  "Email":                         "resp_email",
  "Respondent Role":               "respondent_role",
  "Age Range":                     "resp_age",
  "Gender":                        "resp_gender",
  "Years of Residence":            "resp_years_residence",
  "Preferred Survey Language":     "resp_lang",
  "Province":                      "province",
  "Selected Island":               "selected_island",
  "Selected Village Name":         "selected_village_name",
  "Selected Village ID":           "selected_village_id",
  "Island Other (free text)":      "island_other",
  "Village Other (free text)":     "village_other",
  "Tabu Area Local Name":          "tabu_area_name",
  "Latitude":                      "lat",
  "Longitude":                     "lon",
  "Aware of Tabu Areas":           "aware_general",
  "CPWB Types Known":              "cpwb_types_known",
  "Other CPWB Type (described)":   "cpwb_other_type_text",
  "Local Terms for Tabu Areas":    "cpwb_local_terms",
  "FPA Status":                    "fpa_status",
  "FPA Declared For":              "fpa_declared_for",
  "FPA Who Declares":              "fpa_who_declares",
  "FPA Duration":                  "fpa_duration",
  "FPA Water Types":               "fpa_water_type",
  "FPA Rules":                     "fpa_rules",
  "FPA Sanctions":                 "fpa_sanctions",
  "FPA Additional Info":           "fpa_additional",
  "CIPA Status":                   "cipa_status",
  "CIPA Who Declares":             "cipa_who_declares",
  "CIPA Duration":                 "cipa_duration",
  "CIPA Water Types":              "cipa_water_type",
  "CIPA Sanctions":                "cipa_sanctions",
  "CIPA Additional Info":          "cipa_additional",
  "CircPA Status":                 "circpa_status",
  "CircPA Who Declares":           "circpa_who_declares",
  "CircPA Duration":               "circpa_duration",
  "CircPA Water Types":            "circpa_water_type",
  "CircPA Additional Info":        "circpa_additional",
  "MecPA Status":                  "mecpa_status",
  "MecPA Species/Resources":       "mecpa_species",
  "MecPA Who Declares":            "mecpa_who_declares",
  "MecPA Duration":                "mecpa_duration",
  "MecPA Additional Info":         "mecpa_additional",
  "ConcPA Status":                 "concpa_status",
  "ConcPA Context":                "concpa_context",
  "ConcPA Who Declares":           "concpa_who_declares",
  "ConcPA Duration":               "concpa_duration",
  "ConcPA Additional Info":        "concpa_additional",
  "Chief Declared Closure":        "chief_declared",
  "Chief Declaration Process":     "chief_process",
  "Chief MPA Recognition":         "chief_mpa_recognition",
  "Chief MPA Conflict":            "chief_mpa_conflict",
  "Chief MPA Conflict Description":"chief_conflict_desc",
  "Chief Support Needs":           "chief_support_needs",
  "Chief Additional Comments":     "chief_additional",
  "Community Compliance Level":    "community_compliance",
  "Compliance Factors":            "compliance_factors",
  "Perceived Effectiveness":       "perceived_effectiveness",
  "Ecological Changes Observed":   "ecological_changes",
  "Ecological Changes Description":"ecological_changes_desc",
  "Willing to Support Documentation": "willing_documentation",
  "Community Additional Comments": "community_additional",
  "Open Feedback":                 "open_feedback",
  "Heard Via":                     "heard_via",
  "Want PDF Copy":                 "want_pdf",
  "Willing for Follow-up":         "willing_followup",
  "Follow-up Contact":             "followup_contact"
};


// =============================================================================
// doPost: receives JSON from survey, appends a row to the sheet
// =============================================================================
function doPost(e) {
  try {
    var raw = e.postData ? e.postData.contents : '';
    var data = JSON.parse(raw);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      // Create the sheet if it doesn't exist
      sheet = ss.insertSheet(SHEET_NAME);
    }

    // Ensure header row exists
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
      // Style header row
      var headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
      headerRange.setBackground('#005f6b');
      headerRange.setFontColor('#ffffff');
      headerRange.setFontWeight('bold');
      headerRange.setFontSize(9);
      sheet.setFrozenRows(1);
    }

    // Build row in header order
    var row = HEADERS.map(function(header) {
      var key = FIELD_MAP[header];
      if (!key) return '';
      var val = data[key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      return String(val);
    });

    sheet.appendRow(row);

    // Auto-resize columns on first few rows
    if (sheet.getLastRow() <= 5) {
      sheet.autoResizeColumns(1, HEADERS.length);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        status: "success",
        id: new Date().toISOString(),
        rows: sheet.getLastRow() - 1
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        status: "error",
        message: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// =============================================================================
// doGet: multi-action endpoint
//   No action / health-check:   GET <url>
//   List all responses:         GET <url>?action=list
//   List with auth (admin):     GET <url>?action=list&token=ADMIN_READ_TOKEN
//   Update one response:        GET <url>?action=update&id=<timestamp>&token=...&payload=<urlencoded JSON>
//   Delete one response:        GET <url>?action=delete&id=<timestamp>&token=...
//
// NOTE: For the dashboard (read-only public stats) leave ADMIN_READ_TOKEN_REQUIRED=false.
// For update/delete, the caller MUST send a matching token. Set ADMIN_WRITE_TOKEN below.
// =============================================================================

// Optional read protection — leave false for a public dashboard; set true if you want
// the dashboard to also require a token before listing rows.
var ADMIN_READ_TOKEN_REQUIRED = false;
var ADMIN_READ_TOKEN = "";  // leave empty unless ADMIN_READ_TOKEN_REQUIRED = true

// REQUIRED for update/delete from the admin page. Generate a random string
// (e.g., openssl rand -hex 24) and paste it into the admin HTML as well.
var ADMIN_WRITE_TOKEN = "REPLACE_WITH_ADMIN_WRITE_TOKEN";

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function _getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME);
}

function _readAllRows() {
  var sheet = _getSheet();
  if (!sheet || sheet.getLastRow() < 2) return [];
  var range = sheet.getRange(1, 1, sheet.getLastRow(), HEADERS.length);
  var values = range.getValues();
  var headerRow = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var obj = {};
    for (var j = 0; j < HEADERS.length; j++) {
      var header = HEADERS[j];
      var key = FIELD_MAP[header] || header;
      obj[key] = row[j];
    }
    obj._row = i + 1;  // 1-indexed sheet row number for update/delete
    rows.push(obj);
  }
  return rows;
}

function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "";
    var sheet = _getSheet();
    var rowCount = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;

    // Health check (no action)
    if (!action) {
      return _json({
        status: "ok",
        service: "Vanuatu CPWB Survey Backend",
        sheet: SHEET_NAME,
        submissions: rowCount,
        columns: HEADERS.length,
        timestamp: new Date().toISOString()
      });
    }

    // LIST — used by dashboard and admin
    if (action === "list") {
      if (ADMIN_READ_TOKEN_REQUIRED) {
        if (!e.parameter.token || e.parameter.token !== ADMIN_READ_TOKEN) {
          return _json({ status: "error", message: "Unauthorized" });
        }
      }
      var rows = _readAllRows();
      return _json({
        status: "success",
        count: rows.length,
        responses: rows
      });
    }

    // UPDATE — admin only
    if (action === "update") {
      if (!e.parameter.token || e.parameter.token !== ADMIN_WRITE_TOKEN) {
        return _json({ status: "error", message: "Unauthorized" });
      }
      var rowNum = parseInt(e.parameter.row, 10);
      if (!rowNum || rowNum < 2) {
        return _json({ status: "error", message: "Invalid row number" });
      }
      var payload = JSON.parse(e.parameter.payload || "{}");
      var rowValues = HEADERS.map(function(h) {
        var key = FIELD_MAP[h] || h;
        var val = payload[key];
        if (val === null || val === undefined) return '';
        if (typeof val === 'boolean') return val ? 'Yes' : 'No';
        return String(val);
      });
      sheet.getRange(rowNum, 1, 1, HEADERS.length).setValues([rowValues]);
      return _json({ status: "success", action: "update", row: rowNum });
    }

    // DELETE — admin only
    if (action === "delete") {
      if (!e.parameter.token || e.parameter.token !== ADMIN_WRITE_TOKEN) {
        return _json({ status: "error", message: "Unauthorized" });
      }
      var delRow = parseInt(e.parameter.row, 10);
      if (!delRow || delRow < 2) {
        return _json({ status: "error", message: "Invalid row number" });
      }
      sheet.deleteRow(delRow);
      return _json({ status: "success", action: "delete", row: delRow });
    }

    return _json({ status: "error", message: "Unknown action: " + action });
  } catch(err) {
    return _json({ status: "error", message: err.message });
  }
}


// =============================================================================
// Utility: clearSheet (run manually from Apps Script editor to reset data)
// =============================================================================
function clearSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) {
    sheet.clearContents();
    Logger.log('Sheet cleared: ' + SHEET_NAME);
  }
}


// =============================================================================
// Utility: listColumns (run to log the column headers — useful for debugging)
// =============================================================================
function listColumns() {
  Logger.log('Column headers (' + HEADERS.length + ' total):');
  HEADERS.forEach(function(h, i) {
    Logger.log((i+1) + '. ' + h + '  →  ' + (FIELD_MAP[h] || '(no mapping)'));
  });
}
