/**
 * Shared pieces of the in-chat widgets (ChatGPT apps, Claude MCP Apps):
 * the page shell, the design tokens, the host bridge and the 3D viewer.
 *
 * A widget is one self-contained HTML document served as an MCP
 * resource (`ui://…`, mimeType `text/html;profile=mcp-app`) and rendered
 * by the host in a sandboxed iframe. It gets its data from the tool
 * result's structuredContent, delivered two ways that both have to work:
 *   - MCP Apps: JSON-RPC over postMessage (`ui/initialize`, then
 *     `ui/notifications/tool-result`). Claude, and ChatGPT's standard path.
 *   - ChatGPT's alias: `window.openai.toolOutput`, updated with an
 *     `openai:set_globals` event.
 * Rendering is idempotent, so getting both is fine.
 *
 * The widget scripts are written without template literals or `${`:
 * they live inside the template literals below.
 */

/** three.js from the CDN, pinned to the version the app ships. */
export const THREE_VERSION = "0.183.2";
export const WIDGET_CDN = "https://cdn.jsdelivr.net";

export const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

const STYLES = `
:root{
  --bg:#FFFFFF; --page:transparent; --ink:#1F1D1A; --ink-2:#4A453F; --ink-3:#7A7369;
  --soft:#F7F5F1; --soft-2:#F1EEE8; --track:#ECE8E1; --line:#EEEAE3; --stage:#F1EDE6;
  --print:#5468C9; --ship:#6FB5AE; --fee:#E3B25C; --min:#E07A5F;
  --good-ink:#1C6B3A; --good-bg:#E6F4EA; --pick-bg:#EEF0FB; --pick-ink:#2F3F94;
  --warn-ink:#8A3B22; --warn-bg:#FBF3EF;
  --btn:#1F1D1A; --btn-ink:#FFFFFF;
}
html.dark{
  --bg:#1E1D1B; --ink:#F3F1EC; --ink-2:#CFCAC2; --ink-3:#A39D93;
  --soft:#292825; --soft-2:#302E2B; --track:#3A3834; --line:#34322E; --stage:#2A2825;
  --print:#8B9AE6; --ship:#7CC3BC; --fee:#E8C27A; --min:#EC917A;
  --good-ink:#8FD3A5; --good-bg:#1F3326; --pick-bg:#262B45; --pick-ink:#C3CBF5;
  --warn-ink:#F2B9A6; --warn-bg:#3A2621;
  --btn:#F3F1EC; --btn-ink:#1F1D1A;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--page)}
body{font-family:-apple-system,"SF Pro Text",system-ui,sans-serif;color:var(--ink);font-size:14px;line-height:1.4;-webkit-font-smoothing:antialiased}
.rounded{font-family:ui-rounded,-apple-system,system-ui,sans-serif}
.mono{font-family:ui-monospace,"SF Mono",Menlo,monospace}
.card{background:var(--bg);border-radius:28px;padding:16px;display:flex;flex-direction:column;gap:14px}
.muted{color:var(--ink-3)}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 20px;border-radius:999px;border:0;font:inherit;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none}
.btn-primary{background:var(--btn);color:var(--btn-ink)}
.btn-soft{background:var(--soft-2);color:var(--ink)}
.btn:focus-visible,.row:focus-visible{outline:2px solid var(--print);outline-offset:2px}
.stage{position:relative;border-radius:22px;background:radial-gradient(120% 90% at 50% 35%,var(--bg) 0%,var(--stage) 75%);overflow:hidden;flex-shrink:0}
.stage canvas{display:block;width:100%!important;height:100%!important;touch-action:pan-y}
.stage .hint{position:absolute;left:10px;bottom:10px;font-size:11.5px;color:var(--ink-2);background:color-mix(in srgb,var(--bg) 85%,transparent);padding:5px 10px;border-radius:999px;display:inline-flex;gap:5px;align-items:center}
.stage .fallback{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--ink-3);font-size:12px}
.dot{width:10px;height:10px;border-radius:999px;flex-shrink:0;display:inline-block}
.bar{height:6px;border-radius:999px;background:var(--track)}
.bar>i{display:block;height:6px;border-radius:999px;min-width:6px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

/**
 * Host bridge. Exposes window.mz = { onData(fn), openLink(url),
 * followUp(text), theme }. onData fires with structuredContent whenever
 * the host delivers (or redelivers) the tool result.
 */
const BRIDGE = `
(function(){
  var nextId = 0, pending = {}, handlers = [], last = null;
  function post(msg){ try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function request(method, params){
    var id = ++nextId;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function(resolve, reject){
      pending[id] = { resolve: resolve, reject: reject };
      setTimeout(function(){ if (pending[id]) { delete pending[id]; reject(new Error("timeout")); } }, 8000);
    });
  }
  function notify(method, params){ post({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function emit(data){
    if (!data || typeof data !== "object") return;
    last = data;
    handlers.forEach(function(fn){ try { fn(data); } catch (e) { console.error(e); } });
  }
  function setTheme(t){ document.documentElement.classList.toggle("dark", t === "dark"); }
  function fromOpenAI(){
    var o = window.openai;
    if (!o) return;
    if (o.theme) setTheme(o.theme);
    if (o.toolOutput) emit(o.toolOutput);
  }
  window.addEventListener("message", function(e){
    if (e.source !== window.parent) return;
    var m = e.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id !== undefined && pending[m.id]) {
      var p = pending[m.id]; delete pending[m.id];
      if (m.error) p.reject(m.error); else p.resolve(m.result);
      return;
    }
    if (m.method === "ui/notifications/tool-result") emit(m.params && m.params.structuredContent);
    if (m.method === "ui/notifications/host-context-changed" && m.params && m.params.theme) setTheme(m.params.theme);
  });
  window.addEventListener("openai:set_globals", fromOpenAI);
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
  fromOpenAI();
  request("ui/initialize", {
    appInfo: { name: "materialize-widget", version: "1.0.0" },
    appCapabilities: {},
    protocolVersion: "2026-01-26"
  }).then(function(res){
    var ctx = res && res.hostContext;
    if (ctx && ctx.theme) setTheme(ctx.theme);
    notify("ui/notifications/initialized");
  }).catch(function(){});
  if (window.ResizeObserver) {
    new ResizeObserver(function(){
      notify("ui/notifications/size-changed", { height: Math.ceil(document.documentElement.scrollHeight) });
    }).observe(document.body);
  }
  window.mz = {
    onData: function(fn){ handlers.push(fn); if (last) fn(last); },
    openLink: function(url){
      if (window.openai && window.openai.openExternal) { window.openai.openExternal({ href: url }); return; }
      request("ui/open-link", { url: url }).catch(function(){ window.open(url, "_blank", "noopener"); });
    },
    followUp: function(text){
      if (window.openai && window.openai.sendFollowUpMessage) { window.openai.sendFollowUpMessage({ prompt: text }); return; }
      request("ui/message", { role: "user", content: [{ type: "text", text: text }] }).catch(function(){});
    }
  };
})();
`;

/**
 * 3D viewer. window.mzViewer.mount(el, { url, format }) renders the model
 * with soft studio light, crisp edges and a slow turntable the user can
 * drag; resolves false (and leaves the fallback showing) on any failure:
 * no WebGL, CDN blocked, expired link, unsupported format.
 */
const VIEWER = `
window.mzViewer = {
  mount: async function(el, model){
    if (!model || !model.url) return false;
    var fmt = String(model.format || "").toLowerCase();
    if (fmt !== "stl" && fmt !== "obj" && fmt !== "3mf") return false;
    try {
      var THREE = await import("three");
      var controlsMod = await import("three/addons/controls/OrbitControls.js");
      var loaderMod = fmt === "stl" ? await import("three/addons/loaders/STLLoader.js")
        : fmt === "obj" ? await import("three/addons/loaders/OBJLoader.js")
        : await import("three/addons/loaders/3MFLoader.js");
      var res = await fetch(model.url);
      if (!res.ok) return false;
      var object;
      if (fmt === "stl") {
        var geom = new loaderMod.STLLoader().parse(await res.arrayBuffer());
        object = new THREE.Mesh(geom);
      } else if (fmt === "obj") {
        object = new loaderMod.OBJLoader().parse(await res.text());
      } else {
        object = new loaderMod.ThreeMFLoader().parse(await res.arrayBuffer());
      }
      var dark = document.documentElement.classList.contains("dark");
      var mat = new THREE.MeshStandardMaterial({ color: dark ? 0x9a958d : 0x4a4540, roughness: 0.55, metalness: 0.04 });
      var edgeMat = new THREE.LineBasicMaterial({ color: dark ? 0xd9d4cc : 0x6a655d, transparent: true, opacity: 0.55 });
      var group = new THREE.Group();
      object.traverse(function(o){
        if (o.isMesh) {
          o.material = mat; o.castShadow = true;
          if (o.geometry.attributes.position.count < 600000) {
            o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), edgeMat));
          }
        }
      });
      group.add(object);
      // Printable models are Z-up; three.js is Y-up.
      if (fmt !== "3mf") group.rotation.x = -Math.PI / 2;
      var box = new THREE.Box3().setFromObject(group);
      var size = box.getSize(new THREE.Vector3());
      var center = box.getCenter(new THREE.Vector3());
      var radius = Math.max(size.x, size.y, size.z) || 1;
      group.position.sub(center);
      group.position.y += size.y / 2;
      var pivot = new THREE.Group(); pivot.add(group);
      var s = 2 / radius; pivot.scale.setScalar(s);

      var scene = new THREE.Scene();
      scene.add(pivot);
      scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x3a3631 : 0xcfc6b8, 0.9));
      var key = new THREE.DirectionalLight(0xffffff, 2.6);
      key.position.set(2.5, 8, 3.5); key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
      key.shadow.radius = 6;
      scene.add(key);
      var fill = new THREE.DirectionalLight(0xfff4e6, 0.7); fill.position.set(-5, 2.5, 2); scene.add(fill);
      var rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-2, 4, -5); scene.add(rim);
      var ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: dark ? 0.35 : 0.16 }));
      ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

      var w = el.clientWidth, h = el.clientHeight;
      var camera = new THREE.PerspectiveCamera(30, w / h, 0.1, 100);
      var height = size.y * s;
      // Frame the bounding sphere with some air, from a 3/4 view.
      var sphere = Math.sqrt(size.x * size.x + size.y * size.y + size.z * size.z) * s / 2;
      var dist = sphere / Math.sin((camera.fov * Math.PI / 180) / 2) * 1.08;
      var dir = new THREE.Vector3(1, 0.78, 1).normalize();
      camera.position.copy(dir.multiplyScalar(dist)).add(new THREE.Vector3(0, height / 2, 0));
      var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      el.appendChild(renderer.domElement);

      var controls = new controlsMod.OrbitControls(camera, renderer.domElement);
      controls.target.set(0, height / 2, 0);
      controls.enableZoom = false; controls.enablePan = false; controls.enableDamping = true;
      controls.minPolarAngle = 0.2; controls.maxPolarAngle = Math.PI / 2 - 0.05;
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      controls.autoRotate = !reduce; controls.autoRotateSpeed = 1.6;
      controls.addEventListener("start", function(){ controls.autoRotate = false; });
      controls.update();

      (function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
      if (window.ResizeObserver) new ResizeObserver(function(){
        var nw = el.clientWidth, nh = el.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
      }).observe(el);
      return true;
    } catch (e) {
      console.warn("[materialize] 3D preview unavailable", e);
      return false;
    }
  }
};
`;

/** A cube outline shown until (or instead of) the 3D view. */
export const FALLBACK_ICON = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/></svg>`;

export function widgetDocument(opts: { title: string; body: string; script: string; styles?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>${STYLES}${opts.styles ?? ""}</style>
<script type="importmap">{"imports":{"three":"${WIDGET_CDN}/npm/three@${THREE_VERSION}/build/three.module.js","three/addons/":"${WIDGET_CDN}/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>
</head>
<body>
${opts.body}
<script>${BRIDGE}</script>
<script>${VIEWER}</script>
<script>${opts.script}</script>
</body>
</html>`;
}
