"""Measure a STEP file for the component-registry Tier-2 cross-validation
(MTR-203): overall bbox, PCB slab (largest thin solid by XY footprint), and
vertical through-hole cylinders near the PCB plane. Prints JSON.

Needs the OCP kernel (build123d container image). Invoked by
scripts/validate-component-registry.ts — not imported by app code.
"""
import json
import sys
from collections import defaultdict

from OCP.Bnd import Bnd_Box
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepBndLib import BRepBndLib
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS


def bbox(shape):
    b = Bnd_Box()
    BRepBndLib.Add_s(shape, b)
    return b.Get()  # xmin, ymin, zmin, xmax, ymax, zmax


def main(path):
    reader = STEPControl_Reader()
    if reader.ReadFile(path) != IFSelect_RetDone:
        print(json.dumps({"error": "read failed"}))
        return
    reader.TransferRoots()
    shape = reader.OneShape()

    xmin, ymin, zmin, xmax, ymax, zmax = bbox(shape)
    overall = [xmax - xmin, ymax - ymin, zmax - zmin]

    # PCB slab: the 0.4-3.5 mm thick solid with the largest XY footprint.
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    best = None
    while ex.More():
        b = bbox(ex.Current())
        area = (b[3] - b[0]) * (b[4] - b[1])
        thick = b[5] - b[2]
        if 0.4 < thick < 3.5 and (best is None or area > best[0]):
            best = (area, b)
        ex.Next()
    pcb = None
    # A "PCB" whose footprint is a sliver of the overall part is a misdetected
    # pin/contact (battery holders etc.) — fall back to the overall frame.
    if best and best[0] < 0.05 * overall[0] * overall[1]:
        best = None
    if best:
        _, b = best
        pcb = {
            "lx": b[3] - b[0],
            "ly": b[4] - b[1],
            "t": b[5] - b[2],
            "cx": (b[0] + b[3]) / 2,
            "cy": (b[1] + b[4]) / 2,
            "zmid": (b[2] + b[5]) / 2,
        }

    # Vertical cylinders crossing the PCB z-band = candidate holes.
    holes = defaultdict(list)
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face_s(ex.Current())
        try:
            ad = BRepAdaptor_Surface(f)
            if ad.GetType() == GeomAbs_Cylinder:
                cyl = ad.Cylinder()
                if abs(cyl.Axis().Direction().Z()) > 0.99:
                    fb = bbox(f)
                    if pcb is None or (fb[2] < pcb["zmid"] < fb[5] + 0.2):
                        loc = cyl.Location()
                        key = (round(loc.X(), 2), round(loc.Y(), 2))
                        holes[key].append(round(cyl.Radius(), 3))
        except Exception:  # noqa: BLE001 — skip degenerate faces
            pass
        ex.Next()

    ref = pcb or {
        "cx": (xmin + xmax) / 2,
        "cy": (ymin + ymax) / 2,
    }
    hole_list = sorted(
        {
            (
                round(k[0] - ref["cx"], 3),
                round(k[1] - ref["cy"], 3),
                round(2 * min(v), 3),
            )
            for k, v in holes.items()
        }
    )
    print(
        json.dumps(
            {
                "overall": [round(v, 3) for v in overall],
                "pcb": {k: round(v, 3) for k, v in pcb.items()} if pcb else None,
                "holes": [list(h) for h in hole_list],
            }
        )
    )


if __name__ == "__main__":
    main(sys.argv[1])
