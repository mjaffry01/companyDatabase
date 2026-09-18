# Bring your own AI key

Every AI feature in this app (opportunity posting analysis, resume upload
analysis, mentor AI search, AI job search, resume-fit comparison, and
tailored resume generation) normally uses one shared Gemini/OpenAI key that
the app owner configures once in Apps Script Script Properties
(`analysisConfiguration()`). That's still the default for everyone.

A member can optionally save their own key instead, from the **Your own AI
key** section of the Profile dialog (name, model, and API key). It's saved
with `setUserAiConfig` to `localStorage.userAiConfig` in their own browser -
**never sent to or stored by the backend, never written to any Sheet** - and
cleared with one click ("Use the shared key instead").

## How it reaches the backend

`contactApi()` in `index.html` attaches the saved key to the request body as
`userAI: {provider, model, apiKey}`, but only for the six actions that
actually call an LLM (`AI_ACTIONS` in `index.html`): `saveOpportunity`,
`uploadResume`, `searchMentors`, `searchJobs`, `compareResumeFit`,
`generateTailoredResume`. Every other action never carries it.

On the backend, each of those six entry points calls `resolveAiConfig_(data)`
(in `apps-script/ResumeAnalysis.gs`) instead of `analysisConfiguration()`
directly. It validates `data.userAI` (provider is `gemini` or `openai`, both
`apiKey` and `model` non-empty, `model` matches the same safe-characters check
the shared config already applies) and returns a single-provider config built
from it; anything missing or malformed falls straight back to the shared
config, so a bad or absent key never breaks the feature - it just quietly
uses the shared key instead, same as before this existed.

The key is used only for that one request. It is not logged, not persisted,
and not attached to owner-run recovery jobs (`retryResumeAnalysis`,
`retryOpportunityAnalysis` always use the shared key, since those run without
a specific member's request in hand).

## Why this exists

The shared key has one quota for every member combined - see the "Recovery
from a failed AI analysis" section of `OPPORTUNITY-BACKEND.md` for what
happens when that quota is exhausted (a Gemini 429, for example). A member
who brings their own key isn't competing for that shared quota at all; a
member who doesn't is unaffected and keeps using the shared key exactly as
before.

## Activate on the live site

No activation step needed beyond the normal `Code.gs` / `ResumeAnalysis.gs`
redeploy and publishing `index.html` and `profile.js` - there's no new sheet,
Script Property, or OAuth scope involved.
