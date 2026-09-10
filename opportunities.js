let opportunityFiles = [], opportunitySaving = false, opportunitySession = 0;
let opportunityRequestId = null;
let opportunityProfile = null;
function applyOpportunityProfile(profile){
  opportunityProfile = profile || null;
  const identity = document.getElementById('opportunityIdentity');
  identity.textContent = profile?.canPost
    ? profile.name + ' · ' + profile.homeCompanies.join(', ')
    : 'To post, add your own name and company in Add a contact using the email you signed in with, then refresh history.';
  const select = document.getElementById('opportunityCompany');
  const options = document.getElementById('opportunityCompanyOptions');
  options.replaceChildren();
  const companyNames = [...new Set([...(profile?.companies || []), ...companies.map(company => company.n)])];
  companyNames.forEach(company => { const option = document.createElement('option'); option.value = company; options.append(option); });
  if(!select.value) select.value = profile?.homeCompanies?.[0] || '';
  document.getElementById('opportunityFields').disabled = opportunitySaving || !profile?.canPost;
}
async function loadOpportunityProfile(){
  const session = opportunitySession;
  try{
    const result = await contactApi('opportunityProfile', {});
    if(session === opportunitySession) applyOpportunityProfile(result.profile);
  }catch(error){
    if(session === opportunitySession){ applyOpportunityProfile(null); document.getElementById('opportunityIdentity').textContent = 'Could not verify posting access: ' + error.message + ' Refresh history to retry.'; }
  }
}
const opportunityText = document.getElementById('opportunityText');
const opportunityStatus = document.getElementById('opportunityStatus');
const opportunityAllowed = ['doc','docx','xls','xlsx','pdf','jpg','jpeg','png'];

function resetOpportunitySession(){
  opportunitySession++;
  opportunityFiles = [];
  opportunitySaving = false;
  opportunityRequestId = null;
  document.getElementById('opportunityCompany').value = '';
  opportunityText.value = '';
  opportunityStatus.textContent = '';
  document.getElementById('opportunityMessages').replaceChildren();
  applyOpportunityProfile(null);
  document.getElementById('opportunityFiles').value = '';
  renderOpportunityAttachments();
}
function renderOpportunityAttachments(){
  const root = document.getElementById('opportunityAttachments');
  root.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
  root.replaceChildren();
  opportunityFiles.forEach((file, index) => {
    const row = document.createElement('div'); row.className = 'opportunity-attachment';
    if(['jpg','jpeg','png'].includes(fileExtension(file.name))){
      const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.alt = file.name; row.append(img);
    }
    const label = document.createElement('span'); label.textContent = file.name + ' (' + Math.ceil(file.size / 1024) + ' KB)';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.onclick = () => { opportunityFiles.splice(index, 1); opportunityRequestId = null; renderOpportunityAttachments(); };
    row.append(label, remove); root.append(row);
  });
}
function addOpportunityFiles(files){
  if(opportunitySaving) return;
  const combined = opportunityFiles.concat(Array.from(files));
  if(combined.some(file => !opportunityAllowed.includes(fileExtension(file.name)))){ opportunityStatus.textContent = 'Choose Word, Excel, PDF, JPG or PNG files.'; return; }
  if(combined.some(file => !file.size)){ opportunityStatus.textContent = 'Empty files cannot be uploaded.'; return; }
  if(combined.length > 5 || combined.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024){ opportunityStatus.textContent = 'Attach up to 5 files with a combined size of 5 MB or less.'; return; }
  opportunityFiles = combined; opportunityRequestId = null; opportunityStatus.textContent = ''; renderOpportunityAttachments();
}
document.getElementById('opportunityFiles').addEventListener('change', event => { addOpportunityFiles(event.target.files); event.target.value = ''; });
opportunityText.addEventListener('input', () => { opportunityRequestId = null; });
opportunityText.addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  if(!files.length) return;
  event.preventDefault();
  addOpportunityFiles(files);
  const text = event.clipboardData.getData('text/plain');
  if(text && !opportunitySaving) opportunityText.setRangeText(text, opportunityText.selectionStart, opportunityText.selectionEnd, 'end');
});
opportunityText.addEventListener('keydown', event => {
  if(event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing){ event.preventDefault(); document.getElementById('opportunityComposer').requestSubmit(); }
});
function renderOpportunityAnalysis(item, bubble){
  const analysis = item && item.analysis;
  if(!analysis) return;
  const box = document.createElement('div');
  box.className = 'opportunity-analysis';
  const title = document.createElement('strong');
  title.textContent = 'AI requirements' + (analysis.status ? ' · ' + analysis.status : '');
  box.append(title);

  const addField = (label, value) => {
    const p = document.createElement('p');
    const span = document.createElement('span');
    span.textContent = label;
    p.append(span, document.createTextNode(value));
    box.append(p);
  };

  addField(
    'Years of experience',
    analysis.yearsExperience === null || analysis.yearsExperience === undefined || analysis.yearsExperience === ''
      ? 'Not stated'
      : String(analysis.yearsExperience)
  );
  addField('Technical skills', (analysis.technicalSkills || []).join('; ') || 'None listed');
  addField('Non-technical skills', (analysis.nonTechnicalSkills || []).join('; ') || 'None listed');
  if(analysis.experienceBasis) addField('Experience basis', analysis.experienceBasis);
  if((analysis.reviewNotes || []).length) addField('Review notes', (analysis.reviewNotes || []).join(' '));
  bubble.append(box);

  const matches = analysis.matches || [];
  if(matches.length){
    const matchBox = document.createElement('div');
    matchBox.className = 'opportunity-matches';
    const matchTitle = document.createElement('strong');
    matchTitle.textContent = 'Matching candidates (' + matches.length + ')';
    matchBox.append(matchTitle);
    const list = document.createElement('ul');
    matches.forEach(match => {
      const li = document.createElement('li');
      const skills = (match.matchedSkills || []).join(', ');
      li.textContent = (match.name || 'A candidate') + ' — ' + match.score + '% match' + (skills ? ' (' + skills + ')' : '');
      list.append(li);
    });
    matchBox.append(list);
    bubble.append(matchBox);
  }
}

