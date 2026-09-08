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
const CONTACTS_SHEET = 'ShiaContacts';
const MEMBERS_SHEET = 'Members';
const RESUMES_SHEET = 'Resumes';
const RESUME_FOLDER_NAME = 'Professional Resumes Raw Data';
const RESUME_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const RESUME_ALLOWED_EXTENSIONS = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', html: 'text/html', htm: 'text/html' };
const COMPANY_HEADERS = { n: 'Company Name', s: 'Company Type', t: 'Size', a: 'Hyderabad Office Address' };

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
      return json({ approved: checkMembership(email, payload.sub) });
    }

    if(!isApproved(email)){
      throw new Error('Administrator approval is required.');
    }
    if(action === 'companies') return json({ companies: getCompanies() });
    if(action === 'contacts') return json({ contacts: getContacts() });
    if(action === 'addContact') return json(addContact(email, body));
    if(action === 'uploadResume') return json(uploadResume(email, body));
    if(action === 'opportunities') return json({ opportunities: getOpportunities(email) });
    if(action === 'saveOpportunity') return json(saveOpportunity(email, body));
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
    sheet.appendRow(['Email', 'Approved', 'Google Account ID', 'First seen']);
  }
  return sheet;
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
  try{
    const sheet = getMembersSheet();
    const row = findMemberRow(sheet, email);
    if(row === -1){
      sheet.appendRow([email, false, sub, new Date()]);
      return false;
    }
    return sheet.getRange(row, 2).getValue() === true;
  }finally{
    lock.releaseLock();
  }
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
    a: headers.indexOf(COMPANY_HEADERS.a)
  };
  if(Object.keys(idx).some(key => idx[key] < 0)){
    throw new Error('Company Directory headers changed; update COMPANY_HEADERS in Code.gs.');
  }
  const companies = [];
  for(let i = 1; i < values.length; i++){
    const row = values[i];
    if(!row[idx.n]) continue;
    companies.push({
      n: String(row[idx.n]),
      s: String(row[idx.s] || ''),
      t: String(row[idx.t] || ''),
      a: String(row[idx.a] || '')
    });
  }
  return companies;
}

// ---- Contacts ----
const CONTACTS_HEADER = ['Company', 'Name', 'Phone', 'Email', 'Timestamp', 'Address', 'Owner Email', 'Contact ID'];

function ensureContactsHeader(sheet){
  const first = sheet.getRange(1, 1, 1, 2).getValues()[0];
  if(first[0] === 'Company' && first[1] === 'Name') return; // header already present
  sheet.insertRowBefore(1); // preserves any existing data rows below
  sheet.getRange(1, 1, 1, CONTACTS_HEADER.length).setValues([CONTACTS_HEADER]);
}

function getContacts(){
  const sheet = ss().getSheetByName(CONTACTS_SHEET);
  if(!sheet) throw new Error('"' + CONTACTS_SHEET + '" sheet not found.');
  ensureContactsHeader(sheet);
  const values = sheet.getDataRange().getValues();
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
      address: String(row[5] || '')
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

function addContact(ownerEmail, data){
  const company = clampText(data.company, 200);
  const name = clampText(data.name, 150);
  const phone = clampText(data.phone, 40);
  const address = clampText(data.address, 500);
  const email = clampText(data.email, 254);
  if(!company || !name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || data.confirmed !== true){
    throw new Error('Complete your contact details and declaration.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try{
    const sheet = ss().getSheetByName(CONTACTS_SHEET);
    if(!sheet) throw new Error('"' + CONTACTS_SHEET + '" sheet not found.');
    ensureContactsHeader(sheet);
    const values = sheet.getDataRange().getValues();
    for(let i = 1; i < values.length; i++){
      if(normalizeKey(values[i][0]) === normalizeKey(company) && normalizeKey(values[i][1]) === normalizeKey(name)){
        throw new Error('This contact is already saved.');
      }
    }
    sheet.appendRow([company, name, phone, email, new Date(), address, ownerEmail, Utilities.getUuid()]);
    return { ok: true };
  }finally{
    lock.releaseLock();
  }
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
      const mimeType = RESUME_ALLOWED_EXTENSIONS[extension];
      if(!mimeType){
        throw new Error('Only .doc, .docx, .pdf and .html/.htm resumes are accepted.');
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
    return { ok: true };
  }finally{
    lock.releaseLock();
  }
}

// ---- Professional Opportunity inbox ----
const OPPORTUNITY_FOLDER_NAME = 'Professional Opportunity';
const OPPORTUNITY_SHEET = 'Opportunities';
const OPPORTUNITY_TYPES = {
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png'
};

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
    return {name:file.name, bytes:bytes, mimeType:OPPORTUNITY_TYPES[extension]};
  });
  const lock = LockService.getScriptLock(); lock.waitLock(15000);
  try{
    let sheet = ss().getSheetByName(OPPORTUNITY_SHEET);
    if(!sheet){ sheet = ss().insertSheet(OPPORTUNITY_SHEET); sheet.appendRow(['Submission ID', 'Submitted by', 'Record JSON']); }
    const previous = sheet.getDataRange().getValues().slice(1).find(row => row[0] === requestId && String(row[1]).toLowerCase() === email.toLowerCase());
    if(previous) return {ok:true, opportunity:JSON.parse(previous[2])};
    const folder = setupProfessionalOpportunity();
    const created = [];
    const record = {id:requestId, createdAt:new Date().toISOString(), text:text, files:[]};
    try{
      attachments.forEach((attachment, index) => {
        const safeName = attachment.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0,150);
        const file = folder.createFile(Utilities.newBlob(attachment.bytes, attachment.mimeType, requestId + '_' + index + '_' + safeName));
        created.push(file);
        record.files.push({name:attachment.name, id:file.getId(), url:file.getUrl(), mimeType:attachment.mimeType});
      });
      if(text) created.push(folder.createFile(Utilities.newBlob(text, 'text/plain', requestId + '_message.txt')));
      // Preserve raw input and attribution for future AI processing, without interpreting it.
      created.push(folder.createFile(Utilities.newBlob(JSON.stringify({...record, submittedBy:email}), 'application/json', requestId + '_metadata.json')));
      sheet.appendRow([requestId, email, JSON.stringify(record)]);
    }catch(error){
      created.forEach(file => { try{ file.setTrashed(true); }catch(cleanupError){ console.error(cleanupError); } });
      throw error;
    }
    return {ok:true, opportunity:record};
  }finally{ lock.releaseLock(); }
}
