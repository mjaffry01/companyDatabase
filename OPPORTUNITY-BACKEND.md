# Professional Opportunity

The My profile icon opens an account dialog with name, contact company, verified
sign-in email, phone, and self-reported work status. Name falls back to the
verified Google account name when no contact matches. Missing data is displayed
as Not provided. Working / Not working is saved per verified email in a Profiles
sheet created automatically on first save. A contact company alone does not set
employment status. Deploy the updated Code.gs and include profile.js in the
frontend release to activate this feature. Existing approval rules still apply.

The Opportunities tab accepts pasted text, clipboard JPG/PNG images, and Word
(.doc/.docx), Excel (.xls/.xlsx), PDF, JPG/JPEG and PNG files. Limits: 20,000
characters and 5 attachments totaling 5 MB per submission. After a successful
save, AI (same Gemini-first / OpenAI Script properties as resume analysis)
decomposes the opportunity into **Years of experience**, **Technical skills**,
**Non-technical skills**, **Experience basis**, and **Review notes**. Results
are stored on the opportunity JSON, shown in the Opportunities tab, and logged
to an **Opportunity Analysis** sheet. If LLM properties are missing, the
opportunity still saves and analysis status is `Awaiting LLM setup`.

### Matching candidates to a posted opportunity

Once an opportunity's requirements are extracted (status `Complete` or `Review
needed`), `matchOpportunityToResumes_` (in `apps-script/ResumeAnalysis.gs`)
scores every analyzed resume (the **resumen Analysis** sheet, same one
`uploadResumeAndAnalyze` fills in on upload) against those requirements with a
heuristic - no extra LLM call - that compares:

- **Skills**: each opportunity skill is checked against the resume's skills
  case-insensitively, matching whole tokens ("Node" matches "Node.js", "AWS"
  matches "AWS (EC2, S3)"; "Java" does **not** match "JavaScript"). Technical
  skills are weighted higher than non-technical skills.
- **Years of experience**: the resume's years as a ratio of whatever the
  opportunity requires (full credit when the opportunity states no minimum).

The two are combined 70/30 (skills/experience) into a 0-100 score. Only the
strongest resume per candidate email counts, and only scores at or above
`OPPORTUNITY_MATCH_THRESHOLD` (60) qualify - capped to the top 25 matches so a
vague posting can't fan out into unbounded emails. Matches are **not** written
to the Opportunity Analysis sheet (no schema change needed); they're computed
fresh each time and returned as `analysis.matches` on the opportunity record.

For every match, `sendOpportunityMatchEmail_` emails the **candidate** their
approximate match score and matched skills, the **job description itself**
(the same text/attachment-extracted text the AI analyzed, truncated to 4,000
characters via `truncateForEmail_` with a "see the original posting" note if
longer - not just a skills summary), and, when `findContactsForCompany_` finds
one, the **referral contact's name and email** at that company so the
candidate can reach out directly instead of waiting to be contacted; if no
contact is on file yet the email says so instead. A candidate email failure is
logged and swallowed, never blocking the save. The person who posted the
opportunity sees the matched candidates' names, scores and matched skills in
the Opportunities tab, under the same AI-requirements panel (no candidate
email addresses are shown there).

If there is at least one match, `findContactsForCompany_` looks up the
opportunity's company in the **ReferrerContact** sheet (via `getContacts()` in
Code.gs, matched case/whitespace-insensitively, deduplicated by email). Each
referral contact found gets **one** email from `sendReferralMatchEmail_`
listing every matched candidate (name, email, score, matched skills), the same
job description text, and who posted the opportunity (name and email, from
`profile.name` in `saveOpportunity` and the verified sign-in email) so the
contact knows who to coordinate with. One email per contact per posting, not
per candidate, so a company with several matches doesn't flood its referral
contact. No email goes out at all when the company has no saved referral
contact. The count of
contacts notified is returned as `analysis.referralContactsNotified` and shown
in the post-save status line alongside the candidate match count.

Approved members can submit and reload their latest 100 submissions. The backend
additionally requires the signed-in email to match the Email of a named contact
in ReferrerContact before posting. Owner Email does not qualify: it may identify
someone who entered a colleague's contact. The Opportunities header displays the
matched name and company after sign-in. Any approved member with this contact
match may select or enter another company when posting; separate per-company
approval is not required. New records store the server-derived poster name and
home companies separately from the opportunity company. Existing records remain
readable without inventing attribution that was not recorded.

The backend
uses the verified sign-in email, never an email supplied in the request, to filter
history. Original files, a text file for messages, and a JSON metadata file are
saved in the deploying account's **Professional Opportunity** Drive folder.
Files retain the folder's existing permissions; the app does not enable public
sharing. An Opportunities sheet stores submission IDs, verified emails, and JSON
records. Repeating an unchanged submission ID returns its existing result.

## Activate on the live site

1. In the existing **standalone** Apps Script project, replace Code.gs with the
   complete apps-script/Code.gs in this repository, and ResumeAnalysis.gs with the
   complete apps-script/ResumeAnalysis.gs (matching to resumes and the match emails
   live entirely in that second file). Do not edit the older bound script.
2. Save, then optionally run `setupProfessionalOpportunity` once to create the
   folder immediately. Otherwise the first successful submission creates it.
   The existing Drive and Sheets scopes suffice.
3. Deploy > Manage deployments > edit the existing deployment > New version >
   Deploy. Keep the existing /exec URL and execute-as-owner setting.
4. Publish index.html, opportunities.js, opportunities.css and sw.js with the
   normal GitHub Pages release.
5. As an approved member, submit text and sample attachments, refresh history,
   and verify the originals in Drive. Check another member cannot see that history.

Local changes do not update the live Apps Script project or create a Drive folder
until the updated backend is run. A save error preserves the draft for retry.
