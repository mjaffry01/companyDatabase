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

The adapter tries **Gemini first**, then **OpenAI** if Gemini is missing, errors,
or returns invalid JSON. OpenAI uses the Responses API with strict structured
output and `store: false`. It is disabled until the owner enters these
**Script properties** in Apps Script Project Settings (never in frontend code
or a chat message):

- RESUME_LLM_ENABLED: true
- RESUME_GEMINI_API_KEY and RESUME_GEMINI_MODEL (first choice)
- RESUME_OPENAI_API_KEY and RESUME_OPENAI_MODEL (fallback)

Legacy `RESUME_LLM_PROVIDER` / `RESUME_LLM_API_KEY` / `RESUME_LLM_MODEL` still
work for a single provider. No default model or key is supplied. A Cursor
password is not an API key. Enable only after confirming each provider account
and its data-use settings are appropriate for these resumes. No LLM calls are
made while disabled. The Analysis method column records which provider
succeeded.

PDFs are supplied directly as documents. Google Docs are exported as text. Word
and HTML are converted to a temporary private Google Doc via the Drive API,
exported as text, then the temporary copy is moved to trash. Originals remain
untouched. The Drive API must be enabled for the Apps Script Cloud project for
these conversions/exports; existing Drive and external-request scopes are used.

## Resume fit (compare.js / "Resume Fit" tab)

A separate on-demand comparison, not tied to the Resumes upload flow. The
"Resume fit" tab lets a member paste/attach a resume (file, Google Doc link,
or pasted text) and a job description/opportunity (pasted text and/or up to
5 attached files - text, Office docs, PDFs, or images read via OCR), then
calls `compareResumeToOpportunity` (same `analysisConfiguration()` /
Gemini-first-then-OpenAI setup as automatic uploads - no separate Script
properties needed). It returns strengths, weaknesses, matched/missing JD
skills, a years-of-experience assessment, and project evidence as validated
structured JSON, and logs each comparison to a new **"Resume Fit"** sheet tab
(auto-created by `setupResumeAnalysis`/`resumeFitSheet`). The `doPost`
`compareResumeFit` action is guarded by `typeof compareResumeToOpportunity
=== 'function'`, so the rest of the app keeps working if this file hasn't
been redeployed yet - the frontend then shows a message telling the caller
to deploy the updated `Code.gs`/`ResumeAnalysis.gs`.

## Tailored resume (Word download)

After a Resume Fit comparison completes, a "Generate tailored resume" button
calls the new `generateTailoredResume` action (`ResumeAnalysis.gs`), reusing
the same resume/opportunity inputs plus the just-computed comparison (as
context, not instructions). It returns a structured tailored resume - name,
headline, summary, sections of heading/subheading/bullets - built entirely
from **facts already present in the source resume**: the model may reorder,
regroup and rephrase real bullets/skills toward the JD's language, but
`validateTailoredResume` and the prompt itself forbid inventing an employer,
project, date, metric or skill the resume doesn't already state. Anything the
JD needs that the resume can't back up is named in `missingSkillsNotAdded`
instead of being fabricated in.

`buildTailoredResumeDoc_` renders that structure into a throwaway Google Doc
(`DocumentApp`, titles/headings/bullets - no missing-skills text in the doc
itself), `exportDocAsDocxBase64_` exports it as `.docx` bytes via the Drive
API (`files.export`, same OAuth-token pattern as the rest of the app), and the
temporary Doc is always trashed afterward (even if the export itself fails).
The frontend (`compare.js`) turns the returned base64 into a `Blob` and
triggers a normal browser download - nothing is written to Drive that the
member can see or that persists.

For each skill in `missingSkillsNotAdded` (capped to 5), `suggestGithubProjectsForMissingSkills_`
searches GitHub's public repository search API for real, existing projects
that demonstrate that skill, purely as **"study or build something like
this"** suggestions - they are always someone else's public work, never
inserted into the resume or presented as the candidate's own. GitHub's
unauthenticated search is capped at 10 requests/minute; set `GITHUB_TOKEN` in
Script Properties (a token with no scopes is enough) to raise that if usage
grows. A failed or empty lookup for one skill is skipped silently; it never
blocks the tailored resume itself.

This requires the `https://www.googleapis.com/auth/documents` OAuth scope
(added to `appsscript.json`) on top of the scopes already used elsewhere -
redeploying will prompt for a fresh authorization consent the first time, the
same way adding Drive access did for resume uploads.

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
https://developers.openai.com/api/docs/guides/file-inputs and
https://developers.openai.com/api/docs/guides/structured-outputs and
https://developers.google.com/workspace/drive/api/guides/manage-uploads
