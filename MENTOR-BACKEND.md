# Mentor Match

Two tabs let approved members guide each other outside the referral flow:
**Become a Mentor** for people currently working who can spare time to guide
someone starting out, and **Find a Mentor** for job seekers who want one.
Either side can act first — a mentor can adopt a seeker straight off the pool,
or a seeker can request a specific mentor — both land as a row in
**MentorMatches** so both tabs immediately show who's already spoken for.

A person registers once per tab (registering updates their existing row
rather than creating a duplicate). A mentor profile is name, current role and
company, phone and preferred contact method (both optional), up to 10 areas
they can guide in, years of experience, how many mentees they can take at
once, whether they charge for mentorship (and if so, their stated rate — the
backend only displays what the mentor declares, it never processes a
payment), a short note shown to browsers, and acceptance of the mentor
undertaking (see below). A seeker profile is name, phone and preferred
contact method (both optional), situation (Recent graduate / Recently lost my
job / Switching fields), up to 10 fields they want guidance in, and a required
note describing what help they need.

**The mentor undertaking.** `upsertMentorProfile` refuses to save unless
`undertakingAccepted` is true on the request — the frontend won't submit the
form without the checkbox ticked, and the backend checks it again. This isn't
stored as a legal document, just a timestamp (`Undertaking accepted at`,
refreshed every time the mentor saves their profile) confirming they agreed to
represent themselves honestly, including disclosing any fee upfront and not
guaranteeing outcomes.

Browsing a pool shows everyone registered on the other side except yourself,
including their phone/contact-preference (if given) and, on a mentor card, a
paid/free badge and average rating. Once connected, both the pool card and the
compact ledger rows (Your requests / Mentees you've adopted) reveal call,
WhatsApp and email links via the same `.contact-actions` pattern as
ReferrerContact — nothing before that point, so browsing doesn't broadcast
phone numbers to everyone. Adopting or requesting is blocked with an explicit
error until you've registered on your own side first (the buttons are
disabled client-side, and the backend enforces it again). `adoptMentee` also
enforces that a seeker can only be adopted once (first mentor wins) and that a
mentor cannot exceed the mentee capacity they declared; `requestMentor` blocks
sending the same mentor a second request. Neither action lets you target
yourself.

On a successful adopt or request, `sendMentorMatchEmail_` emails the other
person with a name, role/situation, note, and how to reach them (email, plus
phone and stated preference when given). Like every other notification email
in this app, a failure here is logged and swallowed — it never blocks or
unwinds the match, which has already been recorded by that point.

**Ratings.** Once a seeker is connected to a mentor (adopted or requested,
either direction), they can rate that mentor 1–5 stars with an optional note.
`rateMentor` writes onto the existing MentorMatches row for that pair rather
than creating a new one, so a connection carries at most one rating, and
re-rating just overwrites it. A mentor's average and count are recomputed from
MentorMatches on every read (`attachRatingSummary_`) rather than cached, so
they can never drift out of sync with the underlying ratings. Seekers are not
rated — this is one-directional.

**AI-assisted search.** The seeker tab has a free-text box ("Describe what
you need help with") that calls `searchMentors`, which reuses the exact same
Gemini-first / OpenAI Script properties already configured for resume
analysis (`analysisConfiguration()` / `callGeminiJson()` in
apps-script/ResumeAnalysis.gs) — there is nothing new to configure if that's
already turned on. The LLM sees the seeker's request plus a JSON directory of
every listed mentor's own fields (role, company, expertise, years, paid
status, note) and returns up to 5 ranked matches with a short reason, which
`callMentorSearchLLM` then filters to only emails actually present in the
directory (a model cannot invent a match). If ResumeAnalysis.gs isn't
deployed, LLM analysis isn't turned on, or the call fails, `searchMentors`
falls back to a plain keyword overlap against each mentor's role/company/
expertise/note — the feature degrades instead of breaking, and the frontend
labels which kind of result it's showing.

Three sheet tabs are created automatically on first use, the same
create-on-first-write pattern as Profiles and Opportunities elsewhere in this
file — nothing needs to be pre-created in the spreadsheet:

- **Mentors** — Email, Name, Role, Company, Expertise (comma-separated),
  Years, Slots, Phone, Contact preference, Paid, Rate, Note, Undertaking
  accepted at, Updated at. One row per mentor, keyed by email.
- **MentorSeekers** — Email, Name, Status, Field (comma-separated), Phone,
  Contact preference, Note, Updated at. One row per seeker, keyed by email.
- **MentorMatches** — Match ID, Mentor email, Seeker email, Type (`adopted` or
  `requested`), Created at, Rating, Review, Rated at. One row per connection;
  never deleted, and updated only by `rateMentor` filling in the last three
  columns, so the history of who reached out to whom stays intact.

## Activate on the live site

1. In the existing **standalone** Apps Script project, replace Code.gs with
   the complete apps-script/Code.gs in this repository. Do not edit the older
   bound script. ResumeAnalysis.gs only needs to be there too if you want AI
   search to actually call an LLM — without it, mentor search still works via
   the keyword fallback.
2. Deploy > Manage deployments > edit the existing deployment > New version >
   Deploy. Keep the existing /exec URL and execute-as-owner setting.
3. Publish index.html, mentor.js and opportunities.css with the normal GitHub
   Pages release.
4. As an approved member, register on both tabs (a second browser profile or
   incognito window signed in as a different approved member helps here,
   since you cannot adopt or request yourself), adopt/request across the two
   accounts, confirm both the MentorMatches row and the notification email
   arrive, then rate the mentor from the seeker side and try the AI search box.

Local changes do not update the live Apps Script project until the updated
backend is deployed there. A save error leaves the form filled in for retry.
