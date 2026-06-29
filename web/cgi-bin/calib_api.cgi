#!/bin/bash
# CGI entry point — loads LSST then runs calib_api.py.
# Deployed to ~/public_html/cgi-bin/ and ~/public_html/calib-tool-vis/cgi-bin/.

set -euo pipefail

if [[ -f "${HOME}/loadLSST.bash" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/loadLSST.bash"
elif [[ -f "/sdf/group/rubin/sw/conda/loadLSST.bash" ]]; then
  # shellcheck disable=SC1091
  source "/sdf/group/rubin/sw/conda/loadLSST.bash"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/calib_api.py"
