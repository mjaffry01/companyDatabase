/**
 * Free backend for the Company Contact Book - Google Apps Script Web App.
 * No Firebase, no Cloud Functions, no billing account required.
 *
 * SETUP (see GOOGLE-LOGIN-SETUP.md for the full walkthrough):
 * 1. Go to https://script.google.com/home -> New project. Do NOT use
 *    Extensions -> Apps Script from inside the spreadsheet -- that opens the
 *    *existing* bound script, which is the old public backend and must stay
 *    untouched until this new one is confirmed working.
 * 2. Paste this whole file in as Code.gs (replacing the default content).
 *    Also add apps-script/ResumeAnalysis.gs as a second script file in the
 *    same standalone project (File -> New -> Script). Resume analysis on
 *    upload needs both files. Uploads still succeed if analysis is missing.
 * 3. Fill in CLIENT_ID below with your OAuth Client ID
 *    (from https://console.cloud.google.com/apis/credentials).
 * 4. Deploy -> New deployment -> Web app.
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the resulting /exec URL into auth-config.js as APPS_SCRIPT_URL.
 *
 * Security model:
 * - Every request must carry a Google ID token (idToken) obtained from the
 *   Google Identity Services "Sign in with Google" button on the frontend.
 * - The token is verified against the tokeninfo endpoint Google provides, on every
 *   request (audience, issuer, email_verified are all checked).
 * - The verified email must exist in the "Members" sheet tab with
 *   Approved = TRUE before any company/contact data is returned.
 * - New sign-ins are recorded automatically as Approved = FALSE; the
 *   administrator flips that to TRUE by hand after verifying the person.
 */

// ---- Fill this in ----
const CLIENT_ID = '414131434266-0kbpen3881ik4e32vjlucd63n3a4ssj9.apps.googleusercontent.com';

