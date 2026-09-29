"""
Bake ambient occlusion for the landing's Pneuma Q shells (Blender 3.4+).

Pipeline — run from the repo root when the CAD changes:

  1. Export the shells at shipping detail (25% — with 16-bit normals that is
     indistinguishable from full detail even in polished steel), uncompressed
     since Blender can't read meshopt: any GLB holding just
     the two shell meshes (S: 01_Rear_pocketed_body / 02_Front_soft_shell),
     welded then simplified.
     Save it as shells-raw.glb next to this script's output dir.
  2. blender -b --python scripts/landing-glb/bake-ao.py -- <workdir>
     (<workdir> holds shells-raw.glb; outputs land there)
     -> shells-uv.glb (shells + UVs) and ao-front.png / ao-rear.png
  3. SHELLS_UV=<workdir>/shells-uv.glb node scripts/landing-glb/build.mjs <src.glb>
  4. Convert the PNGs to public/home/ao-{front,rear}.webp (1024², greyscale).

The maps and shells-uv.glb must come from the SAME run: Smart UV Project
re-lays the UVs every time, so a map from one bake on geometry from
another lands in the wrong places.

Each shell is baked against itself only (the other is hidden), so the
insides don't darken when the shells split apart on the landing.
"""
import bpy, math, os, sys
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(argv[0]) if argv else os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(out, "shells-raw.glb"))
sc = bpy.context.scene
sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "METAL"; prefs.get_devices()
for d in prefs.devices: d.use = True
sc.cycles.device = "GPU"
sc.cycles.samples = 256
if sc.world is None: sc.world = bpy.data.worlds.new("W")
sc.world.light_settings.distance = 0.025  # 2.5 cm: pools into the camera well and cavities, still local
shells = [o for o in sc.objects if o.type == "MESH"]
print("SHELLS", [(o.name, len(o.data.polygons), tuple(round(v,4) for v in o.dimensions)) for o in shells])
for obj in shells:
    for o in shells: o.hide_render = (o is not obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.object.mode_set(mode="OBJECT")
    key = "front" if "Front" in obj.name else "rear"
    img = bpy.data.images.new(f"ao-{key}", 2048, 2048, alpha=False)
    if not obj.data.materials:
        obj.data.materials.append(bpy.data.materials.new(f"m-{key}"))
    for mat in obj.data.materials:
        mat.use_nodes = True
        n = mat.node_tree.nodes.new("ShaderNodeTexImage"); n.image = img
        mat.node_tree.nodes.active = n
    sc.render.bake.margin = 16
    bpy.ops.object.bake(type="AO")
    img.filepath_raw = os.path.join(out, f"ao-{key}.png"); img.file_format = "PNG"; img.save()
    print("BAKED", key)
for o in shells: o.hide_render = False
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "shells-uv.glb"), export_format="GLB",
    export_materials="PLACEHOLDER", export_texcoords=True, export_normals=True, use_selection=False)
print("EXPORTED")
