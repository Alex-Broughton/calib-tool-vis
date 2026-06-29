# calib-tool-vis

A small utility for listing calibration datasets in an LSST Butler repository.

## Requirements

- LSST Science Pipelines (for `lsst.daf.butler`)

## Usage

```bash
python calibtool.py
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-r`, `--repository` | `/sdf/group/rubin/repo/main/` | Butler repo to search |
| `-c`, `--collection` | `LSSTCam/calib` | Collection to search (also constrains the camera) |
| `-d`, `--dataset_type` | *(none)* | Restrict search to a specific dataset type |

### Examples

```bash
# List all calibrations in the default LSSTCam collection
python calibtool.py

# Search a different repository and collection
python calibtool.py -r /path/to/repo -c LATISS/calib

# Filter to a single dataset type
python calibtool.py -d bias
```
