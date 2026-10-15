"""Planning board: the checks a plan must pass before it is finalized (LOGIC_WALKTHROUGH §22).

Pure functions over plain dicts, so the rules are tested without a database. A milestone here has id, name,
plan_column, sequence, start_date, end_date and assignee_count; edges map a milestone id to its predecessors."""

from app.rules.cycles import creates_cycle

COLUMNS = ("backlog", "ready", "scheduled")
COLUMN_LABELS = {"backlog": "Backlog", "ready": "Ready", "scheduled": "Scheduled"}

# code -> what the checklist says when it passes. The order is the checklist's order.
CHECKS = {
    "HAS_SCHEDULED": "At least one milestone is scheduled",
    "ALL_SCHEDULED": "Nothing is left in Backlog or Ready",
    "DATES_IN_RANGE": "Every scheduled milestone has dates inside the project's dates",
    "HAS_ASSIGNEE": "Every scheduled milestone has someone assigned",
    "DEPENDENCIES_VALID": "Dependencies stay inside this project and form no loop",
    "SEQUENCE_MATCHES_DEPENDENCIES": "No milestone is ordered before a milestone it depends on",
}


def in_cycles(edges: dict[str, set[str]]) -> set[str]:
    """The milestones that sit on a dependency loop: those that would close a loop with their own predecessors."""
    out = set()
    for node, preds in edges.items():
        others = {k: v for k, v in edges.items() if k != node}
        if preds and creates_cycle(others, node, set(preds)):
            out.add(node)
    return out


def _problem(m: dict, message: str) -> dict:
    return {"milestone_id": m["id"], "name": m["name"], "message": message}


def plan_checks(milestones: list[dict], edges: dict[str, set[str]], *, project_start, project_end,
                cross_project: set[str]) -> list[dict]:
    """Every check, passing or not, as {code, label, ok, problems: [{milestone_id, name, message}]}.
    `cross_project`: ids of milestones with a dependency on a milestone of another project."""
    by_id = {str(m["id"]): m for m in milestones}
    scheduled = sorted((m for m in milestones if m["plan_column"] == "scheduled"),
                       key=lambda m: (m["sequence"], str(m["id"])))
    problems: dict[str, list[dict]] = {code: [] for code in CHECKS}

    if not scheduled:
        problems["HAS_SCHEDULED"].append({"milestone_id": None, "name": None,
                                          "message": "Move at least one milestone to Scheduled"})
    for m in sorted(milestones, key=lambda m: (COLUMNS.index(m["plan_column"]), m["sequence"], str(m["id"]))):
        if m["plan_column"] != "scheduled":
            problems["ALL_SCHEDULED"].append(_problem(m, f"{m['name']} is still in {COLUMN_LABELS[m['plan_column']]}"))

    loops = in_cycles({k: set(v) for k, v in edges.items()})
    position = {str(m["id"]): m["sequence"] for m in scheduled}
    for m in scheduled:
        mid = str(m["id"])
        if m["start_date"] < project_start or m["end_date"] > project_end or m["end_date"] < m["start_date"]:
            problems["DATES_IN_RANGE"].append(_problem(
                m, f"{m['name']} runs {m['start_date']} to {m['end_date']}, outside {project_start} to {project_end}"))
        if not m["assignee_count"]:
            problems["HAS_ASSIGNEE"].append(_problem(m, f"Nobody is assigned to {m['name']}"))
        if mid in cross_project:
            problems["DEPENDENCIES_VALID"].append(_problem(m, f"{m['name']} depends on a milestone in another project"))
        elif mid in loops:
            problems["DEPENDENCIES_VALID"].append(_problem(m, f"{m['name']} is part of a dependency loop"))
        for pred in sorted(edges.get(mid, ()), key=lambda p: position.get(str(p), 0)):
            pred = str(pred)
            if pred in position and mid not in loops and position[pred] >= position[mid]:
                problems["SEQUENCE_MATCHES_DEPENDENCIES"].append(
                    _problem(m, f"{m['name']} comes before {by_id[pred]['name']}, which it depends on"))

    return [{"code": code, "label": label, "ok": not problems[code], "problems": problems[code]}
            for code, label in CHECKS.items()]
