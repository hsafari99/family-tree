# Tree linking (design)

Status: approved and implemented, 2026-11-17. This covers feedback item 5.
It builds on the person privacy design (`2026-11-17-person-privacy.md`).

## Goal

People create their own trees and join them through a person who is in both, usually the creator.
Once both owners agree, members of each tree can see the other tree's people on their own canvas,
connected at that shared person. The view is read-only, and the other tree's privacy rules apply.
Each tree keeps its own owner, members and data. Nothing is copied between trees.

## Decisions

| # | Decision |
|---|----------|
| L1 | **Joined view.** A linked tree is shown read-only, attached to the bridge person on the viewer's own canvas. Trees are never merged and data is never synced. |
| L2 | **Bridge = a real account.** A link goes through one user who has their own card (`tree_members.person_id`) in both trees. There is no matching of persons without an account, now or later: it risks wrong joins and joins people without their consent. |
| L3 | **Both owners accept.** The bridge user proposes. The owner of each tree accepts. A side owned by the bridge user is accepted automatically. |
| L4 | **Many links, direct neighbours only.** A tree may have several links. A viewer in tree T sees only the trees linked directly to T, never trees two links away. |
| L5 | **Both directions.** A live link lets members of each tree see the other. (A per-side "share my tree" switch could be added later as two flags on the same row; out of scope.) |
| L6 | **"Public" includes linked trees.** Public now means "everyone in this tree and in trees linked to it". Branch and private keep their meaning; branch steps are counted across the bridge. |
| L7 | **Collapsed by default.** The linked tree appears as a marker on the bridge card and unfolds on click. Open/closed is remembered per viewer. |
| L8 | **Cross-link features:** canvas, view-only person panel, search and the relationship path. Not: the Today card, duplicate check / similar people, export, editing or relations across the link. |
| L9 | **Ending.** Either owner or the bridge user can end a link at any time, without approval. A link also ends automatically when its bridge is no longer valid (see Lifecycle). An ended link never comes back; it is proposed again. |

## Terms

- **T**: the tree the viewer is working in. **L**: a tree linked to T.
- **Bridge user**: the account the link goes through. **Bridge cards**: that user's own card in T and in L.
- **Visitor**: a viewer looking at L who is not a member of L.
- **Live link**: both sides accepted and not ended. **Pending**: proposed, not yet accepted by both, not ended.

## Data model

New table `tree_links`, one row per proposal or link:

| Column | Notes |
|---|---|
| `id` | uuid |
| `tree_a_id`, `tree_b_id` | FK `trees`, cascade on hard delete. Check `tree_a_id < tree_b_id`, so a pair has one spelling. |
| `bridge_user_id` | FK `users`, cascade |
| `bridge_person_a_id`, `bridge_person_b_id` | The bridge cards. Composite FKs to `persons(tree_id, id)`, as `tree_members` does. Copied at proposal time. |
| `proposed_by_user_id` | FK `users`, set null. Always the bridge user in this version. |
| `a_accepted_at`, `b_accepted_at` | Timestamps, nullable. Live when both are set. |
| `expires_at` | Proposal time + 30 days. Applies only while pending. |
| `ended_at`, `ended_by_user_id`, `end_reason` | `end_reason` enum: `ended`, `cancelled`, `declined`, `bridge_left`, `card_unlinked`, `tree_deleted`, `expired`. |
| `created_at` | |

Indexes and constraints:

- Unique on `(tree_a_id, tree_b_id)` where `ended_at is null`: at most one pending or live link per pair. A pair can be linked again after an earlier link ended.
- Index on `tree_b_id` (the pair index serves `tree_a_id`).
- A tree may have at most **10** pending or live links. Checked on proposal for both trees, inside the transaction.

Migration: `0012_tree_links`. No change to existing tables.

### Reading a link

A link counts as live only if `ended_at is null`, both acceptances are set, and both trees are not
soft-deleted. A pending link past `expires_at` counts as ended; a write that touches it, or a
listing, marks it `expired`. Reads never re-check the bridge itself: the writes below keep
`ended_at` correct.

