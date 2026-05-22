<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Shared (friend) views must mirror the personal views

The friend view at `/friends/[friendId]` (Total / Calendar / Grid — see
`app/friends/[friendId]/`) is meant to be **visually and functionally the
same** as a user's own Total / Calendar / Grid views, with one and only one
difference: it is **read-only** (you can view + copy a friend's shared
rhythms, never edit them).

**Standing rule:** whenever you change the personal views — the dashboard
(`app/page.tsx`: Day/Week/Month/Year + Grid), the Total View
(`app/activities/`), or their shared building blocks (`day-list`,
`grid-table`, `instance-row`, etc.) — apply the **same visual/behavioral
change to the friend views** so they don't drift apart. This covers
sorting, grouping, filtering, layout, labels, colors, empty states, new
sub-views, etc.

The ONLY thing that must NOT be ported is **editability**: no
Complete/Missed/Unlabel, no Edit/Archive/Delete, no "+ Add", no mutation
modals. Reuse the real components in read-only mode where practical
(`GridTable` already takes a `readOnly` prop); otherwise keep the friend-side
renderers feature-matched by hand.

If porting a change to the friend views **doesn't make sense or would cause
problems** (e.g. it depends on a mutation, on URL-driven dashboard
navigation, or on the user's own data), **stop and ask** instead of forcing
it. Known intentional gaps today: friend Grid has no "Custom" range, and the
friend Calendar's Day tab is a static chronological list rather than the
dashboard's infinite-scroll day list.
