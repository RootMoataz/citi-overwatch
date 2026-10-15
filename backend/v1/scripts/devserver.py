"""Local API server: turns HTTP requests into Lambda Function URL events for function.handler.

    python scripts/devserver.py [--port 3001] [--db overwatch_dev] [--reset] [--seed]
"""

import argparse
import base64
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def build_event(method: str, path: str, headers, body: bytes) -> dict:
    parts = urlsplit(path)
    cookie_header = headers.get("Cookie", "")
    return {
        "version": "2.0",
        "rawPath": parts.path,
        "rawQueryString": parts.query,
        "headers": {k.lower(): v for k, v in headers.items() if k.lower() != "cookie"},
        "cookies": [c.strip() for c in cookie_header.split(";") if c.strip()],
        "body": body.decode("utf-8") if body else None,
        "isBase64Encoded": False,
        "requestContext": {"http": {"method": method}},
    }


def serialized(fn):
    """One request at a time: the app keeps a single database connection, which isn't thread-safe."""
    lock = threading.Lock()

    def run(event, context):
        with lock:
            return fn(event, context)
    return run


def make_handler(lambda_handler):
    lambda_handler = serialized(lambda_handler)

    class Handler(BaseHTTPRequestHandler):
        def _serve(self):
            length = int(self.headers.get("Content-Length") or 0)
            event = build_event(self.command, self.path, self.headers, self.rfile.read(length))
            resp = lambda_handler(event, None)
            self.send_response(resp["statusCode"])
            for key, value in (resp.get("headers") or {}).items():
                self.send_header(key, value)
            for cookie in resp.get("cookies") or []:
                self.send_header("Set-Cookie", cookie)
            # Like a Function URL: binary responses (profile photos) arrive base64-encoded and leave as bytes.
            raw = resp.get("body") or ""
            body = base64.b64decode(raw) if resp.get("isBase64Encoded") else raw.encode("utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _serve

        def log_message(self, fmt, *args):  # the app already logs one JSON line per request
            pass

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="ACME Scout local API server")
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--db", default="overwatch_dev")
    parser.add_argument("--reset", action="store_true", help="drop and re-migrate the database")
    parser.add_argument("--seed", action="store_true", help="load demo data")
    args = parser.parse_args()

    os.environ.setdefault("IS_LOCAL", "true")
    os.environ["POSTGRES_NAME"] = args.db

    import function
    from app import db
    from app.migrate import apply_migrations
    from app.seed import seed

    db.ensure_database(args.db)
    conn = db.connect()
    if args.reset:
        conn.run("DROP SCHEMA public CASCADE")
        conn.run("CREATE SCHEMA public")
    print("migrations applied:", apply_migrations(conn))
    if args.seed:
        print("demo logins:", json.dumps(seed(conn)))

    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(function.handler))
    print(f"API listening on http://localhost:{args.port}/api/v1  (Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
