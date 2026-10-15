"""Request parsing, the error envelope and Lambda Function URL responses."""

import base64
import json
import re
import uuid
from decimal import Decimal
from datetime import date, datetime
from urllib.parse import parse_qsl

API_PREFIX = "/api/v1"
REQUEST_ID_RE = re.compile(r"[A-Za-z0-9-]{1,64}")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _default(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def json_response(status: int, body=None, *, headers: dict | None = None,
                  cookies: list[str] | None = None) -> dict:
    resp = {"statusCode": status, "headers": {"content-type": "application/json", **(headers or {})}}
    if body is not None:
        resp["body"] = json.dumps(body, default=_default)
    if cookies:
        resp["cookies"] = cookies
    return resp


def binary_response(body: bytes, *, content_type: str, status: int = 200, headers: dict | None = None) -> dict:
    """Raw bytes for a Function URL: base64 in the body with isBase64Encoded, which Lambda decodes for the client.
    The browser must take the bytes as exactly `content_type` (nosniff) and never run anything in them (CSP)."""
    return {"statusCode": status, "isBase64Encoded": True, "body": base64.b64encode(body).decode("ascii"),
            "headers": {"content-type": content_type, "x-content-type-options": "nosniff",
                        "content-security-policy": "default-src 'none'", **(headers or {})}}


def error_body(err: ApiError, request_id: str) -> dict:
    return {"error": {"code": err.code, "message": err.message,
                      "details": err.details, "request_id": request_id}}


class Request:
    def __init__(self, event: dict):
        http = event.get("requestContext", {}).get("http", {})
        self.method = http.get("method", "GET").upper()
        self._source_ip = http.get("sourceIp")
        raw_path = event.get("rawPath") or "/"
        if raw_path.startswith(API_PREFIX):
            raw_path = raw_path[len(API_PREFIX):]
        self.path = "/" + raw_path.strip("/") if raw_path.strip("/") else "/"
        self.path_params: dict[str, str] = {}
        self.query = dict(parse_qsl(event.get("rawQueryString") or "", keep_blank_values=True))
        self.headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
        self.cookies: dict[str, str] = {}
        for cookie in event.get("cookies") or []:
            name, _, value = cookie.partition("=")
            self.cookies[name.strip()] = value.strip()
        given = self.headers.get("x-request-id") or ""
        self.request_id = given if REQUEST_ID_RE.fullmatch(given) else str(uuid.uuid4())
        body = event.get("body")
        if body and event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        self._body = body

    def json(self) -> dict:
        if not self._body:
            return {}
        try:
            data = json.loads(self._body)
        except (ValueError, TypeError):
            raise ApiError(400, "INVALID_JSON", "Request body is not valid JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "INVALID_JSON", "Request body must be a JSON object")
        return data

    @property
    def client_address(self) -> str:
        """The caller's IP address, best effort, for rate limits only (never for access decisions).

        CloudFront's CloudFront-Viewer-Address ("ip:port") when it is forwarded, else the Function URL's source IP
        (behind CloudFront that is the edge's address, shared by many visitors). A direct caller can set the header,
        so this can be dodged but not used to limit someone else without knowing their address."""
        viewer = self.headers.get("cloudfront-viewer-address", "").strip()
        if viewer:
            return viewer.rsplit(":", 1)[0].strip("[]") if ":" in viewer else viewer
        return self._source_ip or "unknown"
