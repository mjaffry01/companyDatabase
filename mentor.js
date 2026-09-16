let mentorSession = 0;
let mentorState = { mentorProfile:null, seekerProfile:null, mentors:[], seekers:[], matches:[], myAppointments:[] };
let pendingRatings = {};

function toggleChip(chip){ chip.classList.toggle('on'); }
document.querySelectorAll('#m-expertise .chip-opt, #s-field .chip-opt').forEach(chip => chip.addEventListener('click', () => toggleChip(chip)));

// Field-level validation: pinpoints which field is wrong instead of one
// generic banner message, and clears itself the moment the field becomes
// valid again rather than waiting for the next submit attempt.
function setFieldError(el, message){
  const field = el.closest('.field');
  if(!field) return;
  field.classList.toggle('invalid', !!message);
  let err = field.querySelector('.field-error');
  if(message){
    if(!err){ err = document.createElement('div'); err.className = 'field-error'; field.appendChild(err); }
    err.textContent = message;
  }else if(err){ err.remove(); }
}
function isValidPhone(value){
  const digits = String(value || '').replace(/[^\d]/g, '');
  return digits.length === 0 || (digits.length >= 7 && digits.length <= 15);
}
function wireLiveValidation(id, validate){
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener('blur', () => setFieldError(el, validate(el.value)));
  el.addEventListener('input', () => { if(el.closest('.field')?.classList.contains('invalid')) setFieldError(el, validate(el.value)); });
}
const requiredText = v => v.trim() ? '' : 'This field is required.';
const yearsRange = v => { if(!v.trim()) return ''; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 60 ? '' : 'Enter a number between 0 and 60.'; };
const slotsRange = v => { if(!v.trim()) return ''; const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 20 ? '' : 'Enter a whole number between 1 and 20.'; };
const phoneFormat = v => isValidPhone(v) ? '' : 'Enter a valid phone number (7-15 digits).';
wireLiveValidation('m-name', requiredText);
wireLiveValidation('m-role', requiredText);
wireLiveValidation('m-company', requiredText);
wireLiveValidation('m-phone', phoneFormat);
wireLiveValidation('m-years', yearsRange);
wireLiveValidation('m-slots', slotsRange);
wireLiveValidation('s-name', requiredText);
wireLiveValidation('s-phone', phoneFormat);

function getSelectedChips(containerId){
  return Array.from(document.querySelectorAll('#' + containerId + ' .chip-opt.on')).map(chip => chip.textContent);
}
function setSelectedChips(containerId, values){
  const wanted = new Set((values || []).map(v => String(v).toLowerCase()));
  document.querySelectorAll('#' + containerId + ' .chip-opt').forEach(chip => chip.classList.toggle('on', wanted.has(chip.textContent.toLowerCase())));
}

function resetMentorSession(){
  mentorSession++;
  mentorState = { mentorProfile:null, seekerProfile:null, mentors:[], seekers:[], matches:[], myAppointments:[] };
  pendingRatings = {};
  ['m-name','m-role','m-company','m-phone','m-years','m-slots','m-note','m-rate','s-name','s-phone','s-note'].forEach(id => { const el = document.getElementById(id); if(el){ el.value = ''; setFieldError(el, ''); } });
  ['m-contact-pref','s-status','s-contact-pref'].forEach(id => { const el = document.getElementById(id); if(el){ el.value = ''; setFieldError(el, ''); } });
  document.getElementById('m-expertise').classList.remove('invalid');
  document.getElementById('s-field').classList.remove('invalid');
  document.getElementById('m-undertaking-row').classList.remove('invalid');
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
  document.getElementById('m-new-time').value = '';
  document.getElementById('myTimesList').innerHTML = '';
  document.getElementById('mentor-search-input').value = '';
  document.getElementById('mentorSearchResult').replaceChildren();
  document.getElementById('myAppointmentsMentor').innerHTML = '';
  document.getElementById('myAppointmentsSeeker').innerHTML = '';
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
    btn.innerHTML = '<i class="fa-solid fa-user-pen" aria-hidden="true"></i> Update profile';
  }else{
    note.textContent = 'Not registered yet';
    note.classList.remove('ok');
    btn.innerHTML = '<i class="fa-solid fa-compass" aria-hidden="true"></i> Register';
  }
  renderMyTimes();
}

