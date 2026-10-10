import { widgetDocument } from "./shell";

/**
 * The inspector widget for materialize_inspect_model: one model, or the
 * parts of an assembly, in a 3D view the user can actually work in, which
 * the chat hosts don't give them. Cut through it on any axis (with a
 * filled cap, so a solid reads as solid and a hollow as hollow), measure
 * between two points on the surface in mm, and pull an assembly apart.
 * The printability facts the tool measured sit under the view.
 *
 * What the user is looking at goes back to the model as context
 * (`ui/update-model-context`, and ChatGPT's widget state), so "make this
 * wall thicker" after a cut means the wall at that cut.
 *
 * Model units are millimetres throughout: the scene is left at the file's
 * own scale (unlike the quote card's turntable, which normalizes), so a
 * measured distance is a world distance.
 */

const STYLES = `
.card{gap:12px}
.top{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:2px 4px 0}
.top h2{margin:0;font-size:18px;font-weight:700;letter-spacing:-0.01em;overflow-wrap:anywhere}
.top .size{font-size:12.5px;color:var(--ink-3);white-space:nowrap}
.stage{height:400px}
html.full .stage{height:calc(100vh - 210px);min-height:320px}
.stage canvas{touch-action:none}
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tool{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;border-radius:999px;background:var(--soft-2);color:var(--ink);font-size:13.5px;font-weight:600}
.tool[aria-pressed="true"]{background:var(--btn);color:var(--btn-ink)}
.tool:focus-visible{outline:2px solid var(--print);outline-offset:2px}
.tool.small{min-height:30px;padding:0 11px;font-size:12.5px}
.spacer{flex:1}
.ctl{display:flex;align-items:center;gap:10px;background:var(--soft);border-radius:18px;padding:8px 12px;font-size:13px}
.ctl input[type=range]{flex:1;min-width:80px;accent-color:var(--print)}
.ctl .val{min-width:74px;text-align:right;font-weight:600}
.readout{position:absolute;right:10px;top:10px;font-size:12.5px;font-weight:600;background:color-mix(in srgb,var(--bg) 88%,transparent);padding:6px 11px;border-radius:999px;display:none}
.facts{display:flex;flex-wrap:wrap;gap:6px}
.fact{font-size:12.5px;background:var(--soft);border-radius:999px;padding:4px 10px;color:var(--ink-2)}
.fact b{color:var(--ink);font-weight:650}
.issues{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.issues li{font-size:13px;border-radius:14px;padding:8px 12px;background:var(--warn-bg);color:var(--warn-ink)}
.issues li.ok{background:var(--good-bg);color:var(--good-ink)}
`;

const BODY = `
<main class="card" id="app" aria-live="polite">
  <p class="muted" style="margin:4px">Loading model…</p>
</main>
`;

