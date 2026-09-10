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
   complete apps-script/Code.gs in this repository. Do not edit the older bound script.
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
