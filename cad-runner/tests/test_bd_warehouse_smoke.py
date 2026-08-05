"""
bd_warehouse smoke manifest (MTR-200) — DOCKER-ONLY verification.

The TS resolver (lib/cad/step-parts/bd-warehouse.ts) maps aliases like
"m3x12 shcs" / "608zz" to the bd_warehouse constructor snippets below. Those
dimensions are trusted upstream (published ISO/DIN/vendor tables, Apache-2.0,
by the build123d author), but the dev/CI environment has no OCP kernel, so
NOTHING here has executed until this script runs once inside the cad-runner
image:

    docker build -t cad-runner cad-runner/
    docker run --rm cad-runner python3 tests/test_bd_warehouse_smoke.py

Each MANIFEST entry mirrors one canonical snippet the resolver emits; a PASS
means the class imports, the constructor accepts our exact size/type strings,
and the resulting solid has a non-degenerate bounding box. Outside the image
(no bd_warehouse/OCP) the script SKIPs with exit 0 so plain-python CI runs
stay green.

Keep this list in sync with CANONICAL snippets in
lib/cad/step-parts/bd-warehouse.ts — a constructor emitted to prompts that is
not smoke-tested here is an unverified claim.
"""
import sys
import traceback

# (module, class, kwargs, what the TS resolver emits it for)
MANIFEST = [
    ("bd_warehouse.fastener", "SocketHeadCapScrew",
     {"size": "M3-0.5", "length": 12, "fastener_type": "iso4762"},
     'm3x12 shcs / iso4762_m3x12'),
    ("bd_warehouse.fastener", "ButtonHeadScrew",
     {"size": "M3-0.5", "length": 8, "fastener_type": "iso7380_1"},
     "M3x8 button head"),
    ("bd_warehouse.fastener", "CounterSunkScrew",
     {"size": "M4-0.7", "length": 12, "fastener_type": "iso10642"},
     "M4x12 countersunk"),
    ("bd_warehouse.fastener", "SetScrew",
     {"size": "M3-0.5", "length": 6, "fastener_type": "iso4026"},
     "M3x6 set/grub screw"),
    ("bd_warehouse.fastener", "HexHeadScrew",
     {"size": "M5-0.8", "length": 16, "fastener_type": "iso4014"},
     "M5x16 hex head bolt"),
    ("bd_warehouse.fastener", "HexNut",
     {"size": "M3-0.5", "fastener_type": "iso4032"},
     "M3 hex nut"),
    ("bd_warehouse.fastener", "PlainWasher",
     {"size": "M3", "fastener_type": "iso7089"},
     "M3 washer"),
    ("bd_warehouse.fastener", "HeatSetNut",
     {"size": "M3-0.5-Standard", "fastener_type": "McMaster-Carr"},
     "M3 heat-set insert (M2-M5 only)"),
    ("bd_warehouse.bearing", "SingleRowDeepGrooveBallBearing",
     {"size": "M8-22-7", "bearing_type": "SKT"},
     "608 bearing"),
    ("bd_warehouse.bearing", "SingleRowCappedDeepGrooveBallBearing",
     {"size": "M8-22-7", "bearing_type": "SKT"},
     "608zz / 608-2RS bearing"),
    # FUNCTIONAL THREADS (knowledge/bd-warehouse.ts) — kernel-verified
    # 2026-08-04: external ridges fuse clean onto their core; internal
    # threads ship as Part(children=[body, thread]) and finalize through
    # the voxel-remesh mesh pipeline (booleans shatter or silently drop
    # the thread — never fuse/cut internal threads).
    ("bd_warehouse.thread", "IsoThread",
     {"major_diameter": 20.0, "pitch": 2.5, "length": 20,
      "external": False, "end_finishes": ("fade", "fade")},
     "internal thread (compound-children + remesh recipe)"),
    ("bd_warehouse.thread", "IsoThread",
     {"major_diameter": 20.0, "pitch": 2.5, "length": 20,
      "external": True, "end_finishes": ("fade", "square")},
     "external ISO thread (fuses clean onto its core)"),
    ("bd_warehouse.thread", "TrapezoidalThread",
     {"diameter": 24.0, "pitch": 4.0, "thread_angle": 30, "length": 20,
      "external": True, "end_finishes": ("fade", "fade")},
     "chunky external trapezoidal thread"),
]


def main() -> int:
    import importlib

    try:
        importlib.import_module("bd_warehouse.fastener")
        importlib.import_module("bd_warehouse.bearing")
    except ImportError as err:
        print(f"SKIP: bd_warehouse/OCP unavailable here ({err}); "
              "run inside the cad-runner image")
        return 0

    failures = 0
    for module, cls_name, kwargs, alias in MANIFEST:
        label = f"{cls_name}({', '.join(f'{k}={v!r}' for k, v in kwargs.items())})"
        try:
            cls = getattr(importlib.import_module(module), cls_name)
            part = cls(**kwargs)
            bb = part.bounding_box()
            size = bb.size
            if min(size.X, size.Y, size.Z) <= 0:
                raise AssertionError(f"degenerate bounding box {size}")
            print(f"PASS  {label}  [{alias}]  bbox "
                  f"{size.X:.2f} x {size.Y:.2f} x {size.Z:.2f} mm")
        except Exception:
            failures += 1
            print(f"FAIL  {label}  [{alias}]")
            traceback.print_exc()

    print(f"\n{len(MANIFEST) - failures}/{len(MANIFEST)} constructors verified")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
