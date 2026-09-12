// Google Sign-In (Google Identity Services) gate. No Firebase, no billing account needed.
// Access is granted only after the administrator approves the signed-in Google account
// in the "Members" tab of the backing spreadsheet (see apps-script/Code.gs).
window.idToken = null;
window.sessionToken = null;
let authGeneration = 0; // bumped on every sign-in attempt / sign-out so in-flight requests can detect they're stale
let accessRequest = null; // the authGeneration currently being checked, to dedupe concurrent checkAccess() calls

// contactApi() (index.html) sends sessionToken when we have one, idToken otherwise.
// Other files (profile.js) use this to guard against a stale response after the
// user signs out or in again mid-request, without caring which credential type is active.
window.currentCredential = function(){ return window.sessionToken || window.idToken; };

// The backend issues its own sessionToken (HMAC-signed, ~8h validity - see
// Code.gs's "Session tokens" note) once a sign-in is confirmed approved. That,
// not the raw Google idToken (which itself only lasts about an hour and can't
// be silently renewed in every browser - FedCM/third-party-cookie support
// varies), is what gets cached across a refresh: contactApi() sends
// sessionToken once we have one, so a refresh restores it here and the
// backend accepts it directly with no round-trip to Google at all, until the
// full ~8h session actually elapses. Only then does the app fall back to a
// fresh Google sign-in (silently via One Tap when the browser allows it,
// otherwise the visible "Sign in with Google" button). Only an explicit
// "Sign out" clears the cache and disables the silent One Tap re-auth.
const SESSION_TOKEN_STORAGE_KEY = 'companyContactBook.sessionToken';
function saveSessionToken(token){
  try{ localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token); }catch(error){ /* private mode / storage blocked - session just won't survive a refresh */ }
}
function clearSavedSessionToken(){
  try{ localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY); }catch(error){ /* ignore */ }
}
function loadSavedSessionToken(){
  try{ return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY); }catch(error){ return null; }
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
  window.sessionToken = null; // a fresh Google sign-in always re-establishes the session from scratch
  authGeneration++;
  showSignedInUI();
  authStatusEl().textContent = 'Checking your access…';
  await checkAccess();
}

// Returns true when the backend accepted the current credential (whether the
// account is approved yet or still pending), and false when it was rejected
// outright (expired, revoked, wrong audience, etc.) - used by
// tryRestoreSession() to decide whether a cached session is still good.
async function checkAccess(){
  if(!window.currentCredential()){ showSignedOutUI(); return false; }
  const gen = authGeneration;
  if(accessRequest === gen) return true;
  accessRequest = gen;
  const checkBtn = document.getElementById('checkAccessBtn');
  checkBtn.disabled = true;
  let tokenAccepted = true;
  try{
    const result = await contactApi('membership', {includeBootstrap:true});
    if(gen !== authGeneration) return true;
    if(result.sessionToken){ window.sessionToken = result.sessionToken; saveSessionToken(result.sessionToken); }
    if(!result.approved){
      authStatusEl().textContent = 'New accounts are auto-approved within 3 minutes, or sooner when an administrator approves you. Tap "Check access" to retry.';
      return true;
    }
    authStatusEl().textContent = 'Loading your contacts…';
    await window.init(result);
    if(gen !== authGeneration) return true;
    if(result.profile){
      applyOpportunityProfile(result.profile);
      setProfileName(result.profile.name);
    }else{
      // Compatibility with a backend that has not yet received the bundled response.
      void loadProfileName();
    }
  }catch(error){
    if(gen !== authGeneration) return true;
    authStatusEl().textContent = error.message || 'Could not check access. Try again.';
    tokenAccepted = false;
  }finally{
    if(accessRequest === gen) accessRequest = null;
    if(gen === authGeneration) checkBtn.disabled = false;
  }
  return tokenAccepted;
}

// Called once at page load (from initGoogleSignIn) to avoid forcing a fresh
// sign-in click on every refresh: try the cached session token first, and
// drop it only if the backend actually rejects it.
async function tryRestoreSession(){
  const cached = loadSavedSessionToken();
  if(!cached) return;
  window.sessionToken = cached;
  authGeneration++;
  showSignedInUI();
  authStatusEl().textContent = 'Checking your access…';
  const ok = await checkAccess();
  if(ok) return;
  window.sessionToken = null;
  clearSavedSessionToken();
  showSignedOutUI();
}

function logout(){
  window.idToken = null;
  window.sessionToken = null;
  authGeneration++;
  clearSavedSessionToken();
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
    if(!window.currentCredential()){
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
