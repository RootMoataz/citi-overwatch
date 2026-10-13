"""Load demo data into a local database: python scripts/seed.py --db overwatch_dev"""

import argparse
import json
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
    from app.seed import seed

    db.ensure_database(args.db)
    conn = db.connect()
    apply_migrations(conn)
    print("demo logins:", json.dumps(seed(conn)))


if __name__ == "__main__":
    main()
