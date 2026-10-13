import random

from app.rules.usernames import is_valid_username, normalize_username, suggest_usernames


def never_taken(_):
    return False


def test_normalize_trims_and_lowercases():
    assert normalize_username("  JSmith ") == "jsmith"


def test_validity_rules():
    assert is_valid_username("john.smith")
    assert is_valid_username("a_b")
    assert not is_valid_username("ab")              # too short
    assert not is_valid_username("a" * 21)          # too long
    assert not is_valid_username("John")            # uppercase
    assert not is_valid_username("john smith")      # space
    assert not is_valid_username("john-smith")      # dash not allowed


def test_base_forms_in_order():
    assert suggest_usernames("John", "Smith", None, never_taken) == [
        "jsmith", "john.smith", "smithj", "john_smith", "johns"]


def test_suggestions_skip_taken_and_are_valid():
    taken = {"jsmith", "john.smith"}
    result = suggest_usernames("John", "Smith", None, taken.__contains__, rng=random.Random(1))
    assert len(result) == 5
    assert not taken & set(result)
    assert all(is_valid_username(u) for u in result)
    assert len(set(result)) == 5


def test_suggestions_include_typed_when_free():
    taken = {"jsmith", "john.smith", "smithj"}
    result = suggest_usernames("John", "Smith", "J.Smith.Dev", taken.__contains__)
    assert result[:3] == ["john_smith", "johns", "j.smith.dev"]


def test_typed_skipped_when_taken_invalid_or_duplicate():
    taken = {"jsmith", "john.smith", "smithj", "john_smith", "johns", "jsm"}
    rng = random.Random(7)
    assert "jsm" not in suggest_usernames("John", "Smith", "jsm", taken.__contains__, rng=rng)
    assert "x" not in suggest_usernames("John", "Smith", "x", taken.__contains__, rng=rng)
    result = suggest_usernames("John", "Smith", "johns", never_taken)
    assert result.count("johns") == 1


def test_names_with_symbols_and_long_names():
    result = suggest_usernames("Mary-Ann", "O'Neil", None, never_taken)
    assert result[0] == "moneil"
    long = suggest_usernames("Bartholomew", "Featherstonehaugh", None, never_taken)
    assert all(is_valid_username(u) for u in long)


def test_names_without_usable_letters_fall_back():
    result = suggest_usernames("李", "王", None, never_taken, rng=random.Random(3))
    assert len(result) == 5
    assert all(is_valid_username(u) for u in result)


def test_stops_when_everything_is_taken():
    assert suggest_usernames("John", "Smith", None, lambda _: True) == []
