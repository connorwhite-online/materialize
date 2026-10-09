import { widgetDocument } from "./shell";

/**
 * The material picker for materialize_recommend_material: each pick with
 * 5-step meters for strength, flex, detail and heat, one reason for and
 * one against, and what was ruled out and why. "Quote in X" hands the
 * choice back to the chat.
 */
export const MATERIALS_WIDGET_URI = "ui://materialize/materials-v1.html";

const STYLES = `
.hd{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;padding:2px 4px 0}
.hd h2{margin:0;font-size:24px;font-weight:700}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:12.5px;background:var(--soft-2);border-radius:999px;padding:6px 12px}
.axes,.meters{display:grid;grid-template-columns:120px repeat(4,minmax(0,1fr));gap:8px;align-items:center}
.axes{padding:0 16px;font-size:11.5px;color:var(--ink-3)}
.axes span{display:flex;align-items:center;gap:5px}
.pick{border-radius:22px;background:var(--soft);padding:16px;display:flex;flex-direction:column;gap:12px}
.pick.top{background:var(--pick-bg)}
.pname{font-size:16px;font-weight:700}
.pmeta{font-size:12px;color:var(--ink-3)}
.pips{display:flex;gap:3px}
.pips i{width:16px;height:8px;border-radius:999px;background:var(--track)}
.pips i.on{background:var(--print)}
.sum{margin:0;font-size:13.5px;line-height:1.45;color:var(--ink-2)}
.pc{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px;line-height:1.4}
.pc p{margin:0;display:flex;gap:7px}
.pc svg{flex-shrink:0;margin-top:2px}
.foot{display:flex;justify-content:space-between;align-items:center;gap:10px}
.out{background:var(--warn-bg);border-radius:18px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;font-size:13px}
.out p{margin:0;display:flex;gap:10px}
.out b{min-width:96px}
.notes{margin:0 4px;font-size:12px;color:var(--ink-3)}
@media (max-width:520px){.axes{display:none}.meters{grid-template-columns:1fr 1fr}.meters .who{grid-column:1/-1}.pc{grid-template-columns:1fr}}
`;

const BODY = `
<main class="card" id="app" aria-live="polite">
  <p class="muted" style="margin:4px">Loading materials…</p>
</main>
`;

const SCRIPT = `
(function(){
  var app = document.getElementById("app");
  var AXES = [["strength", "Strength"], ["flexibility", "Flex"], ["detail", "Detail"], ["heatResistance", "Heat"]];
  var ICONS = {
    strength: '<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>',
    flexibility: '<path d="M2 12c2.5-4 5-4 7.5 0s5 4 7.5 0 3.5-3 5-2"/>',
    detail: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    heatResistance: '<path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z"/>'
  };
  var USE = { prototype: "A quick prototype", functional: "A functional part", display: "A display piece", outdoor: "An outdoor part", flexible: "A flexible part", high_temp: "A part that gets hot", miniature: "A miniature" };
  var TIER = { budget: "$", mid: "$$", premium: "$$$" };

  function h(tag, attrs, kids){
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "onclick") n.addEventListener("click", v);
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, String(v));
    });
    (kids || []).forEach(function(c){
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function icon(paths, size){
    return '<svg width="' + (size || 13) + '" height="' + (size || 13) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
  }
  function pips(n, label){
    var row = h("div", { "class": "pips", role: "img", "aria-label": label + " " + n + " of 5" });
    for (var i = 1; i <= 5; i++) row.appendChild(h("i", { "class": i <= n ? "on" : "" }));
    return row;
  }
  function reqChip(applied){
    var parts = [];
    AXES.forEach(function(a){ if (applied && applied[a[0]]) parts.push(a[1] + " " + applied[a[0]] + "+"); });
    if (applied && applied.maxPrice) parts.push("Up to " + (TIER[applied.maxPrice] || applied.maxPrice));
    return parts.length ? h("span", { "class": "chip" }, [parts.join(" · ")]) : null;
  }

  // The meters already say what a material is good at; the card adds the
  // catalog's description and only the cautions, in plain words.
  function cons(p){
    var out = (p.watchOut || []).map(function(w){
      return w.replace(/ \\(\\d\\/5\\)$/, "").replace(/^low /, "Low ").replace(/^rigid:/, "Rigid:");
    });
    if (p.fit && p.fit.verdict !== "good" && p.fit.reasons && p.fit.reasons[0]) out.unshift(p.fit.reasons[0]);
    return out.slice(0, 2);
  }

  function card(p, i){
    var s = p.scores || {};
    var name = p.name;
    return h("section", { "class": "pick" + (i === 0 ? " top" : ""), "aria-label": name }, [
      h("div", { "class": "meters" }, [
        h("div", { "class": "who", style: "display:flex;flex-direction:column;gap:2px" }, [
          h("span", { "class": "pname rounded" }, [name]),
          h("span", { "class": "pmeta" }, [p.method + " · " + (TIER[p.priceTier] || p.priceTier)])
        ])
      ].concat(AXES.map(function(a){ return pips(s[a[0]] || 0, a[1]); }))),
      p.summary ? h("p", { "class": "sum" }, [p.summary]) : null,
      cons(p).length ? h("div", { "class": "pc" }, cons(p).map(function(c){
        return h("p", null, [h("span", { html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--warn-ink)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 8v5M12 16.5h.01"/><circle cx="12" cy="12" r="9"/></svg>' }), c]);
      })) : null,
      h("div", { "class": "foot" }, [
        i === 0 ? h("span", { "class": "pill", style: "background:var(--bg);color:var(--pick-ink)" }, ["Best fit"]) : h("span"),
        h("button", { "class": "btn " + (i === 0 ? "btn-primary" : "btn-soft"), type: "button", style: "min-height:44px;font-size:14px", onclick: function(){
          window.mz.followUp("Get print quotes in " + name + ".");
        } }, ["Quote in " + name])
      ])
    ]);
  }

  function render(d){
    var picks = d.picks || [];
    var head = h("div", { "class": "hd" }, [
      h("div", { style: "display:flex;flex-direction:column;gap:3px" }, [
        h("span", { "class": "muted", style: "font-size:12px" }, [d.basedOnFile ? "Materials for " + d.basedOnFile : "Materials for"]),
        h("h2", { "class": "rounded" }, [USE[d.useCase] || "Your part"])
      ]),
      h("div", { "class": "chips" }, [reqChip(d.applied)])
    ]);
    var axes = h("div", { "class": "axes", "aria-hidden": "true" }, [h("span")].concat(AXES.map(function(a){
      return h("span", { html: icon(ICONS[a[0]]) + a[1] });
    })));
    var out = (d.ruledOut || []).slice(0, 4);
    var outBox = out.length ? h("section", { "class": "out", "aria-label": "Ruled out" }, [
      h("p", { style: "font-weight:600;color:var(--warn-ink)" }, ["Ruled out"])
    ].concat(out.map(function(r){ return h("p", null, [h("b", null, [r.name]), h("span", null, [r.reason])]); }))) : null;
    var kids = [head, picks.length ? axes : null].concat(picks.slice(0, 4).map(card)).concat([outBox]);
    if (!picks.length) kids.push(h("p", { "class": "muted", style: "margin:4px" }, ["Nothing met every requirement."]));
    app.replaceChildren.apply(app, kids.filter(Boolean));
  }

  window.mz.onData(function(data){
    if (!data || !Array.isArray(data.picks)) return;
    render(data);
  });
})();
`;

export function materialsWidgetHtml(): string {
  return widgetDocument({
    title: "Materialize materials",
    styles: STYLES,
    body: BODY,
    script: SCRIPT,
  });
}
