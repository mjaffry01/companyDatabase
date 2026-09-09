// Google Sign-In (Google Identity Services) gate. No Firebase, no billing account needed.
// Access is granted only after the administrator approves the signed-in Google account
// in the "Members" tab of the backing spreadsheet (see apps-script/Code.gs).
window.idToken = null;
let accessRequest = null;

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
  const token = window.idToken;
  if(accessRequest === token) return;
  accessRequest = token;
  const checkBtn = document.getElementById('checkAccessBtn');
  checkBtn.disabled = true;
  try{
    const result = await contactApi('membership', {includeBootstrap:true});
    if(token !== window.idToken) return;
    if(!result.approved){
      authStatusEl().textContent = 'Your account is awaiting administrator approval. Tap "Check access" after you have been approved.';
      return;
    }
    authStatusEl().textContent = 'Loading your contacts…';
    await window.init(result);
    if(token !== window.idToken) return;
    if(result.profile){
      applyOpportunityProfile(result.profile);
      setProfileName(result.profile.name);
    }else{
      // Compatibility with a backend that has not yet received the bundled response.
      void loadProfileName();
    }
  }catch(error){
    if(token !== window.idToken) return;
    authStatusEl().textContent = error.message || 'Could not check access. Try again.';
  }finally{
    if(accessRequest === token) accessRequest = null;
    if(token === window.idToken) checkBtn.disabled = false;
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
  const protocol = window.location.protocol;
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if(protocol !== 'https:' && !(protocol === 'http:' && localHost)){
    const signIn = document.getElementById('googleSignInDiv');
    signIn.replaceChildren();
    signIn.hidden = false;
    authStatusEl().textContent = protocol === 'file:'
      ? 'Google sign-in cannot run from a file opened on your computer. Open the online Contact Book to sign in.'
      : 'Google sign-in needs a secure website address. Open the online Contact Book to sign in.';
    const link = document.createElement('a');
    link.href = 'https://mjaffry01.github.io/companyDatabase/';
    link.textContent = 'Open online Contact Book';
    link.className = 'btn btn-primary';
    signIn.append(link);
    return;
  }
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