function formatSlotTime(iso){
  const d = new Date(iso);
  return d.toLocaleString(undefined, { weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function renderMyTimes(){
  const wrap = document.getElementById('myTimesList');
  const myTimes = mentorState.mentorProfile?.myTimes || [];
  if(!myTimes.length){ wrap.innerHTML = '<div class="empty-note">No times listed yet — add one below.</div>'; return; }
  wrap.replaceChildren();
  myTimes.forEach(slot => {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `<span class="when"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(formatSlotTime(slot.startsAt))}</span><span class="time-row-right">${
      slot.bookedByEmail
        ? `<span class="booked-by"><i class="fa-solid fa-user-check" aria-hidden="true"></i> Booked by ${escapeHtml(slot.bookedByName || slot.bookedByEmail)}</span><button class="remove" type="button" onclick="cancelAppointment(this, '${escapeHtml(slot.slotId)}')" title="Cancel this appointment" aria-label="Cancel this appointment"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i></button>`
        : `<button class="remove" type="button" onclick="removeMentorTime('${escapeHtml(slot.slotId)}')" title="Remove this time" aria-label="Remove this time"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>`
    }</span>`;
    wrap.appendChild(row);
  });
}

async function addMentorTime(){
  const input = document.getElementById('m-new-time');
  const noteEl = document.getElementById('mentorFormNote');
  if(!input.value){ noteEl.textContent = 'Pick a date and time first.'; noteEl.classList.remove('ok'); return; }
  const startsAt = new Date(input.value).toISOString();
  try{
    const result = await contactApi('addMentorSlot', { startsAt });
    if(mentorState.mentorProfile) mentorState.mentorProfile.myTimes = result.myTimes;
    input.value = '';
    renderMyTimes();
    showToast('Time added');
  }catch(error){ showToast('Could not add time: ' + error.message); }
}
async function removeMentorTime(slotId){
  try{
    const result = await contactApi('removeMentorSlot', { slotId });
    if(mentorState.mentorProfile) mentorState.mentorProfile.myTimes = result.myTimes;
    renderMyTimes();
  }catch(error){ showToast('Could not remove time: ' + error.message); }
}

async function bookMentorTime(button, slotId){
  button.disabled = true;
  try{
    await contactApi('bookMentorSlot', { slotId });
    showToast('Appointment confirmed — check your email');
    await loadMentorData();
  }catch(error){ showToast('Could not book that time: ' + error.message); button.disabled = false; }
}
async function cancelAppointment(button, slotId){
  button.disabled = true;
  try{
    await contactApi('cancelMentorSlot', { slotId });
    showToast('Appointment cancelled');
    await loadMentorData();
  }catch(error){ showToast('Could not cancel: ' + error.message); button.disabled = false; }
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
    btn.innerHTML = '<i class="fa-solid fa-user-pen" aria-hidden="true"></i> Update profile';
  }else{
    note.textContent = 'Not registered yet';
    note.classList.remove('ok');
    btn.innerHTML = '<i class="fa-solid fa-hand" aria-hidden="true"></i> Register';
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
    mentorState.myAppointments = result.myAppointments || [];
    applyMentorProfile();
    applySeekerProfile();
    renderSeekerPool();
    renderMentorPool();
    renderAdoptedList();
    renderRequestedList();
    renderMyAppointments();
  }catch(error){
    showToast('Could not load mentor network: ' + error.message);
  }
}

function renderMyAppointments(){
  const list = mentorState.myAppointments || [];
  const html = !list.length ? '' : `<div class="appt-panel">
    <div class="appt-panel-head"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i> Your upcoming appointments</div>
    ${list.map(a => `<div class="mini-chip"><div class="mini-chip-main"><span>${a.iAmMentor ? '<i class="fa-solid fa-user-graduate" aria-hidden="true"></i>' : '<i class="fa-solid fa-compass" aria-hidden="true"></i>'} <span class="who">${escapeHtml(a.withName)}</span> <span class="meta">— ${a.iAmMentor ? 'your mentee' : 'your mentor'}</span></span><span class="meta"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(formatSlotTime(a.startsAt))}</span></div></div>`).join('')}
  </div>`;
  ['myAppointmentsMentor', 'myAppointmentsSeeker'].forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = html; });
}

