"""Department presets: a realistic milestone plan per department, used by the project template and the demo
curation. Pure data and pure functions, no database.

Each step has a weight (its share of the project timeline), an effort estimate in person-hours for a
six-month project (scaled to the dates it actually gets), a difficulty, a priority, the steps it waits for
(`after`) and the skills it needs (job titles, matched against people's titles when someone is picked for it).
Steps that wait for the same steps run in parallel and share their dates. For the milestone workflow each step also
names the catalogue skills it requires (`required`, matched against people's skills when work is auto-routed) and
its completion criteria (one line each); its objective is the description.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

REFERENCE_DAYS = 182  # the project length the step estimates are written for (26 weeks)


@dataclass(frozen=True)
class Step:
    name: str
    description: str
    weight: int
    hours: int  # expected person-hours when the project runs REFERENCE_DAYS
    difficulty: str
    priority: str
    after: tuple[str, ...]
    skills: tuple[str, ...]
    required: tuple[str, ...] = ()  # catalogue skills (skills table) someone needs to be routed to it
    criteria: tuple[str, ...] = ()  # completion criteria, one checklist line each


PRESETS: dict[str, tuple[Step, ...]] = {
    # Software delivery, with the backend and frontend built side by side.
    "Technology": (
        Step("Discovery & requirements", "Agree the scope, user needs and acceptance criteria with the business.",
             12, 80, "easy", "medium", (), ("Business Analyst", "Software Engineer"),
             required=("Business Analysis",),
             criteria=(
                 "Scope and out-of-scope items agreed with the business",
                 "User needs and journeys written down",
                 "Acceptance criteria signed off",
             )),
        Step("Solution architecture", "Design the target architecture, data model and integration approach.",
             13, 120, "medium", "high", ("Discovery & requirements",), ("Backend Engineer", "Data Engineer", "Software Engineer"),
             required=("Backend Development", "Data Engineering"),
             criteria=(
                 "Target architecture and data model reviewed",
                 "Integration approach agreed for every system touched",
                 "Non-functional requirements set (security, performance)",
             )),
        Step("Build: backend services", "Deliver the services, data pipelines and integrations behind the solution.",
             35, 320, "hard", "high", ("Solution architecture",), ("Backend Engineer", "Data Engineer", "Software Engineer"),
             required=("Backend Development", "Data Engineering"),
             criteria=(
                 "Services and integrations deployed to the test environment",
                 "Automated tests pass",
                 "Data pipelines reconcile against the source",
             )),
        Step("Build: frontend", "Deliver the screens people use, built against the agreed designs.",
             35, 240, "medium", "medium", ("Solution architecture",), ("Frontend Engineer", "UX Designer", "Mobile Engineer"),
             required=("Frontend Development", "UI/UX Design"),
             criteria=(
                 "Screens built to the agreed designs",
                 "Accessibility checks pass",
                 "Works against the real services in test",
             )),
        Step("QA & user acceptance testing", "Prove the solution works end to end and get the business to sign it off.",
             15, 160, "medium", "high", ("Build: backend services", "Build: frontend"), ("QA Engineer", "Business Analyst"),
             required=("QA", "Business Analysis"),
             criteria=(
                 "Test plan executed end to end",
                 "No open critical or high defects",
                 "Business sign-off on user acceptance testing",
             )),
        Step("Release & cutover", "Deploy to production and move users across with a rollback plan ready.",
             10, 80, "hard", "critical", ("QA & user acceptance testing",), ("DevOps Engineer", "Backend Engineer", "Software Engineer"),
             required=("DevOps", "Backend Development"),
             criteria=(
                 "Release deployed in the agreed window",
                 "Rollback plan rehearsed",
                 "Users moved across and old system read-only",
             )),
        Step("Hypercare", "Support users closely after go-live and fix early issues fast.",
             15, 80, "easy", "medium", ("Release & cutover",), ("Software Engineer", "QA Engineer"),
             required=("Backend Development", "QA"),
             criteria=(
                 "Early issues triaged within a day",
                 "Support handed over to the run team",
                 "Lessons learned recorded",
             )),
    ),
    # An operational rollout: assess, choose, pilot, train, roll out, review.
    "Operations": (
        Step("Current-state assessment", "Map today's processes, tools and pain points with the teams involved.",
             15, 80, "easy", "medium", (), ("Business Analyst", "Cloud Engineer", "Network Engineer"),
             required=("Business Analysis",),
             criteria=(
                 "Current processes and tools mapped",
                 "Pain points ranked with each team",
                 "Baseline measures captured",
             )),
        Step("Vendor & tool selection", "Shortlist, evaluate and choose the vendor or tool that fits the requirements.",
             15, 100, "medium", "high", ("Current-state assessment",), ("Cloud Engineer", "DevOps Engineer", "Business Analyst"),
             required=("DevOps", "Business Analysis"),
             criteria=(
                 "Shortlist evaluated against the requirements",
                 "Costs and contract terms compared",
                 "Choice approved by the sponsor",
             )),
        Step("Pilot rollout", "Run the change with one team first and measure the results.",
             20, 200, "hard", "high", ("Vendor & tool selection",), ("DevOps Engineer", "Frontend Engineer", "Cloud Engineer"),
             required=("DevOps", "Frontend Development"),
             criteria=(
                 "Pilot team live on the new way of working",
                 "Results measured against the baseline",
                 "Go or no-go decision recorded",
             )),
        Step("Training & change management", "Prepare guides and train every affected team before the full rollout.",
             15, 120, "medium", "medium", ("Pilot rollout",), ("QA Engineer", "Business Analyst", "Frontend Engineer"),
             required=("Business Analysis", "QA"),
             criteria=(
                 "Guides published for every affected team",
                 "Every team trained",
                 "Support contacts announced",
             )),
        Step("Full rollout", "Roll the change out to every team and retire the old way of working.",
             25, 280, "hard", "critical", ("Training & change management",), ("DevOps Engineer", "Network Engineer", "Cloud Engineer"),
             required=("DevOps",),
             criteria=(
                 "Every team moved across",
                 "Old tools retired",
                 "No open critical incidents",
             )),
        Step("Post-implementation review", "Check the benefits against the business case and record lessons learned.",
             10, 40, "easy", "low", ("Full rollout",), ("Business Analyst", "QA Engineer"),
             required=("Business Analysis", "QA"),
             criteria=(
                 "Benefits checked against the business case",
                 "Lessons learned shared",
                 "Follow-up actions have owners",
             )),
    ),
    # An audit cycle, from scoping to the regulator's sign-off.
    "Risk & Compliance": (
        Step("Scoping & risk assessment", "Set the audit scope and rank the risks that matter most.",
             15, 60, "medium", "high", (), ("Risk Analyst", "Compliance Analyst"),
             required=("Risk Analysis",),
             criteria=(
                 "Audit scope agreed",
                 "Risks ranked by impact and likelihood",
                 "Test plan approved",
             )),
        Step("Control testing (fieldwork)", "Test the key controls and collect evidence for each one.",
             30, 240, "hard", "high", ("Scoping & risk assessment",), ("Compliance Analyst", "Risk Analyst"),
             required=("Compliance", "QA"),
             criteria=(
                 "Every key control tested",
                 "Evidence filed for each test",
                 "Exceptions logged with owners",
             )),
        Step("Findings & draft report", "Write up the findings with ratings and agree the facts with control owners.",
             15, 100, "medium", "medium", ("Control testing (fieldwork)",), ("Compliance Analyst", "Risk Analyst"),
             required=("Compliance", "Risk Analysis"),
             criteria=(
                 "Every finding rated",
                 "Facts agreed with control owners",
                 "Draft report reviewed",
             )),
        Step("Remediation planning", "Agree an owner, actions and a deadline for every finding.",
             15, 80, "medium", "medium", ("Findings & draft report",), ("Risk Analyst", "Compliance Analyst"),
             required=("Risk Analysis",),
             criteria=(
                 "Every finding has an owner, actions and a deadline",
                 "Plan agreed with the business",
                 "Tracking in place",
             )),
        Step("Remediation verification", "Re-test the fixed controls to confirm each finding is closed.",
             15, 100, "medium", "high", ("Remediation planning",), ("Compliance Analyst", "Risk Analyst"),
             required=("Compliance", "QA"),
             criteria=(
                 "Fixed controls re-tested",
                 "Evidence of each fix filed",
                 "Closed findings confirmed",
             )),
        Step("Regulatory sign-off", "Present the final report and get sign-off from the regulator and the board.",
             10, 40, "easy", "critical", ("Remediation verification",), ("Compliance Analyst", "Risk Analyst"),
             required=("Compliance",),
             criteria=(
                 "Final report issued",
                 "Board and regulator sign-off recorded",
                 "Open items handed to the next cycle",
             )),
    ),
}

# Existing milestone names (normalized) that already stand for a preset step, so the curation keeps them and adds
# only what's missing around them. Never used to rename anything.
ALIASES: dict[str, dict[str, str]] = {
    "Technology": {
        "discovery": "Discovery & requirements", "requirements": "Discovery & requirements",
        "design": "Solution architecture", "architecture": "Solution architecture",
        "solution design": "Solution architecture",
        "build": "Build: backend services", "development": "Build: backend services",
        "schema mapping": "Build: backend services", "data migration": "Build: backend services",
        "prototype": "Build: frontend", "frontend": "Build: frontend", "ui build": "Build: frontend",
        "testing": "QA & user acceptance testing", "qa": "QA & user acceptance testing",
        "uat": "QA & user acceptance testing", "user acceptance testing": "QA & user acceptance testing",
        "cutover": "Release & cutover", "release": "Release & cutover", "launch": "Release & cutover",
        "go live": "Release & cutover", "deployment": "Release & cutover",
        "support": "Hypercare", "warranty": "Hypercare",
    },
    "Operations": {
        "assessment": "Current-state assessment", "requirements": "Current-state assessment",
        "current state": "Current-state assessment",
        "vendor selection": "Vendor & tool selection", "tool selection": "Vendor & tool selection",
        "procurement": "Vendor & tool selection",
        "pilot": "Pilot rollout", "training": "Training & change management",
        "change management": "Training & change management",
        "launch": "Full rollout", "rollout": "Full rollout", "go live": "Full rollout",
        "review": "Post-implementation review", "lessons learned": "Post-implementation review",
    },
    "Risk & Compliance": {
        "scoping": "Scoping & risk assessment", "planning": "Scoping & risk assessment",
        "risk assessment": "Scoping & risk assessment",
        "audit fieldwork": "Control testing (fieldwork)", "fieldwork": "Control testing (fieldwork)",
        "control testing": "Control testing (fieldwork)",
        "findings": "Findings & draft report", "draft report": "Findings & draft report",
        "reporting": "Findings & draft report",
        "remediation": "Remediation planning",
        "sign off": "Regulatory sign-off", "final report": "Regulatory sign-off",
    },
}


def normalize(name: str) -> str:
    """Lower case, '&' and punctuation dropped, single spaces: "QA &  User-Acceptance" -> "qa user acceptance"."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split())


