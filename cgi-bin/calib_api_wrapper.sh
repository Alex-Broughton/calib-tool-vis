#!/bin/bash
# CGI wrapper that loads the LSST environment before running calib_api.py.
# Use this if bare Python CGI cannot import lsst.daf.butler.
#
# Install to ~/public_html/cgi-bin/calib_api.py (replacing the .py script)
# or as calib_api.cgi and update API_URL in web/app.js accordingly.

set -euo pipefail

# Adjust this path to your LSST setup script on the cluster.
if [[ -f "${HOME}/loadLSST.bash" ]]; then
  source "${HOME}/loadLSST.bash"
elif [[ -f "/sdf/group/rubin/sw/conda/loadLSST.bash" ]]; then
  source "/sdf/group/rubin/sw/conda/loadLSST.bash"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/calib_api.py"
