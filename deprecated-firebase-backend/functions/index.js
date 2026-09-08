const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {google} = require('googleapis');
initializeApp();
const db = getFirestore();
const sheets = google.sheets({version:'v4', auth:new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets']})});
const spreadsheetId = process.env.SPREADSHEET_ID;
const contactsRange = "'ShiaContacts'!A:H";
async function rows(range){
  const result = await sheets.spreadsheets.values.get({spreadsheetId, range});
  return result.data.values || [];
}
function text(value, max=500){ return typeof value === 'string' ? value.trim().slice(0,max) : ''; }
exports.contactApi = onCall({region:'us-central1',maxInstances:2}, async request => {
  if(!request.auth || request.auth.token.email_verified !== true || request.auth.token.firebase?.sign_in_provider !== 'google.com') throw new HttpsError('unauthenticated','Sign in with Google.');
  const {uid,token} = request.auth;
  const memberRef = db.collection('members').doc(uid);
  const member = await memberRef.get();
  const action = request.data?.action;
  if(action === 'membership'){
    if(!member.exists){
      try{ await memberRef.create({email:token.email,approved:false,createdAt:FieldValue.serverTimestamp()}); }
      catch(error){ if(error.code !== 6) throw error; }
    }
    return {approved: member.data()?.approved === true};
  }
  if(member.data()?.approved !== true) throw new HttpsError('permission-denied','Administrator approval is required.');
  if(!spreadsheetId) throw new HttpsError('failed-precondition','Spreadsheet is not configured.');
  if(action === 'companies'){
    // Set exact header labels after inspecting Company Directory; fail rather than guess mappings.
    const data = await rows("'Company Directory'!A:Z");
    const headers = data[0] || [];
    const fields = ['COMPANY_NAME_HEADER','COMPANY_SECTOR_HEADER','COMPANY_TYPE_HEADER','COMPANY_ADDRESS_HEADER'];
    const indexes = fields.map(key => headers.indexOf(process.env[key]));
    if(indexes.some(i => i < 0)) throw new HttpsError('failed-precondition','Configure company directory header mappings.');
    return {companies:data.slice(1).filter(row=>row[indexes[0]]).map(row=>Object.fromEntries(['n','s','t','a'].map((key,i)=>[key,row[indexes[i]] || ''])))};
  }
  if(action === 'contacts'){
    const data = await rows(contactsRange);
    const hasHeader = data[0]?.[0] === 'Company' && data[0]?.[1] === 'Name';
    const contacts = Object.create(null);
    for(const row of hasHeader ? data.slice(1) : data){
      if(!row[0]) continue;
      (contacts[row[0]] ||= []).push({name:row[1] || '',phone:row[2] || '',email:row[3] || '',ts:row[4] || '',address:row[5] || ''});
    }
    return {contacts};
  }
  if(action === 'addContact'){
    const p = request.data;
    const company=text(p.company), name=text(p.name,150), phone=text(p.phone,40), email=text(p.email,254), address=text(p.address);
    if(!company || !name || !phone || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || p.confirmed !== true) throw new HttpsError('invalid-argument','Complete your contact details and declaration.');
    const {createHash,randomUUID} = require('node:crypto');
    const normalize = s=>s.toLowerCase().replace(/\s+/g,' ').trim();
    const key=createHash('sha256').update(normalize(company)+'\n'+normalize(name)).digest('hex');
    const lock=db.collection('contactSubmissions').doc(key);
    // Atomic claim prevents concurrent duplicate submissions. Retain uncertain writes for admin review.
    try{ await lock.create({ownerUid:uid,state:'pending',createdAt:FieldValue.serverTimestamp()}); }
    catch(error){ if(error.code===6) throw new HttpsError('already-exists','This contact is already saved or awaiting review.'); throw error; }
    const existing=await rows(contactsRange);
    if(existing.some(row=>normalize(String(row[0]||''))===normalize(company)&&normalize(String(row[1]||''))===normalize(name))){
      await lock.update({state:'duplicate'});
      throw new HttpsError('already-exists','This contact is already saved.');
    }
    await sheets.spreadsheets.values.append({spreadsheetId,range:contactsRange,valueInputOption:'RAW',insertDataOption:'INSERT_ROWS',requestBody:{values:[[company,name,phone,email,new Date().toISOString(),address,uid,randomUUID()]]}});
    await lock.update({state:'saved'});
    return {ok:true};
  }
  throw new HttpsError('invalid-argument','Unknown action.');
});
