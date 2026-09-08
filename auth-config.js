// Public configuration for the free Google Sign-In + Apps Script backend.
// Safe to expose in client-side code — these are not secrets.
//
// Setup (see GOOGLE-LOGIN-SETUP.md for full steps):
// 1. Create an OAuth Client ID at https://console.cloud.google.com/apis/credentials
//    (Application type: Web application; Authorized JavaScript origin: https://mjaffry01.github.io)
//    Paste it below as GOOGLE_CLIENT_ID.
// 2. Deploy apps-script/Code.gs as a Web App (Execute as: Me, Who has access: Anyone).
//    Paste the deployment's /exec URL below as APPS_SCRIPT_URL.
window.GOOGLE_CLIENT_ID = '414131434266-0kbpen3881ik4e32vjlucd63n3a4ssj9.apps.googleusercontent.com';
window.APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwfYYPiD4TpxfdWRM7HgzMYSHKFgGve44jeXboTDFp2LhaN2Zwh8PObzJL6Lo5ay34k/exec';
