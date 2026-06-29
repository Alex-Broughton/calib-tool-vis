#!/bin/bash
# Deploy the static web UI to ~/public_html on S3DF.
#
# Usage (from repo root, on the cluster):
#   ./deploy.sh
#
# S3DF public_html is static-only (no CGI). Use query.sh to generate JSON,
# or serve.py + SSH port forwarding for live interactive queries.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${HOME}/public_html/calib-tool-vis"
WEB_BASE="https://s3df.slac.stanford.edu/people/${USER}"

echo "Deploying to ${TARGET}"

mkdir -p "${TARGET}/data"

rsync -av --delete \
  --exclude 'data/latest.json' \
  "${REPO_ROOT}/web/" \
  "${TARGET}/"

install -m 644 "${REPO_ROOT}/calibtool.py" "${TARGET}/calibtool.py"
install -m 755 "${REPO_ROOT}/query.sh" "${TARGET}/query.sh"

echo "Setting public read permissions on ${TARGET}..."
chmod -R a+rX "${TARGET}"

echo ""
echo "Done."
echo "  Web UI:  ${WEB_BASE}/calib-tool-vis/"
echo ""
echo "Run a query on the cluster:"
echo "  cd ${TARGET} && ./query.sh -c LSSTCam/calib -d electroBfDistortionMatrix"
echo ""
echo "Then open the web UI and click Load results."
echo ""
echo "For live interactive queries via SSH tunnel:"
echo "  python ${REPO_ROOT}/serve.py"
echo "  ssh -L 8765:localhost:8765 \$(hostname -s)"
echo "  open http://localhost:8765"
