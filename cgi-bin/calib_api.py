#!/usr/bin/env python3
"""CGI endpoint that queries calibrations and returns JSON for the web UI."""

from __future__ import annotations

import cgi
import json
import os
import sys
import traceback

# Allow importing calibtool from the repo root or the deployed web directory.
_CANDIDATE_ROOTS = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    os.path.join(os.path.expanduser("~"), "public_html", "calib-tool-vis"),
]
for _root in _CANDIDATE_ROOTS:
    if _root not in sys.path and os.path.isdir(_root):
        sys.path.insert(0, _root)

import lsst.daf.butler as dB  # noqa: E402

from calibtool import get_calibrations, records_to_json  # noqa: E402

# Restrict repository paths to known safe prefixes on the cluster.
_ALLOWED_REPO_PREFIXES = (
    "/sdf/group/rubin/repo/",
    "/repo/",
)


def _json_response(payload: dict, status: int = 200) -> None:
    print(f"Status: {status}")
    print("Content-Type: application/json")
    print("Access-Control-Allow-Origin: *")
    print()
    print(json.dumps(payload))


def _validate_repo(repo: str) -> str | None:
    repo = os.path.normpath(repo)
    if not any(repo.startswith(prefix) for prefix in _ALLOWED_REPO_PREFIXES):
        return f"Repository path not allowed: {repo}"
    return None


def main() -> None:
    form = cgi.FieldStorage()
    repo = form.getfirst("repo", "/sdf/group/rubin/repo/main/")
    collection = form.getfirst("collection", "LSSTCam/calib")
    dataset_type = form.getfirst("dataset_type") or None
    where = form.getfirst("where") or None

    if not collection.strip():
        _json_response({"error": "collection is required"}, status=400)
        return

    dataset_type = dataset_type.strip() if dataset_type else None
    where = where.strip() if where else None
    if where and not dataset_type:
        _json_response(
            {
                "error": (
                    "dataset_type is required when using WHERE. "
                    "Use Butler SQL syntax, e.g. instrument = 'LSSTCam' AND detector = 204"
                ),
            },
            status=400,
        )
        return

    repo_error = _validate_repo(repo)
    if repo_error:
        _json_response({"error": repo_error}, status=400)
        return

    try:
        butler = dB.Butler(repo, collections=collection)
        records = get_calibrations(
            butler,
            collection,
            dataset_type=dataset_type,
            where=where,
        )
        _json_response({"records": json.loads(records_to_json(records))})
    except Exception as exc:
        _json_response(
            {
                "error": str(exc),
                "detail": traceback.format_exc(),
            },
            status=500,
        )


if __name__ == "__main__":
    main()
