# Company Contact Book

A PWA that helps a community share company contacts for job referrals, look up existing
contacts, and let job seekers (recent graduates or people who've recently lost a job)
drop off a resume for others to refer. No paid backend — Google Sign-In + a Google Apps
Script Web App + a Google Sheet + Google Drive, all free-tier.

**Live site:** https://mjaffry01.github.io/companyDatabase/ (served by GitHub Pages from
this repo's `main` branch — pushing to `main` deploys the frontend automatically).

## Architecture — read this before changing anything

```
index.html (+ auth.js, auth-config.js)         apps-script/Code.gs
  Static frontend, GitHub Pages       --POST-->   Google Apps Script Web App
  Google Identity Services sign-in                (standalone project, NOT bound
                                                    to the spreadsheet)
                                                       |
                                                       v
                                          Google Sheet "Jobfinder"
                                          (Company Directory / ShiaContacts /
                                           Members / Resumes tabs)
                                                       |
                                                       v
                                          Google Drive folder
                                          "Professional Resumes Raw Data"
```

- **Frontend** (`index.html`, `auth.js`, `auth-config.js`, `manifest.json`, `sw.js`,
  `icons/`) is plain HTML/CSS/JS, no build step, no framework, no npm. Edit the file
  directly, commit, push — GitHub Pages picks it up.
- **Backend** (`apps-script/Code.gs`, `apps-script/appsscript.json`) is a **standalone**
  Google Apps Script project (not "Extensions → Apps Script" from inside the
  spreadsheet — that's a different, older, unrelated bound script that must stay
  untouched). It's deployed as a Web App; the frontend POSTs to its `/exec` URL
  (`window.APPS_SCRIPT_URL` in `auth-config.js`).
- **⚠️ The critical gotcha: `apps-script/Code.gs` in this repo is a mirror, not the live
  source.** Google Apps Script has no git integration and no CLI deploy in this setup —
  the actual live backend only exists inside the Apps Script web editor
  (script.google.com), under the same Google account as the deploying user. **Editing
  the file in this repo and pushing to GitHub does nothing to the live backend.** Every
  backend change needs a manual second step: open the Apps Script project, paste in the
  updated `Code.gs`, save, and deploy a **new version** of the *existing* deployment
  (Deploy → Manage deployments → pencil icon → Version: "New version" → Deploy) so the
  `/exec` URL stays the same and the live frontend keeps working. See
  `GOOGLE-LOGIN-SETUP.md` for full first-time setup, `ADDRESS-BACKEND.md` and
  `RESUME-UPLOAD-BACKEND.md` for the two features that needed this.
- **Data lives in Google, not in this repo**: the "Jobfinder" Google Sheet
  (`SPREADSHEET_ID` in `Code.gs`) holds `Company Directory`, `ShiaContacts` (contacts),
  `Members` (approved sign-ins), and `Resumes` (resume-upload log) tabs. Resume files
  themselves land in a Drive folder named "Professional Resumes Raw Data" (auto-created
  by the script), owned by whichever account deployed the script.
- `deprecated-firebase-backend/` is dead code from an earlier Firebase-based attempt
  (abandoned because it needed a paid Blaze plan). Not used, kept only for reference.

## If you're an AI assistant picking this up

You very likely can't drive the Apps Script web editor UI reliably end-to-end — a few
things there are specifically hostile to browser automation, learned the hard way in
this project's history (see git log):

1. **Google's sign-in prompt (FedCM) and OAuth consent screens cannot be clicked through
   by automation.** They render outside normal page/extension control. If a backend
   change needs a fresh authorization grant (e.g. the script now touches a Google API it
   didn't before), you must ask the human to click through it themselves in their own
   browser — walk them through the exact steps, then verify success by checking the
   **Executions** log (left sidebar in the Apps Script editor) rather than assuming.
2. **When pasting code into the Apps Script (Monaco) editor via clipboard, verify the
   paste actually landed** (scroll to check both top and bottom of the file) before
   saving — clicks on the toolbar/dropdowns there don't always register on the first
   try, and the clipboard can get silently overwritten by an unrelated action earlier in
   the same session. Also strip non-ASCII characters (curly quotes, em dashes, ellipses)
   from strings before pasting — they can get mis-encoded in transit; using a Windows
   clipboard round-trip surfaced this failure mode specifically. Diff your intended
   content against what's actually in the editor before hitting Deploy.
3. **The function-selector dropdown in the Apps Script toolbar is easy to mis-click** —
   confirm the dropdown label actually shows the function you selected before clicking
   Run, or you'll silently re-run the wrong function.
4. A **newly-created, still-empty Google Doc isn't immediately visible to
   `DriveApp.getFileById()`** (Drive's API index lags the Docs UI). If you're testing
   the Google-Doc-link resume path with a throwaway test doc, put real content in it
   first.
5. Prefer testing backend logic by adding a **temporary test function** in the Apps
   Script editor and using Run + the Execution log, over trying to drive the live
   frontend through Google sign-in — it's far more reliable. Delete the temp function
   before your final save.
6. This repo's git history and remote can diverge from what's live on GitHub Pages if
   changes get pushed by another route (e.g. someone using GitHub's web upload
   directly). `git fetch origin` and diff before assuming your local checkout matches
   production.

## Setup docs

- `GOOGLE-LOGIN-SETUP.md` — first-time Google Sign-In + Apps Script backend setup.
- `ADDRESS-BACKEND.md` — notes on the contact-address field (already applied).
- `RESUME-UPLOAD-BACKEND.md` — notes on the Resumes tab / Drive upload / Google Doc link
  feature (already applied), including the `appsscript.json` OAuth-scope fix.

## Current feature set (as of this writing)

- **Opportunities** tab: chat-style submission of text, Word, Excel, PDF and
  JPG/PNG images, including clipboard images. Stores originals and metadata in
  **Professional Opportunity** on Drive, with each member's latest 100 submissions
  shown in their own history. AI processing is deferred. See
  `OPPORTUNITY-BACKEND.md` for the required separate backend deployment.

- **Add a contact** tab: for people currently employed somewhere to share a contact
  there for referrals.
- **Search & lookup** tab: browse companies and existing contacts.
- **Resumes** tab: for recent graduates / recently laid-off job seekers to upload a
  resume (`.doc`/`.docx`/`.pdf`/`.html`/`.htm`, max 5 MB) or paste a Google Doc link
  (must be shared "Anyone with the link" or otherwise accessible to the deploying
  account) — saved to the Drive folder above and logged to the Resumes sheet tab.