def department_key(department: str | None) -> str | None:
    """The preset's own spelling of a department name given in any case, or None."""
    wanted = normalize(department or "")
    return next((key for key in PRESETS if normalize(key) == wanted), None) if wanted else None


def preset_for(department: str | None) -> tuple[Step, ...] | None:
    """The department's steps (any case), or None when it has no preset."""
    key = department_key(department)
    return PRESETS[key] if key else None


def match_step(department: str, milestone_name: str) -> Step | None:
    """The preset step an existing milestone stands for: same name, or a known alias. None if neither."""
    key = department_key(department)
    if not key:
        return None
    wanted = normalize(milestone_name)
    by_name = {normalize(s.name): s for s in PRESETS[key]}
    if wanted in by_name:
        return by_name[wanted]
    alias = ALIASES[key].get(wanted)
    return by_name[normalize(alias)] if alias else None


def step_named(department: str | None, milestone_name: str) -> Step | None:
    """The department's step with exactly this name (any case and punctuation), or None. Aliases don't count."""
    steps = preset_for(department) or ()
    wanted = normalize(milestone_name)
    return next((s for s in steps if normalize(s.name) == wanted), None)


def stages(steps) -> list[list[Step]]:
    """Steps grouped by how deep they sit in the dependency chain; a group's steps run in parallel."""
    depth: dict[str, int] = {}
    for step in steps:  # the presets list every step after the steps it waits for
        depth[step.name] = 1 + max((depth[p] for p in step.after), default=-1)
    out: list[list[Step]] = [[] for _ in range(max(depth.values()) + 1)]
    for step in steps:
        out[depth[step.name]].append(step)
    return out


