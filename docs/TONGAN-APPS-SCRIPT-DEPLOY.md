# Tongan Admin — Apps Script Deployment (Session 2026-08-31 rebuild)

This is the **single, canonical deploy procedure** for the Tongan admin web app. It replaces every earlier deployment doc and every one‑off patch note. Follow these steps in order. Do not skip.

The admin is **four files**, all inside one Apps Script project bound to the Tongan Master Sheet:

1. `tongan-master-writeback.gs` — the server (all the logic, MAPPING, validation, Change Log).
2. `tongan-admin-app.html` — the outer web page (the only file that contains `<?!= ... ?>` template snippets).
3. `tongan-admin-writeback-bridge.html` — a small JavaScript library that calls the server via `google.script.run`.
4. `tongan-admin-controller.html` — the JavaScript that draws the admin form and handles clicks.

The admin has **no passwords, no shared secrets, no HMAC, no snapshot passcodes**. Google identity is the only authentication.

**Important — leave the legacy HMAC Apps Script project alone.** The existing HMAC-based Tongan admin (bound to the same Master Sheet) will keep working through its existing `/exec` URL until you retire it. This deploy creates a **new, separate** Apps Script project.

---

## Step 1. Create a NEW, standalone Apps Script project

The existing HMAC-based Tongan Apps Script project (bound to the Master Sheet) stays untouched. You'll create a brand-new standalone project for the Google-auth admin. It doesn't need to be bound to the Sheet — the Master Sheet ID is baked into the server file, so a standalone project reads and writes the Sheet just fine.

1. Open a new browser tab and go to <https://script.google.com/home>. Make sure you're signed in as **`ronvave@hawaii.edu`**.
2. Click the blue **+ New project** button (top-left).
3. A new project opens with a placeholder file `Code.gs` and a title like **Untitled project** at the top-left.
4. Click the title **Untitled project** and rename it to **`Tongan Scholar Database Admin`**. Press Enter.
5. In the left sidebar, hover over the file `Code.gs`, click the three-dot menu that appears, choose **Remove** (or **Delete**), and confirm. The Files list should now be empty. You'll paste the four real files in step 3.

---

## Step 2. Confirm the two required Script Properties

The server refuses to run if these are missing.

1. In the Apps Script editor, click the **gear icon (Project Settings)** on the far left sidebar.
2. Scroll down to **Script Properties**. You should see a small table.
3. Make sure these two rows exist (add them with **Add script property** if they do not):

   | Property key            | Value                                          |
   |-------------------------|------------------------------------------------|
   | `APPROVED_ADMIN_EMAIL`  | `ronvave@hawaii.edu`                           |
   | `WRITE_ENABLED`         | `false`                                        |

   Leave `WRITE_ENABLED` at `false` for now. You will flip it to `true` only after all tests in step 6 pass.

4. A brand-new project won't have any other properties. If a **`SHARED_SECRET`** or any other stale key appears (unlikely here), delete it — nothing reads it anymore.

5. Click **Save script properties** if the button appears.

6. Click the **`< >` code icon** on the left sidebar to return to the file list.

---

## Step 3. Create and paste the four files

You are going to end up with **exactly these four files** in the Apps Script project:

* `tongan-master-writeback.gs`
* `tongan-admin-app` (`.html` — Apps Script hides the extension in the file list)
* `tongan-admin-writeback-bridge` (`.html`)
* `tongan-admin-controller` (`.html`)

For each file, create a blank file in the Apps Script project first:

* For the `.gs` file: click the **+** icon next to **Files** → **Script**. Name it `tongan-master-writeback` (no extension needed — Apps Script adds `.gs` automatically).
* For each `.html` file: click the **+** icon next to **Files** → **HTML**. Name it `tongan-admin-app`, `tongan-admin-writeback-bridge`, `tongan-admin-controller` (no extension needed — Apps Script adds `.html` automatically).

Then for each newly-created file, paste its contents:

* Click the file name in the sidebar to open it.
* Press **Ctrl+A** (Cmd+A on Mac) inside the code area, then **Delete**, so the file is empty.
* Open the matching file from this repo on GitHub (links below), click the **Raw** button, press **Ctrl+A / Cmd+A**, **Ctrl+C / Cmd+C**, come back to the Apps Script tab and press **Ctrl+V / Cmd+V**.
* Press **Ctrl+S / Cmd+S** to save.

Files to copy, in order:

1. `tongan-master-writeback.gs` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/tongan-master-writeback.gs>
2. `tongan-admin-app.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/tongan-admin-app.html>
3. `tongan-admin-writeback-bridge.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/tongan-admin-writeback-bridge.html>
4. `tongan-admin-controller.html` — <https://github.com/ronvave/vave-lab/blob/main/apps-script/tongan-admin-controller.html>

Do not edit any of the pasted content. Do not add or remove blank lines. The files are designed as one interlocking set.

---

## Step 4. Sanity check the server file

1. In the file list click `tongan-master-writeback.gs`.
2. At the top of the code area there is a **function picker** (a dropdown). Choose **`inspectConfig`**.
3. Click **Run**.
4. The first time you do this, Google will pop up an authorization dialog. Click **Review permissions**, pick your Google account (`ronvave@hawaii.edu`), click **Advanced → Go to (unsafe)** if warned, then **Allow**. This is the standard Apps Script first‑run prompt.
5. Click the **Execution log** tab at the bottom of the editor. You should see four lines that look like:

   ```
   APPROVED_ADMIN_EMAIL = ronvave@hawaii.edu
   WRITE_ENABLED        = false
   Spreadsheet ID       = 1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI
   Timezone             = Pacific/Honolulu
   ```