// ---- Sheet layout (edit only if your tab/column names differ) ----
// This is a STANDALONE script (not bound to the spreadsheet), so it needs the
// spreadsheet's ID explicitly rather than SpreadsheetApp.getActiveSpreadsheet().
// It is deliberately kept separate from the spreadsheet's existing bound script
// (the old public backend) so that one is untouched until ready to retire it.
const SPREADSHEET_ID = '1cgJ8wGEPkQW8QbrBuCqa9Z1Pcq62yma2R3N9YKoMSnk';
const COMPANY_SHEET = 'Company Directory';
const CONTACTS_SHEET = 'ReferrerContact';
const CONTACTS_SHEET_LEGACY = 'ShiaContacts';
const MEMBERS_SHEET = 'Members';
const AUTO_APPROVE_MINUTES = 3;
const RESUMES_SHEET = 'Resumes';
const RESUME_FOLDER_NAME = 'Professional Resumes Raw Data';
const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RESUME_ALLOWED_EXTENSIONS = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', html: 'text/html', htm: 'text/html' };
// The Resumes tab (uploadResume) only accepts Word files - kept separate from
// RESUME_ALLOWED_EXTENSIONS above, which Resume Fit's comparisonResumePart still
// uses to accept PDF/HTML resumes for one-off JD comparisons.
const RESUME_UPLOAD_ALLOWED_EXTENSIONS = { doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const COMPANY_HEADERS = { n: 'Company Name', s: 'Company Type', t: 'Size', a: 'Hyderabad Office Address', c: 'Careers Page URL' };
const CAREER_SHEET_CANDIDATES = ['careerOpportunities', 'Career Opportunities', 'Careers URLs', 'Career URLs'];
const CAREER_URL_HEADERS = ['Careers URL', 'Careers Page URL', 'Career URL', 'URL'];

function ss(){ return SpreadsheetApp.openById(SPREADSHEET_ID); }

function json(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e){
  return json({ error: 'This endpoint only accepts POST requests.' });
}

function doPost(e){
  try{
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const payload = verifyToken(body.idToken);
    const email = payload.email;
    const action = body.action;

    if(action === 'membership'){
      const approved = checkMembership(email, payload.sub);
      if(!approved || body.includeBootstrap !== true) return json({approved:approved});
      const contacts = getContacts();
      return json({approved:true, companies:getCompanies(), contacts:contacts,
        profile:getOpportunityProfile(email, contacts, payload.name)});
    }

    if(!isApproved(email)){
      throw new Error('Administrator approval is required.');
    }
    if(action === 'companies') return json({ companies: getCompanies() });
    if(action === 'addCompany') return json(addCompany(email, body));
    if(action === 'contacts') return json({ contacts: getContacts() });
    if(action === 'addReferrerContact' || action === 'addContact') return json(addReferrerContact(email, body));
    if(action === 'saveCareerUrl') return json(saveCareerUrl(email, body));
    if(action === 'saveHrContact') return json(saveHrContact(email, body));
    if(action === 'uploadResume'){
      return json(typeof uploadResumeAndAnalyze === 'function'
        ? uploadResumeAndAnalyze(email, body)
        : uploadResume(email, body));
    }
    if(action === 'myResumes') return json({ resumes: myResumes(email) });
    if(action === 'deleteResume') return json(deleteResume(email, body));
    if(action === 'opportunityProfile') return json({ profile: getOpportunityProfile(email) });
    if(action === 'profile') return json({ profile: getUserProfile(email, payload.name) });
    if(action === 'saveWorkStatus') return json(saveWorkStatus(email, body.workStatus, payload.name));
    if(action === 'opportunities') return json({ opportunities: getOpportunities(email), profile: getOpportunityProfile(email) });
    if(action === 'saveOpportunity') return json(saveOpportunity(email, body));
    if(action === 'compareResumeFit'){
      return json(typeof compareResumeToOpportunity === 'function'
        ? compareResumeToOpportunity(email, body)
        : {error:'Resume comparison is not deployed yet.'});
    }
    throw new Error('Unknown action.');
  }catch(error){
    return json({ error: (error && error.message) || String(error) });
  }
}

// ---- Google ID token verification ----
function verifyToken(idToken){
  if(!idToken) throw new Error('Sign in with Google.');
  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if(response.getResponseCode() !== 200) throw new Error('Your sign-in expired. Please sign in again.');
  const payload = JSON.parse(response.getContentText());
  if(payload.aud !== CLIENT_ID) throw new Error('Sign-in is not valid for this app.');
  if(payload.email_verified !== 'true' && payload.email_verified !== true){
    throw new Error('Your Google account email is not verified.');
  }
  if(payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com'){
    throw new Error('Invalid token issuer.');
  }
  return payload; // { email, sub, email_verified, aud, iss, ... }
}

// ---- Membership (approval) ----
function getMembersSheet(){
  let sheet = ss().getSheetByName(MEMBERS_SHEET);
  if(!sheet){
    sheet = ss().insertSheet(MEMBERS_SHEET);
    sheet.appendRow(['Email', 'Approved', 'Google Account ID', 'First seen', 'Welcome email sent']);
    return sheet;
  }
  // Add the welcome-email-sent column to existing sheets that were created before this feature.
  const headers = sheet.getRange(1, 1, 1, 5).getValues()[0];
  if(String(headers[4] || '').trim().toLowerCase() !== 'welcome email sent'){
    sheet.getRange(1, 5).setValue('Welcome email sent');
  }
  return sheet;
}

function adminEmailAddresses(){
  const p = PropertiesService.getScriptProperties();
  return String(p.getProperty('ADMIN_EMAIL') || '').split(',').map(e => e.trim()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

function notifyAdminsOfPendingMember(email, sub){
  const admins = adminEmailAddresses();
  if(!admins.length) return;
  const subject = 'New member approval needed: ' + email;
  // Always the public frontend, never ScriptApp.getService().getUrl(): that returns this
  // backend's own /exec (or, for anything that isn't a live web-app request - an editor run,
  // a time-driven trigger - the /dev test-deployment URL, which real users can't open at all).
  const appUrl = 'https://mjaffry01.github.io/companyDatabase/';
  const body = 'A new member signed in to Company Contact Book:\n\nEmail: ' + email + '\nGoogle ID: ' + sub + '\nTime: ' + new Date().toLocaleString() + '\n\nTo approve immediately, open the Jobfinder spreadsheet Members tab and set Approved = TRUE for this email.\n\nIf you do nothing, they will be auto-approved in ' + AUTO_APPROVE_MINUTES + ' minutes and will receive a welcome email.\n\nApp: ' + appUrl;
  admins.forEach(admin => {
    try{ MailApp.sendEmail(admin, subject, body); }catch(error){ console.error('Admin notify failed', error); }
  });
}

function sendWelcomeEmail(email){
  // Always the public frontend, never ScriptApp.getService().getUrl(): that returns this
  // backend's own /exec (or, for anything that isn't a live web-app request - an editor run,
  // a time-driven trigger - the /dev test-deployment URL, which real users can't open at all).
  const appUrl = 'https://mjaffry01.github.io/companyDatabase/';
  try{
    MailApp.sendEmail(email, 'Your Company Contact Book access is approved',
      'Hi,\n\nYour access to the Company Contact Book has been granted. You can now sign in and explore the app.\n\n' + appUrl + '\n\nIf you did not request this, please ignore this email.');
  }catch(error){ console.error('Welcome email failed', error); }
}

function findMemberRow(sheet, email){
  const data = sheet.getDataRange().getValues();
  const target = String(email).toLowerCase();
  for(let i = 1; i < data.length; i++){
    if(String(data[i][0]).toLowerCase() === target) return i + 1; // 1-based sheet row
  }
  return -1;
}

function isApproved(email){
  const sheet = getMembersSheet();
  const row = findMemberRow(sheet, email);
  return row !== -1 && sheet.getRange(row, 2).getValue() === true;
}

function checkMembership(email, sub){
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let isNew = false;
  let rowNumber;
  let approved = false;
  let notifyAdmin = false;
  let sendWelcome = false;
  try{
    const sheet = getMembersSheet();
    const row = findMemberRow(sheet, email);
    if(row === -1){
      sheet.appendRow([email, false, sub, new Date(), '']);
      rowNumber = sheet.getLastRow();
      isNew = true;
    }else{
      rowNumber = row;
    }

    const approvedCell = sheet.getRange(rowNumber, 2);
    approved = approvedCell.getValue() === true;
    if(!approved){
      const firstSeen = sheet.getRange(rowNumber, 4).getValue();
      if(firstSeen && typeof firstSeen.getTime === 'function' && (Date.now() - firstSeen.getTime()) >= AUTO_APPROVE_MINUTES * 60 * 1000){
        approvedCell.setValue(true);
        approved = true;
      }
    }

    if(isNew && !approved) notifyAdmin = true;
    if(approved){
      const sentCell = sheet.getRange(rowNumber, 5);
      if(sentCell.getValue() !== true){
        sentCell.setValue(true);
        sendWelcome = true;
      }
    }
  }finally{
    lock.releaseLock();
  }

  // Send emails outside the spreadsheet lock.
  if(notifyAdmin) notifyAdminsOfPendingMember(email, sub);
  if(sendWelcome) sendWelcomeEmail(email);
  return approved;
}

function sendPendingWelcomeEmails(){
  const sheet = getMembersSheet();
  const data = sheet.getDataRange().getValues();
  const rowsToSend = [];
  for(let i = 1; i < data.length; i++){
    const approved = data[i][1] === true;
    const sent = data[i][4] === true;
      if(approved && !sent) rowsToSend.push(i + 1);
  }
  rowsToSend.forEach(row => {
    const email = sheet.getRange(row, 1).getValue();
    try{
      sendWelcomeEmail(email);
      sheet.getRange(row, 5).setValue(true);
    }catch(error){ console.error('Welcome email failed', error); }
  });
}

function autoApprovePendingMembers(){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) return;
  try{
    const sheet = getMembersSheet();
    const data = sheet.getDataRange().getValues();
    const cutoff = AUTO_APPROVE_MINUTES * 60 * 1000;
    for(let i = 1; i < data.length; i++){
      const approved = data[i][1] === true;
      const firstSeen = data[i][3];
      if(!approved && firstSeen && typeof firstSeen.getTime === 'function' && (Date.now() - firstSeen.getTime()) >= cutoff){
        sheet.getRange(i + 1, 2).setValue(true);
      }
    }
  }finally{
    lock.releaseLock();
  }
  sendPendingWelcomeEmails();
}

function setupAutoApprovalTrigger(){
  const triggers = ScriptApp.getProjectTriggers();
  const exists = triggers.some(t => t.getHandlerFunction() === 'autoApprovePendingMembers');
  if(exists) return 'Auto-approval trigger already exists.';
  ScriptApp.newTrigger('autoApprovePendingMembers').timeBased().everyMinutes(1).create();
  return 'Auto-approval trigger created. It runs every minute.';
}

// ---- Company Directory ----
function findHeaderRow(sheet, firstColumnValue){
  const rowsToScan = Math.min(15, sheet.getLastRow());
  if(rowsToScan < 1) return -1;
  const values = sheet.getRange(1, 1, rowsToScan, 1).getValues();
  for(let i = 0; i < values.length; i++){
    if(String(values[i][0]).trim() === firstColumnValue) return i + 1;
  }
  return -1;
}

function findCareerSheet_(){
  const book = ss();
  for(let i = 0; i < CAREER_SHEET_CANDIDATES.length; i++){
    const sheet = book.getSheetByName(CAREER_SHEET_CANDIDATES[i]);
    if(sheet) return sheet;
  }
  const sheets = book.getSheets();
  for(let i = 0; i < sheets.length; i++){
    const sheet = sheets[i];
    if(String(sheet.getName()).toLowerCase() === String(COMPANY_SHEET).toLowerCase()) continue;
    const headerRow = findHeaderRow(sheet, COMPANY_HEADERS.n);
    if(headerRow === -1) continue;
    const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
    if(CAREER_URL_HEADERS.some(h => headers.indexOf(h) >= 0)) return sheet;
  }
  return null;
}

function ensureCareerSheet_(){
  let sheet = findCareerSheet_();
  if(sheet) return sheet;
  sheet = ss().insertSheet(CAREER_SHEET_CANDIDATES[0]);
  sheet.getRange(1, 1, 1, 5).setValues([['Company Name', 'Careers URL', 'Source', 'Updated by', 'Updated at']]);
  return sheet;
}

function careerSheetIndexes_(sheet){
  const headerRow = findHeaderRow(sheet, COMPANY_HEADERS.n);
  if(headerRow === -1) throw new Error('careerOpportunities sheet is missing a Company Name header.');
  const lastCol = Math.max(sheet.getLastColumn(), 5);
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const nameIdx = headers.indexOf(COMPANY_HEADERS.n);
  let urlIdx = -1;
  for(let i = 0; i < CAREER_URL_HEADERS.length; i++){
    urlIdx = headers.indexOf(CAREER_URL_HEADERS[i]);
    if(urlIdx >= 0) break;
  }
  if(nameIdx < 0) throw new Error('careerOpportunities sheet needs a Company Name column.');
  if(urlIdx < 0){
    urlIdx = Math.max(1, headers.filter(Boolean).length);
    sheet.getRange(headerRow, urlIdx + 1).setValue('Careers URL');
  }
  let sourceIdx = headers.indexOf('Source');
  if(sourceIdx < 0){
    sourceIdx = Math.max(urlIdx + 1, headers.filter(Boolean).length);
    sheet.getRange(headerRow, sourceIdx + 1).setValue('Source');
  }
  let byIdx = headers.indexOf('Updated by');
  if(byIdx < 0){
    byIdx = Math.max(sourceIdx + 1, headers.filter(Boolean).length);
    sheet.getRange(headerRow, byIdx + 1).setValue('Updated by');
  }
  let atIdx = headers.indexOf('Updated at');
  if(atIdx < 0){
    atIdx = Math.max(byIdx + 1, headers.filter(Boolean).length);
    sheet.getRange(headerRow, atIdx + 1).setValue('Updated at');
  }
  return { headerRow, nameIdx, urlIdx, sourceIdx, byIdx, atIdx };
}

function isHttpUrl_(value){
  return /^https?:\/\/[^\s]+$/i.test(String(value || '').trim());
}

function saveCareerUrl(ownerEmail, data){
  const company = clampText(data.company, 200);
  const url = clampText(data.url, 1000);
  if(!company) throw new Error('Company name is required.');
  if(!isHttpUrl_(url)) throw new Error('Enter a valid http(s) careers URL.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const sheet = ensureCareerSheet_();
    const idx = careerSheetIndexes_(sheet);
    const lastRow = sheet.getLastRow();
    let rowNumber = -1;
    if(lastRow > idx.headerRow){
      const names = sheet.getRange(idx.headerRow + 1, idx.nameIdx + 1, lastRow - idx.headerRow, 1).getValues();
      for(let i = 0; i < names.length; i++){
        if(normalizeKey(names[i][0]) === normalizeKey(company)){
          rowNumber = idx.headerRow + 1 + i;
          break;
        }
      }
    }
    if(rowNumber < 0){
      sheet.appendRow([]);
      rowNumber = sheet.getLastRow();
      sheet.getRange(rowNumber, idx.nameIdx + 1).setValue(company);
    }
    sheet.getRange(rowNumber, idx.urlIdx + 1).setValue(url);
    sheet.getRange(rowNumber, idx.sourceIdx + 1).setValue('member-edit');
    sheet.getRange(rowNumber, idx.byIdx + 1).setValue(ownerEmail);
    sheet.getRange(rowNumber, idx.atIdx + 1).setValue(new Date());

    // Keep Company Directory Careers Page URL in sync when that column exists.
    const companySheet = ss().getSheetByName(COMPANY_SHEET);
    if(companySheet){
      const headerRow = findHeaderRow(companySheet, COMPANY_HEADERS.n);
      if(headerRow !== -1){
        const headers = companySheet.getRange(headerRow, 1, 1, companySheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
        const nameCol = headers.indexOf(COMPANY_HEADERS.n);
        let careersCol = headers.indexOf(COMPANY_HEADERS.c);
        if(careersCol < 0){
          careersCol = headers.length;
          companySheet.getRange(headerRow, careersCol + 1).setValue(COMPANY_HEADERS.c);
        }
        if(nameCol >= 0){
          const last = companySheet.getLastRow();
          if(last > headerRow){
            const names = companySheet.getRange(headerRow + 1, nameCol + 1, last - headerRow, 1).getValues();
            for(let i = 0; i < names.length; i++){
              if(normalizeKey(names[i][0]) === normalizeKey(company)){
                companySheet.getRange(headerRow + 1 + i, careersCol + 1).setValue(url);
                break;
              }
            }
          }
        }
      }
    }
    return { ok: true, company: company, url: url };
  }finally{
    lock.releaseLock();
  }
}

function getCareerUrlMap(){
  const sheet = findCareerSheet_();
  if(!sheet) return {};
  const headerRow = findHeaderRow(sheet, COMPANY_HEADERS.n);
  if(headerRow === -1) return {};
  const numRows = sheet.getLastRow() - headerRow + 1;
  if(numRows < 2) return {};
  const values = sheet.getRange(headerRow, 1, numRows, sheet.getLastColumn()).getValues();
  const headers = values[0].map(h => String(h).trim());
  const nameIdx = headers.indexOf(COMPANY_HEADERS.n);
  let urlIdx = -1;
  for(let i = 0; i < CAREER_URL_HEADERS.length; i++){
    urlIdx = headers.indexOf(CAREER_URL_HEADERS[i]);
    if(urlIdx >= 0) break;
  }
  if(nameIdx < 0 || urlIdx < 0) return {};
  const map = {};
  for(let i = 1; i < values.length; i++){
    const name = String(values[i][nameIdx] || '').trim();
    const url = String(values[i][urlIdx] || '').trim();
    if(name && url) map[normalizeKey(name)] = url;
  }
  return map;
}

function getCompanies(){
  const sheet = ss().getSheetByName(COMPANY_SHEET);
  if(!sheet) throw new Error('"' + COMPANY_SHEET + '" sheet not found.');
  const headerRow = findHeaderRow(sheet, COMPANY_HEADERS.n);
  if(headerRow === -1) throw new Error('Could not find the Company Directory header row.');
  const numRows = sheet.getLastRow() - headerRow + 1;
  if(numRows < 1) return [];
  const values = sheet.getRange(headerRow, 1, numRows, sheet.getLastColumn()).getValues();
  const headers = values[0].map(h => String(h).trim());
  const idx = {
    n: headers.indexOf(COMPANY_HEADERS.n),
    s: headers.indexOf(COMPANY_HEADERS.s),
    t: headers.indexOf(COMPANY_HEADERS.t),
    a: headers.indexOf(COMPANY_HEADERS.a),
    c: headers.indexOf(COMPANY_HEADERS.c)
  };
  const requiredKeys = ['n','s','t','a'];
  if(requiredKeys.some(key => idx[key] < 0)){
    throw new Error('Company Directory headers changed; update COMPANY_HEADERS in Code.gs.');
  }
  const careerMap = getCareerUrlMap();
  const companies = [];
  for(let i = 1; i < values.length; i++){
    const row = values[i];
    if(!row[idx.n]) continue;
    const name = String(row[idx.n]);
    const fromColumn = idx.c >= 0 ? String(row[idx.c] || '').trim() : '';
    const fromCareerSheet = careerMap[normalizeKey(name)] || '';
    companies.push({
      n: name,
      s: String(row[idx.s] || ''),
      t: String(row[idx.t] || ''),
      a: String(row[idx.a] || ''),
      c: fromColumn || fromCareerSheet
    });
  }
  return companies;
}

function companyDirectoryIndexes_(sheet){
  const headerRow = findHeaderRow(sheet, COMPANY_HEADERS.n);
  if(headerRow === -1) throw new Error('Could not find the Company Directory header row.');
  const lastCol = Math.max(sheet.getLastColumn(), 8);
  const headers = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  const idx = {
    headerRow: headerRow,
    n: headers.indexOf(COMPANY_HEADERS.n),
    s: headers.indexOf(COMPANY_HEADERS.s),
    t: headers.indexOf(COMPANY_HEADERS.t),
    a: headers.indexOf(COMPANY_HEADERS.a),
    c: headers.indexOf(COMPANY_HEADERS.c),
    note: headers.indexOf('Verification Note'),
    website: headers.indexOf('Website'),
    lastCol: lastCol
  };
  if(idx.n < 0 || idx.s < 0 || idx.t < 0 || idx.a < 0){
    throw new Error('Company Directory headers changed; update COMPANY_HEADERS in Code.gs.');
  }
  if(idx.c < 0){
    idx.c = headers.filter(Boolean).length;
    sheet.getRange(headerRow, idx.c + 1).setValue(COMPANY_HEADERS.c);
    idx.lastCol = Math.max(idx.lastCol, idx.c + 1);
  }
  return idx;
}

function discoverCareerUrlForCompany_(companyName){
  const fallback = {
    url: 'https://www.google.com/search?q=' + encodeURIComponent(String(companyName) + ' careers'),
    source: 'google-careers-search'
  };
  try{
    if(typeof analysisConfiguration !== 'function') return fallback;
    const config = analysisConfiguration();
    if(!config || !config.providers || !config.providers.length) return fallback;
    const schema = {
      type: 'object',
      properties: {
        url: { type: 'string' },
        sourceNote: { type: 'string' }
      },
      required: ['url']
    };
    const prompt = 'You find official company careers pages. For the company name "' + companyName + '", return JSON with url set to the best official https careers/jobs page (India/Hyderabad preferred when relevant). If you are not confident, return an empty url string. Never invent a fake domain. Do not return a Google search URL.';
    for(let i = 0; i < config.providers.length; i++){
      const provider = config.providers[i];
      try{
        let result = null;
        if(provider.provider === 'gemini' && typeof callGeminiJson === 'function'){
          result = callGeminiJson(provider, prompt, schema, [{ text: 'Company: ' + companyName }]);
        }else if(provider.provider === 'openai'){
          const response = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + provider.apiKey },
            muteHttpExceptions: true,
            payload: JSON.stringify({
              model: provider.model,
              input: [{ role: 'system', content: prompt }, { role: 'user', content: 'Company: ' + companyName }],
              text: { format: { type: 'json_schema', name: 'career_url', schema: schema, strict: true } }
            })
          });
          if(response.getResponseCode() >= 300) throw new Error('OpenAI career lookup failed.');
          const body = JSON.parse(response.getContentText());
          const text = (body.output || []).map(function(item){
            return (item.content || []).filter(function(part){ return part.type === 'output_text'; }).map(function(part){ return part.text; }).join('');
          }).join('');
          result = JSON.parse(text);
        }
        const url = String(result && result.url || '').trim();
        if(isHttpUrl_(url) && !/google\.[^/]+\/search/i.test(url)){
          return { url: url, source: 'ai-discover' };
        }
      }catch(error){
        console.error('Career URL discover provider failed', error);
      }
    }
  }catch(error){
    console.error('Career URL discover failed', error);
  }
  return fallback;
}