function renderOpportunities(items){
  const root = document.getElementById('opportunityMessages'); root.replaceChildren();
  if(!items.length){ root.textContent = 'Your opportunities will appear here once you send them.'; return; }
  items.forEach(item => {
    const bubble = document.createElement('article'); bubble.className = 'opportunity-message';
    const time = document.createElement('small'); time.textContent = (item.postedBy || 'You') + (item.company ? ' · ' + item.company : '') + ' · ' + new Date(item.createdAt).toLocaleString(); bubble.append(time);
    if(item.text){ const p = document.createElement('p'); p.textContent = item.text; bubble.append(p); }
    const list = document.createElement('ul');
    (item.files || []).forEach(file => { const li = document.createElement('li'); li.textContent = file.name; list.append(li); });
    if(list.children.length) bubble.append(list);
    renderOpportunityAnalysis(item, bubble);
    const saved = document.createElement('small'); saved.textContent = 'Saved to Professional Opportunity'; bubble.append(saved); root.append(bubble);
  });
  root.scrollTop = root.scrollHeight;
}
async function loadOpportunities(){
  const session = opportunitySession;
  const root = document.getElementById('opportunityMessages');
  if(!root.children.length) root.textContent = 'Loading your opportunities...';
  try{
    const result = await contactApi('opportunities', {});
    if(session !== opportunitySession) return;
    applyOpportunityProfile(result.profile);
    renderOpportunities(result.opportunities || []);
  }catch(error){ if(session === opportunitySession) root.textContent = 'Could not load history: ' + error.message + ' Use Refresh history to retry.'; }
}
document.getElementById('opportunityComposer').addEventListener('submit', async event => {
  event.preventDefault(); if(opportunitySaving) return;
  if(!opportunityProfile?.canPost){ opportunityStatus.textContent = 'A matching contact profile is required to post.'; return; }
  const company = document.getElementById('opportunityCompany').value;
  const text = opportunityText.value.trim();
  if(!text && !opportunityFiles.length){ opportunityStatus.textContent = 'Paste an opportunity or attach a file first.'; return; }
  if(text.length > 20000){ opportunityStatus.textContent = 'Please keep the message under 20,000 characters.'; return; }
  const session = opportunitySession;
  opportunitySaving = true; document.getElementById('opportunityFields').disabled = true;
  opportunityStatus.textContent = 'Saving to Google Drive and decomposing with AI...';
  opportunityRequestId ||= crypto.randomUUID();
  try{
    const files = await Promise.all(opportunityFiles.map(async file => ({name:file.name, dataBase64:await fileToBase64(file)})));
    if(session !== opportunitySession) return;
    const result = await contactApi('saveOpportunity', {requestId:opportunityRequestId, text, files, company});
    if(session !== opportunitySession) return;
    if(!result.ok) throw new Error('The server did not confirm the save.');
    opportunityText.value = ''; opportunityFiles = []; opportunityRequestId = null; renderOpportunityAttachments();
    const matchCount = result.opportunity?.analysis?.matches?.length || 0;
    opportunityStatus.textContent = result.opportunity?.analysis
      ? ('Saved. AI status: ' + (result.opportunity.analysis.status || 'Complete')
        + (matchCount ? ' · ' + matchCount + ' matching candidate' + (matchCount === 1 ? '' : 's') + ' notified' : '')
        + '. You can send another opportunity.')
      : 'Saved to Professional Opportunity. You can send another opportunity.';
    await loadOpportunities();
  }catch(error){ if(session === opportunitySession) opportunityStatus.textContent = 'Could not save: ' + error.message + ' Your message and attachments are still here. Retry Send opportunity.'; }
  finally{ if(session === opportunitySession){ opportunitySaving = false; document.getElementById('opportunityFields').disabled = !opportunityProfile?.canPost; } }
});
document.getElementById('opportunityCompany').addEventListener('input', () => { opportunityRequestId = null; });
