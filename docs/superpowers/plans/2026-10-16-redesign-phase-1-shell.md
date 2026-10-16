# Redesign Phase 1 (Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every page the mockups' shell:
- breadcrumbs in the top bar;
- a user chip at the bottom of the sidebar;
- one top-bar order;
- a single demo countdown pill instead of the page banner;
- the "Demo access ·" notice on the four admin pages whose actions the demo blocks.

**Architecture:** Pure crumb rules are derived from `NAV` in a new `app/breadcrumbs.js`. A small context lets a page name its last crumb (`useBreadcrumb`). The account menu becomes one component, opened from the avatar and from the new sidebar chip. `DemoSession.jsx` swaps `DemoBanner`/`DemoChip` for a `DemoPill`, and gains a `DemoAccessNotice`.

**Tech Stack:** React 19, MUI 9, react-router, Vitest + Testing Library + MSW.

**Spec:** `docs/superpowers/specs/2026-10-16-redesign-from-mockups-design.md`. Sections **3.1–3.6** bind this plan. **3.4** holds the crumb table and **3.5** the demo pill. The four page notice texts are in **§6.4–6.7**. Mockups are in `.superpowers/redesign/`.

## Global Constraints

- **Repo and branch:** repo `C:\Users\mizo7\OneDrive\Desktop\Projects\coding-workshop-participant`, branch `feat/frontend`. Work in place. Don't switch branches, push, deploy or touch remotes.
- **Scope:** the frontend only. No permission or nav-item changes: the items, order, labels, badges and `can()` checks in `NAV` stay exactly as they are. No business-rule changes.
- **Exact copy:**
  - root crumbs: "Workspace" for Work pages, "Administration" for Admin pages (for admins);
  - crumb nav labelled "Breadcrumb", with the last crumb `aria-current="page"`;
  - the user chip is a button named "<Full name>, account menu";
  - demo pill label "Demo session · m:ss";
  - the pill's name is "Demo session, signed out in N minutes N seconds";
  - the popover reads "Public demo admin. Some actions are disabled, and you'll be signed out when the timer ends.";
  - one polite announcement at 1:00: "1 minute left in the demo session";
  - demo-disabled tooltip: `DEMO_DISABLED` (existing).
- **Page notices**, verbatim from spec §6:
  - People: "Demo access · Account creation and editing are unavailable in this session."
  - Departments: "Demo access · Adding, renaming and archiving departments is disabled."
  - Skills: "Demo access · Adding, renaming and archiving skills is disabled."
  - Archive: "Demo access · Only milestone restoration is available in this session." It can be hidden for the session.
- **Top bar order, right side:**
  1. Search field (the palette button drawn as a field: magnifier, "Search…", "Ctrl K", or "⌘K" on Apple; icon-only under `md`; named "Search (Ctrl+K)");
  2. TimerChip;
  3. Puppy;
  4. Bell;
  5. Demo pill;
  6. Avatar.
- **Kept as they are:**
  - `overwatch.sidebarCollapsed`, the `[` shortcut, the Collapse control;
  - `DemoWelcome`, `DemoLock`;
  - the `Layout` export and its props (`user`, `onLogout`, `topBarExtras`, `badges`). `App.jsx` may change only to reorder what it passes.
- **Every role:** employee, manager, executive, admin, and a "Tracks own hours" manager/admin. Light and dark. No horizontal scroll at 375 px.
- **Tests:**
  - Role and label queries only.
  - Commits carry no attribution of any kind, use the exact messages, and stage only your files (`backend/health/` stays out).
  - One suite at a time: `cd frontend && npx vitest run <paths> --testTimeout=20000`, then the full suite, then `npm run lint`.

## Review Focus

1. **A project page before its name loads.** The last crumb shows a short skeleton, never "undefined" and never the previous project's name. Pinned in Task 1.
2. **An executive on Archive or Audit log** (Work items for them). Their root crumb is "Workspace", not "Administration". Pinned in Task 1.
3. **The collapsed sidebar.** The user chip shows only the avatar, keeps its accessible name, and still opens the menu. Pinned in Task 2.
4. **A demo session that crosses 1:00 while the tab is hidden, then returns.** It is announced once at most, never once per second. Pinned in Task 3.
5. **A non-demo admin.** No pill and no "Demo access ·" notice on People, Departments, Skills or Archive. Pinned in Task 3.

---

### Task 1: Breadcrumbs

**Files:**
- Create: `frontend/src/app/breadcrumbs.js`. It holds the pure function `crumbsFor(pathname, user, lastLabel)` and the `BreadcrumbProvider`, `useBreadcrumb(label)` and `useCrumbs()` context hooks. These hooks may move into a `.jsx` sibling if JSX is needed.
- Create: `frontend/src/app/Breadcrumbs.jsx`. On desktop it renders the nav. On phones, for nested pages only, it renders the back link "‹ <parent>".
- Modify:
  - `frontend/src/app/Layout.jsx`: render `Breadcrumbs` at the left of the top bar and wrap in the provider.
  - `features/projects/ProjectDetailPage.jsx`: `useBreadcrumb(project?.name)`.
  - `features/people/PersonProfilePage.jsx` and `UserDetailPage.jsx`: the person's name.
  - `features/messages/MessagesPage.jsx`: the open thread's subject or name.
- Test: `frontend/src/app/breadcrumbs.test.jsx` (new).

**Interfaces:** `crumbsFor` returns `[{ label, to? }]`. The last crumb has no `to`, and a root crumb has no `to`.

