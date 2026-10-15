"""Demo data so every dashboard section has something to show (spec §11).

Dates are relative to today, so the demo stays realistic whenever it is loaded.
Running seed() again is a no-op once admin.demo exists.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from app.db import query_one, transaction
from app.rules.overtime import hourly_rate
from app.security import hash_password

DEMO_PASSWORD = "Demo123!"
# Logins published in the README for graders. Their password is public, so locking them out or changing it
# would only let one visitor spoil the demo for everyone else.
PUBLISHED_DEMO = frozenset({"manager.demo", "employee.demo"})
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


def seed(conn) -> dict:
    creds = {"admin": ("admin.demo", DEMO_PASSWORD), "manager": ("manager.demo", DEMO_PASSWORD),
             "employee": ("employee.demo", DEMO_PASSWORD)}
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


def _load(conn) -> None:
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    pw_hash = hash_password(DEMO_PASSWORD)  # one hash for every demo account keeps seeding fast
    people: dict[str, dict] = {}

    for username, first, last, role, title, salary, reports_to in PEOPLE:
        people[username] = query_one(conn, """
            INSERT INTO users (username, email, first_name, last_name, job_title, role, salary,
                               manager_id, password_hash, must_change_password)
            VALUES (:u, :e, :f, :l, :t, CAST(:r AS user_role), :s, CAST(:m AS uuid), :h, false)
            RETURNING *""", u=username, e=f"{username}@acme.example", f=first, l=last, t=title, r=role,
            s=salary, m=str(people[reports_to]["id"]) if reports_to else None, h=pw_hash)

    def d(days: int) -> date:
        return today + timedelta(days=days)

    def project(name, manager, status, start, end, budget, description, completed=False):
        return query_one(conn, """
            INSERT INTO projects (name, description, start_date, predicted_end_date, budget, status,
                                  manager_id, created_by, completed_at)
            VALUES (:n, :desc, :s, :e, :b, CAST(:st AS project_status), :m, :c,
                    CASE WHEN :done THEN now() - interval '30 days' END)
            RETURNING *""", n=name, desc=description, s=start, e=end, b=Decimal(budget), st=status,
            m=people[manager]["id"], c=people["admin.demo"]["id"], done=completed)

    def milestone(proj, name, start, end, status, description="", difficulty="medium"):
        return query_one(conn, """
            INSERT INTO milestones (project_id, name, description, start_date, end_date, status, completed_at,
                                    difficulty)
            VALUES (:p, :n, :desc, :s, :e, CAST(:st AS milestone_status),
                    CASE WHEN :st = 'completed' THEN now() END, :dif)
            RETURNING *""", p=proj["id"], n=name, desc=description, s=start, e=end, st=status, dif=difficulty)

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
    discovery = milestone(apollo, "Discovery", d(-90), d(-60), "completed", "Inventory every legacy table.",
                          "easy")
    mapping = milestone(apollo, "Schema Mapping", d(-59), d(10), "in_progress", "Map legacy fields to the new model.")
    cutover = milestone(apollo, "Cutover", d(11), d(60), "not_started", "Switch traffic to the new platform.",
                        "hard")
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
    requirements = milestone(atlas, "Requirements", d(-120), d(-90), "completed", difficulty="easy")
    build = milestone(atlas, "Build", d(-89), d(-8), "in_progress", difficulty="hard")
    launch = milestone(atlas, "Launch", d(-7), d(-4), "not_started")
    depends(build, requirements)
    depends(launch, build)
    for username, hours in (("dev.patel", 30), ("emma.stone", 30), ("employee.demo", 10), ("finn.walsh", 20)):
        member(atlas, username, hours)
    assign(build, "dev.patel", "emma.stone", "employee.demo")
    assign(launch, "finn.walsh")

    # 3-5. Planned, on hold and completed projects.
    beacon = project("Beacon Mobile App", "manager.demo", "planned", d(20), d(200), 90000,
                     "Native mobile app for field teams.")
    milestone(beacon, "Design", d(20), d(60), "not_started")
    member(beacon, "gia.rossi", 20)
    member(beacon, "hugo.lee", 20)
    cobalt = project("Cobalt Infrastructure Upgrade", "riley.chen", "on_hold", d(-30), d(120), 150000,
                     "Replace end-of-life network hardware.")
    assessment = milestone(cobalt, "Assessment", d(-30), d(10), "in_progress", difficulty="easy")
    for username in ("isla.nguyen", "jack.brown", "finn.walsh"):
        member(cobalt, username, 20)
    assign(assessment, "isla.nguyen", "jack.brown")
    delta = project("Delta Compliance Audit", "manager.demo", "completed", d(-200), d(-30), 40000,
                    "Annual controls audit.", completed=True)
    audit = milestone(delta, "Audit Fieldwork", d(-200), d(-30), "completed", difficulty="hard")
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