async function registerMentor(){
  const nameEl = document.getElementById('m-name'), roleEl = document.getElementById('m-role'), companyEl = document.getElementById('m-company');
  const phoneEl = document.getElementById('m-phone'), yearsEl = document.getElementById('m-years'), slotsEl = document.getElementById('m-slots'), rateEl = document.getElementById('m-rate');
  const name = nameEl.value.trim(), role = roleEl.value.trim(), company = companyEl.value.trim(), phone = phoneEl.value.trim();
  const contactPref = document.getElementById('m-contact-pref').value;
  const expertise = getSelectedChips('m-expertise');
  const years = Number(yearsEl.value);
  const slots = Number(slotsEl.value);
  const note = document.getElementById('m-note').value.trim();
  const paid = document.getElementById('m-paid').checked; // stays optional throughout — only its rate is ever required, and only when this is checked
  const rate = rateEl.value.trim();
  const undertakingAccepted = document.getElementById('m-undertaking').checked;
  const noteEl = document.getElementById('mentorFormNote');
  const chipGroup = document.getElementById('m-expertise');
  const undertakingRow = document.getElementById('m-undertaking-row');

  let firstInvalid = null;
  const flag = (el, message) => { setFieldError(el, message); if(message && !firstInvalid) firstInvalid = el; };
  flag(nameEl, requiredText(name));
  flag(roleEl, requiredText(role));
  flag(companyEl, requiredText(company));
  flag(phoneEl, phoneFormat(phone));
  flag(yearsEl, requiredText(yearsEl.value) || yearsRange(yearsEl.value));
  flag(slotsEl, requiredText(slotsEl.value) || slotsRange(slotsEl.value));
  flag(rateEl, paid && !rate ? 'Enter your rate, or uncheck paid mentorship above.' : (paid && rate && !/\d/.test(rate) ? 'Include a number in your rate (e.g. ₹500 per session).' : ''));

  const expertiseOk = expertise.length > 0;
  chipGroup.classList.toggle('invalid', !expertiseOk);
  if(!expertiseOk && !firstInvalid) firstInvalid = chipGroup;

  undertakingRow.classList.toggle('invalid', !undertakingAccepted);
  if(!undertakingAccepted && !firstInvalid) firstInvalid = document.getElementById('m-undertaking');

  if(firstInvalid){
    noteEl.textContent = !expertiseOk ? 'Pick at least one area you can guide in.' : !undertakingAccepted ? 'Please accept the mentor undertaking to register.' : 'Fix the highlighted field.';
    noteEl.classList.remove('ok');
    firstInvalid.focus();
    return;
  }

  const btn = document.getElementById('mentorSaveBtn');
  btn.disabled = true; noteEl.textContent = 'Saving…'; noteEl.classList.remove('ok');
  try{
    const result = await contactApi('registerMentor', {name, role, company, phone, contactPref, expertise, years, slots, note, paid, rate, undertakingAccepted});
    mentorState.mentorProfile = Object.assign({}, result.profile, { myTimes: mentorState.mentorProfile?.myTimes || [] });
    applyMentorProfile();
    renderSeekerPool();
    showToast('Mentor profile saved');
  }catch(error){ noteEl.textContent = 'Could not save: ' + error.message; }
  finally{ btn.disabled = false; }
}