function addCompany(ownerEmail, data){
  const name = clampText(data.name || data.company, 200);
  const companyType = clampText(data.sector || data.s, 200) || 'Not specified';
  const size = clampText(data.type || data.t, 100) || 'Not specified';
  const address = clampText(data.address || data.a, 500) || 'Not specified';
  if(!name) throw new Error('Enter an organization name.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const sheet = ss().getSheetByName(COMPANY_SHEET);
    if(!sheet) throw new Error('"' + COMPANY_SHEET + '" sheet not found.');
    const idx = companyDirectoryIndexes_(sheet);
    const lastRow = sheet.getLastRow();
    if(lastRow > idx.headerRow){
      const names = sheet.getRange(idx.headerRow + 1, idx.n + 1, lastRow - idx.headerRow, 1).getValues();
      for(let i = 0; i < names.length; i++){
        if(normalizeKey(names[i][0]) === normalizeKey(name)){
          throw new Error('That organization already exists.');
        }
      }
    }
    const row = [];
    for(let c = 0; c < idx.lastCol; c++) row.push('');
    row[idx.n] = name;
    row[idx.s] = companyType;
    row[idx.t] = size;
    row[idx.a] = address;
    if(idx.note >= 0) row[idx.note] = 'Added by member (' + ownerEmail + ') via Add a Referrer';
    sheet.appendRow(row);
  }finally{
    lock.releaseLock();
  }

  const discovered = discoverCareerUrlForCompany_(name);
  let careerUrl = '';
  let careerSource = discovered.source;
  try{
    if(discovered.url){
      const saved = saveCareerUrl(ownerEmail, { company: name, url: discovered.url });
      careerUrl = saved.url || discovered.url;
      // saveCareerUrl stamps source as member-edit; restore discover source on career sheet when possible.
      try{
        const careerSheet = ensureCareerSheet_();
        const cIdx = careerSheetIndexes_(careerSheet);
        const values = careerSheet.getDataRange().getValues();
        for(let i = cIdx.headerRow; i < values.length; i++){
          if(normalizeKey(values[i][cIdx.nameIdx]) === normalizeKey(name)){
            careerSheet.getRange(i + 1, cIdx.sourceIdx + 1).setValue(careerSource);
            break;
          }
        }
      }catch(ignore){}
    }
  }catch(error){
    console.error('Could not save discovered careers URL', error);
    careerUrl = discovered.url || '';
  }

  return {
    ok: true,
    company: {
      n: name,
      s: companyType,
      t: size,
      a: address,
      c: careerUrl
    },
    careerSource: careerSource
  };
}