def distribute(start: date, end: date, weights: list[int]) -> list[tuple[date, date]]:
    """Split start..end (inclusive) into back-to-back spans sized by weight, each at least one day long."""
    days = (end - start).days + 1
    if days < len(weights) or not weights:
        raise ValueError("not enough days for every step")
    spare, total = days - len(weights), sum(weights)
    exact = [spare * w / total for w in weights]
    lengths = [1 + int(x) for x in exact]
    # Largest remainder: hand the leftover days to the steps that lost most to rounding down.
    for i in sorted(range(len(weights)), key=lambda i: (int(exact[i]) - exact[i], i))[:days - sum(lengths)]:
        lengths[i] += 1
    spans, cursor = [], start
    for length in lengths:
        spans.append((cursor, cursor + timedelta(days=length - 1)))
        cursor += timedelta(days=length)
    return spans


def scaled_estimate(step: Step, days: int) -> Decimal:
    """The step's estimate for `days` calendar days, against the days it gets in a REFERENCE_DAYS project;
    whole hours, at least 1, at most 10,000."""
    reference = REFERENCE_DAYS * step.weight / 100
    return Decimal(min(10000, max(1, round(step.hours * days / reference))))


def plan_for(department: str, start_date: date, end_date: date) -> list[dict]:
    """The department's plan laid over the project's dates: stages back to back, parallel steps sharing dates.
    Raises KeyError for a department without a preset, ValueError when the project is shorter than the stages."""
    steps = preset_for(department)
    if steps is None:
        raise KeyError(department)
    if end_date < start_date:
        raise ValueError("the end date is before the start date")
    groups = stages(steps)
    spans = distribute(start_date, end_date, [max(s.weight for s in group) for group in groups])
    out = []
    for group, (start, end) in zip(groups, spans):
        for step in group:
            out.append({"name": step.name, "description": step.description, "start_date": start, "end_date": end,
                        "difficulty": step.difficulty, "priority": step.priority, "status": "not_started",
                        "estimated_hours": scaled_estimate(step, (end - start).days + 1),
                        "after": list(step.after), "skills": list(step.skills),
                        "objective": step.description, "completion_criteria": "\n".join(step.criteria),
                        "required_skills": list(step.required)})
    return out


def templates() -> list[dict]:
    """Every department's plan for GET /project-templates."""
    return [{"department": department,
             "milestones": [{"name": s.name, "description": s.description, "weight": s.weight,
                             "estimated_hours": s.hours,
                             "difficulty": s.difficulty, "priority": s.priority, "after": list(s.after),
                             "skills": list(s.skills), "required_skills": list(s.required),
                             "completion_criteria": list(s.criteria)} for s in steps]}
            for department, steps in PRESETS.items()]
