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

**Booking an actual appointment.** Once connected, a seeker doesn't just get a
mentor's contact info — if that mentor has listed any available times, the
seeker sees them as clickable buttons right on the mentor's card and booking
one is instant (`bookMentorSlot`). Both sides then get an email
(`sendAppointmentConfirmationEmail_`) confirming the exact date and time (and,
if the mentor is paid, restating their rate right there — not just in the
earlier adopt/request email a seeker may have already skimmed past). A mentor
manages their own times from their profile form (`addMentorSlot` /
`removeMentorSlot`) — up to 10 open times at once, each must be in the future
and within 90 days, and a time that's already booked can't be removed (the
mentor has to sort that out with the mentee directly first — or either side
can just cancel it, see below). Booking itself still requires an existing
connection (adopted or requested) — the same rule as rating — so a seeker
can't book a mentor's time without ever having reached out to them, and a
seeker can only ever hold **one** open appointment per mentor at a time
(`bookMentorSlot` blocks a second booking with the same mentor until the
first is cancelled). A seeker only ever sees a mentor's *open* times plus
whichever one they themselves booked — never another seeker's booking; the
mentor's own view of their times (`mentorProfile.myTimes`) is the only place
a booked time shows who booked it, the same visibility level as the
adopted-mentees list already has.

**Cancelling.** Either side of a booked appointment can cancel it
(`cancelMentorSlot`) — the mentor from their "Available times" list, the
seeker from the mentor's card on their own tab. Cancelling clears the
booking columns (the slot itself isn't deleted, so the mentor doesn't have to
re-add the time) and emails both sides that it was cancelled and by whom
(`sendAppointmentCancelledEmail_`). Once freed, that same seeker (after
sorting things out) or a different one can book it again.

**Reminders.** A time-driven trigger you set up once
(`setupMentorReminderTrigger` — run it from the Apps Script editor's function
picker, or `Run` menu) checks hourly for booked appointments starting in
23–25 hours and emails both sides a reminder (`sendUpcomingAppointmentReminders`
/ `sendAppointmentReminderEmail_`). Each slot gets at most one reminder — the
"Reminder sent at" column stops it firing twice even though the trigger runs
every hour. No trigger, no reminders; the confirmation email at booking time
still goes out regardless.

**"Your upcoming appointments."** `getMentorData` also returns
`myAppointments` — every booked slot involving you, whichever side you're on,
merged into one time-sorted list (`myAppointments_`). The frontend shows this
as a small panel at the top of both the Become a Mentor and Find a Mentor
tabs, so a seeker who's booked with two different mentors (or a mentor with
several mentees) sees all of it in one place instead of having to find each
one on its own card.

Four sheet tabs are created automatically on first use, the same
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
- **MentorSlots** — Slot ID, Mentor email, Starts at, Booked by email, Booked
  by name, Booked at, Reminder sent at. One row per time a mentor has ever
  listed; open when the last four columns are blank. `bookMentorSlot` fills
  in Booked by/at, `cancelMentorSlot` clears all four again (the slot stays,
  ready to be booked again), and the reminder trigger fills in the last
  column once per booking.
## Activate on the live site

1. In the existing **standalone** Apps Script project, replace Code.gs with
   the complete apps-script/Code.gs in this repository. Do not edit the older
   bound script. ResumeAnalysis.gs only needs to be there too if you want AI
   search to actually call an LLM — without it, mentor search still works via
   the keyword fallback.
2. Deploy > Manage deployments > edit the existing deployment > New version >
   Deploy. Keep the existing /exec URL and execute-as-owner setting.
3. In the Apps Script editor, select `setupMentorReminderTrigger` in the
   function picker next to Run and click Run once — this turns on the hourly
   reminder check. Safe to run more than once; it no-ops if the trigger
   already exists.
4. Publish index.html, mentor.js and opportunities.css with the normal GitHub
   Pages release.
5. As an approved member, register on both tabs (a second browser profile or
   incognito window signed in as a different approved member helps here,
   since you cannot adopt or request yourself), adopt/request across the two
   accounts, confirm both the MentorMatches row and the notification email
   arrive, then rate the mentor from the seeker side and try the AI search box.
   Add a time from the mentor side, book it from the seeker side, confirm both
   accounts get the appointment-confirmed email with the exact time, try
   booking a second time with the same mentor (should be blocked), then
   cancel it from either side and confirm both get the cancellation email and
   the time becomes bookable again.

Local changes do not update the live Apps Script project until the updated
backend is deployed there. A save error leaves the form filled in for retry.
