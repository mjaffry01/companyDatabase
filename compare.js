let fitComparing = false;
let fitJdFiles = [];
const FIT_JD_ALLOWED = ['txt','html','htm','doc','docx','xls','xlsx','pdf','jpg','jpeg','png','gif','webp'];
function resetResumeFitForm(){
  const form = document.getElementById('fitForm');
  if(!form) return;
  form.reset();
  fitJdFiles = [];
  renderFitJdAttachments();
  document.getElementById('fitFormNote').textContent = '';
  document.getElementById('fitReport').hidden = true;
  document.getElementById('fitReport').replaceChildren();
  document.getElementById('fitCompareBtn').disabled = false;
  fitComparing = false;
}
function renderFitJdAttachments(){
  const root = document.getElementById('fitJdAttachments');
  if(!root) return;
  root.querySelectorAll('img').forEach(img => URL.revokeObjectURL(img.src));
  root.replaceChildren();
  fitJdFiles.forEach((file, index) => {
    const row = document.createElement('div'); row.className = 'opportunity-attachment';
    if(['jpg','jpeg','png','gif','webp'].includes(fileExtension(file.name))){
      const img = document.createElement('img'); img.src = URL.createObjectURL(file); img.alt = file.name; row.append(img);
    }
    const label = document.createElement('span'); label.textContent = file.name + ' (' + Math.ceil(file.size / 1024) + ' KB)';
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost'; remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + file.name);
    remove.onclick = () => { if(fitComparing) return; fitJdFiles.splice(index, 1); renderFitJdAttachments(); };
    row.append(label, remove); root.append(row);
  });
}
function addFitJdFiles(files){
  if(fitComparing) return;
  const combined = fitJdFiles.concat(Array.from(files));
  if(combined.some(file => !FIT_JD_ALLOWED.includes(fileExtension(file.name)))){
    showToast('Attach Word, Excel, PDF, HTML, text, JPG, PNG, GIF or WebP files');
    return;
  }
  if(combined.some(file => !file.size)){ showToast('Empty files cannot be used as a job description'); return; }
  if(combined.length > 5 || combined.reduce((n, f) => n + f.size, 0) > 5 * 1024 * 1024){
    showToast('Attach up to 5 opportunity files totaling 5 MB or less');
    return;
  }
  fitJdFiles = combined;
  renderFitJdAttachments();
}
function fitList(title, items, className){
  const wrap = document.createElement('section');
  wrap.className = className || '';
  const heading = document.createElement('h4');
  heading.textContent = title;
  const list = document.createElement('ul');
  (items && items.length ? items : ['None stated']).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  });
  wrap.append(heading, list);
  return wrap;
}
function renderResumeFit(result, method, status){
  const root = document.getElementById('fitReport');
  root.replaceChildren();
  root.hidden = false;
  const intro = document.createElement('p');
  intro.setAttribute('role', 'status');
  intro.textContent = status === 'Awaiting LLM setup'
    ? 'The resume and JD were saved on this screen, but Gemini is not connected yet.'
    : 'Gemini compared skills, years of experience, and projects against the JD' + (method ? ' (' + method + ').' : '.');
  root.append(intro);
  if(!result) return;
  root.append(
    fitList('Strengths', result.strengths, 'fit-strengths'),
    fitList('Weaknesses', result.weaknesses, 'fit-weaknesses'),
    fitList('JD skills evidenced on the resume', result.matchedSkills),
    fitList('JD skills not evidenced', result.missingSkills)
  );
  const years = document.createElement('section');
  const yearsTitle = document.createElement('h4');
  yearsTitle.textContent = 'Years of experience';
  const yearsBody = document.createElement('p');
  const resumeYears = result.resumeYears == null ? 'not stated on the resume' : result.resumeYears + ' years on the resume';
  const jdYears = result.jdYearsRequired == null ? 'no years required in the JD' : result.jdYearsRequired + ' years required in the JD';
  yearsBody.textContent = (result.yearsAssessment || '') + ' (' + resumeYears + '; ' + jdYears + ').';
  years.append(yearsTitle, yearsBody);
  root.append(years, fitList('Projects or roles that prove JD skills', result.projectEvidence));
  if(result.reviewNotes && result.reviewNotes.length){
    root.append(fitList('Review notes', result.reviewNotes));
  }
}
document.getElementById('fit-opportunity-files').addEventListener('change', event => {
  addFitJdFiles(event.target.files);
  event.target.value = '';
});
document.getElementById('fit-opportunity-text').addEventListener('paste', event => {
  const files = Array.from(event.clipboardData?.items || []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean);
  if(!files.length) return;
  event.preventDefault();
  addFitJdFiles(files);
  const text = event.clipboardData.getData('text/plain');
  if(text && !fitComparing) document.getElementById('fit-opportunity-text').setRangeText(text, document.getElementById('fit-opportunity-text').selectionStart, document.getElementById('fit-opportunity-text').selectionEnd, 'end');
});
document.getElementById('fitForm').addEventListener('submit', async event => {
  event.preventDefault();
  if(fitComparing) return;
  const file = document.getElementById('fit-resume-file').files[0];
  const googleDocUrl = document.getElementById('fit-resume-gdoc').value.trim();
  const resumeText = document.getElementById('fit-resume-text').value.trim();
  const opportunityTitle = document.getElementById('fit-opportunity-title').value.trim();
  const opportunityText = document.getElementById('fit-opportunity-text').value.trim();
  if(!opportunityText && !fitJdFiles.length){ showToast('Paste the opportunity or attach a JD file or image'); return; }
  if(!file && !googleDocUrl && !resumeText){ showToast('Add a resume file, Google Doc link, or paste the resume'); return; }
  if(file && googleDocUrl){ showToast('Use either a resume file or a Google Doc link, not both'); return; }
  let dataBase64 = '', fileName = '';
  if(file){
    const extension = fileExtension(file.name);
    if(!RESUME_ALLOWED_EXTENSIONS.includes(extension)){
      showToast('Only .doc, .docx, .pdf and .html/.htm resumes are accepted');
      return;
    }
    if(file.size > RESUME_MAX_BYTES){
      showToast('Resume file is larger than 5 MB — please upload a smaller file');
      return;
    }
    fileName = file.name;
    dataBase64 = await fileToBase64(file);
  }else if(googleDocUrl && !GDOC_URL_PATTERN.test(googleDocUrl)){
    showToast('That doesn’t look like a Google Doc link (should start with docs.google.com/document/d/…)');
    return;
  }
  fitComparing = true;
  const button = document.getElementById('fitCompareBtn');
  const note = document.getElementById('fitFormNote');
  button.disabled = true;
  note.textContent = 'Converting the JD to text, then Gemini will compare…';
  document.getElementById('fitReport').hidden = true;
  try{
    const opportunityFiles = [];
    for(const jdFile of fitJdFiles){
      opportunityFiles.push({name:jdFile.name, dataBase64:await fileToBase64(jdFile)});
    }
    const json = await contactApi('compareResumeFit', {
      fileName, dataBase64, googleDocUrl: file ? '' : googleDocUrl, resumeText: file || googleDocUrl ? '' : resumeText,
      opportunityTitle, opportunityText, opportunityFiles
    });
    if(json.error) throw new Error(json.error);
    renderResumeFit(json.comparison, json.method, json.status);
    note.textContent = json.status === 'Awaiting LLM setup' ? 'Waiting for Gemini to be connected.' : 'Comparison complete.';
  }catch(error){
    note.textContent = '';
    showToast('Could not compare: ' + error.message);
  }finally{
    fitComparing = false;
    button.disabled = false;
  }
});
