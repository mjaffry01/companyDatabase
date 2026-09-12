const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('login bundles data after approval with one verification and one contact read',()=>{
  const c=vm.createContext({
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,setProperty(){}})},
    Utilities:{getUuid:()=>'uuid',base64Encode:v=>Buffer.from(v).toString('base64'),
      computeHmacSha256Signature:(v,k)=>require('node:crypto').createHmac('sha256',k).update(String(v)).digest()}
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),c);
  let verified=0, reads=0, approved=true;
  c.json=value=>value;
  c.verifyToken=()=>{verified++;return {email:'a@example.com',sub:'id',name:'Alice'};};
  c.checkMembership=()=>approved;
  c.getContacts=()=>{reads++;return {Acme:[{name:'Alice',email:'a@example.com',phone:'123'}]};};
  c.getCompanies=()=>[{n:'Acme'}];
  const event={postData:{contents:JSON.stringify({action:'membership',includeBootstrap:true,idToken:'token'})}};
  const result=c.doPost(event);
  assert.equal(verified,1);assert.equal(reads,1);assert.equal(result.profile.name,'Alice');assert.equal(result.contacts.Acme.length,1);
  assert.ok(result.sessionToken); assert.equal(result.sessionExpiresInMs,8*60*60*1000);
  approved=false; const denied=c.doPost(event);
  assert.equal(denied.approved,false);assert.equal(denied.contacts,undefined);assert.equal(reads,1);
});
test('resume upload still saves if analysis file is not deployed',()=>{
  const c=vm.createContext({}); vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),c);
  c.json=value=>value;
  c.verifyToken=()=>({email:'a@example.com',sub:'id'});
  c.isApproved=()=>true;
  c.uploadResume=()=>({ok:true,driveUrl:'https://drive.google.com/file/d/abc/view'});
  const result=c.doPost({postData:{contents:JSON.stringify({action:'uploadResume',idToken:'token'})}});
  assert.equal(result.ok,true);
  assert.equal(result.driveUrl.includes('/d/abc'),true);
});
test('compare action reports when analysis file is not deployed',()=>{
  const c=vm.createContext({}); vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),c);
  c.json=value=>value;
  c.verifyToken=()=>({email:'a@example.com',sub:'id'});
  c.isApproved=()=>true;
  const result=c.doPost({postData:{contents:JSON.stringify({action:'compareResumeFit',idToken:'token',opportunityText:'Need Java'})}});
  assert.equal(result.error,'Resume comparison is not deployed yet.');
});

function backendWithMembers(){
  const rows=[['Email','Approved','Google Account ID','First seen','Welcome email sent']];
  const properties={};
  const triggers=[];
  const mails=[];
  const sheet={
    appendRow(row){ rows.push([...row]); },
    getDataRange(){ return { getValues:()=>rows.map(r=>[...r]) }; },
    getLastRow(){ return rows.length; },
    getRange(row,col,numRows,numCols){
      const endRow = numRows ? row - 1 + numRows : row;
      const endCol = numCols ? col - 1 + numCols : col;
      return {
        getValue:()=>rows[row-1]?rows[row-1][col-1]:undefined,
        getValues:()=>rows.slice(row-1,endRow).map(r=>r.slice(col-1,endCol)),
        setValue(v){ if(!rows[row-1]) rows[row-1]=[]; rows[row-1][col-1]=v; },
        setValues(vv){ vv.forEach((r,ri)=>{ const tr=row-1+ri; if(!rows[tr]) rows[tr]=[]; r.forEach((v,ci)=>{ rows[tr][col-1+ci]=v; }); }); }
      };
    }
  };
  const context=vm.createContext({
    LockService:{getScriptLock:()=>{let locked=false; return { waitLock(){locked=true;}, releaseLock(){locked=false;}, tryLock(){locked=true; return true; } }; }},
    SpreadsheetApp:{openById:()=>({
      getSheetByName:name=>name==='Members'?sheet:null,
      insertSheet:()=>{ rows.length=0; rows.push(['Email','Approved','Google Account ID','First seen','Welcome email sent']); return sheet; }
    })},
    PropertiesService:{getScriptProperties:()=>({ getProperty:k=>properties[k], setProperty:(k,v)=>properties[k]=v })},
    MailApp:{sendEmail:(to,subject,body)=>mails.push({to,subject,body})},
    ScriptApp:{ getService:()=>({ getUrl:()=>'https://example.com/' }), getProjectTriggers:()=>triggers, newTrigger:fn=>({ timeBased:()=>({ everyMinutes:()=>({ create:()=>{ triggers.push({ getHandlerFunction:()=>fn }); } }) }) }) }
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context);
  return {context,rows,mails,triggers,properties};
}

test('new pending member notifies admin and gets welcome email after auto-approval',()=>{
  const b=backendWithMembers();
  b.properties['ADMIN_EMAIL']='admin@example.com';
  assert.equal(b.context.checkMembership('new@example.com','sub1'),false);
  assert.equal(b.mails.length,1);
  assert.equal(b.mails[0].to,'admin@example.com');
  assert.match(b.mails[0].subject,/New member approval needed/);
  assert.equal(b.rows.length,2);
  assert.equal(b.rows[1][1],false);
  // Simulate 4 minutes passing.
  b.rows[1][3]=new Date(Date.now()-4*60*1000);
  assert.equal(b.context.checkMembership('new@example.com','sub1'),true);
  assert.equal(b.rows[1][1],true);
  assert.equal(b.rows[1][4],true);
  assert.equal(b.mails.length,2);
  assert.equal(b.mails[1].to,'new@example.com');
  assert.match(b.mails[1].subject,/access is approved/);
});

test('time trigger auto-approves pending members older than 3 minutes and sends welcome emails',()=>{
  const b=backendWithMembers();
  b.properties['ADMIN_EMAIL']='admin@example.com';
  b.context.checkMembership('pending@example.com','sub2');
  assert.equal(b.rows[1][1],false);
  b.rows[1][3]=new Date(Date.now()-5*60*1000);
  b.context.autoApprovePendingMembers();
  assert.equal(b.rows[1][1],true);
  assert.equal(b.rows[1][4],true);
  assert.ok(b.mails.some(m=>m.to==='pending@example.com'));
});

test('setupAutoApprovalTrigger creates a 1-minute trigger once',()=>{
  const b=backendWithMembers();
  assert.equal(b.context.setupAutoApprovalTrigger(),'Auto-approval trigger created. It runs every minute.');
  assert.equal(b.triggers.length,1);
  assert.equal(b.triggers[0].getHandlerFunction(),'autoApprovePendingMembers');
  assert.equal(b.context.setupAutoApprovalTrigger(),'Auto-approval trigger already exists.');
});

test('manual sheet approval sends welcome email on next membership check',()=>{
  const b=backendWithMembers();
  b.context.checkMembership('manual@example.com','sub3');
  b.rows[1][1]=true;
  assert.equal(b.context.checkMembership('manual@example.com','sub3'),true);
  assert.ok(b.mails.some(m=>m.to==='manual@example.com'));
});
