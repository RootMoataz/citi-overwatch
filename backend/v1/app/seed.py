"""Demo data so every dashboard section has something to show (spec §11). Demo data by Moataz Hikal.

Dates are relative to today, so the demo stays realistic whenever it is loaded.
Running seed() again is a no-op once admin.demo exists.
"""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one, transaction
from app.presets import step_named
from app.rules.overtime import hourly_rate
from app.security import hash_password

DEMO_PASSWORD = "Demo123!"
# The public demo admin: the sign-in page's "Admin" button. Its password is published, so it is flagged
# is_public_demo: app/public_demo.py refuses its dangerous writes and its sessions end after five minutes.
# The real admin.demo login is a different account and keeps its private password.
PUBLIC_ADMIN = ("demo.admin", "Dana", "Demo-Admin", "Public demo administrator", 120000, "Operations")

# Logins published in the README for graders. Their password is public, so locking them out or changing it
# would only let one visitor spoil the demo for everyone else.
PUBLISHED_DEMO = frozenset({"manager.demo", "employee.demo", "executive.demo", PUBLIC_ADMIN[0]})
WEEKDAYS = range(5)

PEOPLE = [
    # username, first, last, role, title, salary, reports_to
    ("admin.demo", "Avery", "Admin", "admin", "Operations Director", 160000, None),
    ("manager.demo", "Morgan", "Manager", "manager", "Delivery Manager", 140000, None),
    ("riley.chen", "Riley", "Chen", "manager", "Programme Manager", 135000, None),
    ("employee.demo", "Eli", "Employee", "employee", "Software Engineer", 104000, "manager.demo"),
    ("ana.ruiz", "Ana", "Ruiz", "employee", "Data Engineer", 98000, "manager.demo"),
    ("ben.okafor", "Ben", "Okafor", "employee", "Backend Engineer", 101000, "manager.demo"),
    ("chloe.park", "Chloe", "Park", "employee", "Business Analyst", 88000, "manager.demo"),
    ("dev.patel", "Dev", "Patel", "employee", "Frontend Engineer", 99000, "riley.chen"),
    ("emma.stone", "Emma", "Stone", "employee", "QA Engineer", 86000, "riley.chen"),
    ("finn.walsh", "Finn", "Walsh", "employee", "DevOps Engineer", 112000, "riley.chen"),
    ("gia.rossi", "Gia", "Rossi", "employee", "UX Designer", 93000, "manager.demo"),
    ("hugo.lee", "Hugo", "Lee", "employee", "Mobile Engineer", 105000, "manager.demo"),
    ("isla.nguyen", "Isla", "Nguyen", "employee", "Cloud Engineer", 115000, "riley.chen"),
    ("jack.brown", "Jack", "Brown", "employee", "Network Engineer", 97000, "riley.chen"),
    ("kira.sato", "Kira", "Sato", "employee", "Compliance Analyst", 90000, "manager.demo"),
    ("leo.martin", "Leo", "Martin", "employee", "Risk Analyst", 92000, "manager.demo"),
]

# The read-only leadership login: the project's owner, Moataz Hikal, as executive sponsor. Kept out of PEOPLE: it
# was added after the live demo was seeded, so demo_backfill creates it there, and it has no reporting line or
# project work.
EXECUTIVE = ("executive.demo", "Moataz", "Hikal", "Executive Sponsor", 180000, "Operations")
# What earlier seeds called it. demo_backfill renames executive.demo only while it still has this name.
EXECUTIVE_OLD_NAME = ("Eve", "Executive", "Chief Delivery Officer")

# Department -> the demo people in it.
DEPARTMENTS = {
    "Technology": ("manager.demo", "employee.demo", "ana.ruiz", "ben.okafor", "chloe.park", "gia.rossi", "hugo.lee"),
    "Operations": ("admin.demo", "riley.chen", "dev.patel", "emma.stone", "finn.walsh", "isla.nguyen", "jack.brown"),
    "Risk & Compliance": ("kira.sato", "leo.martin"),
}

# Project -> its department. Beacon works in pull mode (its team claims milestones); the rest are push.
PROJECT_DEPARTMENTS = {
    "Apollo Data Migration": "Technology",
    "Atlas Customer Portal": "Operations",
    "Beacon Mobile App": "Technology",
    "Cobalt Infrastructure Upgrade": "Operations",
    "Delta Compliance Audit": "Risk & Compliance",
}
PULL_PROJECT, CLAIMABLE_MILESTONE = "Beacon Mobile App", "Design"
DEMO_REQUEST = "Orion Analytics Dashboard"  # the pending project request

# Beacon is still being planned. Its board (the planning branch's Backlog -> Ready -> Scheduled) holds the Technology
# department plan: the first four steps scheduled in order, QA in Ready and the last two in Backlog. With those
# left over and nobody on the pull project's scheduled steps but Prototype, finalizing shows failing checks.
# Milestones not named here stay in Scheduled after these; names missing from the project are skipped.
BEACON_BOARD = {
    "scheduled": ["Discovery & requirements", "Design", "Prototype", "Build: backend services"],
    "ready": ["QA & user acceptance testing"],
    "backlog": ["Release & cutover", "Hypercare"],
}


def arrange_beacon_board(conn, project_id) -> list[str]:
    """Put Beacon's milestones in the columns and order of BEACON_BOARD; returns the names that moved."""
    rows = query(conn, """SELECT id, name, plan_column, sequence FROM milestones
                          WHERE project_id = :p AND NOT is_archived
                          ORDER BY sequence, end_date, start_date, lower(name), id""", p=project_id)
    by_name = {r["name"]: r for r in rows}
    target: dict[str, tuple[str, int]] = {}
    for column, names in BEACON_BOARD.items():
        for name in names:
            if name in by_name:
                target[name] = (column, sum(1 for t in target.values() if t[0] == column) + 1)
    for r in rows:  # anything else stays scheduled, after the plan's scheduled steps
        if r["name"] not in target:
            target[r["name"]] = ("scheduled", sum(1 for t in target.values() if t[0] == "scheduled") + 1)
    moved = []
    for r in rows:
        column, seq = target[r["name"]]
        if (r["plan_column"], r["sequence"]) != (column, seq):
            conn.run("UPDATE milestones SET plan_column = :c, sequence = :s, updated_at = now() WHERE id = :i",
                     c=column, s=seq, i=r["id"])
            moved.append(r["name"])
    return moved


# (project, milestone) -> difficulty; every other demo milestone is 'medium'.
DIFFICULTIES = {
    ("Apollo Data Migration", "Discovery"): "easy",
    ("Apollo Data Migration", "Cutover"): "hard",
    ("Atlas Customer Portal", "Requirements"): "easy",
    ("Atlas Customer Portal", "Build"): "hard",
    ("Beacon Mobile App", "Prototype"): "hard",
    ("Cobalt Infrastructure Upgrade", "Assessment"): "easy",
    ("Delta Compliance Audit", "Audit Fieldwork"): "hard",
}

# (project, milestone) -> priority; every other demo milestone is 'medium'. Atlas Build is the overdue one.
PRIORITIES = {
    ("Apollo Data Migration", "Cutover"): "critical",
    ("Apollo Data Migration", "Schema Mapping"): "high",
    ("Atlas Customer Portal", "Build"): "critical",
    ("Atlas Customer Portal", "Launch"): "high",
    ("Delta Compliance Audit", "Audit Fieldwork"): "low",
}

# The skills catalogue (also seeded by migration 009) and who has which.
SKILLS = ("QA", "Frontend Development", "Backend Development", "UI/UX Design", "DevOps", "Data Engineering",
          "Business Analysis", "Project Management", "Risk Analysis", "Compliance")
PEOPLE_SKILLS = {
    "manager.demo": ("Project Management",), "riley.chen": ("Project Management",),
    "employee.demo": ("Backend Development", "Data Engineering"), "ben.okafor": ("Backend Development", "DevOps"),
    "ana.ruiz": ("Data Engineering",), "chloe.park": ("Business Analysis", "QA"), "gia.rossi": ("UI/UX Design",),
    "hugo.lee": ("Frontend Development",), "kira.sato": ("QA", "Compliance"),
    "leo.martin": ("Business Analysis", "Risk Analysis"),
    "dev.patel": ("Frontend Development",), "emma.stone": ("QA",), "finn.walsh": ("DevOps",),
    "isla.nguyen": ("DevOps",), "jack.brown": ("DevOps",),
}

