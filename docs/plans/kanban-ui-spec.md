# Kanban UI — implementation spec

- **Plan:** [`kanban-rework.md`](kanban-rework.md)
- **Design system:** [`../design.md`](../design.md)
- **Status:** implementation reference

This is the screen-level contract for the board and task surfaces. It is
subordinate to `docs/design.md`; when they disagree, `docs/design.md` wins.

## Frame

- Board routes: `/board/:boardId?view=board|list|backlog|calendar|gantt&task=:taskId`.
- `PageShell width="wide" scroll="content"`. One `PageHeader` rule; the
  40px board toolbar sits 12px below it with no second rule.
- Header: back link, icon tile, title, private/public/permission labels,
  open/done/columns meta, actions (`New task`, `Share`, settings, more).
- Toolbar: view switcher, search, `Filter`, `Sort`, `Display`; active filter
  chips and `Clear all` on a second row.
- Mobile: header wraps actions; view switcher scrolls horizontally; search
  expands; task panel and sheets go full width.

## Board view

- Lanes: `rounded-panel`, `surface-sunken`, 1px `line`, 10px padding,
  `clamp(256px, calc((100% - 36px) / 4), 360px)`, 12px gap, horizontal scroll.
- Lane header: status dot, name, count, add button; final lanes get a
  success dot and overflow `Archive all`.
- Lane body scrolls; footer `Add task` stays outside the scroll. The composer
  opens at the top of the lane, title-first, `Add details` reveals the inline
  editor and compact fields.
- Cards: 7px radius, `surface`, 12px padding, number, title (2-line clamp),
  priority code, dates, max 2 label dots + N, subtask progress, comment count,
  linked note. No excerpt. Done cards are muted and struck.
- States: hover border only; focus-within 2px signal ring; selected
  `signal-soft/40`; drag source 40% opacity; 2px signal insertion line; no
  lift, scale, shadow, or rotation.
- Empty lane: dashed panel, column hint, text `Add a task`.
- Empty board: keep lanes, show a dismissible onboarding strip.
- Mobile: one lane per snap viewport; helper `Swipe between columns · Tap a
  card to open.`; desktop helper `Drag between columns`.

## Task panel

- `SidePanel`-style, 44rem desktop, full width mobile, non-modal, no scrim.
- Header: number, status picker, open-full-page, more, close.
- Editable 20px title; inline Milkdown description; save state.
- Properties rail: status, priority, assignee, start, due, labels, linked note;
  owner-only/deletion controls hidden for read-only viewers.
- Subtasks: one level, checkbox completes into first final column; add row.
- Relations: subtasks/blocks/related, search picker, remove.
- Activity and comments: chronological; comment composer disabled below
  `comment`; AI edits show Nana avatar and `actor_type="ai"`.
- Mobile: property chips above description; sections stack; 44px targets.
- URL `?task=:id` owns the open panel; closing removes only `task`.

## List view

- Grouped by column, collapsible, sticky group headers.
- Header row: Name, Priority, Assignee, Due, Labels, Progress, Comments, Note.
- 40px rows desktop / 56px mobile; inline property cells; same-board subtasks
  indent one level with a disclosure chevron.
- Empty groups keep the header and show an inline add/clear row.

## Backlog view

- Two sections: Planned and Archived. Rows reuse list anatomy.
- Drag between sections sets `planned`/`archived`; no completion change.
- `Move all to <first open column>` on Planned; no confirmation; toast count.
- Empty and filtered-empty rows stay inside the sections.

## Calendar view

- Month grid, 7 columns, 3 lanes desktop / 2 mobile, `+N more` popover.
- Multi-day bars span day cells, square caps at week boundaries.
- Today marker; `Today` button; unscheduled count opens a side panel.
- Under 768px switch to an agenda grouped by day; compact month strip.

## Gantt view

- 91-day window, 280px rail desktop / hidden mobile behind `Tasks`.
- 24px day columns desktop, 28px mobile; month + day header; weekends tinted;
  today line.
- Bars drag to move dates, 8px handles resize; keyboard arrows move/resize;
  floating date label; cancel on Escape.
- No dependency arrows, percent fills, or resource lanes.

## Filters, sort, display

- AND across subjects; OR within a subject; one negation toggle per subject.
- Subjects: status, priority, assignee, due, labels (Any/All).
- Search matches title, description, labels, task number.
- Per-board localStorage key `nana.board.v1.<id>`; `?view` wins over storage.
- Sort: manual, priority, due, created, updated, title. Drag only in manual.
- Display toggles card fields; defaults all on.
- Drag disabled while filtering or non-manual sort, with explicit copy and a
  recovery action.
- Mobile opens one sheet with Filters/Sort/Display sections and a sticky footer.

## Bulk

- Cmd/Ctrl+Click toggles, Shift+Click ranges, `X` toggles focused, Cmd/Ctrl+A
  selects visible; touch has an explicit `Select` mode.
- Bottom bar: count, status, priority, assignee, labels, due, backlog/board,
  archive/restore, delete. Confirmation only for delete.
- Partial failure reloads and reports counts; selection clears on view/filter
  change.

## Labels

- Owner label definitions: name + one of Ash, Slate, Graphite, Ink, Amber,
  Moss, Clay. Ember is excluded from labels.
- Board cards: dot + text, max 2 + N. Panel: outline chips. No colored text.
- Picker: search, multi-select, inline create for owners, manage link.

## Motion and accessibility

- 140–260ms, house ease; no hover scaling. Reduced motion respected.
- One `<h1>`; lane names `<h2>`; panel sections `<h3>`.
- Every icon button has a label; cards use one stretched button and separate
  interactive children.
- `aria-live` for local move/selection/save failures, not remote token noise.
- Keyboard: `/`, `C`, `?`, `J/K`, `Home/End`, `Space`, `Enter`, `X`, `Esc`,
  `S/P/A/L`, `Shift+D`, `Alt+Arrow`.
- Touch targets 44px; no hover-only affordance.

## Acceptance

- Dynamic columns render and drag correctly; completion uses `is_final`.
- Board/list/backlog/calendar/gantt share one filtered task set.
- Task panel edits all fields, comments, relations, subtasks, and undoes AI
  section edits through the version snapshot.
- Filters/sort/display persist per board.
- Bulk actions work with keyboard and touch.
- Public board view uses columns and omits private fields.
- Desktop 1280/1600 and mobile 390 screenshots pass; no horizontal page scroll
  except the board/Gantt grid.
- `bun run build` and `bun run test:unit` pass.