const SCRIPT = `
(function(){
  var app = document.getElementById("app");
  var started = false;

  function h(tag, attrs, kids){
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "onclick") n.addEventListener("click", v);
      else if (k === "oninput") n.addEventListener("input", v);
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function(c){
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function mm(v){ return (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) + " mm"; }

  // Raw host calls the shared bridge doesn't expose. String ids keep
  // clear of the bridge's numeric ones; replies to them are ignored.
  var rid = 0;
  function post(method, params, isRequest){
    var msg = { jsonrpc: "2.0", method: method, params: params || {} };
    if (isRequest) msg.id = "mzi-" + (++rid);
    try { window.parent.postMessage(msg, "*"); } catch (e) {}
  }

  // What the user is looking at, for the model's next turn.
  var ctxTimer = null;
  function shareContext(view){
    clearTimeout(ctxTimer);
    ctxTimer = setTimeout(function(){
      var text = "In Materialize's inspector the user is looking at " + view.summary;
      post("ui/update-model-context", { content: [{ type: "text", text: text }], structuredContent: view.state }, true);
      try { if (window.openai && window.openai.setWidgetState) window.openai.setWidgetState(view.state); } catch (e) {}
    }, 500);
  }

  function setFull(on){
    document.documentElement.classList.toggle("full", on);
    var mode = on ? "fullscreen" : "inline";
    try {
      if (window.openai && window.openai.requestDisplayMode) { window.openai.requestDisplayMode({ mode: mode }); return; }
    } catch (e) {}
    post("ui/request-display-mode", { mode: mode }, true);
  }

  async function loadParts(THREE, parts){
    var loaders = {};
    async function loaderFor(fmt){
      if (loaders[fmt]) return loaders[fmt];
      var m = fmt === "stl" ? await import("three/addons/loaders/STLLoader.js")
        : fmt === "obj" ? await import("three/addons/loaders/OBJLoader.js")
        : await import("three/addons/loaders/3MFLoader.js");
      loaders[fmt] = m; return m;
    }
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var fmt = String(p.format || "").toLowerCase();
      if (!p.url || (fmt !== "stl" && fmt !== "obj" && fmt !== "3mf")) continue;
      var res = await fetch(p.url);
      if (!res.ok) continue;
      var mod = await loaderFor(fmt);
      var obj;
      if (fmt === "stl") {
        var geo = new mod.STLLoader().parse(await res.arrayBuffer());
        // Many exporters write zero normals; recompute so faces light.
        geo.computeVertexNormals();
        obj = new THREE.Mesh(geo);
      }
      else if (fmt === "obj") obj = new mod.OBJLoader().parse(await res.text());
      else obj = new mod.ThreeMFLoader().parse(await res.arrayBuffer());
      // Printable models are Z-up; three.js is Y-up. 3MF's loader turns it.
      var wrap = new THREE.Group();
      wrap.scale.setScalar(p.scale || 1);
      if (fmt !== "3mf") wrap.rotation.x = -Math.PI / 2;
      wrap.add(obj);
      out.push({ name: p.name || ("Part " + (i + 1)), root: wrap });
    }
    return out;
  }

  async function mount(stage, readout, data, ui){
    var THREE = await import("three");
    var controlsMod = await import("three/addons/controls/OrbitControls.js");
    var loaded = await loadParts(THREE, data.parts || []);
    if (!loaded.length) return null;

    var dark = document.documentElement.classList.contains("dark");
    var scene = new THREE.Scene();
    var world = new THREE.Group();
    scene.add(world);
    loaded.forEach(function(p){ world.add(p.root); });
    world.updateMatrixWorld(true);

    // Sit the whole thing on the ground, centred, at its own scale (mm).
    var box = new THREE.Box3().setFromObject(world);
    var c = box.getCenter(new THREE.Vector3());
    world.position.set(-c.x, -box.min.y, -c.z);
    world.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(world);
    var size = box.getSize(new THREE.Vector3());
    var span = Math.max(size.x, size.y, size.z) || 1;

    // Every mesh, with its part, for picking, explode and the section.
    var meshes = [];
    loaded.forEach(function(p, pi){
      p.root.traverse(function(o){ if (o.isMesh) meshes.push({ mesh: o, part: pi }); });
    });

    var plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), box.max.y);
    var clip = [];
    var palette = dark
      ? [0x9a958d, 0x8b9ae6, 0x7cc3bc, 0xe8c27a, 0xec917a, 0xb39ddb]
      : [0x4a4540, 0x5468c9, 0x4f9a93, 0xc8963f, 0xc9654a, 0x7e57c2];
    var edgeMat = new THREE.LineBasicMaterial({ color: dark ? 0xd9d4cc : 0x6a655d, transparent: true, opacity: 0.5, clippingPlanes: clip });
    var capColor = dark ? 0xec917a : 0xc9654a;

    meshes.forEach(function(m, i){
      var color = loaded.length > 1 ? palette[m.part % palette.length] : palette[0];
      m.mesh.material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.04, side: THREE.DoubleSide, clippingPlanes: clip });
      m.mesh.castShadow = true;
      m.mesh.renderOrder = 6;
      if (m.mesh.geometry.attributes.position.count < 600000) {
        m.mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.mesh.geometry, 30), edgeMat));
      }
      // Stencil pair for the section cap (three.js webgl_clipping_stencil):
      // back faces increment, front faces decrement, so inside the solid
      // the stencil is non-zero exactly where the cut plane meets it.
      var base = new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc });
      // Assigned after clone(): Material.copy clones clipping planes, and
      // a cloned plane never sees the slider move.
      var back = base.clone(); back.side = THREE.BackSide; back.clippingPlanes = [plane];
      back.stencilFail = back.stencilZFail = back.stencilZPass = THREE.IncrementWrapStencilOp;
      var front = base.clone(); front.side = THREE.FrontSide; front.clippingPlanes = [plane];
      front.stencilFail = front.stencilZFail = front.stencilZPass = THREE.DecrementWrapStencilOp;
      var b = new THREE.Mesh(m.mesh.geometry, back); b.renderOrder = 1;
      var f = new THREE.Mesh(m.mesh.geometry, front); f.renderOrder = 1;
      b.visible = f.visible = false;
      m.stencil = [b, f];
      m.mesh.add(b); m.mesh.add(f);
    });

    var cap = new THREE.Mesh(
      new THREE.PlaneGeometry(span * 4, span * 4),
      new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.8, metalness: 0, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp, side: THREE.DoubleSide })
    );
    cap.renderOrder = 2;
    cap.visible = false;
    cap.onAfterRender = function(r){ r.clearStencil(); };
    scene.add(cap);

    scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x3a3631 : 0xcfc6b8, 0.9));
    var key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(span * 1.2, span * 3, span * 1.6); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    var sc = key.shadow.camera; sc.left = sc.bottom = -span * 1.5; sc.right = sc.top = span * 1.5; sc.far = span * 8;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xfff4e6, 0.7); fill.position.set(-span * 2, span, span); scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-span, span * 2, -span * 2); scene.add(rim);
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 8, span * 8), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.16 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

    var w = stage.clientWidth, hgt = stage.clientHeight;
    var camera = new THREE.PerspectiveCamera(32, w / hgt, span / 100, span * 50);
    var radius = size.length() / 2;
    var dist = radius / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.05;
    var target = new THREE.Vector3(0, size.y / 2, 0);
    camera.position.copy(new THREE.Vector3(1, 0.75, 1).normalize().multiplyScalar(dist)).add(target);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, hgt);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    stage.appendChild(renderer.domElement);

    var controls = new controlsMod.OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.minDistance = span * 0.1; controls.maxDistance = span * 12;
    controls.update();

    var dirty = true;
    controls.addEventListener("change", function(){ dirty = true; });
    (function loop(){
      requestAnimationFrame(loop);
      controls.update();
      if (dirty) { renderer.render(scene, camera); dirty = false; }
    })();
    if (window.ResizeObserver) new ResizeObserver(function(){
      var nw = stage.clientWidth, nh = stage.clientHeight;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh); dirty = true;
    }).observe(stage);

    /* ---------- section ---------- */
    // Axis names are the part's own (Z is up, as in a slicer), mapped to
    // three.js world axes after the Z-up rotation above.
    var AXES = {
      z: { n: new THREE.Vector3(0, -1, 0), lo: function(){ return box.min.y; }, hi: function(){ return box.max.y; }, label: "Z (height)" },
      x: { n: new THREE.Vector3(-1, 0, 0), lo: function(){ return box.min.x; }, hi: function(){ return box.max.x; }, label: "X (width)" },
      // Part Y is world -Z. Keeping the far side (part y >= cut) puts the
      // cut face toward the default camera, as on the other two axes.
      y: { n: new THREE.Vector3(0, 0, -1), sign: -1, lo: function(){ return -box.max.z; }, hi: function(){ return -box.min.z; }, label: "Y (depth)" }
    };
    var section = { on: false, axis: "z", t: 0.5 };
    function applySection(){
      var a = AXES[section.axis];
      var lo = a.lo(), hi = a.hi();
      var at = lo + (hi - lo) * section.t;
      // Keeps n·p + d >= 0: below the cut on Z and X, beyond it on Y.
      plane.normal.copy(a.n);
      plane.constant = (a.sign || 1) * at;
      clip.length = 0;
      if (section.on) clip.push(plane);
      meshes.forEach(function(m){
        m.stencil[0].visible = m.stencil[1].visible = section.on;
        // Turning clipping on or off changes the shader; recompile.
        m.mesh.material.needsUpdate = true;
      });
      edgeMat.needsUpdate = true;
      cap.visible = section.on;
      plane.coplanarPoint(cap.position);
      cap.lookAt(cap.position.clone().sub(plane.normal));
      dirty = true;
      return at - lo;
    }

    /* ---------- explode ---------- */
    var explode = 0;
    var bases = meshes.map(function(m){
      var wc = new THREE.Box3().setFromObject(m.mesh).getCenter(new THREE.Vector3());
      return { pos: m.mesh.position.clone(), wc: wc };
    });
    var center = box.getCenter(new THREE.Vector3());
    var framed = box.getBoundingSphere(new THREE.Sphere());
    function applyExplode(){
      var dirs = meshes.map(function(m, i){
        var dir = bases[i].wc.clone().sub(center);
        if (dir.length() < span * 0.02) dir.set(0, (i - (meshes.length - 1) / 2) || 0.5, 0);
        return dir.normalize().multiplyScalar(span * 0.45 * explode);
      });
      // Lift the set so the lowest part stays on the ground instead of
      // sinking through it.
      var lowest = Math.min.apply(null, dirs.map(function(d){ return d.y; }).concat([0]));
      meshes.forEach(function(m, i){
        var dir = dirs[i]; dir.y -= lowest;
        var parent = m.mesh.parent;
        var a = parent.worldToLocal(bases[i].wc.clone());
        var b = parent.worldToLocal(bases[i].wc.clone().add(dir));
        m.mesh.position.copy(bases[i].pos).add(b.sub(a));
      });
      // Keep the spread-out set in frame: follow its centre and back off
      // as it grows, from wherever the user has orbited to.
      world.updateMatrixWorld(true);
      var sphere = new THREE.Box3().setFromObject(world).getBoundingSphere(new THREE.Sphere());
      var offset = camera.position.clone().sub(controls.target);
      offset.multiplyScalar(sphere.radius / framed.radius);
      controls.target.copy(sphere.center);
      camera.position.copy(sphere.center).add(offset);
      framed = sphere;
      controls.update();
      dirty = true;
    }

    /* ---------- measure ---------- */
    var measuring = false, picks = [];
    var markGeo = new THREE.SphereGeometry(span / 120, 16, 12);
    var markMat = new THREE.MeshBasicMaterial({ color: 0x5468c9, depthTest: false });
    var lineMat = new THREE.LineBasicMaterial({ color: 0x5468c9, depthTest: false });
    var marks = new THREE.Group(); marks.renderOrder = 10; scene.add(marks);
    var ray = new THREE.Raycaster();
    var down = null;
    renderer.domElement.addEventListener("pointerdown", function(e){ down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener("pointerup", function(e){
      if (!measuring || !down) return;
      if (Math.abs(e.clientX - down[0]) + Math.abs(e.clientY - down[1]) > 5) return;
      var r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
      var hits = ray.intersectObjects(meshes.map(function(m){ return m.mesh; }), false)
        .filter(function(hh){ return !section.on || plane.distanceToPoint(hh.point) >= -1e-6; });
      if (!hits.length) return;
      if (picks.length === 2) { picks = []; marks.clear(); }
      picks.push(hits[0].point.clone());
      var dot = new THREE.Mesh(markGeo, markMat); dot.position.copy(hits[0].point); dot.renderOrder = 10; marks.add(dot);
      if (picks.length === 2) {
        var ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(picks), lineMat); ln.renderOrder = 10; marks.add(ln);
        var d = picks[1].clone().sub(picks[0]);
        // World -> part axes: x = x, y = -z, z = y.
        readout.textContent = mm(d.length()) + "  ·  Δx " + mm(Math.abs(d.x)) + "  Δy " + mm(Math.abs(d.z)) + "  Δz " + mm(Math.abs(d.y));
        readout.style.display = "block";
        ui.changed();
      } else {
        readout.textContent = "Click a second point";
        readout.style.display = "block";
      }
      dirty = true;
    });

    return {
      partCount: loaded.length,
      partNames: loaded.map(function(p){ return p.name; }),
      setSection: function(on, axis, t){
        section.on = on; if (axis) section.axis = axis; if (t != null) section.t = t;
        return applySection();
      },
      sectionAxisLabel: function(){ return AXES[section.axis].label; },
      setExplode: function(v){ explode = v; applyExplode(); },
      setMeasure: function(on){
        measuring = on;
        if (!on) { picks = []; marks.clear(); readout.style.display = "none"; dirty = true; }
        else { readout.textContent = "Click two points on the part"; readout.style.display = "block"; }
      },
      measurement: function(){
        if (picks.length !== 2) return null;
        var d = picks[1].clone().sub(picks[0]);
        return { distanceMm: +d.length().toFixed(2), dxMm: +Math.abs(d.x).toFixed(2), dyMm: +Math.abs(d.z).toFixed(2), dzMm: +Math.abs(d.y).toFixed(2) };
      },
      section: function(){ return section; },
      explode: function(){ return explode; }
    };
  }

  function render(data){
    if (started) return;
    started = true;
    var g = data.geometry || {};
    var s = g.sizeMm;
    var readout = h("div", { "class": "readout" });
    var stage = h("div", { "class": "stage", role: "img", "aria-label": "3D view of " + (data.title || "the model") }, [
      h("div", { "class": "fallback" }, ["Loading 3D view…"]), readout
    ]);
    var tools = h("div", { "class": "tools" });
    var controlsRow = h("div", { style: "display:flex;flex-direction:column;gap:8px" });

    var facts = h("div", { "class": "facts" }, [
      g.volumeCm3 != null ? h("span", { "class": "fact" }, ["Volume ", h("b", null, [g.volumeCm3 + " cm³"])]) : null,
      g.thinnestWallMm != null ? h("span", { "class": "fact" }, ["Thinnest wall ", h("b", null, [g.thinnestWallMm + " mm"])]) : null,
      g.watertight != null ? h("span", { "class": "fact" }, [g.watertight ? "Watertight" : "Not watertight"]) : null,
      g.shells != null && g.shells > 1 ? h("span", { "class": "fact" }, [g.shells + " separate pieces"]) : null
    ]);
    var issues = Array.isArray(data.issues) ? data.issues : [];
    var issueList = issues.length
      ? h("ul", { "class": "issues" }, issues.slice(0, 5).map(function(i){ return h("li", null, [i.message]); }))
      : (data.printable === true ? h("ul", { "class": "issues" }, [h("li", { "class": "ok" }, ["No printing problems found."])]) : null);

    app.replaceChildren(
      h("div", { "class": "top" }, [
        h("h2", null, [data.title || "Model"]),
        s ? h("span", { "class": "size mono" }, [s.x + " × " + s.y + " × " + s.z + " mm"]) : null
      ]),
      stage, tools, controlsRow, facts, issueList
    );

    var ui = { changed: function(){} };
    mount(stage, readout, data, ui).then(function(v){
      if (!v) { stage.querySelector(".fallback").textContent = "The 3D view couldn't load here."; return; }
      stage.querySelector(".fallback").remove();

      var active = { section: false, measure: false, explode: false, full: false };
      var axis = "z", t = 0.5, ex = 0;

      function summary(){
        var bits = [];
        bits.push((data.title || "the model") + (v.partCount > 1 ? " (" + v.partCount + " parts: " + v.partNames.join(", ") + ")" : ""));
        if (active.section) bits.push("cut through on " + v.sectionAxisLabel() + " at " + mm(v.setSection(true, axis, t)) + " from the bottom of that axis");
        var m = v.measurement();
        if (m) bits.push("a measurement of " + m.distanceMm + " mm between two points they picked (dx " + m.dxMm + ", dy " + m.dyMm + ", dz " + m.dzMm + " mm)");
        if (ex > 0) bits.push("exploded " + Math.round(ex * 100) + "%");
        return bits.join("; ") + ".";
      }
      function changed(){
        shareContext({
          summary: summary(),
          state: {
            fileAssetIds: (data.parts || []).map(function(p){ return p.fileAssetId; }),
            section: active.section ? { axis: axis, fromMinMm: +v.setSection(true, axis, t).toFixed(2) } : null,
            measurement: v.measurement(),
            explode: ex
          }
        });
      }
      ui.changed = changed;

      function toolBtn(label, key, onToggle){
        var b = h("button", { "class": "tool", type: "button", "aria-pressed": "false" }, [label]);
        b.addEventListener("click", function(){
          active[key] = !active[key];
          b.setAttribute("aria-pressed", String(active[key]));
          onToggle(active[key]);
          changed();
        });
        return b;
      }

      // Section controls
      var secVal = h("span", { "class": "val mono" });
      var axisBtns = ["z", "x", "y"].map(function(a){
        var b = h("button", { "class": "tool small", type: "button", "aria-pressed": String(a === axis) }, [a.toUpperCase()]);
        b.addEventListener("click", function(){
          axis = a;
          axisBtns.forEach(function(x){ x.setAttribute("aria-pressed", String(x === b)); });
          secVal.textContent = mm(v.setSection(true, axis, t));
          changed();
        });
        return b;
      });
      var secRange = h("input", { type: "range", min: "0", max: "1000", value: "500", "aria-label": "Cut position" });
      secRange.addEventListener("input", function(){
        t = secRange.value / 1000;
        secVal.textContent = mm(v.setSection(true, axis, t));
        changed();
      });
      var secRow = h("div", { "class": "ctl", style: "display:none" }, [h("span", null, ["Cut"])].concat(axisBtns).concat([secRange, secVal]));

      // Explode controls
      var exRange = h("input", { type: "range", min: "0", max: "100", value: "0", "aria-label": "Explode" });
      exRange.addEventListener("input", function(){ ex = exRange.value / 100; v.setExplode(ex); changed(); });
      var exRow = h("div", { "class": "ctl", style: "display:none" }, [h("span", null, ["Explode"]), exRange]);

      tools.appendChild(toolBtn("Section", "section", function(on){
        secRow.style.display = on ? "flex" : "none";
        var at = v.setSection(on, axis, t);
        secVal.textContent = mm(at);
      }));
      tools.appendChild(toolBtn("Measure", "measure", function(on){ v.setMeasure(on); }));
      if (v.partCount > 1) tools.appendChild(toolBtn("Explode", "explode", function(on){
        exRow.style.display = on ? "flex" : "none";
        if (!on) { ex = 0; exRange.value = "0"; v.setExplode(0); }
      }));
      tools.appendChild(h("span", { "class": "spacer" }));
      tools.appendChild(toolBtn("Full screen", "full", function(on){ setFull(on); }));
      controlsRow.appendChild(secRow);
      controlsRow.appendChild(exRow);
    }).catch(function(e){
      console.warn("[materialize] inspector unavailable", e);
      var fb = stage.querySelector(".fallback");
      if (fb) fb.textContent = "The 3D view couldn't load here.";
    });
  }

  window.mz.onData(function(data){
    if (!data || data.kind !== "inspect" || !Array.isArray(data.parts)) return;
    render(data);
  });
})();
`;

export function inspectorWidgetHtml(): string {
  return widgetDocument({
    title: "Materialize inspector",
    styles: STYLES,
    body: BODY,
    script: SCRIPT,
    displayModes: ["inline", "fullscreen"],
  });
}