// ---- Referrer contacts (sheet: ReferrerContact; legacy tab name ShiaContacts) ----
const CONTACTS_HEADER = ['Company', 'Name', 'Phone', 'Email', 'Timestamp', 'Address', 'Owner Email', 'Contact ID', 'Role'];

function getReferrerContactsSheet(){
  const book = ss();
  let sheet = book.getSheetByName(CONTACTS_SHEET);
  if(sheet) return sheet;
  sheet = book.getSheetByName(CONTACTS_SHEET_LEGACY);
  if(sheet){
    // One-time rename so the live workbook matches the new name without data loss.
    try{ sheet.setName(CONTACTS_SHEET); }catch(error){ /* keep using legacy tab if rename is blocked */ }
    return sheet;
  }
  throw new Error('"' + CONTACTS_SHEET + '" sheet not found (also checked legacy "' + CONTACTS_SHEET_LEGACY + '").');
}

function ensureContactsHeader(sheet){
  const first = sheet.getRange(1, 1, 1, 2).getValues()[0];
  if(first[0] !== 'Company' || first[1] !== 'Name'){
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, CONTACTS_HEADER.length).setValues([CONTACTS_HEADER]);
    return;
  }
  const lastCol = Math.max(sheet.getLastColumn(), CONTACTS_HEADER.length);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
  if(headers.indexOf('Role') < 0){
    sheet.getRange(1, Math.max(headers.filter(Boolean).length, 8) + 1).setValue('Role');
  }
}

