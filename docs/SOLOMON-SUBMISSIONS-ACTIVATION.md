# Activate Solomon Islands scholar sharing and approvals

The website implementation and Apps Script deployment are separate. Publishing the repository does not update your Google Apps Script. The public connection stays disabled until the Solomon Islands endpoint reports the correct spreadsheet and enabled submission capabilities.

## 1. Update your existing Solomon Apps Script

1. Open your Solomon Islands Master spreadsheet: https://docs.google.com/spreadsheets/d/1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY/edit
2. Choose **Extensions → Apps Script**. If your existing endpoint uses a separate project, open that existing project from **https://script.google.com/home** instead. Confirm its deployed web-app URL matches the one saved in the Solomon Admin's **Data source & GitHub → Master write-back endpoint**.
3. Save a private copy of the current script code and note the current deployment version for rollback. Preserve all existing Script Properties and the shared secret. Do not generate a replacement secret.
4. Open this complete deployment file in GitHub: https://github.com/ronvave/vave-lab/blob/main/apps-script/deployed/solomon-submissions-v1.gs
5. Click **Raw**, press **Ctrl+A**, then **Ctrl+C**. In the existing project's code file, replace the old backend contents with this complete file and save. It includes the Google signature-verification library; do not also add a second copy of that library or duplicate doGet/doPost functions.
6. In **Project Settings → Script properties**, retain SHARED_SECRET and WRITE_ENABLED=true. Ensure SOLOMON_SPREADSHEET_ID is 1um6pHKriEhbtvmkm7e8E1j0_Zt9A-oYpY88fuPoAmFY. Add SOLOMON_PUBLIC_SUBMISSIONS_ENABLED = true.
7. From the function dropdown at the top, run **backupSolomonReviewDataV2**, then **setupSolomonSubmissionQueues**, then **authorizeScholarSubmissionStorage**, then **initializeSolomonShareTokens**. Approve the requested Google permissions. These create a private backup, private queues/upload storage, and missing share tokens. Existing scholar data and tokens are preserved. Do not make the uploads folder publicly shared.
8. Choose **Deploy → Manage deployments → pencil/Edit → Version: New version → Deploy**. Update the existing web-app deployment, executing as you. Retain its existing /exec URL and access setting that permits the public submission form to reach it.

## 2. Activate the public connection

1. Open https://ronvave.github.io/vave-lab/admin-solomon-islands-master.html and sign in as Owner.
2. Open **Data source & GitHub**. Keep the existing Solomon endpoint, secret and GitHub configuration.
3. Click **Test connection**, then **Activate scholar submissions**.
4. This checks the country and spreadsheet before publishing only the public endpoint and Google client ID. Your secret is not published. It also requests the Solomon snapshot/token refresh.
5. In GitHub Actions, wait for **Refresh Solomon Islands Master File snapshot**, **Verify cache-bust hashes**, **Dashboard integrity**, and the Pages deployment to succeed. Reload the dashboard with **Ctrl+Shift+R**.
6. Click a scholar's **Share** button and open the copied link in a private window. The same scholar should appear with their photo, research summary and linked publications.

## 3. Enable Google sign-in for reviewers

Owner review works with the existing Owner panel. The separate reviewer page needs a Solomon-specific Google authorization configuration.

1. In the Google Cloud project associated with this Apps Script, create or select the intended **Web application** OAuth client. Set **Authorized JavaScript origins** to https://ronvave.github.io. Configure the consent screen/test users as required by that project's publishing status.
2. In Apps Script Script Properties, set:
   - SOLOMON_GOOGLE_CLIENT_ID: that web client ID;
   - SOLOMON_OWNER_EMAIL: your exact authorized Google email;
   - SOLOMON_REVIEWER_EMAILS: only reviewers you authorize, separated by commas.
3. Keep these identities private. Do not copy another country's reviewer list. The backend verifies Google signatures and identity claims; browser sign-in alone does not grant access.
4. Click **Activate scholar submissions** in the Owner panel again to publish the public client ID.
5. Reviewers use https://ronvave.github.io/vave-lab/admin-solomon-review.html . They can review text and geography and record attachment outcomes. Headshots stay pending until the Owner publishes them through the full Owner panel.

## Check the whole workflow

Use a clearly designated test scholar/submission; do not approve fabricated updates to real colleagues merely to test. Submit one changed field, confirm it appears as Pending, review it, and check the exact Master value plus the next successful public refresh. Also test a rejected suggestion. Bibliography/CV/thesis files require actual review/import work; checking a file does not import it. Reports and other excluded types remain excluded from headline publication totals.

The nine provinces are separate from Honiara City. Existing city-area values are preserved and shown as such; Honiara is not added as a tenth province. Paternal and maternal forms each show Province, Island, Village. Maternal values and CVs are private. Institution changes must resolve to existing canonical institution IDs; ambiguous institutions or degree rows remain for manual review. Institution/department website URLs retain the current review workflow's explicit manual application through the Owner editor.

## Rollback

Redeploy the recorded previous Apps Script version and set SOLOMON_PUBLIC_SUBMISSIONS_ENABLED=false. Restore the prior website commit if needed. Preserve tokens, queue rows, uploaded files and the signed review journal; do not delete accepted work. Use the private Master backup only for a deliberate data restoration after comparing intervening changes.
