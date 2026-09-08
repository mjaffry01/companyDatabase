// Google Sign-In (Google Identity Services) gate. No Firebase, no billing account needed.
// Access is granted only after the administrator approves the signed-in Google account
// in the "Members" tab of the backing spreadsheet (see apps-script/Code.gs).
window.idToken = null;

function authStatusEl(){ return document.getElementById('authStatus'); }

function showSignedOutUI(){
  document.getElementById('googleSignInDiv').hidden = false;
  document.getElementById('logoutBtn').hidden = true;
  document.getElementById('checkAccessBtn').hidden = true;
  authStatusEl().textContent = 'Sign in with Google to access the contact book.';
}

function showSignedInUI(){
  document.getElementById('googleSignInDiv').hidden = true;
  document.getElementById('logoutBtn').hidden = false;
  document.getElementById('checkAccessBtn').hidden = false;
}

async function handleCredentialResponse(response){
  window.idToken = response.credential;
  showSignedInUI();
  authStatusEl().textContent = 'Checking your access…';
  await checkAccess();
}

async function checkAccess(){
  if(!window.idToken){ showSignedOutUI(); return; }
  const checkBtn = document.getElementById('checkAccessBtn');
  checkBtn.disabled = true;
  try{
    const result = await contactApi('membership', {});
    if(!result.approved){
      authStatusEl().textContent = 'Your account is awaiting administrator approval. Tap "Check access" after you have been approved.';
      return;
    }
    authStatusEl().textContent = 'Loading your contacts…';
    await window.init();
  }catch(error){
    authStatusEl().textContent = error.message || 'Could not check access. Try again.';
  }finally{
    checkBtn.disabled = false;
  }
}

function logout(){
  window.idToken = null;
  if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  window.clearContactSession();
  document.getElementById('authGate').hidden = false;
  showSignedOutUI();
}

function initGoogleSignIn(){
  if(!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.indexOf('PASTE_') === 0){
    authStatusEl().textContent = 'Google sign-in is being set up. Contact access is temporarily unavailable.';
    return;
  }
  try{
    google.accounts.id.initialize({ client_id: window.GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
    google.accounts.id.renderButton(document.getElementById('googleSignInDiv'), { theme:'outline', size:'large', text:'signin_with' });
    showSignedOutUI();
  }catch(error){
    authStatusEl().textContent = 'Sign-in could not load. Please check your connection and reload.';
  }
}
