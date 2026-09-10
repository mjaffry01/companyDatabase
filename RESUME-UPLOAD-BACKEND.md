# Resume upload integration

The frontend now has a third tab, "Resumes", where job seekers (recent graduates or
people who have recently lost their job — not people looking to switch) upload a resume
in `.doc`/`.docx`, `.pdf` or `.html`/`.htm` format (up to 5 MB), or paste a link to a
**Google Doc** instead of uploading a file. It is gated behind the same Google sign-in +
admin approval as the rest of the app.

Like [ADDRESS-BACKEND.md](ADDRESS-BACKEND.md), the deployed Apps Script source is not in
this repository, so adding the code to `apps-script/Code.gs` alone does not make the live
backend accept uploads.

## What was added to `apps-script/Code.gs`

- `RESUME_FOLDER_NAME`, `RESUME_MAX_BYTES`, `RESUME_ALLOWED_EXTENSIONS` constants.
- `uploadResume(submitterEmail, data)` — validates name/email/status/declaration, then
  branches on which of two inputs was sent:
  - **File upload**: checks the file extension against the allow-list, decodes the
    base64 payload, enforces the 5 MB cap, and saves it into the Drive folder.
  - **Google Doc link** (`data.googleDocUrl`): extracts the doc ID via
    `extractGoogleDocId()`, opens it with `DriveApp.getFileById()`, and uses
    `file.makeCopy()` to copy it (as a native Google Doc) into the same Drive folder —
    the submitter's doc must have sharing set to "Anyone with the link" (or otherwise be
    accessible to the account the script runs as) or this throws a friendly error.
  Either way the file lands in a Drive folder named **"Professional Resumes Raw Data"**
  (created on first use via `getOrCreateResumeFolder()`) and a row (name, email, phone,
  status, file name, Drive link, submitter, timestamp) is logged to a **"Resumes"** sheet
  tab (auto-created).
- A new `uploadResume` action wired into `doPost`, requiring the same
  `isApproved(email)` check as `companies`/`contacts`/`addReferrerContact`.

## `appsscript.json`

Added an explicit `oauthScopes` list (Drive, Sheets, external requests) so the project's
authorized scope is never narrower than `https://www.googleapis.com/auth/drive.file` —
without it, Apps Script may auto-detect a narrower Drive scope that can create files fine
but can't open a pre-existing file (like a job seeker's Google Doc) by ID. To use this
file, enable **Project Settings → Show "appsscript.json" manifest file in editor** in the
Apps Script project, then paste its contents in alongside `Code.gs`.

## Deploy steps

1. Open the deployed Apps Script project (**not** `Extensions → Apps Script` from inside
   the spreadsheet — that is the old, separate backend; open the standalone project you
   created per `GOOGLE-LOGIN-SETUP.md`).
2. Replace `Code.gs` with the full contents of [apps-script/Code.gs](apps-script/Code.gs)
   from this repo (it now includes the resume-upload code alongside everything else).
3. Save, then **Deploy → Manage deployments → edit the existing Web app deployment → New
   version → Deploy**, so the current `/exec` URL in `auth-config.js` keeps working.
4. Because this is the first use of `DriveApp` in the script, Google will prompt for an
   additional authorization step (Drive access) — accept it under the same account the
   script runs as ("Execute as: Me"). That account's Drive is where the
   "Professional Resumes Raw Data" folder will be created.
5. Upload a test resume from the "Resumes" tab and confirm: the file appears in the
   "Professional Resumes Raw Data" Drive folder, and a row appears in the new "Resumes"
   sheet tab.
