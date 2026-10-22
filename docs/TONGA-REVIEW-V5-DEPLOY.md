# Tonga review backend version 5

Prepared 22 October 2026. Scope: the Tonga Admin review queues (Scholar Update Submissions and
Publication Geography Submissions). Installing v5 changes no Master data. Rows are only written when
a reviewer ticks a proposal and presses Approve.

## What v5 adds

| Change | What the reviewer sees |
|---|---|
| CV reading v2 | Education, appointment and publication sections are recognised under many heading names (any capitalisation, spaced capitals). Each degree, position and publication becomes its own proposal with the CV page and source lines. |
| Graduate Degrees rows | A degree proposal either fills empty fields in the matching row (named by Degree ID) or appends a new row with the next Degree ID. Filled Master values are never overwritten; differing values are listed for information. |
| Positions rows | The same for appointments: new rows get Institution, Country, Department / Unit, the verbatim title, a suggested Standardized Academic Rank, Leadership Title, Role Status, Start and End Year. |
| Close previous role | When a new current appointment is proposed, other current Positions rows get an unticked "Mark as past" proposal. |
| Form proposals | "Load proposals from the form" turns the degrees and current title / institution typed into the submission form into the same Graduate Degrees / Positions proposals, with no attachment needed. |
| CV publications | Publication lists inside a CV become Publications and Authorship proposals. DOIs and exact title-and-year matches are completed from Crossref's public metadata; anything else is left as written. |
| Scanned CVs (optional) | If the Drive API service is switched on, CVs with no readable text are read on the server with Google's OCR. The temporary copy is deleted straight away. |
| Degree field fix | The form's Master's / PhD university and year now write to `O_Uni name` and `Year / Status`. Before, they targeted the formula columns `C_Uni name` and `Finish / Completion Year`, so approvals failed. |
| Geography selection | Reviewers tick which proposed locations to add. Unticked locations are not added. |

Safety rules kept from v4: one script lock per request, a "Master changed since review" check before
every write, formula cells never written, ARRAYFORMULA columns never copied, a field allowlist, formula
injection blocked, a Change Log entry for every new row, and the reviewer role allowlist.

## Install (about 10 minutes)

1. Open the Tonga Apps Script project (the one behind the Tonga submissions web app that the Admin page
   uses) at https://script.google.com.
2. Back up first: **File → Make a copy**, or note the current version under **Deploy → Manage
   deployments**. Don't export Script Properties anywhere.
3. Open the main code file. Select all of its text and replace it with the whole contents of
   `Tonga_Review_Backend_v5.gs.txt`. Click **Save**. If the project keeps the token verifier
   (`TongaJWT`) in a separate file, delete the matching block from the pasted text so it's only defined once,
   as with v4.
4. Leave **Project Settings → Script Properties** unchanged.
5. Optional, for scanned CVs: click **Services (+)** in the left sidebar, choose **Drive API**, keep
   version **v3** and identifier **Drive**, then click **Add**.
6. In the function menu at the top, choose `tongaV5CheckSetup` and click **Run**. Accept the Google
   permission prompt if it appears (it asks to connect to an external service, which is Crossref). The log
   should show `"version":"tonga-submissions-5"`, `"parserLoaded":true`, `"crossrefReachable":true`.
7. **Deploy → Manage deployments**, click the pencil on the existing Tonga web app, set **Version: New
   version**, then click **Deploy**. Keep the same URL and the same "Execute as / Who has access"
   settings.
8. Reload the Tonga Admin page. The new controls switch on automatically once the backend reports
   version 5.

## Check after install

- Public check: opening the web app URL with `?action=submissionCapabilities` should show
  `"version":"tonga-submissions-5"`.
- Scholar Update Submissions: a submission with a CV or typed degrees shows "Proposed Master rows",
  grouped by worksheet. Approve one item on a test scholar, then confirm the new row in the Master and the
  Change Log.

## Rollback

Re-deploy the previous version under **Deploy → Manage deployments**. Rows already added stay in
the Master. After a rollback, don't approve Graduate Degrees or Positions proposals; v4 doesn't understand them.
