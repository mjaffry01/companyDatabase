const {test}=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm');
function setup(){
  const c=vm.createContext({console});
  vm.runInContext(fs.readFileSync('apps-script/ResumeAnalysis.gs','utf8'),c);
  return c;
}
const sample=()=>({name:'Candidate',email:'person@example.com',yearsExperience:2,technicalSkills:['Python','Python'],nonTechnicalSkills:['Mentoring'],experienceBasis:'Two years explicitly stated',reviewNotes:[]});
test('real upload route invokes analysis once after a successful save, never after rejected upload',()=>{
  const c=setup();
  vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),c);
  c.json=value=>value; c.verifyToken=()=>({email:'member@example.com'}); c.isApproved=()=>true;
  const events=[];
  c.uploadResume=()=>{events.push('saved');return {ok:true,driveUrl:'https://drive.google.com/file/d/resume123/view'};};
  c.analyzeResumeFile=(id,email)=>{assert.equal(id,'resume123');assert.equal(email,'candidate@example.com');events.push('analyzed');return 'Awaiting LLM setup';};
  const event={postData:{contents:JSON.stringify({action:'uploadResume',email:'candidate@example.com'})}};
  assert.equal(c.doPost(event).analysisStatus,'Awaiting LLM setup');assert.deepEqual(events,['saved','analyzed']);
  events.length=0;c.uploadResume=()=>{throw Error('invalid upload');};
  assert.equal(c.doPost(event).error,'invalid upload');assert.deepEqual(events,[]);
});
test('validates output and deduplicates skills; rejects invalid experience and email',()=>{
  const c=setup(); assert.equal(c.validateResumeAnalysis(sample()).technicalSkills.length,1);
  for(const changes of [{yearsExperience:-1},{yearsExperience:'2'},{email:'invalid'},{technicalSkills:'Python'},{experienceBasis:''}]) assert.throws(()=>c.validateResumeAnalysis({...sample(),...changes}));
  assert.equal(c.validateResumeAnalysis({...sample(),yearsExperience:null,experienceBasis:''}).yearsExperience,null);
});
test('formula-like extracted values remain text',()=>{
  const c=setup(); assert.equal(c.analysisCell('=IMPORTXML("bad")'),'\'=IMPORTXML("bad")');
  assert.equal(c.analysisCell(0.25),0.25);
});
test('saved upload succeeds even when analysis fails',()=>{
  const c=setup(); c.uploadResume=()=>({ok:true,driveUrl:'https://drive.google.com/file/d/abc/view'});
  c.analyzeResumeFile=()=>{throw Error('provider down');};
  assert.equal(c.uploadResumeAndAnalyze('a@example.com',{}).ok,true);
  assert.equal(c.uploadResumeAndAnalyze('a@example.com',{}).analysisStatus,'Pending');
});
test('missing provider configuration queues safely and completed files are not reprocessed',()=>{
  const c=setup(); let calls=0; const rows=[Array(12).fill('')];
  c.analysisConfiguration=()=>null;
  c.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
  c.resumeAnalysisSheet=()=>({getDataRange:()=>({getValues:()=>rows}),getLastRow:()=>rows.length,getRange:r=>({setValues:v=>rows[r-1]=v[0],setWrap:()=>({setVerticalAlignment(){}})})});
  c.callResumeLLM=()=>{calls++;return sample();};
  assert.equal(c.analyzeResumeFile('abc','person@example.com'),'Awaiting LLM setup');assert.equal(calls,0);
  rows[1][9]='Review needed';
  assert.equal(c.analyzeResumeFile('abc','person@example.com'),'Review needed');assert.equal(rows.length,2);assert.equal(calls,0);
});
test('OpenAI request uses structured output and handles completion and refusal',()=>{
  const c=setup(); let sent; let output={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(sample())}]}]};
  c.resumeModelInput=()=>({type:'input_text',text:'Example resume'});
  c.UrlFetchApp={fetch:(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');sent=JSON.parse(options.payload);assert.equal(options.headers.Authorization,'Bearer test-key');return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(output)};}};
  assert.equal(c.callResumeLLM({}, {model:'test-model',apiKey:'test-key'}).name,'Candidate');
  assert.equal(sent.store,false);assert.equal(sent.text.format.strict,true);assert.equal(sent.text.format.schema.additionalProperties,false);
  assert.equal(sent.input[0].content[0].type,'input_text');
  output={status:'incomplete',output:[]};assert.throws(()=>c.callResumeLLM({}, {model:'test-model',apiKey:'test-key'}),/incomplete/);
  output={status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]};assert.throws(()=>c.callResumeLLM({}, {model:'test-model',apiKey:'test-key'}),/declined/);
});
test('OpenAI PDF payload preserves bytes and configuration requires explicit enablement',()=>{
  const c=setup();c.Utilities={base64Encode:b=>Buffer.from(b).toString('base64')};
  const part=c.resumeModelInput({getMimeType:()=> 'application/pdf',getBlob:()=>({getBytes:()=>[1,2,3]})});
  assert.equal(part.type,'input_file');assert.equal(part.file_data,'data:application/pdf;base64,AQID');
  const props={RESUME_LLM_ENABLED:'true',RESUME_LLM_PROVIDER:'openai',RESUME_LLM_API_KEY:'test-key',RESUME_LLM_MODEL:'test-model'};
  c.PropertiesService={getScriptProperties:()=>({getProperty:key=>props[key]})};
  assert.equal(c.analysisConfiguration().providers[0].model,'test-model');delete props.RESUME_LLM_API_KEY;assert.equal(c.analysisConfiguration(),null);
});


