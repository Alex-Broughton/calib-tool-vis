#!/usr/bin/env python3

import lsst.daf.butler as dB

def print_calibrations(butler, collections, dataset=None):
    for dataset_type in butler.registry.queryDatasetTypes(...):
        if not dataset_type.isCalibration():
            continue
        for assoc in butler.registry.queryDatasetAssociations(dataset_type, collections=collections):
            if dataset is None or dataset_type.name == dataset:
                print(
                    dataset_type.name,
                    assoc.ref.run,
                    assoc.collection,
                    assoc.ref.dataId,
                    assoc.timespan,
                )


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("-r", "--repository", type=str,
                        default="/sdf/group/rubin/repo/main/",
                        help="Butler repo to search.")
    parser.add_argument("-c", "--collection", type=str,
                        default="LSSTCam/calib",
                        help="Collection to search (this also constrains the camera).")
    parser.add_argument("-d", "--dataset_type", type=str,
                        default=None,
                        help="Restrict search to this dataset_type.")
    args = parser.parse_args()

    butler = dB.Butler(args.repository, collections=args.collection)

    print_calibrations(butler, args.collection, dataset=args.dataset_type)