# (project, milestone) -> (objective, completion criteria one per line, required skills).
MILESTONE_DETAILS = {
    ("Apollo Data Migration", "Discovery"): (
        "Inventory every legacy table and who owns it",
        "Every legacy table listed with an owner\nRow counts captured for each table\nData quality issues logged",
        ("Business Analysis", "Data Engineering")),
    ("Apollo Data Migration", "Schema Mapping"): (
        "Map every legacy field to the new customer data model",
        "Customer, account and transaction tables mapped\nAddress fields split into street, city and postcode\n"
        "Records that don't parse flagged for review\nMapping sheet signed off by the data owner",
        ("Data Engineering", "Backend Development")),
    ("Apollo Data Migration", "Cutover"): (
        "Switch live traffic to the new platform with no data loss",
        "Final sync verified against legacy row counts\nTraffic switched in the agreed window\n"
        "Rollback plan rehearsed\nLegacy warehouse set to read-only",
        ("Backend Development", "DevOps")),
    ("Atlas Customer Portal", "Requirements"): (
        "Agree which account changes customers can make themselves",
        "User journeys agreed with the service team\nOut-of-scope changes listed\nRequirements signed off",
        ("Business Analysis",)),
    ("Atlas Customer Portal", "Build"): (
        "Build the self-service screens and the APIs behind them",
        "Address, contact and payment-day changes work end to end\nAccessibility checks pass\n"
        "API errors shown in plain language",
        ("Frontend Development", "Backend Development")),
    ("Atlas Customer Portal", "Launch"): (
        "Release the portal to every customer",
        "Regression suite green\nSupport team briefed\nMonitoring and alerts in place",
        ("DevOps", "QA")),
    ("Beacon Mobile App", "Design"): (
        "Design the field team's core journeys",
        "Job list, job detail and sign-off screens designed\nTested with five field engineers\nDesign system agreed",
        ("UI/UX Design",)),
    ("Beacon Mobile App", "Prototype"): (
        "A clickable prototype field teams can try on a phone",
        "Runs on iOS and Android test devices\nWorks offline for a full shift\nFeedback from two field teams captured",
        ("Frontend Development", "UI/UX Design")),
    ("Cobalt Infrastructure Upgrade", "Assessment"): (
        "Find every end-of-life device and plan its replacement",
        "Every site surveyed\nReplacement list priced\nOutage windows agreed with each site",
        ("DevOps",)),
    ("Delta Compliance Audit", "Audit Fieldwork"): (
        "Test the year's key controls and collect the evidence",
        "Every key control tested\nEvidence filed for each test\nFindings agreed with control owners",
        ("QA", "Business Analysis")),
}

# The work log and a kickback (resolved) on Schema Mapping, so the timeline and history have something to show.
DEMO_UPDATE = ("Apollo Data Migration", "Schema Mapping", "employee.demo", 5 * 60,
               "Customer and account tables are mapped and reconciled. Addresses are next: about 3% of records "
               "don't parse and are flagged for Thursday's review.", 60)
DEMO_KICKBACK = ("Apollo Data Migration", "Schema Mapping", "ana.ruiz", "unclear_requirement",
                 "The legacy address field mixes street, city and postcode in free text and the new model needs "
                 "them split. Which format should records that don't parse go into?",
                 "manager.demo", "Split them into street, city and postcode. Flag anything that doesn't parse and "
                 "we'll go through those together on Thursday.", 4)  # days ago


# A short, realistic message thread and a milestone discussion: (sender, minutes ago, text). Times are relative to
# when they're loaded. Each reader's last_read_at is set so Eli has one unread message in each on first sign-in.
DEMO_DIRECT = [
    ("manager.demo", 20 * 60, "Hi Eli, how is Schema Mapping coming along? Ana mentioned the legacy address fields "
                              "are messy."),
    ("employee.demo", 19 * 60 + 40, "Customer and account tables are mapped. Addresses are the last big piece: the old "
                                    "system keeps them in one free-text field."),
    ("manager.demo", 2 * 60, "Thanks. Split them into street, city and postcode, and flag anything that doesn't parse "
                             "so we can go through it together on Thursday."),
]
DEMO_DISCUSSION = ("Apollo Data Migration", "Schema Mapping", [
    ("manager.demo", 26 * 60, "Starting a thread for Schema Mapping so questions don't get lost. Target is the end of "
                              "next week."),
    ("ana.ruiz", 25 * 60, "I'll take the transaction tables. Ben, can you pick up the reference data?"),
    ("ben.okafor", 3 * 60, "Yes, reference data is mine. I'll post the mapping sheet here by tomorrow."),
])


def _demo_messages(conn) -> tuple[list[str], str | None]:
    """Create the demo conversations. Returns (titles created, None) or ([], why not)."""
    usernames = {"manager.demo", "employee.demo", "ana.ruiz", "ben.okafor"}
    people = {r["username"]: r for r in query(conn, """SELECT id, username, first_name, last_name FROM users
                                                       WHERE username = ANY(:u) AND NOT is_archived""",
                                              u=sorted(usernames))}
    project_name, milestone_name, discussion = DEMO_DISCUSSION
    milestone = query_one(conn, """SELECT m.id FROM milestones m JOIN projects p ON p.id = m.project_id
                                   WHERE p.name = :p AND NOT p.is_archived AND m.name = :m AND NOT m.is_archived""",
                          p=project_name, m=milestone_name)
    if set(people) != usernames or not milestone:
        return [], "missing"
    now = datetime.now(timezone.utc)

    def conversation(lines, readers, **columns):
        last = now - timedelta(minutes=lines[-1][1])
        conv = query_one(conn, """INSERT INTO conversations (created_by, created_at, subject, milestone_id, is_group,
                                                             pair_key, last_message_at)
                                  VALUES (:by, :at, :subject, :milestone, :group, :pair, :last) RETURNING *""",
                         by=people[lines[0][0]]["id"], at=now - timedelta(minutes=lines[0][1]), last=last,
                         subject=columns.get("subject"), milestone=columns.get("milestone"),
                         group=columns.get("group", False), pair=columns.get("pair"))
        for username, read_upto in readers.items():
            read_at = None if read_upto is None else now - timedelta(minutes=lines[read_upto][1])
            conn.run("""INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_read_at)
                        VALUES (:c, :u, :j, :r)""", c=conv["id"], u=people[username]["id"], j=conv["created_at"],
                     r=read_at)
        for username, minutes, text in lines:
            conn.run("INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES (:c, :s, :b, :t)",
                     c=conv["id"], s=people[username]["id"], b=text, t=now - timedelta(minutes=minutes))
        # The bell: one unread alert for Eli, from whoever wrote last.
        sender = people[lines[-1][0]]
        conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload, created_at)
                    VALUES (:r, 'MESSAGE_RECEIVED', :s, CAST(:p AS jsonb), :t)""",
                 r=people["employee.demo"]["id"], s=sender["id"], t=last,
                 p=json.dumps({"conversation_id": str(conv["id"]), "name": f"{sender['first_name']} {sender['last_name']}",
                               "subject": columns.get("subject"), "is_group": columns.get("group", False)}))

    manager, employee = people["manager.demo"], people["employee.demo"]
    conversation(DEMO_DIRECT, {"manager.demo": 2, "employee.demo": 1},
                 pair=":".join(sorted([str(manager["id"]), str(employee["id"])])))
    subject = f"{milestone_name} · {project_name}"
    conversation(discussion, {"manager.demo": 2, "employee.demo": 1, "ana.ruiz": 2, "ben.okafor": 2},
                 subject=subject, milestone=milestone["id"], group=True)
    return [f"{manager['first_name']} {manager['last_name']} and {employee['first_name']} {employee['last_name']}",
            subject], None


WORKFLOW_KEYS = ("skills_created", "user_skills_updated", "milestone_details_updated", "progress_updates_created",
                 "kickbacks_created")


def milestone_details(conn) -> dict[tuple[str, str], tuple[str, str, tuple[str, ...]]]:
    """(project, milestone) -> (objective, criteria, required skills) for the demo projects: MILESTONE_DETAILS, plus
    every live milestone named exactly like a step of its project's department plan (app/presets.py), which gets the
    step's description as its objective, its criteria and its required skills."""
    out = dict(MILESTONE_DETAILS)
    rows = query(conn, """SELECT p.name AS project, m.name FROM milestones m JOIN projects p ON p.id = m.project_id
                          WHERE p.name = ANY(:names) AND NOT p.is_archived AND NOT m.is_archived
                          ORDER BY p.name, m.start_date, lower(m.name)""", names=list(PROJECT_DEPARTMENTS))
    for r in rows:
        step = step_named(PROJECT_DEPARTMENTS[r["project"]], r["name"])
        if step and (r["project"], r["name"]) not in out:
            out[(r["project"], r["name"])] = (step.description, "\n".join(step.criteria), step.required)
    return out