## Lifecycle

**Propose.** `POST /trees/:treeId/links { otherTreeId }`. The caller must have their own card in
both trees, both trees must be live, the pair must have no pending or live link, and neither tree may
be at the limit. The row stores both bridge cards. Each side the caller owns is accepted at once. If
the caller owns both trees, the link is live immediately.

**Accept / decline.** The owner of a side accepts or declines it. Declining ends the row with
`declined`. The proposer can cancel a pending row (`cancelled`).

**End.** Either owner or the bridge user ends a live link (`ended`).

**Automatic end.** One helper, `reconcileLinks(tx, treeIds)`, ends every open link of those trees
whose bridge no longer holds, with the reason below. The writes that can break a bridge (member
removal, relinking a card, deleting people, deleting a tree) call it in their own transaction, and
every link read calls it first, so an ended link is never shown and a later restore never revives
it:

| Event | Ends | Reason |
|---|---|---|
| Bridge user leaves T or L, or is removed | Links where they are the bridge, in that tree | `bridge_left` |
| Bridge user's card is unlinked from them, relinked to another card (`POST /me/person`), or soft-deleted | Links using that card | `card_unlinked` |
| Tree soft-deleted | All links of that tree | `tree_deleted` |
| Account deleted | All links where they are the bridge | The rows go with the account (FK cascade) |

Restoring a card or a tree from Trash does not revive a link.

**Audit.** Proposed, accepted, declined, cancelled and ended are written to the audit log of both
trees. Automatic ends are not audited separately: the write that caused them is.

## Visibility across a link

The viewer is in T. For a live link to L:

**V1. Joined graph.** The server takes the live graphs of T and L, and treats L's bridge card as an
alias of T's bridge card. The bridge person appears once, as T's card; L's unions and parent links
that touch L's bridge card are rewritten to T's card. Only T and the trees linked directly to T are
ever joined, and two of T's linked trees are never joined to each other.

**V2. Rights in L.** A viewer who is also a member of L keeps their real role and visibility in L,
as today. Anyone else is a visitor: read-only, whatever their role in T. Owner or editor in T gives
nothing in L. Steward grants do not cross.

**V3. Each L person, for a visitor:**

| Level | Visitor sees |
|---|---|
| Public, or no linked account | Everything |
| Branch, N steps | Everything if the viewer's own card in T is within N steps on the joined T+L graph (R7 rules, the bridge counted as one person). Otherwise name only, with "Data access is restricted". A viewer with no card in T sees name only. |
| Private | Name only, with "Data access is restricted" |

Hide birth year (R3) and union dates (R4) apply as for viewers. Search must not leak (R5).

**V4. Symmetric.** L's members viewing T get the same rules.

**V5. T's own privacy is unchanged.** Branch distances between two people of T are still counted
in T alone. A shorter path through L never reveals T's people to each other.

**V6. Server-side.** As R6: every response that carries L's data is masked on the server. The
existing `loadVisibility` is reused with a joined graph and the alias applied, rather than written
again.

**V7. Wording.** The public option reads "Everyone in this tree and linked trees". In a person's
own details (read mode), the privacy line also names the linked trees.

## API

All under `/api/v1/trees/:treeId`, with the usual access checks. Shapes go in
`packages/shared/src/links.ts`.

| Route | Who | Does |
|---|---|---|
| `GET /links` | Members | Live links: other tree's id and name, bridge person name, people count. Owner and bridge user also get pending rows, in and out. |
| `GET /links/candidates` | Members | The caller's other trees where they have their own card, without a pending or live link to T. |
| `POST /links` | Bridge user | Propose (see Lifecycle). |
| `POST /links/:linkId/accept`, `/decline` | Owner of T's side | Accept or decline T's side. |
| `DELETE /links/:linkId` | Owners, bridge user | Cancel a pending link (proposer) or end a live one. |
| `GET /links/:linkId/graph` | Members of T | L's graph, masked (V3), bridge alias applied (V1). |
| `GET /links/:linkId/persons/:personId` | Members of T | One L person's view-only detail, masked. |
| `GET /search` (existing) | Members | Adds `inLinkedTrees`: masked matches tagged with tree id and name. |
| `GET /relationship` (existing) | Members | Either end may be in a linked tree; the path runs on the joined graph. |

