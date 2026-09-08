# Professional Opportunity

The Opportunities tab accepts pasted text, clipboard JPG/PNG images, and Word
(.doc/.docx), Excel (.xls/.xlsx), PDF, JPG/JPEG and PNG files. Limits: 20,000
characters and 5 attachments totaling 5 MB per submission. AI processing is not enabled.

Approved members can submit and reload their latest 100 submissions. The backend
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
