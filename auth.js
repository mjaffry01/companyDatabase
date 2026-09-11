// Google Sign-In (Google Identity Services) gate. No Firebase, no billing account needed.
// Access is granted only after the administrator approves the signed-in Google account
// in the "Members" tab of the backing spreadsheet (see apps-script/Code.gs).
window.idToken = null;
let accessRequest = null;

// Google ID tokens are short-lived (about an hour) by design, and the backend
// re-verifies one on every request via Google's tokeninfo endpoint - caching
// it here is just a client-side copy of the same token, not a new trust
// boundary or a longer-lived credential. Caching it means a page refresh
// does not force a fresh "Sign in with Google" click; once the cached token
// has actually expired, initGoogleSignIn() falls back to Google's silent
// One Tap re-auth (auto_select + google.accounts.id.prompt()) before ever
// showing the sign-in button, so a returning member with an active Google
// browser session stays signed in well past 8 hours without clicking
// anything. Only an explicit "Sign out" clears the cache and turns this off.
const ID_TOKEN_STORAGE_KEY = 'companyContactBook.idToken';
function saveIdToken(token){
  try{ localStorage.setItem(ID_TOKEN_STORAGE_KEY, token); }catch(error){ /* private mode / storage blocked - session just won't survive a refresh */ }
}
function clearSavedIdToken(){
  try{ localStorage.removeItem(ID_TOKEN_STORAGE_KEY); }catch(error){ /* ignore */ }
}
function loadSavedIdToken(){
  try{ return localStorage.getItem(ID_TOKEN_STORAGE_KEY); }catch(error){ return null; }
}

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
  saveIdToken(response.credential);
  showSignedInUI();
  authStatusEl().textContent = 'Checking your access…';
  await checkAccess();
}

// Returns true when the backend accepted the current idToken (whether the
// account is approved yet or still pending), and false when it was rejected
// outright (expired, revoked, wrong audience, etc.) - used by
// tryRestoreSession() to decide whether a cached token is still good.
async function checkAccess(){
  if(!window.idToken){ showSignedOutUI(); return false; }
  const token = window.idToken;
  if(accessRequest === token) return true;
  accessRequest = token;
  const checkBtn = document.getElementById('checkAccessBtn');
  checkBtn.disabled = true;
  let tokenAccepted = true;
  try{
    const result = await contactApi('membership', {includeBootstrap:true});
    if(token !== window.idToken) return true;
    if(!result.approved){
      authStatusEl().textContent = 'New accounts are auto-approved within 3 minutes, or sooner when an administrator approves you. Tap "Check access" to retry.';
      return true;
    }
    authStatusEl().textContent = 'Loading your contacts…';
    await window.init(result);
    if(token !== window.idToken) return true;
    if(result.profile){
      applyOpportunityProfile(result.profile);
      setProfileName(result.profile.name);
    }else{
      // Compatibility with a backend that has not yet received the bundled response.
      void loadProfileName();
    }
  }catch(error){
    if(token !== window.idToken) return true;
    authStatusEl().textContent = error.message || 'Could not check access. Try again.';
    tokenAccepted = false;
  }finally{
    if(accessRequest === token) accessRequest = null;
    if(token === window.idToken) checkBtn.disabled = false;
  }
  return tokenAccepted;
}

// Called once at page load (from initGoogleSignIn) to avoid forcing a fresh
// sign-in click on every refresh: try the cached token first, and drop it
// only if the backend actually rejects it.
async function tryRestoreSession(){
  const cached = loadSavedIdToken();
  if(!cached) return;
  window.idToken = cached;
  showSignedInUI();
  authStatusEl().textContent = 'Checking your access…';
  const ok = await checkAccess();
  if(ok) return;
  window.idToken = null;
  clearSavedIdToken();
  showSignedOutUI();
}

function logout(){
  window.idToken = null;
  clearSavedIdToken();
  if(window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  window.clearContactSession();
  document.getElementById('authGate').hidden = false;
  showSignedOutUI();
}

async function initGoogleSignIn(){
  const protocol = window.location.protocol;
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if(protocol !== 'https:' && !(protocol === 'http:' && localHost)){
    const signIn = document.getElementById('googleSignInDiv');
    signIn.replaceChildren();
    signIn.hidden = false;
    authStatusEl().textContent = protocol === 'file:'
      ? 'Google sign-in cannot run from a double-clicked file. Serve this folder over localhost (for example: npx --yes serve -l 8000) then open http://localhost:8000 — and add http://localhost:8000 as an Authorized JavaScript origin on your Google OAuth client.'
      : 'Google sign-in needs http://localhost or https. Serve this folder locally, or open the online Contact Book.';
    const link = document.createElement('a');
    link.href = 'https://mjaffry01.github.io/companyDatabase/';
    link.textContent = 'Open online Contact Book';
    link.className = 'btn btn-primary';
    signIn.append(link);
    const localHint = document.createElement('p');
    localHint.style.cssText = 'margin-top:12px;font-size:13px;color:var(--text-dim);';
    localHint.textContent = 'Local login: run a static server in this folder, then use http://localhost (not file://).';
    signIn.append(localHint);
    return;
  }
  if(!window.GOOGLE_CLIENT_ID || window.GOOGLE_CLIENT_ID.indexOf('PASTE_') === 0){
    authStatusEl().textContent = 'Google sign-in is being set up. Contact access is temporarily unavailable.';
    return;
  }
  try{
    google.accounts.id.initialize({
      client_id: window.GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true,
      cancel_on_tap_outside: false
    });
    google.accounts.id.renderButton(document.getElementById('googleSignInDiv'), { theme:'outline', size:'large', text:'signin_with' });
    showSignedOutUI();
    await tryRestoreSession();
    if(!window.idToken){
      // No usable cached session - try Google's silent One Tap re-auth (only
      // does anything if this browser still has an active Google session
      // that previously signed in here) before leaving the explicit
      // sign-in button as the only option.
      try{ google.accounts.id.prompt(); }catch(error){ /* FedCM/One Tap unavailable; explicit button still works */ }
    }
  }catch(error){
    authStatusEl().textContent = 'Sign-in could not load. Please check your connection and reload.';
  }
}
