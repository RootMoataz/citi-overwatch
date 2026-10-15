"""Pull mode: may a team member claim this milestone? A pure check of the milestone's facts."""


def claim_blocker(*, work_mode: str, status: str, is_archived: bool, blocked: bool, assignee_count: int) -> str | None:
    """The error code that stops the claim, or None when it can go ahead.

    Claimable means: the project works in pull mode, the milestone is Ready to start (not started, not archived,
    every predecessor completed) and nobody is on it yet.
    """
    if work_mode != "pull":
        return "NOT_PULL_PROJECT"
    if is_archived or status != "not_started" or blocked:
        return "NOT_READY"
    if assignee_count:
        return "ALREADY_CLAIMED"
    return None
