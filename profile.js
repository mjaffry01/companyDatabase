let profileGeneration = 0;
function setProfileName(name){
  document.getElementById('profileButtonName').textContent = name || '';
  document.getElementById('profileTitle').textContent = name || 'Profile';
  document.getElementById('profileButton').setAttribute('aria-label', name ? 'Open profile for ' + name : 'Open profile');
}
async function loadProfileName(){
  const generation = profileGeneration;
  const token = window.idToken;
  try{
    const result = await contactApi('profile', {});
    if(generation === profileGeneration && token === window.idToken){
      setProfileName(result.profile?.name);
      if(result.profile) applyOpportunityProfile(result.profile);
    }
  }catch(error){ /* Keep the profile icon available so the user can retry. */ }
}
function clearUserProfile(){
  profileGeneration++;
  setProfileName('');
  document.getElementById('profileDialog').close();
  document.getElementById('profileDetails').hidden = true;
  document.getElementById('profileStatusForm').hidden = true;
  ['profileName','profileCompany','profileEmail','profilePhone','profileWorkStatus','profileMessage'].forEach(id => document.getElementById(id).textContent = '');
  document.getElementById('profileStatusForm').reset();
}
function renderUserProfile(profile){
  setProfileName(profile.name);
  document.getElementById('profileName').textContent = profile.name || 'Not provided';
  document.getElementById('profileCompany').textContent = profile.homeCompanies?.join(', ') || 'Not provided';
  document.getElementById('profileEmail').textContent = profile.email || 'Not provided';
  document.getElementById('profilePhone').textContent = profile.phone || 'Not provided';
  document.getElementById('profileWorkStatus').textContent = profile.workStatus || 'Not provided';
  document.getElementById('profileStatusSelect').value = profile.workStatus || '';
  document.getElementById('profileDetails').hidden = false;
  document.getElementById('profileStatusForm').hidden = false;
}
async function openUserProfile(){
  if(!window.idToken) return;
  const generation = ++profileGeneration;
  const dialog = document.getElementById('profileDialog');
  if(!dialog.open) dialog.showModal();
  document.getElementById('profileDetails').hidden = true;
  document.getElementById('profileStatusForm').hidden = true;
  document.getElementById('profileMessage').textContent = 'Loading your profile...';
  try{
    const result = await contactApi('profile', {});
    if(generation !== profileGeneration) return;
    if(!result.profile) throw new Error('Profile is not available.');
    renderUserProfile(result.profile);
    document.getElementById('profileMessage').textContent = '';
  }catch(error){ if(generation === profileGeneration) document.getElementById('profileMessage').textContent = 'Could not load your profile: ' + error.message; }
}
document.getElementById('profileStatusForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('profileSaveButton');
  if(button.disabled) return;
  const generation = profileGeneration;
  button.disabled = true;
  document.getElementById('profileMessage').textContent = 'Saving work status...';
  try{
    const result = await contactApi('saveWorkStatus', {workStatus:document.getElementById('profileStatusSelect').value});
    if(generation !== profileGeneration) return;
    if(!result.ok || !result.profile) throw new Error('Save was not confirmed.');
    renderUserProfile(result.profile);
    document.getElementById('profileMessage').textContent = 'Work status saved.';
  }catch(error){ if(generation === profileGeneration) document.getElementById('profileMessage').textContent = 'Could not save: ' + error.message; }
  finally{ button.disabled = false; }
});
