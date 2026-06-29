# calib-tool-vis

A web interface and CLI for listing calibration datasets in an LSST Butler repository and visualizing their validity ranges on a timeline.

## Requirements

- LSST Science Pipelines (for `lsst.daf.butler`)
- A Butler repository accessible from the cluster (e.g. `/sdf/group/rubin/repo/main/`)

## CLI usage

```bash
python calibtool.py -r main -c LSSTCam/calib -d electroBfDistortionMatrix
```

Each line of output follows:

```
dataset_type run collection dimensions validity_range
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-r`, `--repository` | `/sdf/group/rubin/repo/main/` | Butler repo to search |
| `-c`, `--collection` | `LSSTCam/calib` | Collection to search |
| `-d`, `--dataset_type` | *(none)* | Restrict to a specific dataset type |
| `-w`, `--where` | *(none)* | Butler where expression to filter dimensions (e.g. `detector=204`) |
| `--json` | *(off)* | Output results as JSON |

### Examples

```bash
# List all calibrations in the default LSSTCam collection
python calibtool.py

# Filter to one dataset type
python calibtool.py -d electroBfDistortionMatrix

# Filter by detector
python calibtool.py -d bias -w "detector=204"

# JSON output for scripting
python calibtool.py -d bias --json
```

## Web interface

The web UI lives in `web/` and talks to a CGI endpoint in `cgi-bin/` that runs the same query logic as the CLI.

### Deploy on the cluster

From the repo root on the cluster (with LSST set up in your environment):

```bash
chmod +x deploy.sh
./deploy.sh
```

This copies:

- `web/*` → `~/public_html/calib-tool-vis/`
- `cgi-bin/calib_api.py` → `~/public_html/cgi-bin/calib_api.py`
- `calibtool.py` → `~/public_html/calib-tool-vis/calibtool.py`

Then open:

```
https://<cluster-host>/~<username>/calib-tool-vis/
```

### CGI setup notes

- `calib_api.py` must be executable (`chmod 755`).
- The CGI script imports `calibtool.py` from the parent of `cgi-bin/`; `deploy.sh` also copies it into the web directory for reference.
- If CGI fails with import errors, ensure your web server runs CGI with LSST available. You may need a wrapper that sources `loadLSST.bash` before invoking Python. Example wrapper at `cgi-bin/calib_api_wrapper.sh`.
- Repository paths are restricted to prefixes under `/sdf/group/rubin/repo/` for safety.

### Manual layout

If you prefer not to use `deploy.sh`, the expected layout under `~/public_html` is:

```
public_html/
  calib-tool-vis/
    index.html
    style.css
    app.js
    calibtool.py
  cgi-bin/
    calib_api.py
```

The API URL in `web/app.js` is `../cgi-bin/calib_api.py` relative to the web directory.

## JSON record format

Each record returned by `--json` or the web API:

```json
{
  "dataset_type": "electroBfDistortionMatrix",
  "run": "LSSTCam/calib/.../electroBFDistortionMatrix.20260127b",
  "collection": "LSSTCam/calib/.../electroBFDistortionMatrixGen.20260120a/20260122T155828Z",
  "dimensions": "{instrument: 'LSSTCam', detector: 204}",
  "validity_start": "2025-01-26T00:00:00",
  "validity_end": null,
  "validity_range": "[2025-01-26T00:00:00, ∞)"
}
```
