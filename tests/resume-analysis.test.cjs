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
const sampleFit=()=>({strengths:['Java'],weaknesses:['No cloud'],matchedSkills:['Java'],missingSkills:['AWS'],yearsAssessment:'Close on years',resumeYears:4,jdYearsRequired:5,projectEvidence:['Checkout service used Java'],reviewNotes:[]});
test('comparison validates JD evidence and years; rejects empty strengths and weaknesses',()=>{
  const c=setup();
  assert.equal(c.validateResumeFit(sampleFit()).matchedSkills.length,1);
  assert.throws(()=>c.validateResumeFit({...sampleFit(),resumeYears:-1}));
  assert.throws(()=>c.validateResumeFit({...sampleFit(),strengths:[],weaknesses:[]}));
});
test('compare waits when LLM is disabled and requires a job description',()=>{
  const c=setup();
  c.clampText=(value,max)=>String(value||'').trim().slice(0,max||500);
  c.analysisConfiguration=()=>null;
  assert.equal(c.compareResumeToOpportunity('a@example.com',{opportunityText:'Need Java',resumeText:'Java'}).status,'Awaiting LLM setup');
  assert.throws(()=>c.compareResumeToOpportunity('a@example.com',{opportunityText:'  '}),/attach a JD/i);
});
test('compare tries Gemini first then OpenAI and stores the winning method',()=>{
  const c=setup();const calls=[];const rows=[];
  c.clampText=(value,max)=>String(value||'').trim().slice(0,max||500);
  c.analysisConfiguration=()=>({providers:[{provider:'gemini',model:'g'},{provider:'openai',model:'o'}]});
  c.comparisonResumePart=()=>({type:'input_text',text:'I used Java on payments',source:'pasted resume'});
  c.callComparisonLLM=(provider)=>{calls.push(provider.provider);if(provider.provider==='gemini') throw Error('down');return sampleFit();};
  c.resumeFitSheet=()=>({appendRow:row=>rows.push(row),getLastRow:()=>rows.length,getRange:()=>({setWrap:()=>({setVerticalAlignment(){}})})});
  const result=c.compareResumeToOpportunity('a@example.com',{opportunityTitle:'Backend',opportunityText:'Need Java and AWS, 5 years'});
  assert.equal(result.ok,true);assert.equal(result.method,'OpenAI / o');assert.deepEqual(calls,['gemini','openai']);
  assert.match(String(rows[0][4]),/Java/);assert.equal(rows[0][11],'OpenAI / o');
});
test('Gemini comparison sends the JD and resume PDF in one request',()=>{
  const c=setup();let sent;
  const body={candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(sampleFit())}]}}]};
  c.UrlFetchApp={fetch:(url,options)=>{sent=JSON.parse(options.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)};}};
  const result=c.callComparisonLLM({provider:'gemini',model:'gemini-test',apiKey:'k'},c.comparisonPrompt(),c.comparisonSchema(),[
    {type:'input_text',text:'JOB DESCRIPTION / OPPORTUNITY:\nNeed Java'},
    {type:'input_file',file_data:'data:application/pdf;base64,AQID'}
  ]);
  assert.equal(result.strengths[0],'Java');
  assert.match(sent.contents[0].parts[0].text,/Need Java/);
  assert.equal(sent.contents[0].parts[1].inlineData.data,'AQID');
});
test('JD paste and UTF-8 files become one text block; images use OCR',()=>{
  const c=setup();
  c.clampText=(value,max)=>String(value||'').trim().slice(0,max||500);
  c.getFileExtension=name=>{const match=/\.([a-z0-9]+)$/i.exec(name);return match?match[1].toLowerCase():'';};
  c.Utilities={base64Decode:s=>Buffer.from(s,'base64'),base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:bytes=>({getDataAsString:()=>Buffer.from(bytes).toString('utf8')})};
  const joined=c.opportunitySourcesToText({opportunityText:'Hello',opportunityFiles:[{name:'jd.txt',dataBase64:Buffer.from('World').toString('base64')}]},{providers:[]});
  assert.match(joined,/Hello/);assert.match(joined,/World/);
  let ocr=0;
  c.extractMediaText=(part)=>{ocr++;assert.match(part.file_data,/image\/png/);return 'Need Java 5 years';};
  const fromImage=c.opportunitySourcesToText({opportunityText:'',opportunityFiles:[{name:'shot.png',dataBase64:'AQID'}]},{providers:[{provider:'gemini'}]});
  assert.equal(ocr,1);assert.match(fromImage,/Need Java/);
  assert.throws(()=>c.opportunitySourcesToText({opportunityText:'',opportunityFiles:[]},{providers:[]}),/attach a JD/i);
});
test('Gemini image OCR keeps the image mime type',()=>{
  const c=setup();let sent;
  const ocrBody={candidates:[{finishReason:'STOP',content:{parts:[{text:'  Backend JD  '}]}}]};
  c.UrlFetchApp={fetch:(url,options)=>{sent=JSON.parse(options.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(ocrBody)};}};
  const text=c.extractMediaText({type:'input_file',filename:'jd.png',file_data:'data:image/png;base64,AQID'},{providers:[{provider:'gemini',model:'gemini-test',apiKey:'k'}]});
  assert.equal(text,'Backend JD');
  assert.equal(sent.contents[0].parts[0].inlineData.mimeType,'image/png');
});