function getContacts(){
  const sheet = getReferrerContactsSheet();
  ensureContactsHeader(sheet);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(h => String(h).trim());
  const roleIdx = headers.indexOf('Role');
  const contacts = {};
  for(let i = 1; i < values.length; i++){
    const row = values[i];
    if(!row[0]) continue;
    const company = String(row[0]);
    (contacts[company] = contacts[company] || []).push({
      name: String(row[1] || ''),
      phone: String(row[2] || ''),
      email: String(row[3] || ''),
      ts: row[4] ? String(row[4]) : '',
      address: String(row[5] || ''),
      role: roleIdx >= 0 ? String(row[roleIdx] || '') : ''
    });
  }
  return contacts;
}

function clampText(value, max){
  return typeof value === 'string' ? value.trim().slice(0, max || 500) : '';
}

function normalizeKey(value){
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function addReferrerContact(ownerEmail, data){
  const company = clampText(data.company, 200);
  const name = clampText(data.name, 150);
  const phone = clampText(data.phone, 40);
  const address = clampText(data.address, 500);
  const email = clampText(data.email, 254);
  const role = clampText(data.role, 80);
  const allowUpdate = data.updateIfExists === true;
  if(!company || !name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || data.confirmed !== true){
    throw new Error('Complete your contact details and declaration.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const sheet = getReferrerContactsSheet();
    ensureContactsHeader(sheet);
    const values = sheet.getDataRange().getValues();
    const headers = values[0].map(h => String(h).trim());
    const roleIdx = headers.indexOf('Role');
    for(let i = 1; i < values.length; i++){
      if(normalizeKey(values[i][0]) === normalizeKey(company) && normalizeKey(values[i][1]) === normalizeKey(name)){
        if(!allowUpdate) throw new Error('This contact is already saved.');
        sheet.getRange(i + 1, 3).setValue(phone);
        sheet.getRange(i + 1, 4).setValue(email);
        sheet.getRange(i + 1, 5).setValue(new Date());
        if(address) sheet.getRange(i + 1, 6).setValue(address);
        sheet.getRange(i + 1, 7).setValue(ownerEmail);
        if(roleIdx >= 0 && role) sheet.getRange(i + 1, roleIdx + 1).setValue(role);
        return { ok: true, updated: true, company: company, name: name, phone: phone, email: email, address: address, role: role };
      }
    }
    const row = [company, name, phone, email, new Date(), address, ownerEmail, Utilities.getUuid()];
    if(roleIdx >= 0){
      while(row.length <= roleIdx) row.push('');
      row[roleIdx] = role;
    }
    sheet.appendRow(row);
    return { ok: true, updated: false, company: company, name: name, phone: phone, email: email, address: address, role: role };
  }finally{
    lock.releaseLock();
  }
}

/** @deprecated Use addReferrerContact. Kept so older callers do not break. */
function addContact(ownerEmail, data){
  return addReferrerContact(ownerEmail, data);
}

function saveHrContact(ownerEmail, data){
  return addReferrerContact(ownerEmail, {
    company: data.company,
    name: data.name,
    phone: data.phone,
    email: data.email,
    address: data.address || '',
    role: clampText(data.role, 80) || 'HR',
    confirmed: data.confirmed === true,
    updateIfExists: true
  });
}

// ---- Resume uploads ----
function getOrCreateResumeFolder(){
  const folders = DriveApp.getFoldersByName(RESUME_FOLDER_NAME);
  if(folders.hasNext()) return folders.next();
  return DriveApp.createFolder(RESUME_FOLDER_NAME);
}

const RESUMES_HEADER = ['Timestamp', 'Candidate name', 'Candidate email', 'Phone', 'Status', 'File name', 'Drive link', 'Submitted by'];

function ensureResumesHeader(sheet){
  const first = sheet.getRange(1, 1, 1, 2).getValues()[0];
  if(first[0] === 'Timestamp' && first[1] === 'Candidate name') return;
  sheet.insertRowBefore(1);
  sheet.getRange(1, 1, 1, RESUMES_HEADER.length).setValues([RESUMES_HEADER]);
}

function logResumeUpload(row){
  let sheet = ss().getSheetByName(RESUMES_SHEET);
  if(!sheet) sheet = ss().insertSheet(RESUMES_SHEET);
  ensureResumesHeader(sheet);
  sheet.appendRow(row);
}

function getFileExtension(fileName){
  const match = /\.([a-zA-Z0-9]+)$/.exec(String(fileName || ''));
  return match ? match[1].toLowerCase() : '';
}

// Accepts a Google Docs URL like https://docs.google.com/document/d/<id>/edit
// and returns just the <id>, or '' if the URL doesn't match that shape.
function extractGoogleDocId(url){
  const match = /^https:\/\/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/.exec(String(url || '').trim());
  return match ? match[1] : '';
}

function uploadResume(submitterEmail, data){
  const name = clampText(data.name, 150);
  const email = clampText(data.email, 254);
  const phone = clampText(data.phone, 40);
  const status = clampText(data.status, 60);
  const fileName = clampText(data.fileName, 200);
  const dataBase64 = String(data.dataBase64 || '');
  const googleDocUrl = clampText(data.googleDocUrl, 500);

  if(!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !status || data.confirmed !== true){
    throw new Error('Complete your name, email, status and declaration.');
  }
  if(!fileName && !googleDocUrl){
    throw new Error('Choose a resume file or paste a Google Doc link.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const folder = getOrCreateResumeFolder();
    let storedName, driveUrl, loggedFileName;

    if(googleDocUrl){
      const docId = extractGoogleDocId(googleDocUrl);
      if(!docId){
        throw new Error('That doesn\'t look like a Google Doc link (should start with docs.google.com/document/d/...).');
      }
      let source;
      try{
        source = DriveApp.getFileById(docId);
      }catch(err){
        throw new Error('Could not open that Google Doc. Make sure sharing is set to "Anyone with the link".');
      }
      storedName = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd_HHmmss') + '_' + source.getName();
      const copy = source.makeCopy(storedName, folder);
      driveUrl = copy.getUrl();
      loggedFileName = source.getName();
    }else{
      if(!dataBase64){
        throw new Error('Choose a resume file to upload.');
      }
      const extension = getFileExtension(fileName);
      const mimeType = RESUME_UPLOAD_ALLOWED_EXTENSIONS[extension];
      if(!mimeType){
        throw new Error('Only .doc and .docx resumes are accepted.');
      }
      let bytes;
      try{
        bytes = Utilities.base64Decode(dataBase64);
      }catch(err){
        throw new Error('The uploaded file could not be read. Please try again.');
      }
      if(bytes.length < 1){
        throw new Error('The uploaded file is empty.');
      }
      if(bytes.length > RESUME_MAX_BYTES){
        throw new Error('Resume file is larger than 5 MB. Please upload a smaller file.');
      }
      const safeBase = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 150);
      storedName = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Etc/UTC', 'yyyy-MM-dd_HHmmss') + '_' + safeBase;
      const blob = Utilities.newBlob(bytes, mimeType, storedName);
      const file = folder.createFile(blob);
      driveUrl = file.getUrl();
      loggedFileName = fileName;
    }

    logResumeUpload([new Date(), name, email, phone, status, loggedFileName, driveUrl, submitterEmail]);
    return { ok: true, driveUrl: driveUrl };
  }finally{
    lock.releaseLock();
  }
}

function driveFileIdFromUrl_(url){
  const match = /\/d\/([a-zA-Z0-9_-]+)/.exec(String(url || ''));
  return match ? match[1] : '';
}

// Only the resumes a member submitted themselves - matched on the "Submitted by"
// column, not the candidate email, so someone can't list resumes they didn't upload.
function myResumes(submitterEmail){
  const sheet = ss().getSheetByName(RESUMES_SHEET);
  if(!sheet) return [];
  const target = String(submitterEmail || '').trim().toLowerCase();
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => String(row[7] || '').trim().toLowerCase() === target)
    .map(row => ({
      timestamp: row[0] ? String(row[0]) : '',
      name: String(row[1] || ''),
      email: String(row[2] || ''),
      phone: String(row[3] || ''),
      status: String(row[4] || ''),
      fileName: String(row[5] || ''),
      driveUrl: String(row[6] || '')
    }));
}

// Deletes a resume the caller submitted: trashes the Drive file, removes the
// Resumes row, and clears the matching resumen Analysis row if one exists.
function deleteResume(submitterEmail, data){
  const driveUrl = clampText(data.driveUrl, 500);
  if(!driveUrl) throw new Error('Missing resume to remove.');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  let fileId = '';
  try{
    const sheet = ss().getSheetByName(RESUMES_SHEET);
    if(!sheet) throw new Error('No resumes found.');
    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for(let i = 1; i < values.length; i++){
      if(String(values[i][6] || '').trim() === driveUrl){ rowIndex = i; break; }
    }
    if(rowIndex < 0) throw new Error('That resume was not found.');
    const submittedBy = String(values[rowIndex][7] || '').trim().toLowerCase();
    if(submittedBy !== String(submitterEmail || '').trim().toLowerCase()){
      throw new Error('You can only remove resumes you submitted.');
    }
    fileId = driveFileIdFromUrl_(driveUrl);
    sheet.deleteRow(rowIndex + 1);
  }finally{
    lock.releaseLock();
  }
  if(fileId){
    try{ DriveApp.getFileById(fileId).setTrashed(true); }catch(error){ console.error('Could not trash resume file', error); }
    if(typeof removeResumeAnalysisById === 'function'){
      try{ removeResumeAnalysisById(fileId); }catch(error){ console.error('Could not remove analysis row', error); }
    }
  }
  return { ok: true };
}

// ---- Professional Opportunity inbox ----
const OPPORTUNITY_FOLDER_NAME = 'Professional Opportunity';
const OPPORTUNITY_SHEET = 'Opportunities';
const OPPORTUNITY_TYPES = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'
};

