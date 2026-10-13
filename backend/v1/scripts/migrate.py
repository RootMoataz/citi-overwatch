"""Apply migrations to a local database: python scripts/migrate.py --db overwatch_dev"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="overwatch_dev")
    args = parser.parse_args()
    os.environ.setdefault("IS_LOCAL", "true")
    os.environ["POSTGRES_NAME"] = args.db

    from app import db
    from app.migrate import apply_migrations

    db.ensure_database(args.db)
    print("applied:", apply_migrations(db.connect()))


if __name__ == "__main__":
    main()
