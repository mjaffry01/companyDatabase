const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(){
  const sheets = {};
  const context = vm.createContext({LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{openById:()=>({
    getSheetByName:name=>sheets[name],insertSheet(name){
      const rows=[];
      return sheets[name]={appendRow:row=>rows.push(row),getDataRange:()=>({getValues:()=>rows}),getRange:(row,col)=>({setValues:values=>values[0].forEach((value,index)=>rows[row-1][col-1+index]=value)})};
    }
  })}});
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context);
  context.getContacts=()=>({Acme:[{name:'Alice',email:'alice@example.com',phone:'12345'}]});
  return context;
}
test('profile uses verified email and contact details without guessing employment',()=>{
  const c=setup(); const p=c.getUserProfile('alice@example.com','Google Name');
  assert.equal(p.name,'Alice'); assert.equal(p.email,'alice@example.com'); assert.equal(p.phone,'12345'); assert.equal(p.workStatus,'');
  const missing=c.getUserProfile('other@example.com','Other');
  assert.equal(missing.name,'Other'); assert.equal(missing.phone,''); assert.equal(missing.homeCompanies.length,0);
});
test('work status persists, updates, stays isolated and validates allowed values',()=>{
  const c=setup();
  c.saveWorkStatus('alice@example.com','Working','Alice');
  assert.equal(c.getUserProfile('alice@example.com').workStatus,'Working');
  c.saveWorkStatus('alice@example.com','Not working','Alice');
  assert.equal(c.getUserProfile('alice@example.com').workStatus,'Not working');
  assert.equal(c.getUserProfile('other@example.com').workStatus,'');
  assert.throws(()=>c.saveWorkStatus('alice@example.com','Unknown'),/Choose/);
});