def _demo_workflow(conn, out: dict, skip) -> None:
    """Skills, milestone details, a progress update and a resolved kickback, filling blanks only: a person gets the
    seed's skills only while they have none; a milestone's objective, criteria and required skills are each set only
    while empty (milestone_details(): the seed's own and every department-plan step); the update and kickback are
    added only while Schema Mapping has none. Safe to run again."""
    skill_ids = {}
    for name in SKILLS:
        row = query_one(conn, "SELECT id FROM skills WHERE lower(name) = lower(:n)", n=name)
        if not row:
            row = query_one(conn, "INSERT INTO skills (name) VALUES (:n) RETURNING id", n=name)
            out["skills_created"].append(name)
        skill_ids[name] = row["id"]

    for username, names in PEOPLE_SKILLS.items():
        user = query_one(conn, "SELECT id FROM users WHERE username = :u", u=username)
        if not user:
            skip(f"skills of {username}", "missing")
        elif query_one(conn, "SELECT 1 AS ok FROM user_skills WHERE user_id = :u LIMIT 1", u=user["id"]):
            skip(f"skills of {username}", "already_set")
        else:
            for name in names:
                conn.run("INSERT INTO user_skills (user_id, skill_id) VALUES (:u, :s)", u=user["id"], s=skill_ids[name])
            out["user_skills_updated"].append(username)

    def milestone_row(project, name):
        return query_one(conn, """SELECT m.* FROM milestones m JOIN projects p ON p.id = m.project_id
                                  WHERE p.name = :p AND NOT p.is_archived AND m.name = :m AND NOT m.is_archived
                                  ORDER BY m.created_at LIMIT 1""", p=project, m=name)

    for (project, name), (objective, criteria, needs) in milestone_details(conn).items():
        label = f"{project} / {name}"
        m = milestone_row(project, name)
        if not m:
            skip(label, "missing")
            continue
        filled = False
        if not m["objective"]:
            conn.run("UPDATE milestones SET objective = :o WHERE id = :i", o=objective, i=m["id"])
            filled = True
        if not m["completion_criteria"]:
            conn.run("UPDATE milestones SET completion_criteria = :c WHERE id = :i", c=criteria, i=m["id"])
            filled = True
        if not query_one(conn, "SELECT 1 AS ok FROM milestone_skills WHERE milestone_id = :i LIMIT 1", i=m["id"]):
            for skill in needs:
                conn.run("INSERT INTO milestone_skills (milestone_id, skill_id) VALUES (:m, :s)", m=m["id"],
                         s=skill_ids[skill])
            filled = bool(needs) or filled
        if filled:
            out["milestone_details_updated"].append(label)
        else:
            skip(label, "already_set")

    now = datetime.now(timezone.utc)
    project, name, username, minutes, text, percent = DEMO_UPDATE
    m, author = milestone_row(project, name), query_one(conn, "SELECT id FROM users WHERE username = :u", u=username)
    label = f"{project} / {name} progress update"
    if not m or not author:
        skip(label, "missing")
    elif query_one(conn, "SELECT 1 AS ok FROM milestone_updates WHERE milestone_id = :i LIMIT 1", i=m["id"]):
        skip(label, "already_set")
    else:
        at = now - timedelta(minutes=minutes)
        conn.run("""INSERT INTO milestone_updates (milestone_id, author_id, body, percent_complete, created_at)
                    VALUES (:m, :a, :b, :p, :t)""", m=m["id"], a=author["id"], b=text, p=percent, t=at)
        conn.run("""INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changes, created_at)
                    VALUES (:a, 'post_update', 'milestone', :m, CAST(:c AS jsonb), :t)""",
                 a=author["id"], m=str(m["id"]), t=at,
                 c=json.dumps({"before": None, "after": {"percent_complete": percent}}))
        out["progress_updates_created"].append(label)

    project, name, raiser_name, category, reason, resolver_name, note, days = DEMO_KICKBACK
    m = milestone_row(project, name)
    raiser = query_one(conn, "SELECT id FROM users WHERE username = :u", u=raiser_name)
    resolver = query_one(conn, "SELECT id FROM users WHERE username = :u", u=resolver_name)
    label = f"{project} / {name} kickback"
    if not m or not raiser or not resolver:
        skip(label, "missing")
    elif query_one(conn, "SELECT 1 AS ok FROM milestone_kickbacks WHERE milestone_id = :i LIMIT 1", i=m["id"]):
        skip(label, "already_set")
    else:
        raised, resolved = now - timedelta(days=days), now - timedelta(days=days, hours=-3)
        kickback = query_one(conn, """
            INSERT INTO milestone_kickbacks (milestone_id, raised_by, category, reason, previous_status, raised_at,
                                             resolved_by, resolution, resolution_note, resolved_at)
            VALUES (:m, :r, :c, :reason, 'in_progress', :raised, :s, 'returned', :n, :resolved) RETURNING id""",
            m=m["id"], r=raiser["id"], c=category, reason=reason, raised=raised, s=resolver["id"], n=note,
            resolved=resolved)
        for actor, action, before, after, at in (
                (raiser["id"], "kick_back", {"status": "in_progress"},
                 {"status": "blocked", "category": category, "kickback_id": str(kickback["id"])}, raised),
                (resolver["id"], "resolve_kickback", {"status": "blocked"},
                 {"status": "in_progress", "resolution": "returned", "kickback_id": str(kickback["id"])}, resolved)):
            conn.run("""INSERT INTO audit_log (actor_id, action, entity_type, entity_id, changes, created_at)
                        VALUES (:a, :act, 'milestone', :m, CAST(:c AS jsonb), :t)""",
                     a=actor, act=action, m=str(m["id"]), t=at, c=json.dumps({"before": before, "after": after}))
        out["kickbacks_created"].append(label)


def _demo_hr_submission(conn) -> tuple[str | None, str | None]:
    """The oldest of the last four complete weeks already went to HR for payroll; the three after it are ready to
    submit. Added only while there is no HR submission at all. Returns (what was added, why not)."""
    if query_one(conn, "SELECT 1 AS ok FROM hr_submissions LIMIT 1"):
        return None, "already_set"
    admin = query_one(conn, "SELECT id FROM users WHERE username = 'admin.demo'")
    today = datetime.now(timezone.utc).date()
    paid_from = today - timedelta(days=today.weekday()) - timedelta(weeks=4)
    paid_to = paid_from + timedelta(days=6)
    totals = query_one(conn, """SELECT count(*) AS n, sum(hours) AS h, sum(hours * hourly_rate) AS c FROM time_entries
                                WHERE status = 'approved' AND work_date BETWEEN :a AND :b""", a=paid_from, b=paid_to)
    if not admin or not totals["n"]:
        return None, "missing"
    submission = query_one(conn, """
        INSERT INTO hr_submissions (period_start, period_end, submitted_by, submitted_at, entry_count, total_hours,
                                    total_cost)
        VALUES (:a, :b, :by, now() - interval '20 days', :n, :h, :c) RETURNING id, submitted_at""",
        a=paid_from, b=paid_to, by=admin["id"], n=totals["n"], h=totals["h"], c=totals["c"])
    conn.run("""INSERT INTO hr_submission_entries (submission_id, entry_id, hours, hourly_rate, cost)
                SELECT :s, id, hours, hourly_rate, round(hours * hourly_rate, 2) FROM time_entries
                WHERE status = 'approved' AND work_date BETWEEN :a AND :b""",
             s=submission["id"], a=paid_from, b=paid_to)
    conn.run("""UPDATE time_entries SET hr_submission_id = :s, hr_submitted_at = :at
                WHERE status = 'approved' AND work_date BETWEEN :a AND :b""",
             s=submission["id"], at=submission["submitted_at"], a=paid_from, b=paid_to)
    return f"{paid_from} to {paid_to}", None


