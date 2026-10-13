"""Milestone dependency graph checks. edges: milestone id -> set of predecessor ids."""


def creates_cycle(edges: dict[str, set[str]], milestone_id: str, predecessors: set[str]) -> bool:
    """True if making milestone_id depend on `predecessors` would form a loop."""
    if milestone_id in predecessors:
        return True
    seen: set[str] = set()
    stack = list(predecessors)
    while stack:
        node = stack.pop()
        if node == milestone_id:
            return True
        if node in seen:
            continue
        seen.add(node)
        stack.extend(edges.get(node, ()))
    return False


def dependency_order(edges: dict[str, set[str]]) -> list[str]:
    """Topological order (predecessors first); ties broken by id for a stable result."""
    nodes = set(edges)
    for preds in edges.values():
        nodes |= set(preds)
    remaining = {n: set(edges.get(n, ())) & nodes for n in nodes}
    order: list[str] = []
    while True:
        ready = sorted(n for n, preds in remaining.items() if not preds)
        if not ready:
            break
        node = ready[0]
        order.append(node)
        del remaining[node]
        for preds in remaining.values():
            preds.discard(node)
    order.extend(sorted(remaining))  # only reachable if the data already holds a loop
    return order
