let opportunityFiles = [], opportunitySaving = false, opportunitySession = 0;
let opportunityRequestId = null;
const opportunityText = document.getElementById('opportunityText');
const opportunityStatus = document.getElementById('opportunityStatus');
const opportunityAllowed = ['doc','docx','xls','xlsx','pdf','jpg','jpeg','png'];

function resetOpportunitySession(){
  opportunitySession++;
  opportunityFiles = [];
  opportunitySaving = false;
  opportunityRequestId = null;
  opportunityText.value = '';
  opportunityStatus.textContent = '';
  document.getElementById('opportunityMessages').replaceChildren();
  document.getElementById('opportunityFields').disabled = false;
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
function renderOpportunities(items){
  const root = document.getElementById('opportunityMessages'); root.replaceChildren();
  if(!items.length){ root.textContent = 'Your opportunities will appear here once you send them.'; return; }
  items.forEach(item => {
    const bubble = document.createElement('article'); bubble.className = 'opportunity-message';
    const time = document.createElement('small'); time.textContent = 'You · ' + new Date(item.createdAt).toLocaleString(); bubble.append(time);
    if(item.text){ const p = document.createElement('p'); p.textContent = item.text; bubble.append(p); }
    const list = document.createElement('ul');
    (item.files || []).forEach(file => { const li = document.createElement('li'); li.textContent = file.name; list.append(li); });
    if(list.children.length) bubble.append(list);
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
    renderOpportunities(result.opportunities || []);
  }catch(error){ if(session === opportunitySession) root.textContent = 'Could not load history: ' + error.message + ' Use Refresh history to retry.'; }
}
document.getElementById('opportunityComposer').addEventListener('submit', async event => {
  event.preventDefault(); if(opportunitySaving) return;
  const text = opportunityText.value.trim();
  if(!text && !opportunityFiles.length){ opportunityStatus.textContent = 'Paste an opportunity or attach a file first.'; return; }
  if(text.length > 20000){ opportunityStatus.textContent = 'Please keep the message under 20,000 characters.'; return; }
  const session = opportunitySession;
  opportunitySaving = true; document.getElementById('opportunityFields').disabled = true;
  opportunityStatus.textContent = 'Saving to Google Drive...';
  opportunityRequestId ||= crypto.randomUUID();
  try{
    const files = await Promise.all(opportunityFiles.map(async file => ({name:file.name, dataBase64:await fileToBase64(file)})));
    if(session !== opportunitySession) return;
    const result = await contactApi('saveOpportunity', {requestId:opportunityRequestId, text, files});
    if(session !== opportunitySession) return;
    if(!result.ok) throw new Error('The server did not confirm the save.');
    opportunityText.value = ''; opportunityFiles = []; opportunityRequestId = null; renderOpportunityAttachments();
    opportunityStatus.textContent = 'Saved to Professional Opportunity. You can send another opportunity.';
    await loadOpportunities();
  }catch(error){ if(session === opportunitySession) opportunityStatus.textContent = 'Could not save: ' + error.message + ' Your message and attachments are still here. Retry Send opportunity.'; }
  finally{ if(session === opportunitySession){ opportunitySaving = false; document.getElementById('opportunityFields').disabled = false; } }
});