async function registerSeeker(){
  const nameEl = document.getElementById('s-name'), phoneEl = document.getElementById('s-phone'), statusEl = document.getElementById('s-status'), noteInputEl = document.getElementById('s-note');
  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();
  const contactPref = document.getElementById('s-contact-pref').value;
  const status = statusEl.value;
  const field = getSelectedChips('s-field');
  const note = noteInputEl.value.trim();
  const noteEl = document.getElementById('seekerFormNote');
  const chipGroup = document.getElementById('s-field');

  let firstInvalid = null;
  const flag = (el, message) => { setFieldError(el, message); if(message && !firstInvalid) firstInvalid = el; };
  flag(nameEl, requiredText(name));
  flag(phoneEl, phoneFormat(phone));
  flag(statusEl, status ? '' : 'Choose your situation.');
  flag(noteInputEl, requiredText(note));

  const fieldOk = field.length > 0;
  chipGroup.classList.toggle('invalid', !fieldOk);
  if(!fieldOk && !firstInvalid) firstInvalid = chipGroup;

  if(firstInvalid){
    noteEl.textContent = !fieldOk ? 'Pick at least one field you want guidance in.' : 'Fix the highlighted field.';
    noteEl.classList.remove('ok');
    firstInvalid.focus();
    return;
  }

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
const CONTACT_PREF_ICONS = { Email: 'fa-solid fa-envelope', Call: 'fa-solid fa-phone', WhatsApp: 'fa-brands fa-whatsapp' };
function contactPrefNote(person){
  if(!person.contactPref) return '';
  const icon = CONTACT_PREF_ICONS[person.contactPref] || 'fa-solid fa-comment';
  return `<div class="p-pref"><i class="${icon}" aria-hidden="true"></i> Prefers ${escapeHtml(person.contactPref)}</div>`;
}
function ratingWidgetHtml(mentorEmail, existingRating, existingReview){
  const selected = pendingRatings[mentorEmail] || existingRating || 0;
  let stars = '';
  for(let i = 1; i <= 5; i++) stars += `<span class="star${selected >= i ? ' on' : ''}" onclick="selectRatingStar('${escapeHtml(mentorEmail)}', ${i})">&#9733;</span>`;
  return `<div class="rate-widget">
    <div class="star-picker">${stars}</div>
    <input type="text" class="rate-review-input" maxlength="500" placeholder="Optional note about the mentorship" value="${escapeHtml(existingReview || '')}">
    <button type="button" class="btn btn-ghost btn-sm" onclick="submitRating(this, '${escapeHtml(mentorEmail)}')"><i class="fa-regular fa-star" aria-hidden="true"></i> ${existingRating ? 'Update rating' : 'Submit rating'}</button>
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
        match ? `<span class="p-status">${match.type === 'adopted' ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> Adopted' : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Requested you'}</span>`
        : `<button class="btn btn-primary btn-sm" ${mentorState.mentorProfile ? '' : 'disabled title="Register as a mentor first"'} onclick="adoptSeeker('${escapeHtml(s.email)}')"><i class="fa-solid fa-handshake" aria-hidden="true"></i> Adopt as mentee</button>`
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
    const paidBadge = m.paid ? `<span class="p-badge paid"><i class="fa-solid fa-indian-rupee-sign" aria-hidden="true"></i> ${escapeHtml(m.rate)}</span>` : '<span class="p-badge free"><i class="fa-solid fa-gift" aria-hidden="true"></i> Free</span>';
    const ratingLine = m.ratingCount
      ? `<div class="p-rating"><i class="fa-solid fa-star" aria-hidden="true"></i> ${m.ratingAvg} · ${m.ratingCount} review${m.ratingCount === 1 ? '' : 's'}</div>`
      : '<div class="p-rating" style="color:var(--text-dim)"><i class="fa-regular fa-star" aria-hidden="true"></i> Not yet rated</div>';
    card.innerHTML = `
      <div class="p-head"><div><div class="p-name">${escapeHtml(m.name)} ${paidBadge}</div><div class="p-role">${escapeHtml(m.role)} · ${escapeHtml(m.company)}</div>${ratingLine}</div></div>
      <div class="p-tags">${m.expertise.map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="p-note">${escapeHtml(m.note)}</div>
      ${contactPrefNote(m)}
      ${match ? mentorContactActions(m) : ''}
      <div class="p-foot"><span class="p-capacity">${m.years} yrs · ${m.slots} slot${m.slots === 1 ? '' : 's'}</span>${
        match ? `<span class="p-status">${match.type === 'adopted' ? '<i class="fa-solid fa-circle-check" aria-hidden="true"></i> This mentor adopted you' : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Requested — awaiting reply'}</span>`
        : `<button class="btn btn-primary btn-sm" ${mentorState.seekerProfile ? '' : 'disabled title="Register as a seeker first"'} onclick="requestMentor('${escapeHtml(m.email)}')"><i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Request mentorship</button>`
      }</div>
      ${match ? timePicksHtml(m) : ''}
      ${match ? ratingWidgetHtml(m.email, match.rating, match.review) : ''}`;
    wrap.appendChild(card);
  });
  document.getElementById('mentorPoolCount').textContent = mentors.length + ' open';
}

function timePicksHtml(mentor){
  const times = mentor.openTimes || [];
  const confirmed = times.find(s => s.bookedByMe);
  if(confirmed) return `<div class="time-confirmed"><span><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Appointment: ${escapeHtml(formatSlotTime(confirmed.startsAt))}</span><button class="btn btn-ghost btn-sm" type="button" onclick="cancelAppointment(this, '${escapeHtml(confirmed.slotId)}')"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i> Cancel</button></div>`;
  if(!times.length) return '';
  return `<div class="time-picks">
    <div class="label"><i class="fa-regular fa-calendar" aria-hidden="true"></i> Pick a time to book:</div>
    <div class="time-pick-list">${times.map(s => `<button type="button" class="time-pick" onclick="bookMentorTime(this, '${escapeHtml(s.slotId)}')"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(formatSlotTime(s.startsAt))}</button>`).join('')}</div>
  </div>`;
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
    row.innerHTML = `<div class="mini-chip-main"><span><span class="who">${escapeHtml(seeker ? seeker.name : m.seekerEmail)}</span>${seeker ? ' <span class="meta">— ' + escapeHtml(seeker.status) + '</span>' : ''}</span><span class="meta" style="color:var(--teal-dark)"><i class="fa-solid fa-circle-check" aria-hidden="true"></i></span></div>${seeker ? mentorContactActions(seeker) : ''}`;
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
    row.innerHTML = `<div class="mini-chip-main"><span><span class="who">${escapeHtml(mentor ? mentor.name : m.mentorEmail)}</span>${mentor ? ' <span class="meta">— ' + escapeHtml(mentor.role) + '</span>' : ''}</span><span class="meta" style="color:var(--brass)"><i class="fa-regular fa-hourglass-half" aria-hidden="true"></i> pending</span></div>${mentor ? mentorContactActions(mentor) : ''}`;
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
  label.innerHTML = method === 'keyword'
    ? '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> Keyword matches (ask an admin to enable AI ranking for better results):'
    : '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> AI-suggested matches:';
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