The read routes return 404 unless the link is live and involves T. New error codes: `LINK_EXISTS`,
`LINK_LIMIT`. Existing `NOT_LINKED` covers "you have no card in one of these trees".

`GET /api/v1/home/link-requests` lists pending requests that wait for the caller as an owner, for
the Home page notice.

## Web

**Members dialog → "Linked trees" section** (the tree's "Members and invites" dialog):

- Live links: "Rahimi family · through Sara · 34 people". Owners and the bridge user get **End link**, with a confirm that says both sides lose the view.
- Pending: the owner gets **Accept** / **Decline**, with "Public details of both trees become visible to members of both". The proposer sees "Waiting for the Rahimi family owner" and **Cancel**.
- **Link with another tree I'm in**: shown when candidates exist. A dialog lists them with the same summary, then **Send request**.

**Home page:** for each pending request awaiting the caller as owner, a notice next to that tree:
"Sara wants to link King family with the Rahimi family", with Accept, Decline and Review (opens
the Members dialog).

**Canvas:**

- Once per member, the first time they open a tree after a link goes live: a dismissible banner "Now linked with the Rahimi family". Dismissal is kept in the browser.
- The bridge card gets a marker button `⊕ Rahimi family · 34` with `aria-expanded`. Clicking loads the link's graph and lays it out with T, tinted, under a "Rahimi family (view only)" label. Clicking again folds it. Open links are remembered per viewer and tree, like hidden branches.
- Linked cards have no add, edit, delete or relation actions. Clicking one opens a view-only person panel (Details, Relations, Photos), masked, with the tree name in its header.
- If the joined layout times out, the canvas falls back to T alone with the links folded and a note.
- If the link has ended (a read returns 404), the part folds away with "This link has ended".

**Search:** a second group, "In linked trees", tagged with the tree name. Choosing a result unfolds
that link and centres on the person. **Relationship path** works when either person is in a linked
tree.

## Edge cases

- A person entered in both T and L who is not the bridge (for example Sara's mother) shows as two cards. Each is labelled by its tree. No matching (L2).
- The linked graph is fetched on unfold and refetched when the tree reloads. Nothing is pushed live.
- A pending request past 30 days is shown as expired and can be proposed again.
- Ownership transfer: an acceptance belongs to the tree, not the person, so it stays. A side still waiting is then accepted or declined by the new owner.

## Out of scope

Matching persons without an account; per-side sharing (L5); chained links; the Today card, export
and duplicate check across links; editing or drawing relations across a link; email notifications.

## Testing

- **Shared unit:** the bridge alias rewrite; `stepDistances` on a joined graph (wife's brother is 2 steps across the bridge).
- **API integration:**
  - Lifecycle: propose, auto-accept, accept, decline, cancel, end, expiry, and each automatic end in the table above.
  - Who may propose, accept, decline and end; `LINK_EXISTS`; `LINK_LIMIT`; `NOT_LINKED`.
  - Masking for a visitor at public, branch inside and outside N, private, no account, hidden birth year, and a visitor with no card in T.
  - A member of both trees keeps their role in L.
  - Direct links only: T's members never see a tree two links away.
  - Pending and ended links expose nothing; the read routes return 404.
  - Search group and relationship path across a link.
- **Web unit:** the Linked trees section, the Home notice, the canvas marker unfold and fold, the view-only panel without actions, the search group.
- **E2E:** two users and two trees. Propose, accept, unfold, see a public person, see a private person restricted, end the link.

## Rollout

One branch, built in three phases: **(1)** table, lifecycle, Members dialog and Home notice;
**(2)** joined graph, canvas and view-only panel; **(3)** search and relationship path. Release
the API image before merging the web, as usual. Trees without links see no change.