If any line shows `(unset)`, go back to step 2 and add the missing Script Property.

---

## Step 5. Deploy the web app

1. At the top‑right of the Apps Script editor, click **Deploy → Manage deployments**.
2. If there is an existing deployment, click the pencil icon next to it. If there is none, close this window and click **Deploy → New deployment** instead, then pick **Web app** in the settings icon on the top left.
3. Set the deployment settings:
   * **Description:** anything short, e.g. `Tongan admin — 2026-08-31 systematic-repair`.
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

* The page title bar should say `Tongan Scholar Database — Admin`, show your email, and a red pill labelled `READ-ONLY (WRITE_ENABLED=false)`.
* The status bar under the header should end with **"Ready. Pick a worksheet and a row to edit."**
* The worksheet dropdown should be populated.
* Open the **Diagnostics** section at the bottom of the page. `writeEnabled` must be `false`. `activeEmail` must be your email. `worksheets` should be `3` (Scholars, Positions, Graduate Degrees — the same three writable worksheets as the legacy HMAC admin).

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

* Change any low‑stakes free-text field (e.g. `Current Title / Role`) by appending ` [admin-test]` to the current value. **Avoid** enum fields for this test — the Tongan sheet still has some legacy long-form values (like `Alive / current record` for the Alive/Deceased column) that don't match the current enum.
* Click **Save changes**.
* Status bar should turn yellow: **"WRITE_ENABLED=false: dry-run only. 1 written · … Nothing was written."**
* Reload the Master Sheet in another tab and confirm the field is unchanged.

### 6g. High‑consequence confirm gate

* In the edit form, change the value of `Alive / Deceased`. This is the ALWAYS_CONFIRM field — the row turns red and a **"tick to confirm"** checkbox appears next to the field.
* Try to click **Save changes** without ticking the confirm box — it should refuse.
* **Do NOT click Save.** Instead, revert the field to its original value in the form. The red highlight and the confirm checkbox should disappear.

This proves the confirm gate fires on the right field. Actual behaviour when Save is clicked is exercised in step 7 with WRITE_ENABLED=true.

### 6h. Change Log panel

* Click **Refresh** in the "Recent Change Log" card. The most recent Change Log rows appear in the table.

---

## Step 7. Turn writes on and run one real edit

Only do this once every test above has passed.

1. Go back to **Project Settings → Script Properties**.
2. Change `WRITE_ENABLED` from `false` to **`true`**. Save.
3. Reload the admin tab. The badge in the header should now say **`WRITE ENABLED`** in green.
4. Load a Scholars row you're OK making a tiny reversible change to (e.g. your own TNG-S00xx row). Append ` [admin-test]` to the `Record Notes` field.
5. Click Save. The status bar should turn green: **"Wrote 1 field(s). Row reloaded from Master."**
6. Open the Master Sheet — the `Record Notes` cell should show the new value.
7. Open the **Change Log** sheet — the newest row should show your Google email, the scholar ID, and the exact old → new value.
8. **Undo the test change through the admin**: reload the row, remove the ` [admin-test]` you appended, click Save. Verify the Master Sheet cell returns to its original value and a second Change Log entry appears.
9. Flip `WRITE_ENABLED` back to `false` in Script Properties. Reload the admin. Badge returns to red READ-ONLY.

If any step fails, immediately set `WRITE_ENABLED` back to `false`.

---

## Step 8. (Optional) Point the public bookmark

If you want the GitHub Pages bookmark `admin-tongan-master.html` to redirect to the new URL:

1. Open `admin-tongan-master.html` in this repo.
2. Find `REPLACE_WITH_APPS_SCRIPT_EXEC_URL` and paste the `/exec` URL over it.
3. Commit and push. GitHub Pages will pick it up on its next refresh.

---

## What to do if something fails

* **"Fetching MAPPING…" hangs forever.** The bridge is not reaching the server. Open the Apps Script **Executions** log. If there is no `apiDescribe` row for the past minute, the browser JS is broken — reload with DevTools open (`F12`) and copy the console error to the report. If there is an `apiDescribe` row and it shows **Failed** with `not-authorized`, then `APPROVED_ADMIN_EMAIL` doesn't match the account you're signed in as.
* **"Not authorised" page even for your own account.** The deployment is running as the wrong identity. Go back to step 5 and confirm **Execute as: User accessing the web app**.
* **`inspectConfig` prints `WRITE_ENABLED = (unset)`.** Add the property in step 2.
* **Save says "worksheet-not-allowed" or "field-not-allowed".** MAPPING has drifted from the live sheet — either you edited a header in the Sheet or a worksheet was renamed. Compare the live Sheet's row-4 headers against the `var MAPPING = {…}` block at the top of `tongan-master-writeback.gs` and update whichever side is stale (usually the MAPPING).

Nothing in this project should ever be updated by pasting a partial fix. If a real bug turns up, replace all four files as one set, following this doc from Step 3.