# ---------- hour tracking (LOGIC_WALKTHROUGH §28): notes, tracked hours and a flagged example ----------

TRACKED_PERSON = "gia.rossi"  # whose pending hours get work notes and timer-tracked hours in the demo
TIME_TRACKING_KEYS = ("entry_notes_added", "entries_marked_tracked", "flagged_examples_created")
EXAMPLE_HOURS = Decimal(8)
EXAMPLE_DAYS = 4  # the same hours on 4 weekdays: SAME_HOURS_DAILY
EXAMPLE_NOTE = "Worked through the open tickets for this milestone"


def mark_flags_live(conn) -> None:
    """The red flags judge activity and lateness only for hours logged from now on (see app.rules.hour_flags), so a
    freshly seeded history, which has no sign-in trail, never lights up with them."""
    conn.run("""INSERT INTO app_settings (name, value) VALUES ('hour_flags_live_since', CAST(clock_timestamp() AS text))
                ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""")


def _demo_time_tracking(conn, out: dict, skip) -> None:
    """Fill blanks only, never touching approved, rejected or HR-submitted hours:
    - TRACKED_PERSON's pending entries without a usable work note get one (as the timesheet curation writes them);
    - while none of their pending hours came from a timer, their three latest pending entries are marked tracked
      (two fully, one half: "mixed");
    - while no pending entry is flagged SAME_HOURS_DAILY or LONG_DAY, one demo employee gets 8h pending on four
      weekdays of a milestone they're assigned to (inside every rule: open project, the 24h day, a week of at most
      40h), so the approval screens show a red flag."""
    from app.curate import _note_for
    from app.features.time.flags import person_week_flags
    from app.rules.time_tracking import is_proof_note

    person = query_one(conn, "SELECT id FROM users WHERE username = :u", u=TRACKED_PERSON)
    pending = [] if not person else query(conn, """
        SELECT t.id, t.work_date, t.hours, t.note, t.tracked_hours, m.name AS milestone FROM time_entries t
        JOIN milestones m ON m.id = t.milestone_id JOIN projects p ON p.id = t.project_id
        WHERE t.user_id = :u AND t.status = 'pending' AND t.hr_submission_id IS NULL
          AND NOT m.is_archived AND NOT p.is_archived ORDER BY t.work_date, m.name""", u=person["id"])
    if not pending:
        skip(f"{TRACKED_PERSON} work notes", "missing")
        skip(f"{TRACKED_PERSON} tracked hours", "missing")
    else:
        blank = [e for e in pending if not is_proof_note(e["note"])]
        for e in blank:
            conn.run("UPDATE time_entries SET note = :n WHERE id = :i",
                     n=_note_for(e["milestone"], str(person["id"]), e["work_date"]), i=e["id"])
            out["entry_notes_added"].append(f"{TRACKED_PERSON} {e['work_date']} {e['milestone']}")
        if not blank:
            skip(f"{TRACKED_PERSON} work notes", "already_set")
        if any(e["tracked_hours"] > 0 for e in pending):
            skip(f"{TRACKED_PERSON} tracked hours", "already_set")
        else:
            latest = pending[-3:]
            for i, e in enumerate(latest):
                half = (e["hours"] * 2).to_integral_value(rounding="ROUND_FLOOR") / 4  # to the quarter hour
                tracked = half if i == 0 and len(latest) == 3 else e["hours"]
                conn.run("UPDATE time_entries SET tracked_hours = :t WHERE id = :i", t=tracked, i=e["id"])
                out["entries_marked_tracked"].append(
                    f"{TRACKED_PERSON} {e['work_date']} {e['milestone']} ({tracked:f} of {e['hours']:f}h)")

    keys = {(str(r["user_id"]), r["work_date"] - timedelta(days=r["work_date"].weekday())) for r in query(conn, """
        SELECT DISTINCT t.user_id, t.work_date FROM time_entries t WHERE t.status = 'pending'""")}
    flagged = person_week_flags(conn, keys)
    pending_ids = {str(r["id"]) for r in query(conn, "SELECT id FROM time_entries WHERE status = 'pending'")}
    if any(f["code"] in ("SAME_HOURS_DAILY", "LONG_DAY") for i in pending_ids for f in flagged.get(i, [])):
        skip("flagged pending example", "already_set")
        return
    example = _flag_example_slot(conn)
    if not example:
        skip("flagged pending example", "no_room")
        return
    w, days = example
    for d in days:
        conn.run("""INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, note,
                                              created_at, updated_at)
                    VALUES (:u, :m, :p, :d, :h, 'pending', :n, :at, :at)""",
                 u=w["id"], m=w["milestone_id"], p=w["project_id"], d=d, h=EXAMPLE_HOURS, n=EXAMPLE_NOTE,
                 at=datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=22))
    out["flagged_examples_created"].append(
        f"{w['first_name']} {w['last_name']}: {EXAMPLE_HOURS:f}h on {len(days)} weekdays from {days[0]} on "
        f"{w['project']} / {w['milestone']} (SAME_HOURS_DAILY)")


# ---------- the timer workflow (LOGIC_WALKTHROUGH §28): a change request waiting for the manager ----------

CHANGE_PERSON = "employee.demo"  # Eli asks to change hours a timer tracked
CHANGE_HOURS = Decimal(2)
CHANGE_TO = Decimal("1.5")
CHANGE_NOTE = "Mapped the remaining address fields for the reconciliation report"
CHANGE_REASON = "I forgot to stop the timer when I took a phone call, so it ran 30 minutes too long."


def _change_request_slot(conn, person_id):
    """(work item, day) for a small timer-tracked entry of the person: a milestone they're assigned to on an open
    project inside its dates and the milestone's, today or an earlier day of this week or last week (weekdays
    first), with nothing on it that day and the day staying within 24h. None when nothing fits."""
    today = datetime.now(timezone.utc).date()
    this_week = today - timedelta(days=today.weekday())
    work = query(conn, """
        SELECT m.id AS milestone_id, m.name AS milestone, m.start_date, m.end_date, p.id AS project_id,
               p.start_date AS p_start, p.predicted_end_date AS p_end
        FROM milestone_assignees a JOIN milestones m ON m.id = a.milestone_id JOIN projects p ON p.id = m.project_id
        WHERE a.user_id = :u AND NOT m.is_archived AND m.status <> 'completed' AND p.status IN ('planned', 'active')
          AND NOT p.is_archived
        ORDER BY lower(p.name), lower(m.name)""", u=person_id)
    last_week = this_week - timedelta(days=7)
    # Latest weekday first (this week up to today, then last week), then a weekend day (Saturday before Sunday).
    days = [d for d in (this_week + timedelta(days=n) for n in reversed(WEEKDAYS)) if d <= today] + \
        [last_week + timedelta(days=n) for n in reversed(WEEKDAYS)] + \
        [d for d in (this_week + timedelta(days=n) for n in (5, 6)) if d <= today] + \
        [last_week + timedelta(days=n) for n in (5, 6)]
    for w in work:
        for d in days:
            if not (max(w["start_date"], w["p_start"]) <= d <= min(w["end_date"], w["p_end"])):
                continue
            taken = query_one(conn, """SELECT 1 AS ok FROM time_entries WHERE user_id = :u AND milestone_id = :m
                                       AND work_date = :d""", u=person_id, m=w["milestone_id"], d=d)
            day_total = query_one(conn, """SELECT coalesce(sum(hours), 0) AS h FROM time_entries
                                           WHERE user_id = :u AND work_date = :d AND status IN ('pending', 'approved')""",
                                  u=person_id, d=d)["h"]
            if not taken and day_total + CHANGE_HOURS <= 24:
                return w, d
    return None


