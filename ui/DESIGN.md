# UI groundwork — design notes

Companion to [#2](https://github.com/supernovas/particle/issues/2). The prototype in this
directory is the design: every decision below is implemented and clickable against mock data.

## What the UI has to do

particle is a shared workspace where a whole org — founders, sales, engineers, design,
product — starts and supervises coding agents. The UI succeeds if:

1. **Anyone can start work.** Writing a prompt in a channel is the entire "start a project"
   flow. No forms, no config. If you can use Slack, you can use particle.
2. **Agent work is legible at a glance.** A project's state (planning → implementing →
   review ⇄ changes → merged) is visible everywhere the project appears, with one
   consistent color per state.
3. **Trust comes from git, and the UI shows it.** Every project surfaces its ref, commits,
   and diffstat. Nothing agents do is invisible or unauditable.
4. **Humans stay in the loop.** Any thread accepts human replies mid-flight, agents can be
   paused, and review rounds are explicit — the fixed-point loop is a first-class concept,
   not hidden machinery.

## The three panes

**Left — where things are.** Channels (the familiar spine), then a flat list of projects
with live status dots, so active agent work is reachable from anywhere without hunting
through channels. Unread badges only on channels; status dots carry the project signal.

**Center — where work starts.** A normal chat stream. A message that starts a project gets
a project card under it: status chip, task progress bar, diffstat, round counter, watchers.
The card is the project's face in the conversation; clicking it opens the transcript.

**Right — where work is inspected.** The project pane: status + round + issue link, the
ref with a copy-fetch affordance, the plan as a task checklist with per-task state and
assignee, and the full turn-by-turn transcript (plans, commits with sha + diffstat, runs,
reviews, human comments). A reply composer and a pause control sit at the bottom — this
pane is for steering, not just reading.

## Legibility system

- **Status taxonomy** (one hue each, used in dots, chips, and bars):
  planning · implementing · in review · changes requested · merged · failed.
  Live states pulse gently; settled states don't.
- **Actor identity:** humans get round tinted-initial avatars; agents get square monospace
  marks (P, I1, I2, R) in the accent color; integrations (the GitHub bridge) post as apps
  with the particle mark. You can tell who did what from the avatar shape alone.
- **Turn kinds:** plan / commit / run / review / comment / status, each with a distinct
  treatment (commits are monospace boxes with sha + diffstat; reviews carry their verdict).

## Deliberate omissions

DMs, reactions, search, notifications, and settings are all absent on purpose — none of
them are needed to validate the core loop, and each is additive later. Single org, single
repo for now. Light and dark themes ship because tokens made it nearly free.

## What's mock vs. real

Real: all layout and interaction — navigation, selection, composing, replying, pausing,
theme, unreads. Mock: the data (`src/data.ts`), a short scripted feed that plays one
implement → review → changes → fix pass after load, and the pause button's effect. The
domain model in `src/types.ts` is the proposed contract for the worker: the UI is a pure
function of that data, so wiring the backend should not require touching components.

## Next steps

- Real feed from the worker (websocket or SSE) replacing `data.ts` + the scripted events
- Diff viewer behind the card diffstat; PR link once projects open PRs
- Notifications and keyboard navigation (channel switcher, `⌘K`)
- Multi-org / multi-repo switching in the sidebar header
