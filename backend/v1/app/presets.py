"""Department presets: a realistic milestone plan per department, used by the project template and the demo
curation. Pure data and pure functions, no database.

Each step has a weight (its share of the project timeline), a difficulty, a priority, the steps it waits for
(`after`) and the skills it needs (job titles, matched against people's titles when someone is picked for it).
Steps that wait for the same steps run in parallel and share their dates.
"""

import re
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class Step:
    name: str
    description: str
    weight: int
    difficulty: str
    priority: str
    after: tuple[str, ...]
    skills: tuple[str, ...]


PRESETS: dict[str, tuple[Step, ...]] = {
    # Software delivery, with the backend and frontend built side by side.
    "Technology": (
        Step("Discovery & requirements", "Agree the scope, user needs and acceptance criteria with the business.",
             12, "easy", "medium", (), ("Business Analyst", "Software Engineer")),
        Step("Solution architecture", "Design the target architecture, data model and integration approach.",
             13, "medium", "high", ("Discovery & requirements",), ("Backend Engineer", "Data Engineer", "Software Engineer")),
        Step("Build: backend services", "Deliver the services, data pipelines and integrations behind the solution.",
             35, "hard", "high", ("Solution architecture",), ("Backend Engineer", "Data Engineer", "Software Engineer")),
        Step("Build: frontend", "Deliver the screens people use, built against the agreed designs.",
             35, "medium", "medium", ("Solution architecture",), ("Frontend Engineer", "UX Designer", "Mobile Engineer")),
        Step("QA & user acceptance testing", "Prove the solution works end to end and get the business to sign it off.",
             15, "medium", "high", ("Build: backend services", "Build: frontend"), ("QA Engineer", "Business Analyst")),
        Step("Release & cutover", "Deploy to production and move users across with a rollback plan ready.",
             10, "hard", "critical", ("QA & user acceptance testing",), ("DevOps Engineer", "Backend Engineer", "Software Engineer")),
        Step("Hypercare", "Support users closely after go-live and fix early issues fast.",
             15, "easy", "medium", ("Release & cutover",), ("Software Engineer", "QA Engineer")),
    ),
    # An operational rollout: assess, choose, pilot, train, roll out, review.
    "Operations": (
        Step("Current-state assessment", "Map today's processes, tools and pain points with the teams involved.",
             15, "easy", "medium", (), ("Business Analyst", "Cloud Engineer", "Network Engineer")),
        Step("Vendor & tool selection", "Shortlist, evaluate and choose the vendor or tool that fits the requirements.",
             15, "medium", "high", ("Current-state assessment",), ("Cloud Engineer", "DevOps Engineer", "Business Analyst")),
        Step("Pilot rollout", "Run the change with one team first and measure the results.",
             20, "hard", "high", ("Vendor & tool selection",), ("DevOps Engineer", "Frontend Engineer", "Cloud Engineer")),
        Step("Training & change management", "Prepare guides and train every affected team before the full rollout.",
             15, "medium", "medium", ("Pilot rollout",), ("QA Engineer", "Business Analyst", "Frontend Engineer")),
        Step("Full rollout", "Roll the change out to every team and retire the old way of working.",
             25, "hard", "critical", ("Training & change management",), ("DevOps Engineer", "Network Engineer", "Cloud Engineer")),
        Step("Post-implementation review", "Check the benefits against the business case and record lessons learned.",
             10, "easy", "low", ("Full rollout",), ("Business Analyst", "QA Engineer")),
    ),
    # An audit cycle, from scoping to the regulator's sign-off.
    "Risk & Compliance": (
        Step("Scoping & risk assessment", "Set the audit scope and rank the risks that matter most.",
             15, "medium", "high", (), ("Risk Analyst", "Compliance Analyst")),
        Step("Control testing (fieldwork)", "Test the key controls and collect evidence for each one.",
             30, "hard", "high", ("Scoping & risk assessment",), ("Compliance Analyst", "Risk Analyst")),
        Step("Findings & draft report", "Write up the findings with ratings and agree the facts with control owners.",
             15, "medium", "medium", ("Control testing (fieldwork)",), ("Compliance Analyst", "Risk Analyst")),
        Step("Remediation planning", "Agree an owner, actions and a deadline for every finding.",
             15, "medium", "medium", ("Findings & draft report",), ("Risk Analyst", "Compliance Analyst")),
        Step("Remediation verification", "Re-test the fixed controls to confirm each finding is closed.",
             15, "medium", "high", ("Remediation planning",), ("Compliance Analyst", "Risk Analyst")),
        Step("Regulatory sign-off", "Present the final report and get sign-off from the regulator and the board.",
             10, "easy", "critical", ("Remediation verification",), ("Compliance Analyst", "Risk Analyst")),
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
                        "after": list(step.after), "skills": list(step.skills)})
    return out


def templates() -> list[dict]:
    """Every department's plan for GET /project-templates."""
    return [{"department": department,
             "milestones": [{"name": s.name, "description": s.description, "weight": s.weight,
                             "difficulty": s.difficulty, "priority": s.priority, "after": list(s.after),
                             "skills": list(s.skills)} for s in steps]}
            for department, steps in PRESETS.items()]