def _demo_change_request(conn, out: dict, skip) -> None:
    """Fill blanks only: while nobody has asked to change timer hours, Eli asks to change a timer-tracked pending
    cell of his (CHANGE_HOURS -> CHANGE_TO), so the manager can show approve or reject. When Eli has no such cell, a
    small one is created first, within the timesheet rules (assigned, open project, inside its dates, the 24h day),
    with the stopped timer it came from. Running timers are never seeded: they would tick from the seed's time."""
    from app.features.time.service import week_start

    person = query_one(conn, "SELECT id, first_name, last_name FROM users WHERE username = :u AND NOT is_archived",
                       u=CHANGE_PERSON)
    if not person:
        skip("change request", "missing")
        return
    if query_one(conn, "SELECT 1 AS ok FROM time_edit_requests LIMIT 1"):
        skip("change request", "already_set")
        return
    cell = query_one(conn, """
        SELECT t.id, t.milestone_id, t.project_id, t.work_date, t.hours, m.name AS milestone, p.name AS project,
               p.manager_id FROM time_entries t
        JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
        JOIN projects p ON p.id = t.project_id AND NOT p.is_archived AND p.status IN ('planned', 'active')
        WHERE t.user_id = :u AND t.status = 'pending' AND t.tracked_hours > 0 AND t.hr_submission_id IS NULL
          AND t.hours > :min ORDER BY t.work_date DESC LIMIT 1""", u=person["id"], min=Decimal("0.25"))
    if not cell:
        slot = _change_request_slot(conn, person["id"])
        if not slot:
            skip("change request", "no_room")
            return
        w, d = slot
        started = datetime.combine(d, datetime.min.time(), tzinfo=timezone.utc) + timedelta(hours=18)
        entry = query_one(conn, """
            INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, note, tracked_hours,
                                      created_at, updated_at)
            VALUES (:u, :m, :p, :d, :h, 'pending', :n, :h, :at, :at) RETURNING id""",
            u=person["id"], m=w["milestone_id"], p=w["project_id"], d=d, h=CHANGE_HOURS, n=CHANGE_NOTE,
            at=started + timedelta(hours=float(CHANGE_HOURS)))
        conn.run("""INSERT INTO time_timers (user_id, milestone_id, work_date, started_at, stopped_at, tracked_hours,
                                             note, submitted_at, entry_id)
                    VALUES (:u, :m, :d, :s, :e, :h, :n, :e, :entry)""",
                 u=person["id"], m=w["milestone_id"], d=d, s=started, e=started + timedelta(hours=float(CHANGE_HOURS)),
                 h=CHANGE_HOURS, n=CHANGE_NOTE, entry=entry["id"])
        cell = query_one(conn, """SELECT t.id, t.milestone_id, t.project_id, t.work_date, t.hours, m.name AS milestone,
                                         p.name AS project, p.manager_id FROM time_entries t
                                  JOIN milestones m ON m.id = t.milestone_id JOIN projects p ON p.id = t.project_id
                                  WHERE t.id = :i""", i=entry["id"])
    requested = CHANGE_TO if cell["hours"] > CHANGE_TO else cell["hours"] - Decimal("0.25")
    request = query_one(conn, """
        INSERT INTO time_edit_requests (user_id, milestone_id, project_id, work_date, current_hours, requested_hours,
                                        reason)
        VALUES (:u, :m, :p, :d, :c, :r, :reason) RETURNING id""",
        u=person["id"], m=cell["milestone_id"], p=cell["project_id"], d=cell["work_date"], c=cell["hours"],
        r=requested, reason=CHANGE_REASON)
    payload = json.dumps({"request_id": str(request["id"]), "work_date": str(cell["work_date"]),
                          "week_start": str(week_start(cell["work_date"])), "current_hours": float(cell["hours"]),
                          "requested_hours": float(requested), "reason": CHANGE_REASON,
                          "first_name": person["first_name"], "name": f"{person['first_name']} {person['last_name']}",
                          "milestone": {"id": str(cell["milestone_id"]), "name": cell["milestone"]},
                          "project": {"id": str(cell["project_id"]), "name": cell["project"]}})
    conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, payload)
                VALUES (:r, 'TIME_EDIT_REQUESTED', :s, CAST(:p AS jsonb))""",
             r=cell["manager_id"], s=person["id"], p=payload)
    out["change_requests_created"].append(
        f"{person['first_name']} {person['last_name']}: {cell['project']} / {cell['milestone']} on "
        f"{cell['work_date']} from {cell['hours']:f}h to {requested:f}h")


def _flag_example_slot(conn):
    """(person and work item, days) for the flagged example: a demo employee on an in-progress milestone of an active
    project, last week or this week before today, four weekdays with nothing on that milestone, each day staying
    within 24h and the week within 40h. None when nobody fits."""
    today = datetime.now(timezone.utc).date()
    this_week = today - timedelta(days=today.weekday())
    work = query(conn, """
        SELECT u.id, u.first_name, u.last_name, m.id AS milestone_id, m.name AS milestone, m.start_date,
               p.id AS project_id, p.name AS project, p.start_date AS p_start, p.predicted_end_date AS p_end
        FROM milestone_assignees a JOIN users u ON u.id = a.user_id JOIN milestones m ON m.id = a.milestone_id
        JOIN projects p ON p.id = m.project_id
        WHERE u.role = 'employee' AND NOT u.is_archived AND m.status = 'in_progress' AND NOT m.is_archived
          AND p.status = 'active' AND NOT p.is_archived AND p.name = ANY(:names)
        ORDER BY lower(u.last_name), lower(u.first_name), lower(p.name), lower(m.name)""",
                 names=list(PROJECT_DEPARTMENTS))
    for week in (this_week - timedelta(days=7), this_week):
        for w in work:
            rows = query(conn, """SELECT t.milestone_id, t.work_date, t.hours FROM time_entries t
                                  JOIN milestones m ON m.id = t.milestone_id AND NOT m.is_archived
                                  JOIN projects p ON p.id = t.project_id AND NOT p.is_archived
                                  WHERE t.user_id = :u AND t.work_date BETWEEN :a AND :b
                                    AND t.status IN ('pending', 'approved')""",
                         u=w["id"], a=week, b=week + timedelta(days=6))
            taken = {r["work_date"] for r in rows if r["milestone_id"] == w["milestone_id"]}
            day_total = {}
            for r in rows:
                day_total[r["work_date"]] = day_total.get(r["work_date"], Decimal(0)) + r["hours"]
            week_total = sum(day_total.values(), Decimal(0))
            days = [week + timedelta(days=n) for n in WEEKDAYS
                    if week + timedelta(days=n) < today and week + timedelta(days=n) not in taken
                    and max(w["start_date"], w["p_start"]) <= week + timedelta(days=n) <= w["p_end"]
                    and day_total.get(week + timedelta(days=n), Decimal(0)) + EXAMPLE_HOURS <= 24]
            if len(days) >= EXAMPLE_DAYS and week_total + EXAMPLE_HOURS * EXAMPLE_DAYS <= 40:
                return w, days[:EXAMPLE_DAYS]
    return None


def seed(conn, *, curate: bool = True) -> dict:
    """Load the demo once. `curate` rounds it out like the demo_curate operation (app/curate.py) does on the live
    database, so a fresh database and the curated live one look the same; tests of the older seed turn it off."""
    creds = {"admin": ("admin.demo", DEMO_PASSWORD), "manager": ("manager.demo", DEMO_PASSWORD),
             "employee": ("employee.demo", DEMO_PASSWORD), "executive": (EXECUTIVE[0], DEMO_PASSWORD),
             "public_admin": (PUBLIC_ADMIN[0], DEMO_PASSWORD)}
    if query_one(conn, "SELECT 1 AS ok FROM users WHERE username = 'admin.demo'"):
        return creds
    with transaction(conn):
        _load(conn)
        if curate:
            from app.curate import curate as curate_plan  # app.curate reads this module's lists

            curate_plan(conn, datetime.now(timezone.utc).date(), audit=False, archive_test_items=False)
        beacon = query_one(conn, "SELECT id FROM projects WHERE name = :n", n=PULL_PROJECT)
        arrange_beacon_board(conn, beacon["id"])
        # After the curation, so the plan's steps get their details and the paid week holds all its hours.
        _demo_workflow(conn, {key: [] for key in WORKFLOW_KEYS}, lambda item, reason: None)
        _demo_hr_submission(conn)
        _demo_time_tracking(conn, {key: [] for key in TIME_TRACKING_KEYS}, lambda item, reason: None)
        _demo_change_request(conn, {"change_requests_created": []}, lambda item, reason: None)
        mark_flags_live(conn)
    return creds


def rotate_unpublished(conn) -> int:
    """Give every seeded account that isn't a published demo login (or admin.demo) a random password.

    Run once on the public site: the demo data shares one known password, and team lists show usernames.
    """
    import secrets

    names = [u for u, *_ in PEOPLE if u not in PUBLISHED_DEMO and u != "admin.demo"]
    with transaction(conn):
        for username in names:
            conn.run("UPDATE users SET password_hash = :h WHERE username = :u",
                     h=hash_password(secrets.token_urlsafe(24)), u=username)
    return len(names)


def create_admins(conn, users: list[dict]) -> dict:
    """Add ready-to-use admin logins with random passwords; usernames that already exist are skipped.

    For the operator only: reachable through an IAM-authorized direct invoke, never the public URL.
    """
    from app.security import generate_temp_password

    created, skipped = [], []
    with transaction(conn):
        for u in users:
            username = u["username"]
            if query_one(conn, "SELECT 1 AS ok FROM users WHERE username = :u", u=username):
                skipped.append(username)
                continue
            password = generate_temp_password()
            conn.run("""
                INSERT INTO users (username, email, first_name, last_name, job_title, role, salary,
                                   password_hash, must_change_password)
                VALUES (:u, :e, :f, :l, 'Demo administrator', 'admin', 0, :h, false)""",
                     u=username, e=f"{username}@acme.example", f=u["first_name"], l=u["last_name"],
                     h=hash_password(password))
            created.append({"username": username, "password": password})
    return {"created": created, "skipped": skipped}


def _insert_executive(conn, password_hash: str, department_id) -> dict:
    username, first, last, title, salary, _ = EXECUTIVE
    return query_one(conn, """
        INSERT INTO users (username, email, first_name, last_name, job_title, role, salary, password_hash,
                           must_change_password, department_id)
        VALUES (:u, :e, :f, :l, :t, 'executive', :s, :h, false, CAST(:d AS uuid)) RETURNING *""",
        u=username, e=f"{username}@acme.example", f=first, l=last, t=title, s=salary, h=password_hash,
        d=str(department_id) if department_id else None)


def _insert_public_admin(conn, password_hash: str, department_id) -> dict:
    username, first, last, title, salary, _ = PUBLIC_ADMIN
    return query_one(conn, """
        INSERT INTO users (username, email, first_name, last_name, job_title, role, salary, password_hash,
                           must_change_password, department_id, is_public_demo)
        VALUES (:u, :e, :f, :l, :t, 'admin', :s, :h, false, CAST(:d AS uuid), true) RETURNING *""",
        u=username, e=f"{username}@acme.example", f=first, l=last, t=title, s=salary, h=password_hash,
        d=str(department_id) if department_id else None)


def demo_backfill(conn) -> dict:
    """Bring demo data seeded before departments, pull mode, difficulty, the executive role and priority up to
    today's seed, filling blanks only.

    Departments are reused (any case) or created; a demo person or project gets the seed's department only while
    it has none; Beacon switches to pull only while it's still on the 'push' default; a demo milestone gets the
    seed's difficulty and priority, each only while it's still 'medium'; executive.demo is created (published demo password) only
    if that username doesn't exist yet, or renamed to today's seed name (Moataz Hikal, Executive Sponsor) only while it
    still has the old seed name Eve Executive (its job title too, only while it's still the old one), and so is the public demo admin demo.admin (published password,
    is_public_demo; an existing demo.admin that isn't flagged is left alone and listed under skipped); the demo
    message thread and Schema Mapping discussion are added only while there are no conversations at all; Beacon's
    planning board is laid out as BEACON_BOARD only while Beacon is still planned, its plan isn't finalized and
    nobody has arranged it (every card in Scheduled, no plan_order audited); skills, milestone objectives, criteria
    and required skills (the seed's own and every department-plan step by name), the Schema Mapping progress
    update and resolved kickback fill blanks only (see _demo_workflow); the demo HR submission is added only while
    there is none; hour tracking fills blanks on pending hours only (see _demo_time_tracking: work notes and
    tracked hours on Gia's pending entries, and one flagged pending example while there is none); one pending change
    request on timer hours from Eli only while there is no change request at all (see _demo_change_request). Assignees and
    approved, rejected or HR-submitted hours are never touched. Safe to run again.
    For the operator only: reachable through an IAM-authorized direct invoke, never the public URL.
    """
    out = {"departments_created": [], "users_created": [], "users_updated": [], "projects_updated": [],
           "work_mode_updated": [], "difficulties_updated": [], "priorities_updated": [], "plan_board_arranged": [],
           "conversations_created": [], **{key: [] for key in WORKFLOW_KEYS}, "hr_submissions_created": [], "requests_updated": [],
           "users_renamed": [], **{key: [] for key in TIME_TRACKING_KEYS}, "change_requests_created": [],
           "already_set": 0, "skipped": []}

    def skip(item: str, reason: str) -> None:
        """Values already there are only counted; anything the operator may want to look at is listed."""
        if reason == "already_set":
            out["already_set"] += 1
        else:
            out["skipped"].append({"item": item, "reason": reason})

    with transaction(conn):
        departments: dict[str, str] = {}
        for name in DEPARTMENTS:
            row = query_one(conn, "SELECT id, is_archived FROM departments WHERE lower(name) = lower(:n)", n=name)
            if row and row["is_archived"]:
                skip(f"department {name}", "archived")
                continue
            if not row:
                row = query_one(conn, "INSERT INTO departments (name) VALUES (:n) RETURNING id", n=name)
                out["departments_created"].append(name)
            departments[name] = str(row["id"])

        def fill_department(table: str, key: str, value: str, label: str, department: str, updated: list) -> None:
            active = " AND NOT is_archived" if table == "projects" else ""
            row = query_one(conn, f"SELECT id, department_id FROM {table} WHERE {key} = :v{active}", v=value)
            if not row:
                skip(label, "missing")
            elif row["department_id"] is not None:
                skip(label, "already_set")
            elif department not in departments:
                skip(label, "department_archived")
            else:
                conn.run(f"UPDATE {table} SET department_id = CAST(:d AS uuid), updated_at = now() WHERE id = :i",
                         d=departments[department], i=row["id"])
                updated.append(value)

        for department, usernames in DEPARTMENTS.items():
            for username in usernames:
                fill_department("users", "username", username, f"user {username}", department, out["users_updated"])
        for name, department in PROJECT_DEPARTMENTS.items():
            fill_department("projects", "name", name, f"project {name}", department, out["projects_updated"])

        executive = query_one(conn, """SELECT id, first_name, last_name, job_title FROM users
                                       WHERE lower(username) = lower(:u)""", u=EXECUTIVE[0])
        if executive and (executive["first_name"], executive["last_name"]) == EXECUTIVE_OLD_NAME[:2]:
            # Still the old seed's name: give it today's. A name or title anyone chose stays; role and password too.
            title = EXECUTIVE[3] if executive["job_title"] in ("", EXECUTIVE_OLD_NAME[2]) else executive["job_title"]
            conn.run("""UPDATE users SET first_name = :f, last_name = :l, job_title = :t, updated_at = now()
                        WHERE id = :i""", f=EXECUTIVE[1], l=EXECUTIVE[2], t=title, i=executive["id"])
            out["users_renamed"].append(EXECUTIVE[0])
        elif executive:
            skip(f"user {EXECUTIVE[0]}", "already_set")  # whatever its name, role or password now, it stays as it is
        else:
            _insert_executive(conn, hash_password(DEMO_PASSWORD), departments.get(EXECUTIVE[5]))
            out["users_created"].append(EXECUTIVE[0])

        public_admin = query_one(conn, "SELECT is_public_demo FROM users WHERE lower(username) = lower(:u)",
                                 u=PUBLIC_ADMIN[0])
        if public_admin is None:
            _insert_public_admin(conn, hash_password(DEMO_PASSWORD), departments.get(PUBLIC_ADMIN[5]))
            out["users_created"].append(PUBLIC_ADMIN[0])
        elif public_admin["is_public_demo"]:
            skip(f"user {PUBLIC_ADMIN[0]}", "already_set")
        else:
            # Someone made an ordinary account with this name: never publish its password by flagging it.
            skip(f"user {PUBLIC_ADMIN[0]}", "exists_not_public_demo")

        beacon = query_one(conn, "SELECT id, work_mode FROM projects WHERE name = :n AND NOT is_archived",
                           n=PULL_PROJECT)
        if not beacon:
            skip(f"{PULL_PROJECT} work mode", "missing")
        elif beacon["work_mode"] != "push":
            skip(f"{PULL_PROJECT} work mode", "already_set")
        else:
            conn.run("UPDATE projects SET work_mode = 'pull', updated_at = now() WHERE id = :i", i=beacon["id"])
            out["work_mode_updated"].append(PULL_PROJECT)
        if beacon:
            # Pull mode leaves assignments alone, so Design is claimable only if nobody was put on it meanwhile.
            design = query_one(conn, """
                SELECT m.status::text AS status,
                       (SELECT count(*) FROM milestone_assignees a WHERE a.milestone_id = m.id) AS n
                FROM milestones m WHERE m.project_id = :p AND m.name = :n AND NOT m.is_archived""",
                               p=beacon["id"], n=CLAIMABLE_MILESTONE)
            label = f"{PULL_PROJECT} / {CLAIMABLE_MILESTONE}"
            if not design:
                skip(label, "missing")
            elif design["n"]:
                skip(label, "has_assignees")
            elif design["status"] != "not_started":
                skip(label, "already_started")

        for (project, milestone), difficulty in DIFFICULTIES.items():
            label = f"{project} / {milestone}"
            rows = query(conn, """SELECT m.id, m.difficulty FROM milestones m JOIN projects p ON p.id = m.project_id
                                  WHERE p.name = :p AND NOT p.is_archived AND m.name = :m AND NOT m.is_archived""",
                         p=project, m=milestone)
            if not rows:
                skip(label, "missing")
            elif all(r["difficulty"] != "medium" for r in rows):
                skip(label, "already_set")
            else:
                conn.run("""UPDATE milestones SET difficulty = :d, updated_at = now()
                            WHERE id = ANY(:ids) AND difficulty = 'medium'""",
                         d=difficulty, ids=[r["id"] for r in rows if r["difficulty"] == "medium"])
                out["difficulties_updated"].append(label)

        for (project, milestone), priority in PRIORITIES.items():
            label = f"{project} / {milestone}"
            rows = query(conn, """SELECT m.id, m.priority FROM milestones m JOIN projects p ON p.id = m.project_id
                                  WHERE p.name = :p AND NOT p.is_archived AND m.name = :m AND NOT m.is_archived""",
                         p=project, m=milestone)
            if not rows:
                skip(label, "missing")
            elif all(r["priority"] != "medium" for r in rows):
                skip(label, "already_set")
            else:
                conn.run("""UPDATE milestones SET priority = :pr, updated_at = now()
                            WHERE id = ANY(:ids) AND priority = 'medium'""",
                         pr=priority, ids=[r["id"] for r in rows if r["priority"] == "medium"])
                out["priorities_updated"].append(label)

        # Beacon's planning board, only while Beacon is still being planned and nobody has arranged it yet: every
        # card still in Scheduled (where migration 010 puts existing milestones) and no plan_order in the audit log.
        plan = query_one(conn, """SELECT id, status::text AS status, plan_finalized_at FROM projects
                                  WHERE name = :n AND NOT is_archived""", n=PULL_PROJECT)
        label = f"{PULL_PROJECT} plan"
        if not plan:
            skip(label, "missing")
        elif plan["status"] != "planned" or plan["plan_finalized_at"] is not None:
            skip(label, "plan_closed")
        elif query_one(conn, """SELECT 1 AS ok FROM milestones WHERE project_id = :p AND NOT is_archived
                                AND plan_column <> 'scheduled' LIMIT 1""", p=plan["id"]) or \
                query_one(conn, """SELECT 1 AS ok FROM audit_log WHERE entity_type = 'project' AND action = 'plan_order'
                                   AND entity_id = :p LIMIT 1""", p=str(plan["id"])):
            out["already_set"] += 1
        else:
            moved = arrange_beacon_board(conn, plan["id"])
            if moved:
                out["plan_board_arranged"] = moved
            else:
                out["already_set"] += 1

        # The demo messages, only while nobody has written anything yet.
        if query_one(conn, "SELECT 1 AS ok FROM conversations LIMIT 1"):
            skip("demo messages", "already_set")
        else:
            created, why_not = _demo_messages(conn)
            if why_not:
                skip("demo messages", why_not)
            out["conversations_created"] = created

        _demo_workflow(conn, out, skip)

        # The pending demo request gets Technology (so approving it offers the template) only while it has none.
        request = query_one(conn, """SELECT r.id, r.department_id FROM project_requests r JOIN users u ON u.id = r.requested_by
                                     WHERE r.name = :n AND r.status = 'pending' AND u.username = 'manager.demo'
                                     ORDER BY r.created_at LIMIT 1""", n=DEMO_REQUEST)
        tech = query_one(conn, "SELECT id FROM departments WHERE lower(name) = 'technology' AND NOT is_archived")
        if not request or not tech:
            skip(f"request {DEMO_REQUEST}", "missing")
        elif request["department_id"] is not None:
            out["already_set"] += 1
        else:
            conn.run("UPDATE project_requests SET department_id = :d, updated_at = now() WHERE id = :i",
                     d=tech["id"], i=request["id"])
            out["requests_updated"].append(DEMO_REQUEST)

        added, why_not = _demo_hr_submission(conn)
        if added:
            out["hr_submissions_created"].append(added)
        elif why_not == "already_set":
            out["already_set"] += 1
        else:
            skip("HR submission", why_not)

        _demo_time_tracking(conn, out, skip)
        _demo_change_request(conn, out, skip)
    return out


def _load(conn) -> None:
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    pw_hash = hash_password(DEMO_PASSWORD)  # one hash for every demo account keeps seeding fast
    people: dict[str, dict] = {}
    departments = {name: query_one(conn, "INSERT INTO departments (name) VALUES (:n) RETURNING id", n=name)["id"]
                   for name in DEPARTMENTS}
    department_of = {username: departments[name] for name, members in DEPARTMENTS.items() for username in members}

    for username, first, last, role, title, salary, reports_to in PEOPLE:
        people[username] = query_one(conn, """
            INSERT INTO users (username, email, first_name, last_name, job_title, role, salary,
                               manager_id, password_hash, must_change_password, department_id, tracks_own_hours)
            VALUES (:u, :e, :f, :l, :t, CAST(:r AS user_role), :s, CAST(:m AS uuid), :h, false, :dept, :tracks)
            RETURNING *""", u=username, e=f"{username}@acme.example", f=first, l=last, t=title, r=role,
            s=salary, m=str(people[reports_to]["id"]) if reports_to else None, h=pw_hash,
            dept=department_of[username], tracks=role == "employee")  # no demo manager or admin logs hours
    people[EXECUTIVE[0]] = _insert_executive(conn, pw_hash, departments[EXECUTIVE[5]])
    people[PUBLIC_ADMIN[0]] = _insert_public_admin(conn, pw_hash, departments[PUBLIC_ADMIN[5]])

    def d(days: int) -> date:
        return today + timedelta(days=days)

    def project(name, manager, status, start, end, budget, description, completed=False):
        return query_one(conn, """
            INSERT INTO projects (name, description, start_date, predicted_end_date, budget, status,
                                  manager_id, created_by, completed_at, department_id, work_mode)
            VALUES (:n, :desc, :s, :e, :b, CAST(:st AS project_status), :m, :c,
                    CASE WHEN :done THEN now() - interval '30 days' END, :dept, :mode)
            RETURNING *""", n=name, desc=description, s=start, e=end, b=Decimal(budget), st=status,
            m=people[manager]["id"], c=people["admin.demo"]["id"], done=completed,
            dept=departments[PROJECT_DEPARTMENTS[name]], mode="pull" if name == PULL_PROJECT else "push")

    def milestone(proj, name, start, end, status, description=""):
        return query_one(conn, """
            INSERT INTO milestones (project_id, name, description, start_date, end_date, status, completed_at,
                                    difficulty, priority)
            VALUES (:p, :n, :desc, :s, :e, CAST(:st AS milestone_status),
                    CASE WHEN :st = 'completed' THEN now() END, :dif, :pr)
            RETURNING *""", p=proj["id"], n=name, desc=description, s=start, e=end, st=status,
            dif=DIFFICULTIES.get((proj["name"], name), "medium"), pr=PRIORITIES.get((proj["name"], name), "medium"))

    def member(proj, username, hours):
        conn.run("INSERT INTO project_members (project_id, user_id, planned_hours_per_week) VALUES (:p, :u, :h)",
                 p=proj["id"], u=people[username]["id"], h=Decimal(hours))

    def assign(ms, *usernames):
        for username in usernames:
            conn.run("INSERT INTO milestone_assignees (milestone_id, user_id) VALUES (:m, :u)",
                     m=ms["id"], u=people[username]["id"])

    def depends(ms, *preds):
        for pred in preds:
            conn.run("INSERT INTO milestone_dependencies (milestone_id, depends_on_id) VALUES (:m, :p)",
                     m=ms["id"], p=pred["id"])

    def log(username, proj, ms, day, hours, status="approved", *, over_40=False, reason=None):
        if not (proj["start_date"] <= day <= proj["predicted_end_date"]):
            return
        user = people[username]
        approver = people["admin.demo"] if status != "pending" else None
        conn.run("""
            INSERT INTO time_entries (user_id, milestone_id, project_id, work_date, hours, status, over_40,
                                      hourly_rate, decided_by, decided_at, rejection_reason)
            VALUES (:u, :m, :p, :d, :h, CAST(:st AS entry_status), :o, :rate, :by,
                    CASE WHEN :st <> 'pending' THEN now() END, :reason)""",
                 u=user["id"], m=ms["id"], p=proj["id"], d=day, h=Decimal(hours), st=status, o=over_40,
                 rate=hourly_rate(user["salary"]) if status == "approved" else None,
                 by=approver["id"] if approver else None, reason=reason)

    # 1. Healthy active project with a three-step dependency chain.
    apollo = project("Apollo Data Migration", "manager.demo", "active", d(-90), d(75), 250000,
                     "Move customer records from the legacy warehouse to the new platform.")
    discovery = milestone(apollo, "Discovery", d(-90), d(-60), "completed", "Inventory every legacy table.")
    mapping = milestone(apollo, "Schema Mapping", d(-59), d(10), "in_progress", "Map legacy fields to the new model.")
    cutover = milestone(apollo, "Cutover", d(11), d(60), "not_started", "Switch traffic to the new platform.")
    depends(mapping, discovery)
    depends(cutover, mapping)
    for username, hours in (("employee.demo", 30), ("ana.ruiz", 20), ("ben.okafor", 20), ("chloe.park", 15)):
        member(apollo, username, hours)
    assign(discovery, "chloe.park", "employee.demo")
    assign(mapping, "employee.demo", "ana.ruiz", "ben.okafor")
    # Cutover is left unassigned: completing Schema Mapping auto-assigns it (it needs Backend Development or DevOps).

    # 2. At-risk project: past its predicted end with an overdue milestone.
    atlas = project("Atlas Customer Portal", "riley.chen", "active", d(-120), d(-4), 60000,
                    "Self-service portal for customer account changes.")
    requirements = milestone(atlas, "Requirements", d(-120), d(-90), "completed")
    build = milestone(atlas, "Build", d(-89), d(-8), "in_progress")
    launch = milestone(atlas, "Launch", d(-7), d(-4), "not_started")
    depends(build, requirements)
    depends(launch, build)
    for username, hours in (("dev.patel", 30), ("emma.stone", 30), ("employee.demo", 10), ("finn.walsh", 20)):
        member(atlas, username, hours)
    assign(build, "dev.patel", "emma.stone", "employee.demo")
    assign(launch, "finn.walsh")

    # 3-5. Planned, on hold and completed projects. Beacon works in pull mode: its team claims the milestones.
    beacon = project("Beacon Mobile App", "manager.demo", "planned", d(20), d(200), 90000,
                     "Native mobile app for field teams.")
    design = milestone(beacon, "Design", d(20), d(60), "not_started")
    prototype = milestone(beacon, "Prototype", d(61), d(120), "not_started")
    depends(prototype, design)
    member(beacon, "gia.rossi", 20)
    member(beacon, "hugo.lee", 20)
    assign(prototype, "hugo.lee")
    cobalt = project("Cobalt Infrastructure Upgrade", "riley.chen", "on_hold", d(-30), d(120), 150000,
                     "Replace end-of-life network hardware.")
    assessment = milestone(cobalt, "Assessment", d(-30), d(10), "in_progress")
    for username in ("isla.nguyen", "jack.brown", "finn.walsh"):
        member(cobalt, username, 20)
    assign(assessment, "isla.nguyen", "jack.brown")
    delta = project("Delta Compliance Audit", "manager.demo", "completed", d(-200), d(-30), 40000,
                    "Annual controls audit.", completed=True)
    audit = milestone(delta, "Audit Fieldwork", d(-200), d(-30), "completed")
    member(delta, "kira.sato", 20)
    member(delta, "leo.martin", 20)
    assign(audit, "kira.sato", "leo.martin")

    # Approved history for the last four complete weeks (feeds budgets and the forecast).
    for week in range(1, 5):
        start = monday - timedelta(weeks=week)
        for offset in WEEKDAYS:
            day = start + timedelta(days=offset)
            log("employee.demo", apollo, mapping, day, 6)
            log("employee.demo", atlas, build, day, 2)
            log("ana.ruiz", apollo, mapping, day, 4)
            log("ben.okafor", apollo, mapping, day, 4)
            log("dev.patel", atlas, build, day, 6)
            log("emma.stone", atlas, build, day, 6)
            log("isla.nguyen", cobalt, assessment, day, 4)

    # One rejected entry with a reason the employee can see.
    rejected_day = monday - timedelta(days=3)
    conn.run("DELETE FROM time_entries WHERE user_id = :u AND milestone_id = :m AND work_date = :d",
             u=people["ana.ruiz"]["id"], m=mapping["id"], d=rejected_day)
    log("ana.ruiz", apollo, mapping, rejected_day, 4, "rejected",
        reason="Logged to the wrong milestone. Please move these hours to Discovery.")

    # Smart insights: a second rejection for Ana (a pattern) and last week's hours still awaiting approval.
    for username, day, status, reason in (
            ("ana.ruiz", monday - timedelta(days=10), "rejected", "Duplicate of hours already logged that day."),
            ("ben.okafor", monday - timedelta(days=4), "pending", None)):
        conn.run("DELETE FROM time_entries WHERE user_id = :u AND milestone_id = :m AND work_date = :d",
                 u=people[username]["id"], m=mapping["id"], d=day)
        log(username, apollo, mapping, day, 4, status, reason=reason)

    # This week: Eli logs 9h a day, so Friday crosses 40h and the manager is alerted once.
    total = Decimal(0)
    for offset in WEEKDAYS:
        before, total = total, total + 9
        log("employee.demo", apollo, mapping, monday + timedelta(days=offset), 9, "pending",
            over_40=total > 40)
        if before <= 40 < total:
            eli = people["employee.demo"]
            conn.run("""INSERT INTO notifications (recipient_id, type, subject_user_id, week_start, payload)
                        VALUES (:r, 'OVER_40H', :s, :w, CAST(:p AS jsonb))""",
                     r=people["manager.demo"]["id"], s=eli["id"], w=monday,
                     p=f'{{"name": "{eli["first_name"]} {eli["last_name"]}", "week_total": {total}}}')
    log("ben.okafor", apollo, mapping, monday, 4, "pending")

    # A project request waiting for an admin, in Technology so approving it offers that department's template.
    conn.run("""INSERT INTO project_requests (requested_by, name, description, proposed_start, proposed_end,
                                              proposed_budget, department_id)
                VALUES (:u, :n, 'Executive reporting on delivery health.', :s, :e, 75000, :dept)""",
             u=people["manager.demo"]["id"], n=DEMO_REQUEST, s=d(30), e=d(150), dept=departments["Technology"])

    _demo_messages(conn)
