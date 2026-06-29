#!/usr/bin/env python3
"""Local web server with a JSON API for interactive use via SSH port forwarding.

On the cluster:
  python serve.py

From your laptop:
  ssh -L 8765:localhost:8765 sdfiana012
  open http://localhost:8765
"""

from __future__ import annotations

import json
import os
import sys
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import lsst.daf.butler as dB

from calibtool import get_calibrations, records_to_json

WEB_DIR = Path(__file__).resolve().parent / "web"
PORT = int(os.environ.get("CALIB_VIS_PORT", "8765"))

_ALLOWED_REPO_PREFIXES = (
    "/sdf/group/rubin/repo/",
    "/repo/",
)


def _validate_repo(repo: str) -> str | None:
    repo = os.path.normpath(repo.strip())
    if not any(repo.startswith(prefix) for prefix in _ALLOWED_REPO_PREFIXES):
        return f"Repository path not allowed: {repo}"
    return None


def _query(params: dict[str, str]) -> dict:
    repo = params.get("repo", "/sdf/group/rubin/repo/main/")
    collection = params.get("collection", "")
    dataset_type = params.get("dataset_type", "").strip() or None
    where = params.get("where", "").strip() or None

    if not collection.strip():
        return {"error": "collection is required"}

    repo_error = _validate_repo(repo)
    if repo_error:
        return {"error": repo_error}

    butler = dB.Butler(repo, collections=collection)
    records = get_calibrations(
        butler,
        collection,
        dataset_type=dataset_type,
        where=where,
    )
    return {"records": json.loads(records_to_json(records))}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path) -> None:
        if not path.is_file() or not path.resolve().is_relative_to(WEB_DIR.resolve()):
            self.send_error(404)
            return

        content_type = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json; charset=utf-8",
        }.get(path.suffix, "application/octet-stream")

        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = dict(urllib.parse.parse_qsl(parsed.query))

        if parsed.path == "/api/query":
            if params.get("ping"):
                self._send_json({"ok": True})
                return
            try:
                self._send_json(_query(params))
            except Exception as exc:
                self._send_json(
                    {"error": str(exc), "detail": traceback.format_exc()},
                    status=500,
                )
            return

        rel_path = parsed.path.lstrip("/") or "index.html"
        self._send_file(WEB_DIR / rel_path)


def main() -> None:
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving on http://127.0.0.1:{PORT}")
    print("API: http://127.0.0.1:{PORT}/api/query?ping=1")
    print("SSH tunnel: ssh -L {PORT}:localhost:{PORT} <cluster-node>".format(PORT=PORT))
    server.serve_forever()


if __name__ == "__main__":
    main()
