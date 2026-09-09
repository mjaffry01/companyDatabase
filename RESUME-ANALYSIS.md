# Resume analysis

`resumen Analysis` is a new tab in the existing Jobfinder workbook. Each Drive
file has one row with name, email, years of experience, technical skills,
non-technical skills, experience evidence, review notes, source link, file ID,
processing status, time, and analysis method. Existing resumes were analyzed in
Codex on 2026-09-09. No Cursor credentials are stored or used.

## Automatic uploads

Deploy both Code.gs and ResumeAnalysis.gs in the existing standalone Apps Script
project, as a new version of the existing web app deployment. An upload saves
its original file and log first, releases the upload lock, and then invokes
analysis. LLM processing runs within that request; it can add time to an upload
but does not run during sign-in. An analysis error does not undo a saved resume.

The prepared adapter supports Gemini's generateContent API. It is disabled until
the owner explicitly chooses Gemini and enters these **Script properties** in
Apps Script Project Settings (never in frontend code or a chat message):

- RESUME_LLM_PROVIDER: gemini
- RESUME_LLM_MODEL: an available Gemini model supporting PDF input and structured JSON
- RESUME_LLM_API_KEY: the API key from that provider's account
- RESUME_LLM_ENABLED: true, only after approving resume processing with that provider

No default model or key is supplied. A Cursor subscription password is not a
Gemini API key. If another provider is chosen, replace the LLM adapter before
enabling it. Enable only after confirming the provider account and its data-use
settings are appropriate for these resumes. No LLM calls are made while disabled.

PDFs are supplied directly as documents. Google Docs are exported as text. Word
and HTML are converted to a temporary private Google Doc via the Drive API,
exported as text, then the temporary copy is moved to trash. Originals remain
untouched. The Drive API must be enabled for the Apps Script Cloud project for
these conversions/exports; existing Drive and external-request scopes are used.

## Recovery and limitations

Run `retryResumeAnalysis` in the Apps Script editor to process up to five pending
uploads, including uploads whose original request ended before analysis. Rerun
until caught up. Completed and Review needed rows are preserved. To explicitly
reanalyze a file, change only its Analysis status to Pending, then retry. Do not
edit the column headers. A Processing row can be retried after 15 minutes.
This is not a recurring timer; each new app upload invokes analysis directly.

The API-dependent path still needs a real provider key and end-to-end validation
with PDF and Word samples. Current automated tests use mocks and test validation,
deduplication, preserving uploads, and disabled-provider behavior. Provider quotas
or Apps Script execution limits can leave analysis pending/failed for owner retry.

Years of experience is null when unsupported; internships are identified,
overlapping roles must not be double counted, and lower bounds/approximate dates
are described in the evidence column. Skills are extracted, not used to rank or
reject candidates. Model JSON is validated and spreadsheet formula prefixes are
escaped. Missing email may be filled from the upload record, with a source note.

References: https://ai.google.dev/api/generate-content and
https://developers.google.com/workspace/drive/api/guides/manage-uploads
