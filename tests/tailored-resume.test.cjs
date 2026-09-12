const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(){
  const c = vm.createContext({console});
  vm.runInContext(fs.readFileSync('apps-script/ResumeAnalysis.gs', 'utf8'), c);
  return c;
}

const sampleTailored = () => ({
  name: 'Jane Candidate',
  headline: 'Backend Engineer',
  summary: 'Built payments services in Java for four years.',
  sections: [{title: 'Experience', entries: [{heading: 'Backend Engineer', subheading: 'Acme, 2021-2024', bullets: ['Built a payments service in Java', 'Led migration to microservices']}]}],
  missingSkillsNotAdded: ['Kubernetes', 'Kubernetes', ' AWS ']
});

// ---- Docx/Docs mocking helpers ----
function makeDocumentAppMock(){
  const elements = [];
  function makeElement(type, text){
    const el = {type, text, heading: null, italicFlag: false, glyph: null};
    el.setHeading = h => { el.heading = h; return el; };
    el.setItalic = v => { el.italicFlag = v; return el; };
    el.setGlyphType = g => { el.glyph = g; return el; };
    return el;
  }
  const body = {
    clear(){ elements.length = 0; },
    appendParagraph(text){ const el = makeElement('paragraph', text); elements.push(el); return el; },
    appendListItem(text){ const el = makeElement('listItem', text); elements.push(el); return el; }
  };
  const state = {savedAndClosed: false, createdName: null, trashed: false};
  const doc = {getBody: () => body, saveAndClose(){ state.savedAndClosed = true; }, getId: () => 'doc-id-123'};
  const DocumentApp = {
    ParagraphHeading: {TITLE: 'TITLE', SUBTITLE: 'SUBTITLE', HEADING2: 'HEADING2', HEADING3: 'HEADING3'},
    GlyphType: {BULLET: 'BULLET'},
    create: name => { state.createdName = name; return doc; }
  };
  return {DocumentApp, elements, state};
}

test('validateTailoredResume accepts a well-formed response and dedupes/trims missingSkillsNotAdded', () => {
  const c = setup();
  const result = c.validateTailoredResume(sampleTailored());
  assert.deepEqual(Array.from(result.missingSkillsNotAdded).sort(), ['AWS', 'Kubernetes']);
});
test('validateTailoredResume rejects malformed shapes', () => {
  const c = setup();
  for(const changes of [
    {name: 123},
    {sections: 'not-an-array'},
    {sections: [{title: 'X', entries: [{heading: 'H', subheading: 'S', bullets: 'not-an-array'}]}]},
    {sections: [{title: 'X', entries: [{heading: 123, subheading: '', bullets: []}]}]},
    {missingSkillsNotAdded: [1, 2]}
  ]){
    assert.throws(() => c.validateTailoredResume({...sampleTailored(), ...changes}));
  }
  assert.throws(() => c.validateTailoredResume(null));
});
test('validateTailoredResume requires at least a summary or one section', () => {
  const c = setup();
  assert.throws(() => c.validateTailoredResume({...sampleTailored(), summary: '', sections: []}), /summary or one section/);
});

test('callTailoringLLM: Gemini path delegates to callGeminiJson with the tailoring parts', () => {
  const c = setup();
  let received;
  c.callGeminiJson = (provider, prompt, schema, parts) => { received = {provider, prompt, schema, parts}; return sampleTailored(); };
  const parts = [{type: 'input_text', text: 'JD'}, {type: 'input_text', text: 'CONTEXT'}, {type: 'input_text', text: 'RESUME'}];
  const result = c.callTailoringLLM({provider: 'gemini', model: 'g'}, 'prompt', {type: 'object'}, parts);
  assert.equal(result.headline, 'Backend Engineer');
  assert.equal(received.provider.provider, 'gemini');
  assert.equal(received.parts.length, 3);
});
test('callTailoringLLM: OpenAI path builds a structured-output request and parses completion, handles refusal/incomplete', () => {
  const c = setup();
  let sent;
  let output = {status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(sampleTailored())}]}]};
  c.UrlFetchApp = {fetch: (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    sent = JSON.parse(options.payload);
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify(output)};
  }};
  const parts = [{type: 'input_text', text: 'JD'}, {type: 'input_file', filename: 'r.pdf', file_data: 'data:application/pdf;base64,AQID'}];
  const result = c.callTailoringLLM({provider: 'openai', model: 'o', apiKey: 'k'}, 'prompt', {type: 'object'}, parts);
  assert.equal(result.headline, 'Backend Engineer');
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.input[0].content[0].type, 'input_text');
  assert.equal(sent.input[0].content[1].type, 'input_file');
  output = {status: 'incomplete', output: []};
  assert.throws(() => c.callTailoringLLM({provider: 'openai', model: 'o', apiKey: 'k'}, 'prompt', {type: 'object'}, parts), /incomplete/);
  output = {status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: 'No'}]}]};
  assert.throws(() => c.callTailoringLLM({provider: 'openai', model: 'o', apiKey: 'k'}, 'prompt', {type: 'object'}, parts), /declined/);
});

