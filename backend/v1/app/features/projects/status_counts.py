"""GET /projects/status-counts: how many projects there are in each status, archived ones counted on their own.

For the admin control centre and the executive dashboard, so both roles see every project. An archived project
counts as archived whatever status it had; the live ones count by their status. Registered before the projects
routes so GET /projects/{id} doesn't take "status-counts" for an id."""

from app.db import query
from app.http import json_response
from app.router import router

STATUSES = ("planned", "active", "on_hold", "completed")


def status_counts(conn) -> dict:
    counts = {s: 0 for s in STATUSES} | {"archived": 0}
    for row in query(conn, """SELECT CASE WHEN is_archived THEN 'archived' ELSE status::text END AS bucket,
                                     count(*) AS n
                              FROM projects GROUP BY 1"""):
        counts[row["bucket"]] = int(row["n"])
    return counts | {"total": sum(counts.values())}


@router.route("GET", "/projects/status-counts", roles={"admin", "executive"})
def get_status_counts(req, ctx, conn):
    return json_response(200, status_counts(conn))
