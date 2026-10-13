from app.rules.cycles import creates_cycle, dependency_order

# edges map a milestone to the set of milestones it depends on (its predecessors).
# Chain: A -> B -> C  (B depends on A, C depends on B)
CHAIN = {"B": {"A"}, "C": {"B"}}


def test_cycle_direct_and_indirect():
    assert creates_cycle(CHAIN, "A", {"C"}) is True     # A would depend on C, which needs A
    assert creates_cycle(CHAIN, "A", {"B"}) is True     # direct back-edge
    assert creates_cycle(CHAIN, "D", {"A"}) is False
    assert creates_cycle(CHAIN, "C", {"A"}) is False    # redundant but not a loop


def test_self_dependency_is_cycle():
    assert creates_cycle({}, "A", {"A"}) is True


def test_diamond_shape_is_not_a_cycle():
    # D depends on B and C; both depend on A. A is reached twice while searching.
    diamond = {"B": {"A"}, "C": {"A"}, "D": {"B", "C"}}
    assert creates_cycle(diamond, "E", {"D"}) is False
    assert creates_cycle(diamond, "A", {"D"}) is True


def test_empty_predecessors_never_cycle():
    assert creates_cycle(CHAIN, "A", set()) is False


def test_dependency_order_is_topological():
    assert dependency_order(CHAIN) == ["A", "B", "C"]


def test_dependency_order_ties_are_stable_and_include_isolated():
    edges = {"Z": set(), "Y": set(), "X": {"Y", "Z"}}
    assert dependency_order(edges) == ["Y", "Z", "X"]


def test_dependency_order_ties_use_key():
    # X and Y are both free; the key (e.g. start date) decides, not the id.
    edges = {"X": set(), "Y": set(), "Z": {"X"}}
    starts = {"X": 2, "Y": 1, "Z": 3}
    assert dependency_order(edges, key=lambda n: starts[n]) == ["Y", "X", "Z"]


def test_dependency_order_tolerates_a_cycle():
    order = dependency_order({"A": {"B"}, "B": {"A"}})
    assert sorted(order) == ["A", "B"]