test('buildTailoredResumeDoc_ writes name/headline/summary/sections/bullets in order and never mentions missing skills in the doc itself', () => {
  const c = setup();
  const mock = makeDocumentAppMock();
  c.DocumentApp = mock.DocumentApp;
  c.Utilities = {getUuid: () => 'uuid'};
  const id = c.buildTailoredResumeDoc_(sampleTailored());
  assert.equal(id, 'doc-id-123');
  assert.equal(mock.state.savedAndClosed, true);
  const texts = Array.from(mock.elements).map(el => el.text);
  assert.equal(texts[0], 'Jane Candidate');
  assert.equal(mock.elements[0].heading, 'TITLE');
  assert.equal(texts[1], 'Backend Engineer');
  assert.equal(mock.elements[1].heading, 'SUBTITLE');
  assert.ok(texts.includes('Built payments services in Java for four years.'));
  assert.ok(texts.includes('Experience'));
  assert.ok(texts.some(t => t.includes('Backend Engineer') && t.includes('Acme, 2021-2024')));
  assert.ok(texts.includes('Built a payments service in Java'));
  assert.ok(!texts.some(t => t.includes('Kubernetes'))); // missing skills never appear in the downloadable doc itself
});
test('buildTailoredResumeDoc_ omits empty name/headline/summary lines', () => {
  const c = setup();
  const mock = makeDocumentAppMock();
  c.DocumentApp = mock.DocumentApp;
  c.Utilities = {getUuid: () => 'uuid'};
  c.buildTailoredResumeDoc_({...sampleTailored(), name: '', headline: '', summary: ''});
  const texts = Array.from(mock.elements).map(el => el.text);
  assert.ok(!texts.includes(''));
});

test('exportDocAsDocxBase64_ requests the docx export mime type with an OAuth bearer token and base64-encodes the bytes', () => {
  const c = setup();
  let requestedUrl, requestedHeaders;
  c.ScriptApp = {getOAuthToken: () => 'oauth-token'};
  c.UrlFetchApp = {fetch: (url, options) => {
    requestedUrl = url; requestedHeaders = options.headers;
    return {getResponseCode: () => 200, getContent: () => [72, 101, 108, 108, 111]}; // "Hello"
  }};
  c.Utilities = {base64Encode: bytes => Buffer.from(bytes).toString('base64')};
  const result = c.exportDocAsDocxBase64_('doc-id-123');
  assert.match(requestedUrl, /files\/doc-id-123\/export/);
  assert.match(requestedUrl, /wordprocessingml\.document/);
  assert.equal(requestedHeaders.Authorization, 'Bearer oauth-token');
  assert.equal(Buffer.from(result, 'base64').toString('utf8'), 'Hello');
});
test('exportDocAsDocxBase64_ throws a friendly error on a non-200 response', () => {
  const c = setup();
  c.ScriptApp = {getOAuthToken: () => 'oauth-token'};
  c.UrlFetchApp = {fetch: () => ({getResponseCode: () => 403, getContent: () => []})};
  assert.throws(() => c.exportDocAsDocxBase64_('doc-id-123'), /Could not export/);
});

