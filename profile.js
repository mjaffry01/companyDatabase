let profileGeneration = 0;
function setProfileName(name){
  document.getElementById('profileButtonName').textContent = name || '';
  document.getElementById('profileTitle').textContent = name || 'Profile';
  document.getElementById('profileButton').setAttribute('aria-label', name ? 'Open profile for ' + name : 'Open profile');
}
async function loadProfileName(){
  const generation = profileGeneration;
  const token = window.currentCredential();
  try{
    const result = await contactApi('profile', {});
    if(generation === profileGeneration && token === window.currentCredential()){
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
const AI_PROVIDER_INFO = {
  gemini: {
    label: 'Google Gemini',
    url: 'https://aistudio.google.com/apikey',
    urlLabel: 'Open Google AI Studio',
    steps: [
      'Open Google AI Studio and sign in with any Google account (it does not have to be the one you use here).',
      'Click "Create API key", and pick or create a Google Cloud project if it asks.',
      'Copy the key it shows you - you can view it again later in AI Studio if you lose it.',
      'Come back to this tab, paste it below, and save.'
    ],
    models: [
      {value:'gemini-2.5-flash', label:'Gemini 2.5 Flash — recommended, fast & cheap'},
      {value:'gemini-2.5-flash-lite', label:'Gemini 2.5 Flash-Lite — fastest, lowest cost'},
      {value:'gemini-2.5-pro', label:'Gemini 2.5 Pro — most capable, slower'},
      {value:'gemini-2.0-flash', label:'Gemini 2.0 Flash — older generation'}
    ]
  },
  openai: {
    label: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    urlLabel: 'Open OpenAI API keys',
    steps: [
      'Open the OpenAI API keys page and sign in, or create an account.',
      'Click "Create new secret key".',
      'Copy it immediately - OpenAI only shows the full key once.',
      'Come back to this tab, paste it below, and save.'
    ],
    models: [
      {value:'gpt-4o-mini', label:'GPT-4o mini — recommended, fast & cheap'},
      {value:'gpt-4o', label:'GPT-4o — most capable'},
      {value:'gpt-4.1-mini', label:'GPT-4.1 mini'},
      {value:'gpt-4.1', label:'GPT-4.1'}
    ]
  }
};
const AI_CUSTOM_MODEL_VALUE = '__custom__';
function populateModelSelect(provider, selectedModel){
  const info = AI_PROVIDER_INFO[provider];
  const select = document.getElementById('aiKeyModel');
  const customWrap = document.getElementById('aiKeyModelCustomWrap');
  const customInput = document.getElementById('aiKeyModelCustom');
  select.innerHTML = info.models.map(m => '<option value="' + escapeHtml(m.value) + '">' + escapeHtml(m.label) + '</option>').join('')
    + '<option value="' + AI_CUSTOM_MODEL_VALUE + '">Custom model ID…</option>';
  const known = info.models.some(m => m.value === selectedModel);
  if(selectedModel && known){
    select.value = selectedModel;
    customWrap.hidden = true;
    customInput.value = '';
  }else if(selectedModel){
    select.value = AI_CUSTOM_MODEL_VALUE;
    customWrap.hidden = false;
    customInput.value = selectedModel;
  }else{
    select.value = info.models[0].value;
    customWrap.hidden = true;
    customInput.value = '';
  }
}
document.getElementById('aiKeyModel').addEventListener('change', event => {
  const isCustom = event.target.value === AI_CUSTOM_MODEL_VALUE;
  document.getElementById('aiKeyModelCustomWrap').hidden = !isCustom;
  if(isCustom) document.getElementById('aiKeyModelCustom').focus();
});
function setWizardProvider(provider, selectedModel){
  if(!AI_PROVIDER_INFO[provider]) provider = 'gemini';
  document.getElementById('aiKeyProvider').value = provider;
  document.getElementById('wizardProviderGemini').classList.toggle('active', provider === 'gemini');
  document.getElementById('wizardProviderOpenai').classList.toggle('active', provider === 'openai');
  const info = AI_PROVIDER_INFO[provider];
  document.getElementById('wizardInstructions').innerHTML =
    '<ol>' + info.steps.map(step => '<li>' + escapeHtml(step) + '</li>').join('') + '</ol>';
  const openBtn = document.getElementById('wizardOpenProviderBtn');
  openBtn.href = info.url;
  openBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i> ' + escapeHtml(info.urlLabel);
  populateModelSelect(provider, selectedModel);
}
function updateAiKeySummary(config){
  const el = document.getElementById('aiKeySummaryStatus');
  if(!el) return;
  if(config === undefined) config = getUserAiConfig();
  el.textContent = config
    ? 'Using your own ' + (config.provider === 'openai' ? 'OpenAI' : 'Gemini') + ' key (' + config.model + '), saved on this device only.'
    : 'Using the shared key for AI features. Add your own for your personal quota.';
}
function loadAiKeyForm(){
  const config = getUserAiConfig();
  setWizardProvider(config?.provider || 'gemini', config?.model);
  document.getElementById('aiKeyValue').value = '';
  document.getElementById('aiKeyValue').placeholder = config ? 'Key saved on this device - enter a new one to replace it' : 'Paste your API key';
  document.getElementById('aiKeyStatus').textContent = config
    ? 'Using your own ' + (config.provider === 'openai' ? 'OpenAI' : 'Gemini') + ' key, saved on this device only.'
    : 'Using the shared key for AI features.';
  updateAiKeySummary(config);
}
document.getElementById('aiKeyForm').addEventListener('submit', event => {
  event.preventDefault();
  const provider = document.getElementById('aiKeyProvider').value;
  const modelSelectValue = document.getElementById('aiKeyModel').value;
  const model = modelSelectValue === AI_CUSTOM_MODEL_VALUE
    ? document.getElementById('aiKeyModelCustom').value.trim()
    : modelSelectValue;
  const apiKey = document.getElementById('aiKeyValue').value.trim();
  if(!model || !apiKey){ document.getElementById('aiKeyStatus').textContent = 'Enter both a model and an API key.'; return; }
  setUserAiConfig({provider, model, apiKey});
  loadAiKeyForm();
  showToast('AI key saved on this device.');
  setTimeout(() => document.getElementById('aiKeyWizard').close(), 500);
});
document.getElementById('aiKeyClearButton').addEventListener('click', () => {
  clearUserAiConfig();
  loadAiKeyForm();
});
function openAiKeyWizard(opts){
  opts = opts || {};
  loadAiKeyForm();
  document.getElementById('aiKeyDontAskRow').hidden = !opts.auto;
  document.getElementById('aiKeyDontAskAgain').checked = false;
  const dialog = document.getElementById('aiKeyWizard');
  if(!dialog.open) dialog.showModal();
}
document.getElementById('aiKeyWizard').addEventListener('close', () => {
  if(document.getElementById('aiKeyDontAskAgain')?.checked){
    try{ localStorage.setItem('aiKeySetupDismissed', '1'); }catch(error){ /* storage unavailable */ }
  }
  updateAiKeySummary();
});
function maybeOfferAiKeySetup(){
  if(getUserAiConfig()) return;
  try{
    if(localStorage.getItem('aiKeySetupDismissed')) return;
    if(sessionStorage.getItem('aiKeyPromptShown')) return;
    sessionStorage.setItem('aiKeyPromptShown', '1');
  }catch(error){ /* storage unavailable - still offer it once this load */ }
  setTimeout(() => openAiKeyWizard({auto:true}), 700);
}
async function openUserProfile(){
  if(!window.currentCredential()) return;
  const generation = ++profileGeneration;
  const dialog = document.getElementById('profileDialog');
  if(!dialog.open) dialog.showModal();
  document.getElementById('profileDetails').hidden = true;
  document.getElementById('profileStatusForm').hidden = true;
  document.getElementById('profileMessage').textContent = 'Loading your profile...';
  loadAiKeyForm();
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