function getOpportunityProfile(email, existingContacts, googleName){
  const contacts = existingContacts || getContacts();
  const matches = [];
  Object.keys(contacts).forEach(company => {
    contacts[company].forEach(person => {
      // Match the contact's email, not the person who submitted a colleague's entry.
      if(String(person.email).trim().toLowerCase() === email.trim().toLowerCase() && person.name.trim()){
        matches.push({name:person.name, company:company, phone:person.phone});
      }
    });
  });
  const homeCompanies = [...new Set(matches.map(person => person.company))];
  return {name:matches.length ? matches[0].name : clampText(googleName, 150), email:email, phone:[...new Set(matches.map(person => person.phone).filter(Boolean))].join(', '), homeCompanies:homeCompanies,
    companies:homeCompanies.slice(), canPost:matches.length > 0};
}

function getUserProfile(email, googleName){
  const profile = getOpportunityProfile(email);
  if(!profile.name) profile.name = clampText(googleName, 150);
  const sheet = ss().getSheetByName('Profiles');
  const row = sheet && sheet.getDataRange().getValues().slice(1).find(row => normalizeKey(row[0]) === normalizeKey(email));
  profile.workStatus = row && ['Working', 'Not working'].includes(row[1]) ? row[1] : '';
  return profile;
}

function saveWorkStatus(email, status, googleName){
  if(!['Working', 'Not working'].includes(status)) throw new Error('Choose Working or Not working.');
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    let sheet = ss().getSheetByName('Profiles');
    if(!sheet){ sheet = ss().insertSheet('Profiles'); sheet.appendRow(['Email', 'Work status', 'Updated at']); }
    const rows = sheet.getDataRange().getValues();
    const index = rows.findIndex((row, i) => i > 0 && normalizeKey(row[0]) === normalizeKey(email));
    if(index < 0) sheet.appendRow([email, status, new Date()]);
    else sheet.getRange(index + 1, 2, 1, 2).setValues([[status, new Date()]]);
  }finally{ lock.releaseLock(); }
  return {ok:true, profile:getUserProfile(email, googleName)};
}