test('Gemini first, OpenAI fallback, validates results and prepares document once',()=>{
  const c=setup();let prepared=0;const calls=[];
  c.resumeModelInput=()=>{prepared++;return {type:'input_text',text:'resume'};};
  const config={providers:[{provider:'gemini',model:'g'},{provider:'openai',model:'o'}]};
  c.callResumeLLM=(file,p)=>{calls.push(p.provider);return p.provider==='gemini'?{...sample(),yearsExperience:-1}:sample();};
  assert.equal(c.callResumeProviders({},config).method,'OpenAI / o');
  assert.deepEqual(calls,['gemini','openai']);assert.equal(prepared,1);
  calls.length=0;c.callResumeLLM=(file,p)=>{calls.push(p.provider);return sample();};
  assert.equal(c.callResumeProviders({},config).method,'Gemini / g');assert.deepEqual(calls,['gemini']);
  c.callResumeLLM=()=>{throw Error('unavailable');};assert.throws(()=>c.callResumeProviders({},config),/All configured/);
});
test('Gemini sends inline PDF and rejects blocked or malformed output',()=>{
  const c=setup();let sent;let body={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(sample())}]}}]};
  c.UrlFetchApp={fetch:(url,options)=>{assert.match(url,/models\/gemini-test:generateContent$/);assert.equal(options.headers['x-goog-api-key'],'test');sent=JSON.parse(options.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)};}};
  const config={provider:'gemini',model:'gemini-test',apiKey:'test'};
  const part={type:'input_file',file_data:'data:application/pdf;base64,AQID'};
  assert.equal(c.callResumeLLM({},config,part).name,'Candidate');assert.equal(sent.contents[0].parts[0].inlineData.data,'AQID');assert.equal(sent.generationConfig.responseMimeType,'application/json');
  body={candidates:[{finishReason:'SAFETY'}]};assert.throws(()=>c.callResumeLLM({},config,part));
});
test('configuration keeps Gemini first and skips missing keys without disabling fallback',()=>{
  const c=setup();const p={RESUME_LLM_ENABLED:'true',RESUME_GEMINI_API_KEY:'g',RESUME_GEMINI_MODEL:'gemini-test',RESUME_OPENAI_API_KEY:'o',RESUME_OPENAI_MODEL:'openai-test'};
  c.PropertiesService={getScriptProperties:()=>({getProperty:k=>p[k]})};
  assert.equal(c.analysisConfiguration().providers.map(x=>x.provider).join(','),'gemini,openai');
  delete p.RESUME_GEMINI_API_KEY;assert.equal(c.analysisConfiguration().providers[0].provider,'openai');
  p.RESUME_LLM_ENABLED='false';assert.equal(c.analysisConfiguration(),null);
});
