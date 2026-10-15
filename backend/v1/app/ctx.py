"""Who is calling: resolve the bearer token into a Ctx, and install the router guard."""

from dataclasses import dataclass
from datetime import datetime, timezone

from app.db import query_one
from app.http import ApiError
from app.security import decode_access_token

_secret: str | None = None


@dataclass(frozen=True)
class Ctx:
    user_id: str
    role: str
    restricted: bool
    request_id: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_manager(self) -> bool:
        return self.role in ("manager", "admin")

    @property
    def is_executive(self) -> bool:
        """Read-only leadership: sees what an admin sees for delivery oversight, never a salary, changes nothing."""
        return self.role == "executive"

    @property
    def sees_all(self) -> bool:
        """Organisation-wide read access: admins and executives."""
        return self.role in ("admin", "executive")


def jwt_secret(conn) -> str:
    global _secret
    if _secret is None:
        row = query_one(conn, "SELECT value FROM app_secrets WHERE name = 'jwt_secret'")
        if not row:
            raise RuntimeError("jwt_secret missing: run migrations first")
        _secret = row["value"]
    return _secret


def authenticate(req, conn_factory) -> Ctx:
    header = req.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "AUTH_REQUIRED", "Authentication required")
    conn = conn_factory()
    claims = decode_access_token(token.strip(), jwt_secret(conn), datetime.now(timezone.utc))
    user = query_one(conn, "SELECT role, is_archived, must_change_password FROM users "
                           "WHERE id = CAST(:id AS uuid)", id=claims["sub"])
    if not user or user["is_archived"]:
        raise ApiError(401, "AUTH_REQUIRED", "Authentication required")
    # Role and the forced-change flag come from the database, so changes apply immediately.
    return Ctx(user_id=claims["sub"], role=user["role"],
               restricted=bool(claims.get("rst")) or user["must_change_password"],
               request_id=req.request_id)


def install(router) -> None:
    router.authenticate = authenticate
