# Person privacy and birthday without year (design)

Status: approved and implemented, 2026-11-17. This covers feedback items 3 and 4. Tree linking (item 5) is a
separate design.

## Goal

A person with an account decides who in the tree can see their details. They can also show their
birthday without the year, so others know the date but not their age.

## Decisions already made

| # | Decision |
|---|----------|
| D1 | There are three levels: **private**, **branch (N steps)** and **public**. The default is public. |
| D2 | "Public" means every member of the tree, however distant. Nobody outside the tree ever sees anything (no change from today). |
| D3 | Only the person sets the level, through the member account linked to their person card. People with no linked account are always public. |
| D4 | The name and the person's place in the tree (relationship lines) always stay visible. Everything else is hidden, with a note saying "Data access is restricted". |
| D5 | Steps: each parent, child, partner or sibling edge counts as 1. My wife's brother's wife's brother is 4 steps away. |
| D6 | A member with no linked person has no position in the tree, so under "branch" they see nothing. |
| D7 | **Owners and editors always see and can edit everything.** Privacy limits only viewers. |
| D8 | "Hide my birth year" is a separate setting next to the level. When it is on, others see "Born 5 March", with no year and no age. The full date stays stored. |

## Proposed rules (please review)

**R1. Who is a "restricted viewer".** A member with the viewer role who is not this person's
steward. A steward can already edit the people in their branch, so under D7 they count as
editors for those people. The person always sees their own data.

**R2. What is hidden** for a restricted viewer: given and other names stay. Hidden are sex,
birth and passing dates, places, cause of passing, living/deceased status, occupation, education,
notes, residences, all photos (including the picture on their box) and their change history. On
the canvas the box shows the name, a neutral outline and no years. In the panel, a single line
reads "Data access is restricted."

**R3. Hidden birth year (D8)** applies to every viewer who is not an owner or editor. It removes
the year from the birth date. It also removes the birth year on the box, the age, the year in
history entries, and matches on that person's birth year in search.

**R4. Union dates.** A marriage's start and end dates (and its place) belong to two people. They are
hidden if **either** partner is hidden from the viewer.

**R5. Search must not leak.** A restricted person is never matched by a filter on hidden data,
such as born/passed year ranges or place. Searching by name still finds them.

**R6. Enforced on the server, not just in the UI.** Every API response that carries person data
is filtered for the viewer: graph, person view, search, history, photos and photo files, avatar,
residences and the home page. The web app only renders what it gets. Export is owner-only, so it is
unaffected.

**R7. Counting steps** runs on the server with a breadth-first walk from the viewer's linked
person. Parent→child, child→parent, partner↔partner and sibling↔sibling each count as 1. Siblings
share a union, so child→union→child counts as 1, not 2. Only live (not trashed) people and
relations count. The walk is computed once per request, and only when some person on the page
uses a branch level.

**R8. Settings UI.** The person sets this on **Account → Privacy**, one section per tree they are
linked in. It holds the level (Private / My branch, with a step count of 1–10 / Public) and the
checkbox "Show my birthday but hide the year". In a person's own panel, a "Privacy" link takes them
there.

## Data model

New columns on `persons`:

- `privacy_level` enum `public | branch | private`, not null, default `public`.
- `privacy_steps` smallint, null unless the level is branch (check 1–10).
- `hide_birth_year` boolean, not null, default false.

They live on the person, not the member, so they survive a member being unlinked and relinked.
They are only writable through a new endpoint, `PUT /trees/:treeId/me/privacy`, which updates the
caller's own linked person. A normal person edit by an owner or editor cannot change them (D3).

## Out of scope

Tree linking (item 5), the birthday list (item 6) and the photo album (item 7). The birthday list
will reuse R2 and R3.

## Testing

- Shared unit tests: the step walk, using the wife's-brother example (4 steps) plus sibling, cousin and in-law cases.
- API integration tests, one per surface in R6:
  - a viewer at 1 step, 2 steps and outside the range;
  - an editor, the owner, a steward, the person themselves, and a member with no linked person;
  - private, branch and public levels, with the birth year hidden and shown.
- Web tests: the restricted panel note, the box with no years, and the settings form.
