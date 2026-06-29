#!/bin/bash
# Run a Butler calibration query and write JSON for the static web UI.
#
# Usage:
#   ./query.sh -c LSSTCam/calib -d electroBfDistortionMatrix
#   ./query.sh -c LSSTCam/calib -d bias -w "detector=204"
#
# Output goes to ~/public_html/calib-tool-vis/data/latest.json by default.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="/sdf/group/rubin/repo/main/"
COLLECTION=""
DATASET=""
WHERE=""
OUTPUT="${HOME}/public_html/calib-tool-vis/data/latest.json"

usage() {
  echo "Usage: $0 -c COLLECTION [-r REPO] [-d DATASET_TYPE] [-w WHERE] [-o OUTPUT]"
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--repository) REPO="$2"; shift 2 ;;
    -c|--collection) COLLECTION="$2"; shift 2 ;;
    -d|--dataset_type) DATASET="$2"; shift 2 ;;
    -w|--where) WHERE="$2"; shift 2 ;;
    -o|--output) OUTPUT="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

if [[ -z "${COLLECTION}" ]]; then
  echo "Error: -c COLLECTION is required" >&2
  usage
fi

if [[ -f "${HOME}/loadLSST.bash" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/loadLSST.bash"
elif [[ -f "/sdf/group/rubin/sw/conda/loadLSST.bash" ]]; then
  # shellcheck disable=SC1091
  source "/sdf/group/rubin/sw/conda/loadLSST.bash"
fi

mkdir -p "$(dirname "${OUTPUT}")"

ARGS=(-r "${REPO}" -c "${COLLECTION}" --json)
if [[ -n "${DATASET}" ]]; then
  ARGS+=(-d "${DATASET}")
fi
if [[ -n "${WHERE}" ]]; then
  ARGS+=(-w "${WHERE}")
fi

python3 "${SCRIPT_DIR}/calibtool.py" "${ARGS[@]}" > "${OUTPUT}"
chmod -R a+rX "$(dirname "${OUTPUT}")"
echo "Wrote ${OUTPUT}"
echo "View: https://s3df.slac.stanford.edu/people/${USER}/calib-tool-vis/"
