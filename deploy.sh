#!/bin/bash
# Deploy the web UI and CGI endpoint to ~/public_html on the cluster.
#
# Usage (from repo root, on the cluster):
#   ./deploy.sh
#
# Prerequisites:
#   - LSST Science Pipelines available (setup handled by your shell profile or loadLSST.bash)
#   - ~/public_html exists and CGI is enabled for ~/public_html/cgi-bin/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${HOME}/public_html/calib-tool-vis"
CGI_TARGET="${HOME}/public_html/cgi-bin"

echo "Deploying to ${TARGET}"

mkdir -p "${TARGET}" "${CGI_TARGET}"

rsync -av --delete \
  "${REPO_ROOT}/web/" \
  "${TARGET}/"

install -m 755 "${REPO_ROOT}/cgi-bin/calib_api.py" "${CGI_TARGET}/calib_api.py"
install -m 644 "${REPO_ROOT}/calibtool.py" "${TARGET}/calibtool.py"

echo "Done."
echo "  Web UI:  https://$(hostname -f)/~${USER}/calib-tool-vis/"
echo "  API:     https://$(hostname -f)/~${USER}/cgi-bin/calib_api.py"
