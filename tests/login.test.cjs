const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('login bundles data after approval with one verification and one contact read',()=>{
  const c=vm.createContext({}); vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),c);
  let verified=0, reads=0, approved=true;
  c.json=value=>value;
  c.verifyToken=()=>{verified++;return {email:'a@example.com',sub:'id',name:'Alice'};};
  c.checkMembership=()=>approved;
  c.getContacts=()=>{reads++;return {Acme:[{name:'Alice',email:'a@example.com',phone:'123'}]};};
  c.getCompanies=()=>[{n:'Acme'}];
  const event={postData:{contents:JSON.stringify({action:'membership',includeBootstrap:true,idToken:'token'})}};
  const result=c.doPost(event);
  assert.equal(verified,1);assert.equal(reads,1);assert.equal(result.profile.name,'Alice');assert.equal(result.contacts.Acme.length,1);
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