function getOpportunities(email){
  const sheet = ss().getSheetByName(OPPORTUNITY_SHEET);
  if(!sheet) return [];
  return sheet.getDataRange().getValues().slice(1)
    .filter(row => String(row[1]).toLowerCase() === email.toLowerCase())
    .slice(-100).map(row => JSON.parse(row[2]));
}

// Can also be run once in the standalone editor to create the folder before use.
function setupProfessionalOpportunity(){
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('OPPORTUNITY_FOLDER_ID');
  if(existingId){
    const folder = DriveApp.getFolderById(existingId);
    if(folder.isTrashed()) throw new Error('Restore the Professional Opportunity folder from Drive trash.');
    return folder;
  }
  const folders = DriveApp.getFoldersByName(OPPORTUNITY_FOLDER_NAME);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(OPPORTUNITY_FOLDER_NAME);
  props.setProperty('OPPORTUNITY_FOLDER_ID', folder.getId());
  return folder;
}

function saveOpportunity(email, data){
  const profile = getOpportunityProfile(email);
  if(!profile.canPost) throw new Error('Your signed-in email must be listed as a contact before you can post opportunities.');
  const company = typeof data.company === 'string' ? data.company.trim() : '';
  if(!company || company.length > 200) throw new Error('Enter the opportunity company (up to 200 characters).');
  const requestId = String(data.requestId || '');
  if(!/^[a-zA-Z0-9-]{20,80}$/.test(requestId)) throw new Error('Invalid submission ID.');
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if(text.length > 20000) throw new Error('Keep the message under 20,000 characters.');
  if(!Array.isArray(data.files) || data.files.length > 5) throw new Error('Attach up to 5 files.');
  if(!text && !data.files.length) throw new Error('Add text or an attachment.');
  let total = 0;
  const attachments = data.files.map(file => {
    if(!file || typeof file.name !== 'string' || !file.name || file.name.length > 200) throw new Error('Invalid file name.');
    const extension = getFileExtension(file.name);
    if(!Object.prototype.hasOwnProperty.call(OPPORTUNITY_TYPES, extension)) throw new Error('Choose Word, Excel, PDF, JPG or PNG files.');
    if(typeof file.dataBase64 !== 'string' || file.dataBase64.length > 6990508) throw new Error('Attachments must total 5 MB or less.');
    let bytes;
    try{ bytes = Utilities.base64Decode(file.dataBase64); }catch(error){ throw new Error('Could not read the attachment.'); }
    total += bytes.length;
    if(!bytes.length || total > 5 * 1024 * 1024) throw new Error('Files must be nonempty and total 5 MB or less.');
    return {name:file.name, bytes:bytes, mimeType:OPPORTUNITY_TYPES[extension], dataBase64:file.dataBase64};
  });
  let record;
  let sheet;
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    sheet = ss().getSheetByName(OPPORTUNITY_SHEET);
    if(!sheet){ sheet = ss().insertSheet(OPPORTUNITY_SHEET); sheet.appendRow(['Submission ID', 'Submitted by', 'Record JSON']); }
    const previous = sheet.getDataRange().getValues().slice(1).find(row => row[0] === requestId && String(row[1]).toLowerCase() === email.toLowerCase());
    if(previous) return {ok:true, opportunity:JSON.parse(previous[2])};
    const folder = setupProfessionalOpportunity();
    const created = [];
    record = {id:requestId, createdAt:new Date().toISOString(), text:text, files:[], postedBy:profile.name, homeCompanies:profile.homeCompanies, company:company};
    try{
      attachments.forEach((attachment, index) => {
        const safeName = attachment.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0,150);
        const file = folder.createFile(Utilities.newBlob(attachment.bytes, attachment.mimeType, requestId + '_' + index + '_' + safeName));
        created.push(file);
        record.files.push({name:attachment.name, id:file.getId(), url:file.getUrl(), mimeType:attachment.mimeType});
      });
      if(text) created.push(folder.createFile(Utilities.newBlob(text, 'text/plain', requestId + '_message.txt')));
      created.push(folder.createFile(Utilities.newBlob(JSON.stringify({...record, submittedBy:email}), 'application/json', requestId + '_metadata.json')));
      sheet.appendRow([requestId, email, JSON.stringify(record)]);
    }catch(error){
      created.forEach(file => { try{ file.setTrashed(true); }catch(cleanupError){ console.error(cleanupError); } });
      throw error;
    }
  }finally{ lock.releaseLock(); }

  // AI decompose after the opportunity is safely stored (same pattern as resume analysis).
  if(typeof analyzePostedOpportunity === 'function'){
    try{
      const analysis = analyzePostedOpportunity(email, {
        requestId: requestId,
        company: company,
        text: text,
        files: attachments.map(file => ({ name: file.name, dataBase64: file.dataBase64 }))
      });
      record.analysis = analysis;
      const updateLock = LockService.getScriptLock();
      updateLock.waitLock(15000);
      try{
        const values = sheet.getDataRange().getValues();
        for(let i = 1; i < values.length; i++){
          if(values[i][0] === requestId && String(values[i][1]).toLowerCase() === email.toLowerCase()){
            sheet.getRange(i + 1, 3).setValue(JSON.stringify(record));
            break;
          }
        }
      }finally{
        updateLock.releaseLock();
      }
    }catch(error){
      console.error('Opportunity saved; analysis requires retry.', error);
      record.analysis = {
        yearsExperience: null,
        technicalSkills: [],
        nonTechnicalSkills: [],
        experienceBasis: '',
        reviewNotes: ['Opportunity saved; AI decomposition failed. Check LLM Script properties and try posting again.'],
        status: 'Failed',
        method: ''
      };
    }
  }

  return {ok:true, opportunity:record};
}
