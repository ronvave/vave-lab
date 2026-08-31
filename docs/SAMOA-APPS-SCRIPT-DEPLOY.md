# Samoa Admin — Apps Script Deployment (Session 2026-08-31 rebuild)

This is the **single, canonical deploy procedure** for the Samoa admin web app. It replaces every earlier deployment doc and every one‑off patch note. Follow these steps in order. Do not skip.

The admin is **four files**, all inside one Apps Script project bound to the Samoa Master Sheet:

1. `samoa-master-writeback.gs` — the server (all the logic, MAPPING, validation, Change Log).
2. `samoa-admin-app.html` — the outer web page (the only file that contains `<?!= ... ?>` template snippets).
3. `samoa-admin-writeback-bridge.html` — a small JavaScript library that calls the server via `google.script.run`.
4. `samoa-admin-controller.html` — the JavaScript that draws the admin form and handles clicks.

**The old fifth file — `samoa-admin-master-inline.html` — has been retired. You will delete it in step 3 below.**

The admin has **no passwords, no shared secrets, no HMAC, no snapshot passcodes**. Google identity is the only authentication.

---

## Step 1. Open the Apps Script project

1. Go to the Samoa Master Sheet: <https://docs.google.com/spreadsheets/d/1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ/edit>
2. On the Sheet menu bar click **Extensions → Apps Script**. A new tab opens showing the Apps Script editor.
3. In the left sidebar you will see a list of files under a section labelled **Files**. That is the file list you will be editing in the next step.

---

## Step 2. Confirm the two required Script Properties

The server refuses to run if these are missing.

1. In the Apps Script editor, click the **gear icon (Project Settings)** on the far left sidebar.
2. Scroll down to **Script Properties**. You should see a small table.
3. Make sure these two rows exist (add them with **Add script property** if they do not):

   | Property key            | Value                                          |
   |-------------------------|------------------------------------------------|
   | `APPROVED_ADMIN_EMAIL`  | `ronvave@hawaii.edu`                        |
   | `WRITE_ENABLED`         | `false`                                        |

   Leave `WRITE_ENABLED` at `false` for now. You will flip it to `true` only after all tests in step 6 pass.

4. If a **`SHARED_SECRET`** property still exists, delete it (it is a leftover from the retired HMAC contract; nothing reads it anymore).

5. Click **Save script properties** if the button appears.

6. Click the **`< >` code icon** on the left sidebar to return to the file list.

---

## Step 3. Replace the four files (and delete the fifth)

You are going to end up with **exactly these four files** in the Apps Script project:

* `samoa-master-writeback.gs`
* `samoa-admin-app` (`.html` — Apps Script hides the extension in the file list)
* `samoa-admin-writeback-bridge` (`.html`)
* `samoa-admin-controller` (`.html`)

**Delete the old `samoa-admin-master-inline` file first.**

1. In the file list, click the three‑dot menu next to `samoa-admin-master-inline` and choose **Delete**. Confirm.

Now replace the other four files, one at a time. For each file:

* Click the file name in the sidebar to open it.
* Press **Ctrl+A** (Cmd+A on Mac) inside the code area, then **Delete**, so the file is empty.
* Open the matching file from this repo on GitHub (links below), click the **Raw** button, press **Ctrl+A / Cmd+A**, **Ctrl+C / Cmd+C**, come back to the Apps Script tab and press **Ctrl+V / Cmd+V**.
* Press **Ctrl+S / Cmd+S** to save.

Files to copy, in order:

1. `samoa-master-writeback.gs` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/samoa-master-writeback.gs>
2. `samoa-admin-app.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/samoa-admin-app.html>
3. `samoa-admin-writeback-bridge.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/samoa-admin-writeback-bridge.html>
4. `samoa-admin-controller.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/samoa-admin-controller.html>

Do not edit any of the pasted content. Do not add or remove blank lines. The files are designed as one interlocking set.

---

## Step 4. Sanity check the server file

1. In the file list click `samoa-master-writeback.gs`.
2. At the top of the code area there is a **function picker** (a dropdown). Choose **`inspectConfig`**.
3. Click **Run**.
4. The first time you do this, Google will pop up an authorization dialog. Click **Review permissions**, pick your Google account (`ronvave@hawaii.edu`), click **Advanced → Go to (unsafe)** if warned, then **Allow**. This is the standard Apps Script first‑run prompt.
5. Click the **Execution log** tab at the bottom of the editor. You should see four lines that look like:

   ```
   APPROVED_ADMIN_EMAIL = ronvave@hawaii.edu
   WRITE_ENABLED        = false
   Spreadsheet ID       = 1X-RZSWKbzG-oY7anCYaR54Ev8h2G8yl0SXy6jMNhCHQ
   Timezone             = Pacific/Honolulu
   ```

If any line shows `(unset)`, go back to step 2 and add the missing Script Property.

---

## Step 5. Deploy the web app

1. At the top‑right of the Apps Script editor, click **Deploy → Manage deployments**.
2. If there is an existing deployment, click the pencil icon next to it. If there is none, close this window and click **Deploy → New deployment** instead, then pick **Web app** in the settings icon on the top left.
3. Set the deployment settings:
   * **Description:** anything short, e.g. `Samoa admin — 2026-08-31 systematic-repair`.
   * **Execute as:** **User accessing the web app** ← this is the critical setting; the server refuses to run in any other mode.
   * **Who has access:** **Only myself** (or "Anyone with a Google account" — either works because the server double‑checks the email).
4. Click **Deploy**.
5. Copy the **Web app URL** shown (it ends in `/exec`). Keep it — this is the admin URL.

If you already had a deployment and just clicked the pencil, the URL will be the same as before, and you have to click **Deploy → New version** so the code changes actually go live. Do that.

---

## Step 6. Test in this exact order, before turning writes on

Open the `/exec` URL in a new browser tab. If a Google sign‑in appears, sign in with `ronvave@hawaii.edu`.

Do these tests one by one. Each must pass before moving to the next.

### 6a. Loads and reads the MAPPING

* The page title bar should say `Samoa Scholar Database — Admin`, show your email, and a red pill labelled `READ-ONLY (WRITE_ENABLED=false)`.
* The status bar under the header should end with **"Ready. Pick a worksheet and a row to edit."**
* The worksheet dropdown should be populated.
* Open the **Diagnostics** section at the bottom of the page. `writeEnabled` must be `false`. `activeEmail` must be your email. `worksheets` should be `25`.

If the status bar says anything else — screenshot it and stop.

### 6b. Ping

* Click **Test connection**.
* Status bar turns green: `Ping OK. Active email: ronvave@hawaii.edu. WRITE_ENABLED: false.`

### 6c. Unauthorized user is blocked

* In a **second Chrome profile** (or an Incognito window signed into a different Google account), open the same `/exec` URL.
* You should see a plain page titled **Not authorised**, showing the wrong email in a code box.
* No admin surface, no worksheet dropdown, no data.

Close that tab.

### 6d. Executions log confirms server calls

* Back in the Apps Script editor, click the **clock icon (Executions)** on the left sidebar.
* You should see log rows for `doGet`, `apiDescribe`, `apiListKeys` (if you picked a worksheet), `apiPing`. All rows should be green (Completed).

### 6e. Read a real row

* Back in the admin tab, pick **Scholars** in the worksheet dropdown.
* In the key box, start typing a real Scholar ID. Autocomplete should suggest existing values.
* Click **Load row**. The edit form appears with every Scholars field populated from the live sheet.

### 6f. Dry‑run write (WRITE_ENABLED is still false)

* Change any low‑stakes field (e.g. `Display Name`) by adding then removing a space, so the row is marked dirty.
* Click **Save changes**.
* Status bar should turn yellow: **"WRITE_ENABLED=false: dry-run only. 1 written · … Nothing was written."**
* Reload the Master Sheet in another tab and confirm the field is unchanged.

### 6g. High‑consequence confirm gate

* Change `Review Status`. The row should turn red and a **"tick to confirm"** checkbox appears.
* Try to click **Save changes** without ticking — it should stay disabled.
* Tick the confirm box, click Save. It runs a dry-run as above.

### 6h. Change Log panel

* Click **Refresh** in the "Recent Change Log" card. The most recent Change Log rows appear in the table.

---

## Step 7. Turn writes on and run one real edit

Only do this once every test above has passed.

1. Go back to **Project Settings → Script Properties**.
2. Change `WRITE_ENABLED` from `false` to **`true`**. Save.
3. Reload the admin tab. The badge in the header should now say **`WRITE ENABLED`** in green.
4. Load a Scholars row for a scholar you actively want to edit, make one small allowlisted change, and click Save.
5. The status bar should turn green: **"Wrote 1 field(s). Row reloaded from Master."**
6. Open the Master Sheet — the cell should show the new value.
7. Open the **Change Log** sheet — the newest row should show your Google email, the scholar ID, and the exact old → new values.

If any of those does not happen, immediately set `WRITE_ENABLED` back to `false`.

---

## Step 8. (Optional) Point the public bookmark

If you want the GitHub Pages bookmark `admin-samoa-master.html` to redirect to the new URL:

1. Open `admin-samoa-master.html` in this repo.
2. Find `REPLACE_WITH_APPS_SCRIPT_EXEC_URL` and paste the `/exec` URL over it.
3. Commit and push. GitHub Pages will pick it up on its next refresh.

---

## What to do if something fails

* **"Fetching MAPPING…" hangs forever.** The bridge is not reaching the server. Open the Apps Script **Executions** log. If there is no `apiDescribe` row for the past minute, the browser JS is broken — reload with DevTools open (`F12`) and copy the console error to the report. If there is an `apiDescribe` row and it shows **Failed** with `not-authorized`, then `APPROVED_ADMIN_EMAIL` doesn't match the account you're signed in as.
* **"Not authorised" page even for your own account.** The deployment is running as the wrong identity. Go back to step 5 and confirm **Execute as: User accessing the web app**.
* **`inspectConfig` prints `WRITE_ENABLED = (unset)`.** Add the property in step 2.
* **Save says "worksheet-not-allowed" or "field-not-allowed".** MAPPING has drifted from the live sheet. Re-run `samoa_build/generate_allowlist.py` and paste the new `var MAPPING = {…}` block into `samoa-master-writeback.gs`.

Nothing in this project should ever be updated by pasting a partial fix. If a real bug turns up, replace all four files as one set, following this doc from Step 3.