// ---- Opportunity <-> resume matching ----
const opportunityReq=(overrides={})=>({technicalSkills:['React','Node.js','AWS'],nonTechnicalSkills:['Leadership'],yearsExperience:4,...overrides});
test('skill matching is case-insensitive and tolerant of suffixes like .js',()=>{
  const c=setup();
  assert.deepEqual(c.matchedSkillNames_(['React','AWS'],['react.js','Amazon Web Services']),['React']);
  assert.equal(c.skillsFuzzyMatch_('node','node.js'),true);
  assert.equal(c.skillsFuzzyMatch_('java','javascript'),false);
});
test('resumeMatchScore_ weighs technical skills, non-technical skills and years of experience',()=>{
  const c=setup();
  const strong=c.resumeMatchScore_(opportunityReq(),{technicalSkills:['React','Node.js','AWS'],nonTechnicalSkills:['Leadership'],yearsExperience:5});
  assert.equal(strong.score,100);
  assert.deepEqual(Array.from(strong.matchedSkills).sort(),['AWS','Leadership','Node.js','React'].sort());
  const weak=c.resumeMatchScore_(opportunityReq(),{technicalSkills:['Excel'],nonTechnicalSkills:[],yearsExperience:0});
  assert.ok(weak.score<40);
  const noRequirement=c.resumeMatchScore_(opportunityReq({yearsExperience:null}),{technicalSkills:['React','Node.js','AWS'],nonTechnicalSkills:['Leadership'],yearsExperience:0});
  assert.equal(noRequirement.score,100); // opportunity states no years requirement, so any resume years is fine
});
test('matchOpportunityToResumes_ only returns the best score per candidate, at or above the threshold, sorted highest first',()=>{
  const c=setup();
  const rows=[
    Array(12).fill(''), // header
    ['Strong Candidate','strong@example.com',5,'React; Node.js; AWS','Leadership','','','','id1','Complete','',''],
    ['Weak Candidate','weak@example.com',0,'Excel','','','','','id2','Complete','',''],
    ['Duplicate Upload','strong@example.com',1,'React','','','','','id3','Complete','',''], // same email, weaker resume - should not override the strong score
    ['Unfinished','pending@example.com',5,'React; Node.js; AWS','Leadership','','','','id4','Processing','','']
  ];
  c.resumeAnalysisSheet=()=>({getDataRange:()=>({getValues:()=>rows})});
  const matches=c.matchOpportunityToResumes_(opportunityReq());
  assert.equal(matches.length,1);
  assert.equal(matches[0].email,'strong@example.com');
  assert.equal(matches[0].score,100);
});
test('matchOpportunityToResumes_ returns nothing when the opportunity stated no requirements at all, or the resume sheet cannot be read',()=>{
  const c=setup();
  assert.deepEqual(Array.from(c.matchOpportunityToResumes_({technicalSkills:[],nonTechnicalSkills:[],yearsExperience:null})),[]);
  c.resumeAnalysisSheet=()=>{throw Error('sheet unavailable');};
  assert.deepEqual(Array.from(c.matchOpportunityToResumes_(opportunityReq())),[]);
});
test('sendOpportunityMatchEmail_ emails the matched candidate with score and skills, and never throws',()=>{
  const c=setup();const mails=[];
  c.MailApp={sendEmail:(to,subject,body)=>mails.push({to,subject,body})};
  c.sendOpportunityMatchEmail_({name:'Sam',email:'sam@example.com',score:82,matchedSkills:['React','AWS']},'Acme');
  assert.equal(mails.length,1);
  assert.equal(mails[0].to,'sam@example.com');
  assert.match(mails[0].subject,/may match your resume/i);
  assert.match(mails[0].body,/Acme/);
  assert.match(mails[0].body,/82%/);
  assert.match(mails[0].body,/React, AWS/);
  c.MailApp={sendEmail:()=>{throw Error('quota exceeded');}};
  assert.doesNotThrow(()=>c.sendOpportunityMatchEmail_({name:'Sam',email:'sam@example.com',score:82,matchedSkills:[]},'Acme'));
});
// ---- Referral-contact notification ----
test('findContactsForCompany_ matches company names case/whitespace-insensitively, dedupes by email, and skips bad emails',()=>{
  const c=setup();
  c.getContacts=()=>({'Acme Inc':[
    {name:'Rita',email:'rita@acme.com'},
    {name:'Rita Duplicate',email:'RITA@acme.com'}, // same email, different casing - counts once
    {name:'No email',email:''}
  ]});
  const found=Array.from(c.findContactsForCompany_('  acme inc  '));
  assert.equal(found.length,1);
  assert.equal(found[0].email,'rita@acme.com');
  assert.deepEqual(Array.from(c.findContactsForCompany_('Some Other Company')),[]);
});
test('findContactsForCompany_ tolerates getContacts being unavailable or throwing',()=>{
  const c=setup();
  assert.deepEqual(Array.from(c.findContactsForCompany_('Acme')),[]); // getContacts not defined in this context
  c.getContacts=()=>{throw Error('sheet unavailable');};
  assert.deepEqual(Array.from(c.findContactsForCompany_('Acme')),[]);
});
test('sendReferralMatchEmail_ lists every matched candidate and the poster, and never throws',()=>{
  const c=setup();const mails=[];
  c.MailApp={sendEmail:(to,subject,body)=>mails.push({to,subject,body})};
  c.sendReferralMatchEmail_({name:'Rita',email:'rita@acme.com'},
    [{name:'Sam',email:'sam@example.com',score:82,matchedSkills:['React']},{name:'Lee',email:'lee@example.com',score:70,matchedSkills:[]}],
    'Acme',{name:'Poster Pat',email:'poster@example.com'});
  assert.equal(mails.length,1);
  assert.equal(mails[0].to,'rita@acme.com');
  assert.match(mails[0].subject,/Acme opening/);
  assert.match(mails[0].body,/Sam <sam@example\.com>.*82%/);
  assert.match(mails[0].body,/Lee <lee@example\.com>.*70%/);
  assert.match(mails[0].body,/Poster Pat \(poster@example\.com\)/);
  c.MailApp={sendEmail:()=>{throw Error('quota exceeded');}};
  assert.doesNotThrow(()=>c.sendReferralMatchEmail_({email:'rita@acme.com'},[{name:'Sam',email:'sam@example.com',score:82,matchedSkills:[]}],'Acme',{}));
});
test('analyzePostedOpportunity matches resumes, emails winners, and notifies a referral contact naming the poster',()=>{
  const c=setup();const mails=[];
  c.clampText=(value,max)=>String(value||'').trim().slice(0,max||500);
  c.MailApp={sendEmail:(to,subject,body)=>mails.push({to,subject,body})};
  c.PropertiesService={getScriptProperties:()=>({getProperty:key=>({RESUME_LLM_ENABLED:'true',RESUME_GEMINI_API_KEY:'k',RESUME_GEMINI_MODEL:'gemini-test'})[key]})};
  c.callOpportunityAnalysisProviders=()=>({result:{yearsExperience:4,technicalSkills:['React'],nonTechnicalSkills:[],experienceBasis:'4 years required',reviewNotes:[]},method:'Gemini / gemini-test'});
  c.opportunitySourcesToText=()=>'Need React, 4 years';
  const rows=[Array(12).fill(''),['Sam','sam@example.com',5,'React','','','','','id1','Complete','','']];
  c.resumeAnalysisSheet=()=>({getDataRange:()=>({getValues:()=>rows})});
  c.getContacts=()=>({Acme:[{name:'Rita',email:'rita@acme.com'}]});
  const writes=[];
  c.writeOpportunityAnalysisRow_=(email,requestId,company,payload,summary)=>writes.push({email,requestId,company,payload,summary});
  const result=c.analyzePostedOpportunity('poster@example.com',{requestId:'req-1',company:'Acme',text:'Need React, 4 years',postedBy:'Poster Pat'});
  assert.equal(result.status,'Complete');
  assert.equal(result.matches.length,1);
  assert.equal(result.referralContactsNotified,1);
  assert.equal(mails.length,2);
  assert.equal(mails[0].to,'sam@example.com'); // candidate notified first
  assert.equal(mails[1].to,'rita@acme.com'); // then the referral contact
  assert.match(mails[1].body,/Poster Pat \(poster@example\.com\)/);
  assert.deepEqual(writes[0].payload.matches[0].email,'sam@example.com'); // matches travel with the written payload, but are not part of the sheet's fixed columns
});
test('analyzePostedOpportunity skips the referral email entirely when the company has no saved contact',()=>{
  const c=setup();const mails=[];
  c.clampText=(value,max)=>String(value||'').trim().slice(0,max||500);
  c.MailApp={sendEmail:(to,subject,body)=>mails.push({to,subject,body})};
  c.PropertiesService={getScriptProperties:()=>({getProperty:key=>({RESUME_LLM_ENABLED:'true',RESUME_GEMINI_API_KEY:'k',RESUME_GEMINI_MODEL:'gemini-test'})[key]})};
  c.callOpportunityAnalysisProviders=()=>({result:{yearsExperience:4,technicalSkills:['React'],nonTechnicalSkills:[],experienceBasis:'4 years required',reviewNotes:[]},method:'Gemini / gemini-test'});
  c.opportunitySourcesToText=()=>'Need React, 4 years';
  const rows=[Array(12).fill(''),['Sam','sam@example.com',5,'React','','','','','id1','Complete','','']];
  c.resumeAnalysisSheet=()=>({getDataRange:()=>({getValues:()=>rows})});
  c.getContacts=()=>({}); // no contact saved for Acme
  c.writeOpportunityAnalysisRow_=()=>{};
  const result=c.analyzePostedOpportunity('poster@example.com',{requestId:'req-1',company:'Acme',text:'Need React, 4 years',postedBy:'Poster Pat'});
  assert.equal(result.referralContactsNotified,0);
  assert.equal(mails.length,1); // candidate only, no referral email
  assert.equal(mails[0].to,'sam@example.com');
});
