# Google login rollout — free version (no billing account)

The website is locked until configured. Google sign-in gates access using Google Identity
Services (the "Sign in with Google" button) plus a **Google Apps Script Web App** backend —
no Firebase Cloud Functions, no Firestore, no Blaze billing plan, no card ever required.

An earlier attempt used Firebase Cloud Functions, which turned out to require the paid
Blaze plan (a card on file) even for $0 actual usage. That code is kept for reference in
[deprecated-firebase-backend/](deprecated-firebase-backend/) but is **not used**.

## How it works

1. The frontend loads Google Identity Services and shows a "Sign in with Google" button.
2. After sign-in, the frontend has a Google ID token (a signed JWT) proving who the user is.
3. Every data request (`membership`, `companies`, `contacts`, `addContact`) is POSTed to
   the Apps Script Web App along with that ID token.
4. The Apps Script backend verifies the token against Google's own `tokeninfo` endpoint
   (checks audience, issuer, and that the email is verified) on every request — nothing is
   trusted from the browser except "this token is genuinely from this Google account."
5. The verified email must have `Approved = TRUE` in the **Members** sheet tab before any
   company or contact data is returned. New sign-ins are recorded automatically as
   `Approved = FALSE`.

## Setup steps

### 1. Create an OAuth Client ID (free, no billing)

1. Go to <https://console.cloud.google.com/apis/credentials> and select the
   `companydatabase-dc563` project (same project backing Firebase Authentication).
2. **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Authorized JavaScript origins: add `https://mjaffry01.github.io`.
5. Create it, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 2. Deploy the Apps Script backend (free, no billing)

1. Open the "Jobfinder" spreadsheet → **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and paste in the contents of
   [apps-script/Code.gs](apps-script/Code.gs) from this repo.
3. At the top of the script, set `CLIENT_ID` to the OAuth Client ID from step 1.
4. **Deploy → New deployment → type: Web app.**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Authorize the requested permissions (this is your own script accessing your own
   spreadsheet — normal for Apps Script).
6. Copy the deployment's **Web app URL** (ends in `/exec`).

### 3. Wire the frontend to your deployment

In [auth-config.js](auth-config.js), replace the two placeholders:

```js
window.GOOGLE_CLIENT_ID = '...your OAuth Client ID from step 1...';
window.APPS_SCRIPT_URL = '...your Apps Script /exec URL from step 2...';
```

### 4. Publish

Push `index.html`, `auth.js`, `auth-config.js`, `sw.js`, `manifest.json` and `icons/` to the
`mjaffry01/companyDatabase` GitHub repository so GitHub Pages serves the updated site.

## Approval

The first time someone signs in, a row appears in the **Members** tab of the Jobfinder
spreadsheet with `Approved = FALSE`. As administrator:

1. Open the Members tab.
2. Find the row for that person's email.
3. Set column B to `TRUE` to approve, or `FALSE` to revoke access.
4. The user taps **Check access** after you approve them.

There is no custom admin dashboard — approving is literally editing a spreadsheet cell.

## Required security cutover

Disable/archive the **old public Apps Script deployment** referenced in
[deprecated-firebase-backend/](deprecated-firebase-backend/) and remove public access to the
spreadsheet/resume folders. Otherwise the old URL remains an unauthenticated bypass even
though the new site has login. Do not consider rollout complete until that old URL is
tested and confirmed to no longer return data.

## Acceptance checks before launch

- Signed-out requests to the Apps Script URL (no `idToken`) fail with an error.
- Unapproved Google users can sign in but cannot fetch companies/contacts.
- Approved users can search and save; ownership (`Owner Email`) is set from the verified
  token, never from user input.
- A duplicate submission (same company + name) is rejected.
- Signing out clears rendered data; a stale in-flight response cannot repopulate the page
  after sign-out (check by signing out mid-load).
- Test the Google sign-in button in Android Chrome and iPhone Safari. Embedded WhatsApp/
  Instagram in-app browsers may block the Google sign-in popup — such browsers may need
  "Open in external browser."
- Set a Member's `Approved` cell back to `FALSE` and confirm their next request is denied.
- Confirm the old public Apps Script URL no longer returns contacts (see cutover above).

Local syntax checks are not a substitute for these live checks.