test('suggestGithubProjectsForMissingSkills_ caps at 5 skills and 3 repos each, and includes GITHUB_TOKEN when set', () => {
  const c = setup();
  const calls = [];
  c.PropertiesService = {getScriptProperties: () => ({getProperty: key => (key === 'GITHUB_TOKEN' ? 'gh-token' : null)})};
  c.clampText = (value, max) => String(value || '').trim().slice(0, max || 500);
  c.UrlFetchApp = {fetch: (url, options) => {
    calls.push({url, headers: options.headers});
    return {getResponseCode: () => 200, getContentText: () => JSON.stringify({items: [
      {full_name: 'a/repo1', html_url: 'https://github.com/a/repo1', stargazers_count: 100, description: 'd1'},
      {full_name: 'a/repo2', html_url: 'https://github.com/a/repo2', stargazers_count: 50, description: 'd2'},
      {full_name: 'a/repo3', html_url: 'https://github.com/a/repo3', stargazers_count: 10, description: 'd3'},
      {full_name: 'a/repo4', html_url: 'https://github.com/a/repo4', stargazers_count: 1, description: 'd4'}
    ]})};
  }};
  const skills = ['Kubernetes', 'Docker', 'AWS', 'Terraform', 'GraphQL', 'Redis']; // 6 - should cap to 5 calls
  const results = c.suggestGithubProjectsForMissingSkills_(skills);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].headers.Authorization, 'Bearer gh-token');
  assert.equal(results.length, 5);
  assert.equal(results[0].repos.length, 3); // capped to top 3 even though 4 came back
  assert.equal(results[0].repos[0].name, 'a/repo1');
});
test('suggestGithubProjectsForMissingSkills_ skips a skill whose lookup fails or returns non-200, without throwing', () => {
  const c = setup();
  c.PropertiesService = {getScriptProperties: () => ({getProperty: () => null})};
  c.clampText = (value, max) => String(value || '').trim().slice(0, max || 500);
  let call = 0;
  c.UrlFetchApp = {fetch: () => {
    call++;
    if(call === 1) throw new Error('network down');
    return {getResponseCode: () => 403, getContentText: () => '{}'};
  }};
  const results = c.suggestGithubProjectsForMissingSkills_(['SkillA', 'SkillB']);
  assert.deepEqual(Array.from(results), []);
});
test('suggestGithubProjectsForMissingSkills_ returns nothing for an empty list, without calling GitHub', () => {
  const c = setup();
  let called = false;
  c.PropertiesService = {getScriptProperties: () => ({getProperty: () => null})};
  c.UrlFetchApp = {fetch: () => { called = true; return {getResponseCode: () => 200, getContentText: () => '{}'}; }};
  assert.deepEqual(Array.from(c.suggestGithubProjectsForMissingSkills_([])), []);
  assert.equal(called, false);
});

function fullBackend(){
  const c = setup();
  c.clampText = (value, max) => String(value || '').trim().slice(0, max || 500);
  c.PropertiesService = {getScriptProperties: () => ({getProperty: key => ({RESUME_LLM_ENABLED: 'true', RESUME_GEMINI_API_KEY: 'k', RESUME_GEMINI_MODEL: 'gemini-test'})[key]})};
  c.opportunitySourcesToText = () => 'Need Java, Kubernetes';
  c.comparisonResumePart = () => ({type: 'input_text', text: 'Built a payments service in Java', source: 'pasted resume'});
  const mock = makeDocumentAppMock();
  c.DocumentApp = mock.DocumentApp;
  c.Utilities = {getUuid: () => 'uuid', base64Encode: bytes => Buffer.from(bytes).toString('base64')};
  c.ScriptApp = {getOAuthToken: () => 'oauth-token'};
  const trashed = [];
  c.DriveApp = {getFileById: id => ({setTrashed(v){ trashed.push({id, v}); }})};
  c.UrlFetchApp = {fetch: (url) => {
    if(url.indexOf('googleapis.com/drive') >= 0){
      return {getResponseCode: () => 200, getContent: () => [1, 2, 3]};
    }
    if(url.indexOf('api.github.com') >= 0){
      return {getResponseCode: () => 200, getContentText: () => JSON.stringify({items: []})};
    }
    throw new Error('Unexpected fetch: ' + url);
  }};
  return {context: c, mock, trashed};
}

test('generateTailoredResume: awaits LLM setup when no provider is configured', () => {
  const b = fullBackend();
  b.context.PropertiesService = {getScriptProperties: () => ({getProperty: () => null})};
  const result = b.context.generateTailoredResume('a@example.com', {opportunityText: 'Need Java', resumeText: 'Java dev'});
  assert.equal(result.ok, false);
  assert.equal(result.status, 'Awaiting LLM setup');
});

