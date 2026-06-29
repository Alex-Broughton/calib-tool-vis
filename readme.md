# calib-tool-vis

A web interface and CLI for listing calibration datasets in an LSST Butler repository and visualizing their validity ranges on a timeline.

## Requirements

- LSST Science Pipelines (for `lsst.daf.butler`)
- A Butler repository accessible from the cluster (e.g. `/sdf/group/rubin/repo/main/`)

## CLI usage

```bash
python calibtool.py -r /sdf/group/rubin/repo/main/ -c LSSTCam/calib -d electroBfDistortionMatrix
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
| `-w`, `--where` | *(none)* | Butler SQL WHERE expression (same as `butler query-datasets --where`; requires `-d`) |

### WHERE filter

The `--where` flag accepts the same SQL-like expression Butler uses for
`butler query-datasets`. A dataset type (`-d`) is required so Butler knows which
dimensions are in scope.

Examples:

```bash
# Single dimension
python calibtool.py -c LSSTCam/calib -d bias -w "detector = 204"

# Multiple clauses
python calibtool.py -c LSSTCam/calib -d bias \
  -w "instrument = 'LSSTCam' AND detector = 204"

# IN list
python calibtool.py -c LSSTCam/calib -d bias -w "detector IN (1, 2, 3)"
```

Use spaces around operators, single-quote string values, and combine clauses
with `AND` / `OR` as in standard SQL.
| `--json` | *(off)* | Output results as JSON |

## Web interface

The web UI lives in `web/` and renders a timeline from calibration JSON data.

### Important: S3DF hosting is static-only

On S3DF, personal `public_html` is served at:

```
https://s3df.slac.stanford.edu/people/<username>/
```

This is **static hosting only** — no CGI or server-side scripts. Compute nodes like `sdfiana012` also do not serve HTTPS directly, so do not curl them.

Use one of these workflows:

#### Option A — Static (recommended for public_html)

1. Deploy:
   ```bash
   ./deploy.sh
   ```

2. Run a query on the cluster:
   ```bash
   cd ~/public_html/calib-tool-vis
   ./query.sh -c LSSTCam/calib -d electroBfDistortionMatrix
   ```
   This writes `data/latest.json`.

3. Open the web UI and click **Load results**:
   ```
   https://s3df.slac.stanford.edu/people/<username>/calib-tool-vis/
   ```

The form shows the exact `query.sh` command to run. You can also **Upload JSON** from `calibtool.py --json`.

#### Option B — Interactive via SSH tunnel

For live queries from the browser (no manual JSON step):

```bash
# On the cluster
python serve.py

# From your laptop (new terminal)
ssh -L 8765:localhost:8765 sdfiana012

# Browser
open http://localhost:8765
```

Test the API:
```bash
curl 'http://localhost:8765/api/query?ping=1'
```

### Deploy on the cluster

```bash
chmod +x deploy.sh query.sh
./deploy.sh
```

`deploy.sh` runs `chmod -R a+rX` on the deployed directory so new files are web-visible.
`query.sh` does the same for `data/` after writing `latest.json`. If you add files
manually under `public_html`, run:

```bash
cd ~/public_html && chmod -R a+rX *
```

Files deployed to `~/public_html/calib-tool-vis/`:

```
calib-tool-vis/
  index.html, style.css, app.js
  calibtool.py, query.sh
  data/latest.json   ← created by query.sh
```

### Troubleshooting

**`curl: Failed to connect ... port 443: Connection refused`**

You are curling a compute node hostname (`sdfiana012...`). That node does not run a web server. Use the S3DF URL instead:
```
https://s3df.slac.stanford.edu/people/<username>/calib-tool-vis/
```

**"API returned HTML instead of JSON"**

S3DF static hosting cannot run CGI. Use `query.sh` + **Load results**, or `serve.py` with an SSH tunnel.

**No results file yet**

Run `query.sh` on the cluster first, then click **Load results** in the browser.

## JSON record format

Each record returned by `--json`, `query.sh`, or the API:

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
