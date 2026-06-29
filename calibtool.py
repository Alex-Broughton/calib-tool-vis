#!/usr/bin/env python3
"""List calibration datasets and their validity ranges from an LSST Butler repo."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from typing import Any, Iterator, Optional

import lsst.daf.butler as dB


@dataclass
class CalibrationRecord:
    dataset_type: str
    run: str
    collection: str
    dimensions: str
    validity_start: Optional[str]
    validity_end: Optional[str]
    validity_range: str

    def as_text_line(self) -> str:
        return (
            f"{self.dataset_type} {self.run} {self.collection} "
            f"{self.dimensions} {self.validity_range}"
        )


def _format_time(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isot"):
        return value.isot
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _timespan_to_record_fields(timespan) -> tuple[Optional[str], Optional[str], str]:
    if timespan is None:
        return None, None, "(no validity range)"
    begin = _format_time(timespan.begin)
    end = _format_time(timespan.end)
    return begin, end, str(timespan)


def prepare_where(
    where: Optional[str],
    dataset_type: Optional[str] = None,
) -> Optional[str]:
    """Validate and return a Butler SQL WHERE expression."""
    if where is None:
        return None
    where = where.strip()
    if not where:
        return None
    if not dataset_type:
        raise ValueError(
            "A dataset type is required when using WHERE. "
            "Butler query_datasets needs a dataset type to interpret SQL "
            "expressions over dimensions."
        )
    return where


def _matching_data_ids(
    butler: dB.Butler,
    dataset_type_name: str,
    collections: str,
    where: str,
) -> set[tuple[Any, ...]]:
    """Return a set of dataId keys that satisfy the where expression."""
    refs = butler.query_datasets(
        dataset_type_name,
        collections=collections,
        where=where,
        find_first=False,
    )
    return {_data_id_key(ref.dataId) for ref in refs}


def _data_id_key(data_id) -> tuple[Any, ...]:
    required = getattr(data_id, "required", None)
    if required is not None:
        return tuple(sorted(required.items()))
    if hasattr(data_id, "items"):
        return tuple(sorted(data_id.items()))
    raise TypeError(f"Cannot build key for data ID of type {type(data_id)!r}")


def iter_calibrations(
    butler: dB.Butler,
    collections: str,
    dataset_type: Optional[str] = None,
    where: Optional[str] = None,
) -> Iterator[CalibrationRecord]:
    """Yield calibration dataset records from the Butler registry."""
    prepare_where(where, dataset_type)

    if dataset_type:
        dataset_types = [butler.registry.getDatasetType(dataset_type)]
    else:
        dataset_types = [
            dt for dt in butler.registry.queryDatasetTypes() if dt.isCalibration()
        ]

    for dt in dataset_types:
        allowed_data_ids: Optional[set[tuple[Any, ...]]] = None
        prepared_where = prepare_where(where, dt.name)
        if prepared_where:
            allowed_data_ids = _matching_data_ids(butler, dt.name, collections, prepared_where)

        for assoc in butler.registry.queryDatasetAssociations(
            dt, collections=collections
        ):
            if allowed_data_ids is not None:
                if _data_id_key(assoc.ref.dataId) not in allowed_data_ids:
                    continue

            begin, end, validity_range = _timespan_to_record_fields(assoc.timespan)
            yield CalibrationRecord(
                dataset_type=dt.name,
                run=assoc.ref.run,
                collection=assoc.collection,
                dimensions=str(assoc.ref.dataId),
                validity_start=begin,
                validity_end=end,
                validity_range=validity_range,
            )


def get_calibrations(
    butler: dB.Butler,
    collections: str,
    dataset_type: Optional[str] = None,
    where: Optional[str] = None,
) -> list[CalibrationRecord]:
    return list(iter_calibrations(butler, collections, dataset_type, where))


def print_calibrations(
    butler: dB.Butler,
    collections: str,
    dataset_type: Optional[str] = None,
    where: Optional[str] = None,
) -> None:
    for record in iter_calibrations(butler, collections, dataset_type, where):
        print(record.as_text_line())


def records_to_json(records: list[CalibrationRecord]) -> str:
    return json.dumps([asdict(r) for r in records], indent=2)


def _parse_args():
    import argparse

    parser = argparse.ArgumentParser(
        description="List calibration datasets and their validity ranges."
    )
    parser.add_argument(
        "-r",
        "--repository",
        type=str,
        default="/sdf/group/rubin/repo/main/",
        help="Butler repo to search.",
    )
    parser.add_argument(
        "-c",
        "--collection",
        type=str,
        default="LSSTCam/calib",
        help="Collection to search (this also constrains the camera).",
    )
    parser.add_argument(
        "-d",
        "--dataset_type",
        type=str,
        default=None,
        help="Restrict search to this dataset_type.",
    )
    parser.add_argument(
        "-w",
        "--where",
        type=str,
        default=None,
        help="Optional Butler SQL WHERE expression, as used by butler query-datasets "
        "(e.g. \"instrument = 'LSSTCam' AND detector = 204\"). "
        "Requires -d/--dataset_type.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON instead of plain text.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        prepare_where(args.where, args.dataset_type)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    butler = dB.Butler(args.repository, collections=args.collection)
    records = get_calibrations(
        butler,
        args.collection,
        dataset_type=args.dataset_type,
        where=args.where,
    )

    if args.json:
        print(records_to_json(records))
    else:
        for record in records:
            print(record.as_text_line())

    return 0


if __name__ == "__main__":
    sys.exit(main())
