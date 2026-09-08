# Resume upload integration

The frontend now has a third tab, "Resumes", where job seekers (recent graduates or
people who have recently lost their job — not people looking to switch) upload a resume
in `.doc`/`.docx`, `.pdf` or `.html`/`.htm` format, up to 5 MB. It is gated behind the same
Google sign-in + admin approval as the rest of the app.

Like [ADDRESS-BACKEND.md](ADDRESS-BACKEND.md), the deployed Apps Script source is not in
this repository, so adding the code to `apps-script/Code.gs` alone does not make the live
backend accept uploads.

## What was added to `apps-script/Code.gs`

- `RESUME_FOLDER_NAME`, `RESUME_MAX_BYTES`, `RESUME_ALLOWED_EXTENSIONS` constants.
- `uploadResume(submitterEmail, data)` — validates name/email/status/declaration, checks
  the file extension against the allow-list, decodes the base64 payload, enforces the
  5 MB cap, then saves the file into a Drive folder named **"Professional Resumes Raw
  Data"** (created on first use via `getOrCreateResumeFolder()`) and logs a row (name,
  email, phone, status, file name, Drive link, submitter, timestamp) to a **"Resumes"**
  sheet tab (auto-created).
- A new `uploadResume` action wired into `doPost`, requiring the same
  `isApproved(email)` check as `companies`/`contacts`/`addContact`.

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
