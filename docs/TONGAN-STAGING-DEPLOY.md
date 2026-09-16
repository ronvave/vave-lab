# Tongan Staging Admin — One-Time Manual Deployment

This is the **one blocking manual step** in the integrated rebuild: the Apps Script API cannot be driven programmatically from this environment (Discovery-document fetch for `script/v1` fails structurally), so a new Apps Script project has to be created by hand, once, in the Apps Script editor. Everything else — schema, backup, and all four code files — is already built and pushed to this repo.

This creates a **new, standalone, isolated** Apps Script project. It does **not** touch:
- the live Master Sheet (`1lh6wOFcg2GiFe2YylgxM5cvLOdumdbCrHDLQk87rjRI`),
- the current Google-authenticated production Admin deployment,
- the existing public GitHub Admin panel, or
- the public dashboard.

It reads/writes only the **backup Sheet** (`1XTbiKazab-2WWJmkqjJ6AIWvymBL5-6Jj8EsHXYcXWs`, "Tongan Scholars Master File — BACKUP 2026-09-01 pre-integrated-rebuild").

---

## Step 1. Create a new, standalone Apps Script project

1. Go to <https://script.google.com/home>, signed in as `ronvave@hawaii.edu`.
2. Click **+ New project**.
3. Rename the project (click the title top-left) to **`Tongan Staging Admin (integrated rebuild)`**.
4. Delete the placeholder `Code.gs` file (hover it in the sidebar → three-dot menu → Remove).

## Step 2. Create and paste the four files

Create each file in the project, then paste its contents from this repo (open the raw GitHub link, select all, copy, paste into the Apps Script editor, save):

| File to create in Apps Script | Type | Source in repo |
|---|---|---|
| `tongan-staging-writeback` | Script (.gs) | <https://github.com/ronvave/vave-lab/blob/main/apps-script-staging/tongan-staging-writeback.gs> |
| `tongan-staging-admin-app` | HTML | <https://github.com/ronvave/vave-lab/blob/main/apps-script-staging/tongan-staging-admin-app.html> |
| `tongan-staging-admin-bridge` | HTML | <https://github.com/ronvave/vave-lab/blob/main/apps-script-staging/tongan-staging-admin-bridge.html> |
| `tongan-staging-admin-controller` | HTML | <https://github.com/ronvave/vave-lab/blob/main/apps-script-staging/tongan-staging-admin-controller.html> |

Do not rename these files inside the editor — `doGet()` and the `include()` calls reference these exact names (Apps Script hides the `.html`/`.gs` extension in the file list; use the name without the extension when creating the file).

## Step 3. No Script Properties needed for this build

Unlike the live admin (which used `APPROVED_ADMIN_EMAIL` / `WRITE_ENABLED` Script Properties), the staging server has **no Script Properties to set** — the Admin Users worksheet on the backup Sheet is the authorization source of truth, and the Owner (`ronvave@hawaii.edu`) is already seeded there. The only Script Property the code writes itself is `STAGING_LAST_PUBLISH_TS`, set automatically the first time you use Publish.

## Step 4. First-run authorization

1. In the file list, open `tongan-staging-writeback.gs`.
2. In the function picker dropdown at the top, choose `apiPing`, then click **Run**.
3. Google will show a permissions dialog the first time — click **Review permissions**, choose `ronvave@hawaii.edu`, click **Advanced → Go to (unsafe)** if warned (this is Google's standard unverified-script warning, expected for a private script only you use), then **Allow**.
4. Check the **Execution log** — it should show a normal return value (or a `not-authorized` error if Session.getActiveUser() didn't resolve in this test-run context, which is fine at this stage; the true test is the deployed web app in Step 6).

## Step 5. Deploy as a web app

This deployment setting is **intentionally different from the live admin** because the staging server must serve two different audiences from one URL: signed-in Admin Users (`doGet`, full role-gated admin UI) and **anonymous members of the public** submitting the "Update info" correction form (`doPost`, narrow and heavily sanitized).

1. Click **Deploy → New deployment**.
2. Click the gear icon and choose **Web app**.
3. Settings:
   - **Description:** `Tongan staging — integrated rebuild v1`
   - **Execute as:** **Me (ronvave@hawaii.edu)**
   - **Who has access:** **Anyone**
4. Click **Deploy**.
5. Click **Authorize access** if prompted again, same account.
6. Copy the **Web app URL** (ends in `/exec`). This is the **staging exec URL** — send it back so testing can continue.

> **Why "Execute as: Me" + "Anyone" instead of the live admin's "User accessing the web app" + "Only myself"?** The public correction form runs from a different origin (GitHub Pages) and can only reach the script via an anonymous `fetch()` POST — it cannot use `google.script.run` (same-origin only) and cannot require the submitter to sign in with a Google account. "Execute as: Me" lets that anonymous POST run with the script owner's permission to write to the quarantine tables. The admin `doGet` side still identifies the signed-in Admin User via `Session.getActiveUser()` and denies access to anyone not listed active in `Admin Users` — but this identification path has **not yet been verified end-to-end for a second, non-owner @hawaii.edu account** in this deployment mode. **Test matrix item 1 (unauthorized denial) and item 2 (role enforcement) will confirm this before cutover; if `getActiveUser()` returns blank for a second admin under this deployment mode, that is a real limitation to report, not a bug to silently work around.**

## Step 6. Send back the exec URL

Reply with the `/exec` URL from Step 5. From there, the full 16-item test matrix will be run over HTTP directly against this staging deployment (no further manual steps needed unless a test fails and code needs to change, in which case only Step 2's paste-and-save needs repeating for the changed file).

---

## If something goes wrong

- **"Not authorised" page for your own account** — double-check `ronvave@hawaii.edu` is seeded active with role `Owner` in the `Admin Users` tab of the **backup** Sheet (not the live Sheet). It was verified seeded during this build, but re-check if the tab was accidentally edited.
- **`doPost` returns `unsupported-action`** — expected for anything except `{"action":"submitPublicUpdate", ...}`; this is deliberate (see the header comment in `tongan-staging-writeback.gs`).
- **Need to push a code fix** — edit the file in this repo, commit/push, then re-paste just that one file's contents into the Apps Script editor and click **Deploy → Manage deployments → (pencil icon) → New version** so the live staging `/exec` URL picks up the change without generating a new URL.