test('generateTailoredResume: happy path builds a docx, cleans up the temp doc, and returns GitHub suggestions for missing skills', () => {
  const b = fullBackend();
  b.context.callTailoringLLM = () => sampleTailored();
  const result = b.context.generateTailoredResume('a@example.com', {
    opportunityText: 'Need Java, Kubernetes', resumeText: 'Built a payments service in Java',
    comparison: {matchedSkills: ['Java'], missingSkills: ['Kubernetes', 'AWS'], strengths: ['Strong Java'], weaknesses: ['No Kubernetes']}
  });
  assert.equal(result.ok, true);
  assert.equal(result.tailored.headline, 'Backend Engineer');
  assert.equal(Buffer.from(result.docxBase64, 'base64').toString('utf8'), '\x01\x02\x03');
  assert.equal(result.fileName, 'Tailored-Resume-Jane-Candidate.docx');
  assert.deepEqual(b.trashed, [{id: 'doc-id-123', v: true}]); // temp Google Doc always trashed
  assert.deepEqual(Array.from(result.githubSuggestions), []); // this backend's GitHub mock returns no items
});

test('generateTailoredResume: falls back from Gemini to OpenAI, and throws a friendly error when every provider fails', () => {
  const b = fullBackend();
  b.context.PropertiesService = {getScriptProperties: () => ({getProperty: key => ({RESUME_LLM_ENABLED: 'true', RESUME_GEMINI_API_KEY: 'g', RESUME_GEMINI_MODEL: 'gemini-test', RESUME_OPENAI_API_KEY: 'o', RESUME_OPENAI_MODEL: 'openai-test'})[key]})};
  const calls = [];
  b.context.callTailoringLLM = provider => { calls.push(provider.provider); if(provider.provider === 'gemini') throw new Error('down'); return sampleTailored(); };
  const result = b.context.generateTailoredResume('a@example.com', {opportunityText: 'Need Java', resumeText: 'Java dev'});
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(calls), ['gemini', 'openai']);

  b.context.callTailoringLLM = () => { throw new Error('always fails'); };
  assert.throws(() => b.context.generateTailoredResume('a@example.com', {opportunityText: 'Need Java', resumeText: 'Java dev'}), /Could not generate a tailored resume/);
});

test('generateTailoredResume: the temporary Google Doc is still trashed even when the docx export itself fails', () => {
  const b = fullBackend();
  b.context.callTailoringLLM = () => sampleTailored();
  b.context.UrlFetchApp = {fetch: url => {
    if(url.indexOf('googleapis.com/drive') >= 0) return {getResponseCode: () => 500, getContent: () => []};
    return {getResponseCode: () => 200, getContentText: () => '{}'};
  }};
  assert.throws(() => b.context.generateTailoredResume('a@example.com', {opportunityText: 'Need Java', resumeText: 'Java dev'}), /Could not export/);
  assert.deepEqual(b.trashed, [{id: 'doc-id-123', v: true}]);
});

// ---- doPost wiring (Code.gs) ----
test('doPost routes generateTailoredResume to the ResumeAnalysis.gs function when both files are loaded together', () => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), c);
  vm.runInContext(fs.readFileSync('apps-script/ResumeAnalysis.gs', 'utf8'), c);
  c.json = value => value;
  c.verifyToken = () => ({email: 'a@example.com', sub: 'id', name: 'Alice'});
  c.isApproved = () => true;
  let received;
  c.generateTailoredResume = (email, body) => { received = {email, body}; return {ok: true, tailored: {}, docxBase64: 'AA==', fileName: 'x.docx', githubSuggestions: []}; };
  const result = c.doPost({postData: {contents: JSON.stringify({action: 'generateTailoredResume', idToken: 'token', resumeText: 'r', opportunityText: 'jd', comparison: {missingSkills: ['X']}})}});
  assert.equal(result.ok, true);
  assert.equal(received.email, 'a@example.com');
  assert.equal(received.body.resumeText, 'r');
});
test('doPost reports generateTailoredResume as not deployed when ResumeAnalysis.gs is not loaded', () => {
  const c = vm.createContext({});
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), c);
  c.json = value => value;
  c.verifyToken = () => ({email: 'a@example.com', sub: 'id'});
  c.isApproved = () => true;
  const result = c.doPost({postData: {contents: JSON.stringify({action: 'generateTailoredResume', idToken: 'token'})}});
  assert.equal(result.error, 'Tailored resume generation is not deployed yet.');
});
