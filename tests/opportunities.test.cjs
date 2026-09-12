const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function backend(){
  const rows = [], files = [], properties = {}, mails = [];
  let exists = false, failLog = false;
  const sheet = {appendRow(row){ if(failLog && rows.length) throw Error('Write failed'); rows.push(row); }, getDataRange(){return {getValues:()=>rows};}};
  const folder = {getId:()=> 'folder', isTrashed:()=>false, createFile(blob){ const file = {blob, trashed:false,getId:()=>String(files.indexOf(file)),getUrl:()=> 'https://drive.google.com/file/d/id',setTrashed(value){this.trashed=value;}};files.push(file); return file; }};
  const context = vm.createContext({console, SpreadsheetApp:{openById:()=>({getSheetByName:()=>exists?sheet:null,insertSheet:()=>{exists=true;return sheet;}})},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties[key],setProperty:(key,value)=>properties[key]=value})},
    DriveApp:{getFoldersByName:()=>({hasNext:()=>false}),createFolder:()=>folder,getFolderById:()=>folder},
    Utilities:{base64Decode:value=>Array.from(Buffer.from(value,'base64')),newBlob:(data,type,name)=>({data,type,name})},
    MailApp:{sendEmail:(to,subject,body,options)=>mails.push({to,subject,body,options})}});
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context);
  context.getContacts = () => ({Acme:[{name:'Alice',email:'one@example.com'}]});
  return {context, files, rows, mails, failLog(){failLog=true;}};
}
const request = (extra={})=>({requestId:'12345678-1234-1234-1234-123456789012',company:'Acme',text:'A role\nApply here',files:[],...extra});
test('text saved with metadata, history isolated and retries deduplicated',()=>{
  const b=backend(); b.context.saveOpportunity('one@example.com',request());
  assert.equal(b.files.length,2);
  assert.equal(b.context.getOpportunities('one@example.com').length,1);
  assert.equal(b.context.getOpportunities('two@example.com').length,0);
  b.context.saveOpportunity('one@example.com',request());
  assert.equal(b.files.length,2); assert.equal(b.rows.length,2);
  assert.equal(b.files[0].blob.data,'A role\nApply here');
});
test('posting requires a matching contact email, not a supplied name',()=>{
  const b=backend();
  assert.throws(()=>b.context.saveOpportunity('outsider@example.com',request({postedBy:'Alice'})),/signed-in email/);
  assert.equal(b.files.length,0);
  assert.equal(b.context.getOpportunityProfile('ONE@example.com').name,'Alice');
});
test('a listed member can post for another company with server-derived identity',()=>{
  const b=backend();
  const result=b.context.saveOpportunity('one@example.com',request({company:'Other Company',postedBy:'Fake',homeCompanies:['Fake']}));
  assert.equal(result.opportunity.company,'Other Company');
  assert.equal(result.opportunity.postedBy,'Alice');
  assert.deepEqual(Array.from(result.opportunity.homeCompanies),['Acme']);
  assert.throws(()=>b.context.saveOpportunity('one@example.com',request({company:' '})),/company/);
});
test('all supported formats preserve original bytes and MIME types',()=>{
  for(const ext of ['doc','docx','xls','xlsx','pdf','jpg','jpeg','png']){
    const b=backend(); b.context.saveOpportunity('one@example.com',request({text:'',files:[{name:'test.'+ext,dataBase64:'AQID'}]}));
    assert.deepEqual(Array.from(b.files[0].blob.data),[1,2,3]); assert.ok(b.files[0].blob.type);
  }
});
test('invalid, empty, excessive or oversized content is rejected before Drive writes',()=>{
  for(const input of [request({text:'',files:[]}),request({text:'x'.repeat(20001)}),request({files:[{name:'a.exe',dataBase64:'AQID'}]}),request({files:[{name:'a.pdf',dataBase64:''}]}),request({files:Array(6).fill({name:'a.pdf',dataBase64:'AQID'})}),request({files:[{name:'a.pdf',dataBase64:'A'.repeat(6990509)}]})]){
    const b=backend(); assert.throws(()=>b.context.saveOpportunity('one@example.com',input)); assert.equal(b.files.length,0);
  }
});
test('failed log write rolls back new Drive files and supports retry',()=>{
  const b=backend(); b.context.saveOpportunity('one@example.com',request()); b.failLog();
  assert.throws(()=>b.context.saveOpportunity('one@example.com',request({requestId:'22345678-1234-1234-1234-123456789012'})),/Write failed/);
  assert.ok(b.files.slice(2).every(file=>file.trashed)); assert.equal(b.rows.length,2);
});
test('a successful post emails the poster a confirmation, from a recognizable sender, even with no AI matching wired in',()=>{
  const b=backend();
  b.context.saveOpportunity('one@example.com',request());
  assert.equal(b.mails.length,1);
  assert.equal(b.mails[0].to,'one@example.com'); // the verified poster, not the request's own supplied fields
  assert.match(b.mails[0].subject,/Acme/);
  assert.match(b.mails[0].subject,/posted/i);
  assert.match(b.mails[0].body,/posted to the Company Contact Book/);
  assert.match(b.mails[0].body,/AI matching against resumes was not run/); // analyzePostedOpportunity isn't loaded in this test context
  assert.equal(b.mails[0].options.name,'Company Contact Book');
});
test('repeating an unchanged submission ID returns the cached result without emailing again',()=>{
  const b=backend();
  b.context.saveOpportunity('one@example.com',request());
  b.context.saveOpportunity('one@example.com',request());
  assert.equal(b.mails.length,1);
});
test('a rejected post (validation failure) sends no confirmation email',()=>{
  const b=backend();
  assert.throws(()=>b.context.saveOpportunity('one@example.com',request({text:'',files:[]})));
  assert.equal(b.mails.length,0);
});
test('the poster confirmation email failing to send never blocks or unwinds the save',()=>{
  const b=backend();
  b.context.MailApp={sendEmail:()=>{throw Error('quota exceeded');}};
  const result=b.context.saveOpportunity('one@example.com',request());
  assert.equal(result.ok,true);
  assert.equal(b.context.getOpportunities('one@example.com').length,1);
});
