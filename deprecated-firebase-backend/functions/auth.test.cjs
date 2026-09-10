const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture(approved=false){
  let reads=0;
  class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
  const context={exports:{},process:{env:{SPREADSHEET_ID:'test'}},require(name){
    if(name==='firebase-functions/v2/https') return {onCall:(_,fn)=>fn,HttpsError};
    if(name==='firebase-admin/app') return {initializeApp(){}};
    if(name==='firebase-admin/firestore')return {getFirestore:()=>({collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({approved})})})})}),FieldValue:{}};
    if(name==='googleapis')return {google:{auth:{GoogleAuth:class{}},sheets:()=>({spreadsheets:{values:{get:async()=>{reads++;return {data:{values:[['Company','Name'],['Example','Test','123','test@example.com']]}};}}}})}};
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync(__dirname+'/index.js','utf8'),context);
  return {call:context.exports.contactApi,reads:()=>reads};
}
const auth={uid:'verified-user',token:{email_verified:true,email:'test@example.com',firebase:{sign_in_provider:'google.com'}}};
test('signed-out requests cannot read sheets',async()=>{const f=fixture(true);await assert.rejects(f.call({data:{action:'contacts'}}),{code:'unauthenticated'});assert.equal(f.reads(),0);});
test('unapproved users cannot read or write',async()=>{const f=fixture();for(const action of ['contacts','companies','addReferrerContact'])await assert.rejects(f.call({auth,data:{action,approved:true}}),{code:'permission-denied'});assert.equal(f.reads(),0);});
test('non-Google authentication is rejected',async()=>{const f=fixture(true);await assert.rejects(f.call({auth:{...auth,token:{...auth.token,firebase:{sign_in_provider:'password'}}},data:{action:'contacts'}}),{code:'unauthenticated'});});
test('approved Google user can read contacts',async()=>{const f=fixture(true);const r=await f.call({auth,data:{action:'contacts'}});assert.equal(r.contacts.Example[0].name,'Test');assert.equal(f.reads(),1);});
test('membership check does not disclose contacts',async()=>{const f=fixture();assert.equal((await f.call({auth,data:{action:'membership'}})).approved,false);assert.equal(f.reads(),0);});