- [ ] **Step 1: Write failing tests**, one per row of the spec 3.4 table:
  - employee home → `Workspace / My week`;
  - manager home → `Workspace / Dashboard`;
  - admin home → `Workspace / Control centre`;
  - admin `/people` → `Administration / People`;
  - executive `/archive` → `Workspace / Archive` (Review Focus 2);
  - `/projects/p1` with the name loaded → `Projects / Apollo`, where Projects is a link to `/projects`;
  - the same route before the name loads → a skeleton, with no text "undefined" (Review Focus 1);
  - your own `/people/<me>/profile` as an employee → `Workspace / My history`;
  - an admin viewing someone → `Administration / People / <name>`;
  - `/profile` → `Workspace / My profile`;
  - an unknown route → `Workspace / Page not found`;
  - the nav is labelled "Breadcrumb" and only the last crumb has `aria-current="page"`;
  - on a phone (matchMedia stub), a project page shows a "Projects" back link and no full trail.
- [ ] **Step 2:** Run the file. Expect it to fail.
- [ ] **Step 3:** Implement. Crumbs come from `NAV` labels, so `label(user)` functions are resolved.
- [ ] **Step 4:** Run `src/app src/features/projects src/features/people src/features/messages`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Shell: breadcrumbs on every page, named by the page; a back link on phones"

### Task 2: Account menu, sidebar user chip and top-bar order

**Files:**
- Create: `frontend/src/app/AccountMenu.jsx`. Move today's account menu out of `Layout.jsx` unchanged: the header with name/username/role, My profile, Profile photo with the demo lock, Theme radios, Sign out. Export a hook or component that both openers use.
- Modify:
  - `Layout.jsx`: a sidebar user chip above Collapse (desktop) and at the bottom of the phone drawer; reorder the top bar per Global Constraints.
  - The palette button, wherever `PaletteButton` lives: draw it as the search field.
  - `App.jsx`: only to reorder `topBarExtras` if needed.
- Test: `frontend/src/app/Layout.test.jsx`.

- [ ] **Step 1: Write failing tests:**
  - the sidebar chip is named "<Full name>, account menu" and opens the menu with My profile, Profile photo, Theme and Sign out;
  - the avatar button opens the same menu;
  - with the sidebar collapsed, the chip still has its name and opens the menu (Review Focus 3);
  - Collapse and `[` still toggle `data-collapsed`;
  - the top bar's buttons come in the order Search, (timer), Puppy, Notifications, (demo pill), Account;
  - Search is named "Search (Ctrl+K)" and opens the palette;
  - the nav for each of the four roles plus a tracks-own-hours manager: group headings, items, order (one table-driven test);
  - the phone drawer shows the user chip at the bottom and no Collapse.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/app src/features/palette`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Shell: account menu from a sidebar user chip, and one top-bar order with a search field"

### Task 3: Demo pill and "Demo access" notices

**Files:**
- Modify: `frontend/src/app/DemoSession.jsx`:
  - replace `DemoBanner` and `DemoChip` with `DemoPill({ notice })`, a button with a popover and a polite live region that announces once at 1:00;
  - add `DemoAccessNotice({ text, dismissible })`.
  - `Layout.jsx` renders the pill in the top bar per the order and drops the page banner.
- Modify: `features/people/PeoplePage.jsx`, `features/departments/DepartmentsPage.jsx`, `features/skills/SkillsPage.jsx`, `features/archive/ArchivePage.jsx` (or their actual paths): the notice under the header, only in a demo session. Archive's notice can be dismissed for the session (`sessionStorage`, try/catch).
- Test: `frontend/src/app/publicDemo.test.jsx`, plus one assertion per page in its existing test file.

- [ ] **Step 1: Write failing tests:**
  - only `is_public_demo` sessions show the pill;
  - its label counts down "Demo session · 4:29" (fake Date timers);
  - its name follows the spec, and the popover text is exact;
  - the error colour applies under 1:00 (assert a class or `data-urgent`, not a hex value);
  - the live region holds "1 minute left in the demo session" exactly once after crossing 1:00, including after the tab was hidden and comes back (Review Focus 4);
  - no "Demo admin — for demonstration only" banner exists any more;
  - a `DemoLock`ed action shows the `DEMO_DISABLED` tooltip on focus;
  - each of the four pages shows its exact notice in a demo session and none for a normal admin (Review Focus 5);
  - Archive's notice hides for the session.
- [ ] **Step 2:** Run. Expect it to fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `src/app src/features/people src/features/departments src/features/skills src/features/archive`, then the full suite, then lint. Expect all to pass.
- [ ] **Step 5: Commit:** "Shell: one demo countdown pill and a Demo access notice on the pages the demo restricts"

### Task 4: End-to-end, docs, screenshots

**Files:**
- **E2E:** run all three journeys unchanged, and fix only selectors the shell moved (e.g. the account menu).
- **Docs:**
  - README tour: the shell paragraph and the demo session paragraph;
  - `docs/project/USER_STORIES.md`: the breadcrumb and demo pill stories;
  - `docs/project/DEMO_SCRIPT.md`: the demo pill instead of the banner;
  - TESTING counts.
- **Screenshots** at 1440×900, light: `docs/images/dashboard.png` (manager.demo), `my-week.png` (employee.demo; add it if missing and reference it in the README) and `control-centre.png` (admin.demo, or demo.admin to show the pill). Also take one dark and one 375-px shot into the job tmp folder (not the repo).
  - Use the local stack: `devserver.py --db overwatch_shots --reset --seed` on 3001 and `npm run dev` on 3000.
  - Stop both servers afterwards.

- [ ] **Step 1:** Run `npx playwright test` alone, with ports 3000/3001 free. Expect all to pass.
- [ ] **Step 2:** Update the docs with counts from your own final runs.
- [ ] **Step 3:** Take the screenshots, view them, then stop the servers.
- [ ] **Step 4: Commit:** "Shell: docs, screenshots and journeys for the new shell"
