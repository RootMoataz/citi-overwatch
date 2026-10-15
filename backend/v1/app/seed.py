"""Demo data so every dashboard section has something to show (spec §11).

Dates are relative to today, so the demo stays realistic whenever it is loaded.
Running seed() again is a no-op once admin.demo exists.
"""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query, query_one, transaction
from app.rules.overtime import hourly_rate
from app.security import hash_password

DEMO_PASSWORD = "Demo123!"
# Logins published in the README for graders. Their password is public, so locking them out or changing it
# would only let one visitor spoil the demo for everyone else.
PUBLISHED_DEMO = frozenset({"manager.demo", "employee.demo", "executive.demo"})
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

# The read-only leadership login. Kept out of PEOPLE: it was added after the live demo was seeded, so
# demo_backfill creates it there, and it has no reporting line or project work.
EXECUTIVE = ("executive.demo", "Eve", "Executive", "Chief Delivery Officer", 180000, "Operations")

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

# Beacon is still being planned: besides Design and Prototype (Scheduled) its board holds cards not yet scheduled.
# (name, column, place in the column, first day, last day (days after the project starts), difficulty, priority,
# description). With these left over and Design unassigned, finalizing the plan shows failing checks.
PLAN_CARDS = [
    ("User Research", "backlog", 1, 0, 15, "easy", "high", "Shadow field teams for a day to learn how they work."),
    ("Offline Sync", "backlog", 2, 121, 170, "hard", "critical", "Work without signal and sync when back online."),
    ("Push Notifications", "ready", 1, 100, 140, "medium", "low", "Tell people when a job is assigned to them."),
]


def _plan_card(conn, project: dict, card: tuple) -> None:
    name, column, seq, first, last, difficulty, priority, description = card
    end_limit = project["predicted_end_date"]
    conn.run("""INSERT INTO milestones (project_id, name, description, start_date, end_date, difficulty, priority,
                                        plan_column, sequence)
                VALUES (:p, :n, :desc, :s, :e, :dif, :pr, :col, :seq)""",
             p=project["id"], n=name, desc=description, s=min(project["start_date"] + timedelta(days=first), end_limit),
             e=min(project["start_date"] + timedelta(days=last), end_limit), dif=difficulty, pr=priority, col=column,
             seq=seq)

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


def seed(conn) -> dict:
    creds = {"admin": ("admin.demo", DEMO_PASSWORD), "manager": ("manager.demo", DEMO_PASSWORD),
             "employee": ("employee.demo", DEMO_PASSWORD), "executive": (EXECUTIVE[0], DEMO_PASSWORD)}
    if query_one(conn, "SELECT 1 AS ok FROM users WHERE username = 'admin.demo'"):
        return creds
    with transaction(conn):
        _load(conn)
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


def demo_backfill(conn) -> dict:
    """Bring demo data seeded before departments, pull mode, difficulty, the executive role and priority up to
    today's seed, filling blanks only.

    Departments are reused (any case) or created; a demo person or project gets the seed's department only while
    it has none; Beacon switches to pull only while it's still on the 'push' default; a demo milestone gets the
    seed's difficulty and priority, each only while it's still 'medium'; executive.demo is created (published demo password) only
    if that username doesn't exist yet; the demo message thread and Schema Mapping discussion are added only while
    there are no conversations at all; Beacon's planning cards (PLAN_CARDS) are added one by one, each only while Beacon
    is still planned, its plan isn't finalized and it has no milestone of that name. Assignees and hours are never
    touched. Safe to run again.
    For the operator only: reachable through an IAM-authorized direct invoke, never the public URL.
    """
    out = {"departments_created": [], "users_created": [], "users_updated": [], "projects_updated": [],
           "work_mode_updated": [], "difficulties_updated": [], "priorities_updated": [], "plan_cards_created": [], "conversations_created": [], "already_set": 0,
           "skipped": []}

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

        if query_one(conn, "SELECT 1 AS ok FROM users WHERE lower(username) = lower(:u)", u=EXECUTIVE[0]):
            skip(f"user {EXECUTIVE[0]}", "already_set")  # whatever its role or password now, it stays as it is
        else:
            _insert_executive(conn, hash_password(DEMO_PASSWORD), departments.get(EXECUTIVE[5]))
            out["users_created"].append(EXECUTIVE[0])

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

        # Beacon's planning cards, each only while Beacon is still being planned and has no milestone of that name
        # (archived ones count, so a card someone removed doesn't come back).
        plan = query_one(conn, """SELECT id, name, start_date, predicted_end_date, status::text AS status,
                                         plan_finalized_at FROM projects WHERE name = :n AND NOT is_archived""",
                         n=PULL_PROJECT)
        if not plan:
            skip(f"{PULL_PROJECT} plan", "missing")
        elif plan["status"] != "planned" or plan["plan_finalized_at"] is not None:
            skip(f"{PULL_PROJECT} plan", "plan_closed")
        else:
            for card in PLAN_CARDS:
                label = f"{PULL_PROJECT} / {card[0]}"
                if query_one(conn, "SELECT 1 AS ok FROM milestones WHERE project_id = :p AND name = :n",
                             p=plan["id"], n=card[0]):
                    skip(label, "already_set")
                else:
                    _plan_card(conn, plan, card)
                    out["plan_cards_created"].append(label)

        # The demo messages, only while nobody has written anything yet.
        if query_one(conn, "SELECT 1 AS ok FROM conversations LIMIT 1"):
            skip("demo messages", "already_set")
        else:
            created, why_not = _demo_messages(conn)
            if why_not:
                skip("demo messages", why_not)
            out["conversations_created"] = created
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
                               manager_id, password_hash, must_change_password, department_id)
            VALUES (:u, :e, :f, :l, :t, CAST(:r AS user_role), :s, CAST(:m AS uuid), :h, false, :dept)
            RETURNING *""", u=username, e=f"{username}@acme.example", f=first, l=last, t=title, r=role,
            s=salary, m=str(people[reports_to]["id"]) if reports_to else None, h=pw_hash,
            dept=department_of[username])
    people[EXECUTIVE[0]] = _insert_executive(conn, pw_hash, departments[EXECUTIVE[5]])

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
    assign(cutover, "ben.okafor")

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
    for card in PLAN_CARDS:
        _plan_card(conn, beacon, card)
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

    # A project request waiting for an admin.
    conn.run("""INSERT INTO project_requests (requested_by, name, description, proposed_start, proposed_end,
                                              proposed_budget, reason)
                VALUES (:u, 'Orion Analytics Dashboard', 'Executive reporting on delivery health.',
                        :s, :e, 75000, 'Leadership needs a weekly view of delivery risk.')""",
             u=people["manager.demo"]["id"], s=d(30), e=d(150))

    _demo_messages(conn)
