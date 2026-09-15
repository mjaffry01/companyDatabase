let mentorSession = 0;
let mentorState = { mentorProfile:null, seekerProfile:null, mentors:[], seekers:[], matches:[] };
let pendingRatings = {};

function toggleChip(chip){ chip.classList.toggle('on'); }
document.querySelectorAll('#m-expertise .chip-opt, #s-field .chip-opt').forEach(chip => chip.addEventListener('click', () => toggleChip(chip)));

function getSelectedChips(containerId){
  return Array.from(document.querySelectorAll('#' + containerId + ' .chip-opt.on')).map(chip => chip.textContent);
}
function setSelectedChips(containerId, values){
  const wanted = new Set((values || []).map(v => String(v).toLowerCase()));
  document.querySelectorAll('#' + containerId + ' .chip-opt').forEach(chip => chip.classList.toggle('on', wanted.has(chip.textContent.toLowerCase())));
}

function resetMentorSession(){
  mentorSession++;
  mentorState = { mentorProfile:null, seekerProfile:null, mentors:[], seekers:[], matches:[] };
  pendingRatings = {};
  ['m-name','m-role','m-company','m-phone','m-years','m-slots','m-note','m-rate','s-name','s-phone','s-note'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  ['m-contact-pref','s-status','s-contact-pref'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('m-paid').checked = false;
  document.getElementById('m-rate-wrap').hidden = true;
  document.getElementById('m-undertaking').checked = false;
  setSelectedChips('m-expertise', []);
  setSelectedChips('s-field', []);
  applyMentorProfile(); applySeekerProfile();
  document.getElementById('seekerPool').innerHTML = '<div class="empty-note">Sign in to see who is waiting for a mentor.</div>';
  document.getElementById('mentorPool').innerHTML = '<div class="empty-note">Sign in to see available mentors.</div>';
  document.getElementById('adoptedList').innerHTML = '<div class="empty-note">Register above, then adopt someone from the list — they\'ll show up here.</div>';
  document.getElementById('requestedList').innerHTML = '<div class="empty-note">Register above, then request a mentor from the list — they\'ll show up here.</div>';
  document.getElementById('mentor-search-input').value = '';
  document.getElementById('mentorSearchResult').replaceChildren();
}

function applyMentorProfile(){
  const note = document.getElementById('mentorFormNote');
  const btn = document.getElementById('mentorSaveBtn');
  const profile = mentorState.mentorProfile;
  if(profile){
    document.getElementById('m-name').value = profile.name || '';
    document.getElementById('m-role').value = profile.role || '';
    document.getElementById('m-company').value = profile.company || '';
    document.getElementById('m-phone').value = profile.phone || '';
    document.getElementById('m-contact-pref').value = profile.contactPref || '';
    document.getElementById('m-years').value = profile.years || '';
    document.getElementById('m-slots').value = profile.slots || '';
    document.getElementById('m-note').value = profile.note || '';
    document.getElementById('m-paid').checked = !!profile.paid;
    document.getElementById('m-rate-wrap').hidden = !profile.paid;
    document.getElementById('m-rate').value = profile.rate || '';
    document.getElementById('m-undertaking').checked = true;
    setSelectedChips('m-expertise', profile.expertise);
    note.textContent = 'Registered — you can adopt mentees now';
    note.classList.add('ok');
    btn.textContent = 'Update profile';
  }else{
    note.textContent = 'Not registered yet';
    note.classList.remove('ok');
    btn.textContent = 'Register';
  }
}
function applySeekerProfile(){
  const note = document.getElementById('seekerFormNote');
  const btn = document.getElementById('seekerSaveBtn');
  const profile = mentorState.seekerProfile;
  if(profile){
    document.getElementById('s-name').value = profile.name || '';
    document.getElementById('s-phone').value = profile.phone || '';
    document.getElementById('s-contact-pref').value = profile.contactPref || '';
    document.getElementById('s-status').value = profile.status || '';
    document.getElementById('s-note').value = profile.note || '';
    setSelectedChips('s-field', profile.field);
    note.textContent = 'Registered — you can request mentors now';
    note.classList.add('ok');
    btn.textContent = 'Update profile';
  }else{
    note.textContent = 'Not registered yet';
    note.classList.remove('ok');
    btn.textContent = 'Register';
  }
}

async function loadMentorData(){
  if(!window.currentCredential || !window.currentCredential()) return;
  const session = ++mentorSession;
  try{
    const result = await contactApi('mentorData', {});
    if(session !== mentorSession) return;
    mentorState.mentorProfile = result.mentorProfile || null;
    mentorState.seekerProfile = result.seekerProfile || null;
    mentorState.mentors = result.mentors || [];
    mentorState.seekers = result.seekers || [];
    mentorState.matches = result.matches || [];
    applyMentorProfile();
    applySeekerProfile();
    renderSeekerPool();
    renderMentorPool();
    renderAdoptedList();
    renderRequestedList();
  }catch(error){
    showToast('Could not load mentor network: ' + error.message);
  }
}

async function registerMentor(){
  const name = document.getElementById('m-name').value.trim();
  const role = document.getElementById('m-role').value.trim();
  const company = document.getElementById('m-company').value.trim();
  const phone = document.getElementById('m-phone').value.trim();
  const contactPref = document.getElementById('m-contact-pref').value;
  const expertise = getSelectedChips('m-expertise');
  const years = Number(document.getElementById('m-years').value);
  const slots = Number(document.getElementById('m-slots').value);
  const note = document.getElementById('m-note').value.trim();
  const paid = document.getElementById('m-paid').checked;
  const rate = document.getElementById('m-rate').value.trim();
  const undertakingAccepted = document.getElementById('m-undertaking').checked;
  const noteEl = document.getElementById('mentorFormNote');
  if(!name || !role || !company){ noteEl.textContent = 'Fill in your name, role and company.'; noteEl.classList.remove('ok'); return; }
  if(!expertise.length){ noteEl.textContent = 'Pick at least one area you can guide in.'; noteEl.classList.remove('ok'); return; }
  if(!Number.isInteger(slots) || slots < 1){ noteEl.textContent = 'Enter how many mentees you can take.'; noteEl.classList.remove('ok'); return; }
  if(paid && !rate){ noteEl.textContent = 'Enter your rate, or uncheck paid mentorship.'; noteEl.classList.remove('ok'); return; }
  if(!undertakingAccepted){ noteEl.textContent = 'Please accept the mentor undertaking to register.'; noteEl.classList.remove('ok'); return; }
  const btn = document.getElementById('mentorSaveBtn');
  btn.disabled = true; noteEl.textContent = 'Saving…'; noteEl.classList.remove('ok');
  try{
    const result = await contactApi('registerMentor', {name, role, company, phone, contactPref, expertise, years, slots, note, paid, rate, undertakingAccepted});
    mentorState.mentorProfile = result.profile;
    applyMentorProfile();
    renderSeekerPool();
    showToast('Mentor profile saved');
  }catch(error){ noteEl.textContent = 'Could not save: ' + error.message; }
  finally{ btn.disabled = false; }
}

async function registerSeeker(){
  const name = document.getElementById('s-name').value.trim();
  const phone = document.getElementById('s-phone').value.trim();
  const contactPref = document.getElementById('s-contact-pref').value;
  const status = document.getElementById('s-status').value;
  const field = getSelectedChips('s-field');
  const note = document.getElementById('s-note').value.trim();
  const noteEl = document.getElementById('seekerFormNote');
  if(!name || !status){ noteEl.textContent = 'Fill in your name and situation.'; noteEl.classList.remove('ok'); return; }
  if(!field.length){ noteEl.textContent = 'Pick at least one field you want guidance in.'; noteEl.classList.remove('ok'); return; }
  if(!note){ noteEl.textContent = 'Add a line about what help you need.'; noteEl.classList.remove('ok'); return; }
  const btn = document.getElementById('seekerSaveBtn');
  btn.disabled = true; noteEl.textContent = 'Saving…'; noteEl.classList.remove('ok');
  try{
    const result = await contactApi('registerSeeker', {name, phone, contactPref, status, field, note});
    mentorState.seekerProfile = result.profile;
    applySeekerProfile();
    renderMentorPool();
    showToast('Mentee profile saved');
  }catch(error){ noteEl.textContent = 'Could not save: ' + error.message; }
  finally{ btn.disabled = false; }
}

async function adoptSeeker(email){
  try{
    const result = await contactApi('adoptMentee', {seekerEmail: email});
    mentorState.matches = result.matches || mentorState.matches;
    renderSeekerPool();
    renderAdoptedList();
    showToast('Adopted — they have been emailed to get started');
  }catch(error){ showToast('Could not adopt: ' + error.message); }
}
async function requestMentor(email){
  try{
    const result = await contactApi('requestMentor', {mentorEmail: email});
    mentorState.matches = result.matches || mentorState.matches;
    renderMentorPool();
    renderRequestedList();
    showToast('Request sent — the mentor has been emailed');
  }catch(error){ showToast('Could not send request: ' + error.message); }
}

function selectRatingStar(mentorEmail, rating){
  pendingRatings[mentorEmail] = rating;
  renderMentorPool();
}
async function submitRating(button, mentorEmail){
  const match = mentorState.matches.find(m => m.mentorEmail.toLowerCase() === mentorEmail.toLowerCase());
  const rating = pendingRatings[mentorEmail] || (match && match.rating) || 0;
  if(!rating){ showToast('Pick a star rating first'); return; }
  const review = button.closest('.rate-widget').querySelector('.rate-review-input').value.trim();
  button.disabled = true;
  try{
    const result = await contactApi('rateMentor', {mentorEmail, rating, review});
    mentorState.matches = result.matches || mentorState.matches;
    delete pendingRatings[mentorEmail];
    renderMentorPool();
    showToast('Thanks — your rating was saved');
  }catch(error){ showToast('Could not save rating: ' + error.message); button.disabled = false; }
}

function mentorContactActions(person){
  const phone = String(person.phone || '').trim();
  const digits = phoneDigits(phone);
  let html = '<div class="contact-actions">';
  if(phone) html += `<a href="tel:${escapeHtml(phone)}" title="Call ${escapeHtml(person.name)}" aria-label="Call ${escapeHtml(person.name)}"><i class="fa-solid fa-phone" aria-hidden="true"></i></a>`;
  if(digits) html += `<a href="https://wa.me/${digits}" target="_blank" rel="noopener" title="WhatsApp ${escapeHtml(person.name)}" aria-label="WhatsApp ${escapeHtml(person.name)}"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></a>`;
  html += emailLink(person.email);
  html += '</div>';
  return html;
}
function contactPrefNote(person){
  return person.contactPref ? `<div class="p-pref">Prefers ${escapeHtml(person.contactPref)}</div>` : '';
}
function ratingWidgetHtml(mentorEmail, existingRating, existingReview){
  const selected = pendingRatings[mentorEmail] || existingRating || 0;
  let stars = '';
  for(let i = 1; i <= 5; i++) stars += `<span class="star${selected >= i ? ' on' : ''}" onclick="selectRatingStar('${escapeHtml(mentorEmail)}', ${i})">&#9733;</span>`;
  return `<div class="rate-widget">
    <div class="star-picker">${stars}</div>
    <input type="text" class="rate-review-input" maxlength="500" placeholder="Optional note about the mentorship" value="${escapeHtml(existingReview || '')}">
    <button type="button" class="btn btn-ghost btn-sm" onclick="submitRating(this, '${escapeHtml(mentorEmail)}')">${existingRating ? 'Update rating' : 'Submit rating'}</button>
  </div>`;
}

function renderSeekerPool(){
  const wrap = document.getElementById('seekerPool');
  const seekers = mentorState.seekers;
  wrap.replaceChildren();
  if(!seekers.length){ wrap.innerHTML = '<div class="empty-note">No one is waiting for a mentor right now.</div>'; }
  seekers.forEach(s => {
    const match = mentorState.matches.find(m => m.seekerEmail.toLowerCase() === s.email.toLowerCase());
    const card = document.createElement('div');
    card.className = 'mentor-card' + (match ? ' matched' : '');
    card.innerHTML = `
      <div class="p-head"><div><div class="p-name">${escapeHtml(s.name)}</div><div class="p-role">${escapeHtml(s.status)}</div></div></div>
      <div class="p-tags">${s.field.map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="p-note">${escapeHtml(s.note)}</div>
      ${contactPrefNote(s)}
      ${match ? mentorContactActions(s) : ''}
      <div class="p-foot"><span></span>${
        match ? `<span class="p-status">${match.type === 'adopted' ? '&#10003; Adopted' : '&#10148; Requested you'}</span>`
        : `<button class="btn btn-primary btn-sm" ${mentorState.mentorProfile ? '' : 'disabled title="Register as a mentor first"'} onclick="adoptSeeker('${escapeHtml(s.email)}')">Adopt as mentee</button>`
      }</div>`;
    wrap.appendChild(card);
  });
  document.getElementById('seekerPoolCount').textContent = seekers.length + ' waiting';
}

function renderMentorPool(){
  const wrap = document.getElementById('mentorPool');
  const mentors = mentorState.mentors;
  wrap.replaceChildren();
  if(!mentors.length){ wrap.innerHTML = '<div class="empty-note">No mentors have registered yet.</div>'; }
  mentors.forEach(m => {
    const match = mentorState.matches.find(x => x.mentorEmail.toLowerCase() === m.email.toLowerCase());
    const card = document.createElement('div');
    card.className = 'mentor-card' + (match ? ' matched' : '');
    const paidBadge = m.paid ? `<span class="p-badge paid">Paid · ${escapeHtml(m.rate)}</span>` : '<span class="p-badge free">Free</span>';
    const ratingLine = m.ratingCount
      ? `<div class="p-rating">&#9733; ${m.ratingAvg} · ${m.ratingCount} review${m.ratingCount === 1 ? '' : 's'}</div>`
      : '<div class="p-rating" style="color:var(--text-dim)">Not yet rated</div>';
    card.innerHTML = `
      <div class="p-head"><div><div class="p-name">${escapeHtml(m.name)} ${paidBadge}</div><div class="p-role">${escapeHtml(m.role)} · ${escapeHtml(m.company)}</div>${ratingLine}</div></div>
      <div class="p-tags">${m.expertise.map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="p-note">${escapeHtml(m.note)}</div>
      ${contactPrefNote(m)}
      ${match ? mentorContactActions(m) : ''}
      <div class="p-foot"><span class="p-capacity">${m.years} yrs · ${m.slots} slot${m.slots === 1 ? '' : 's'}</span>${
        match ? `<span class="p-status">${match.type === 'adopted' ? '&#10003; This mentor adopted you' : '&#10148; Requested — awaiting reply'}</span>`
        : `<button class="btn btn-primary btn-sm" ${mentorState.seekerProfile ? '' : 'disabled title="Register as a seeker first"'} onclick="requestMentor('${escapeHtml(m.email)}')">Request mentorship</button>`
      }</div>
      ${match ? ratingWidgetHtml(m.email, match.rating, match.review) : ''}`;
    wrap.appendChild(card);
  });
  document.getElementById('mentorPoolCount').textContent = mentors.length + ' open';
}

function renderAdoptedList(){
  const list = document.getElementById('adoptedList');
  const mine = mentorState.matches.filter(m => m.type === 'adopted');
  if(!mine.length){ list.innerHTML = '<div class="empty-note">Register above, then adopt someone from the list — they\'ll show up here.</div>'; return; }
  list.replaceChildren();
  mine.forEach(m => {
    const seeker = mentorState.seekers.find(s => s.email.toLowerCase() === m.seekerEmail.toLowerCase());
    const row = document.createElement('div');
    row.className = 'mini-chip';
    row.innerHTML = `<div class="mini-chip-main"><span><span class="who">${escapeHtml(seeker ? seeker.name : m.seekerEmail)}</span>${seeker ? ' <span class="meta">— ' + escapeHtml(seeker.status) + '</span>' : ''}</span><span class="meta" style="color:var(--teal-dark)">&#10003;</span></div>${seeker ? mentorContactActions(seeker) : ''}`;
    list.appendChild(row);
  });
  document.getElementById('adoptedCount').textContent = mine.length + ' adopted';
}
function renderRequestedList(){
  const list = document.getElementById('requestedList');
  const mine = mentorState.matches.filter(m => m.type === 'requested');
  if(!mine.length){ list.innerHTML = '<div class="empty-note">Register above, then request a mentor from the list — they\'ll show up here.</div>'; return; }
  list.replaceChildren();
  mine.forEach(m => {
    const mentor = mentorState.mentors.find(x => x.email.toLowerCase() === m.mentorEmail.toLowerCase());
    const row = document.createElement('div');
    row.className = 'mini-chip';
    row.innerHTML = `<div class="mini-chip-main"><span><span class="who">${escapeHtml(mentor ? mentor.name : m.mentorEmail)}</span>${mentor ? ' <span class="meta">— ' + escapeHtml(mentor.role) + '</span>' : ''}</span><span class="meta" style="color:var(--brass)">pending</span></div>${mentor ? mentorContactActions(mentor) : ''}`;
    list.appendChild(row);
  });
  document.getElementById('requestedCount').textContent = mine.length + ' sent';
}

async function searchMentorsWithAI(){
  const input = document.getElementById('mentor-search-input');
  const query = input.value.trim();
  const resultEl = document.getElementById('mentorSearchResult');
  if(!query){ resultEl.innerHTML = '<div class="empty-note">Describe what kind of help you need first.</div>'; return; }
  resultEl.innerHTML = '<div class="empty-note">Searching…</div>';
  try{
    const result = await contactApi('searchMentors', {query});
    renderMentorSearchResult(result.matches || [], result.method);
  }catch(error){ resultEl.innerHTML = '<div class="empty-note">Could not search: ' + escapeHtml(error.message) + '</div>'; }
}
function renderMentorSearchResult(matches, method){
  const resultEl = document.getElementById('mentorSearchResult');
  if(!matches.length){ resultEl.innerHTML = '<div class="empty-note">No mentor in the pool matches that yet.</div>'; return; }
  resultEl.replaceChildren();
  const label = document.createElement('div');
  label.className = 'empty-note';
  label.textContent = method === 'keyword' ? 'Keyword matches (ask an admin to enable AI ranking for better results):' : 'AI-suggested matches:';
  resultEl.appendChild(label);
  matches.forEach(match => {
    const mentor = mentorState.mentors.find(m => m.email.toLowerCase() === match.email.toLowerCase());
    if(!mentor) return;
    const row = document.createElement('div');
    row.className = 'mini-chip';
    row.innerHTML = `<div class="mini-chip-main"><span><span class="who">${escapeHtml(mentor.name)}</span> <span class="meta">— ${escapeHtml(mentor.role)}</span></span></div><div class="p-pref" style="margin-top:0">${escapeHtml(match.reason)}</div>`;
    resultEl.appendChild(row);
  });
}
