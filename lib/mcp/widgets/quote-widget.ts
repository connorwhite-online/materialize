import { FALLBACK_ICON, widgetDocument } from "./shell";

/**
 * The quote widget for materialize_get_quote: the part in 3D with its
 * name and size, the cheapest option as line items with percent bars,
 * and a comparison of every option on one scale. Clicking an option
 * makes it the one shown; "Order this" hands the choice back to the chat.
 */

const STYLES = `
.head{display:flex;gap:16px;align-items:stretch}
.head .stage{width:200px;height:200px}
.facts{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;padding-top:4px}
.facts h2{margin:0;font-size:24px;font-weight:700;letter-spacing:-0.01em;overflow-wrap:anywhere}
.facts .file{margin:0;font-size:12.5px;color:var(--ink-3);overflow-wrap:anywhere}
.specs{display:grid;grid-template-columns:64px minmax(0,1fr);row-gap:5px;column-gap:12px;font-size:13.5px}
.ship{display:flex;align-items:center;gap:12px;background:var(--soft);border-radius:18px;padding:11px 14px}
.ship .ico{width:34px;height:34px;border-radius:999px;background:var(--bg);display:flex;align-items:center;justify-content:center;color:var(--ink-2);flex-shrink:0}
.panel{border-radius:22px;border:1px solid var(--line);padding:16px;display:flex;flex-direction:column;gap:14px}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.total{font-size:34px;font-weight:750;letter-spacing:-0.02em;line-height:1.1}
.items{display:flex;flex-direction:column;gap:9px}
.item{display:flex;flex-direction:column;gap:6px}
.item .line{display:flex;align-items:center;gap:10px}
.item .line .lbl{flex:1}
.item .pct{font-size:12.5px;color:var(--ink-3);min-width:40px;text-align:right}
.item .amt{font-weight:600;min-width:64px;text-align:right}
.item .bar{margin-left:20px}
.actions{display:flex;gap:10px}
.actions .btn{flex:1}
.list{display:flex;flex-direction:column;gap:10px}
.row{all:unset;box-sizing:border-box;cursor:pointer;border-radius:20px;background:var(--soft);padding:13px 15px;display:flex;flex-direction:column;gap:9px}
.row[aria-pressed="true"]{background:var(--pick-bg)}
.row .r1{display:flex;align-items:center;gap:10px}
.row .who{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.row .name{font-size:15px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.row .sub{font-size:13px;color:var(--ink-2)}
.row .price{font-size:20px;font-weight:750}
.stack{display:flex;height:10px;border-radius:999px;background:var(--track);gap:2px;overflow:hidden}
.panel .stack{height:12px}
.stack>i{display:block;height:100%;border-radius:999px}
.note{margin:0;display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--warn-ink)}
.vendor,.eta{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--ink-2)}
.vendor span,.eta span,.fac{display:inline-flex}
.eta{color:var(--good-ink);font-weight:600}
.row .name .fac{color:var(--ink-2)}
.proc{font-size:11px;font-weight:700;letter-spacing:0.04em;color:var(--ink-2);background:var(--soft-2);border-radius:999px;padding:2px 8px}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--ink-2)}
.legend span{display:flex;align-items:center;gap:6px}
@media (max-width:520px){.head{flex-direction:column}.head .stage{width:100%;height:220px}.actions{flex-direction:column}}
`;

const BODY = `
<main class="card" id="app" aria-live="polite">
  <p class="muted" style="margin:4px">Loading quotes…</p>
</main>
`;

const SCRIPT = `
(function(){
  var app = document.getElementById("app");
  var state = { data: null, pick: 0, view: "best", mounted: false };
  // The app's factory icon (components/icons/factory.tsx) and a truck.
  var FACTORY = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.86073 8.8356C5.9411 8.35341 6.35829 8 6.84713 8H9.15287C9.64171 8 10.0589 8.35341 10.1393 8.8356L12 20H4L5.86073 8.8356Z"/><path d="M19 3H10C8.89543 3 8 3.89543 8 5"/><path d="M15 14V11.4985C15 11.0867 14.5302 10.8515 14.2005 11.0981L10.9219 13.5508L12 20H20V11.4603C20 11.0558 19.5447 10.8188 19.2133 11.0507L15 14Z"/></svg>';
  var TRUCK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>';
  var COLORS = { print: "var(--print)", min: "var(--min)", ship: "var(--ship)", fee: "var(--fee)" };

  function h(tag, attrs, kids){
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if (v === undefined || v === null || v === false) return;
      if (k === "style") n.setAttribute("style", v);
      else if (k === "onclick") n.addEventListener("click", v);
      else if (k === "html") n.innerHTML = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function(c){
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    });
    return n;
  }
  function money(cents){ return "$" + (Math.round(cents) / 100).toFixed(2); }
  function pct(part, whole){ return whole > 0 ? Math.round(part / whole * 100) : 0; }
  // "Arrives Oct 17–21": the date it reaches them, not how long the
  // printer takes. Dates come from the server as YYYY-MM-DD (UTC).
  function arrival(q, short){
    if (!q.arrivesEarliest || !q.arrivesLatest) return days(q);
    var a = new Date(q.arrivesEarliest + "T12:00:00Z"), b = new Date(q.arrivesLatest + "T12:00:00Z");
    var md = { month: "short", day: "numeric", timeZone: "UTC" };
    var first = a.toLocaleDateString("en-US", md);
    var range = q.arrivesEarliest === q.arrivesLatest ? first
      : a.getUTCMonth() === b.getUTCMonth() ? first + "–" + b.getUTCDate()
      : first + " – " + b.toLocaleDateString("en-US", md);
    return (short ? "arrives " : "Arrives ") + range;
  }
  function days(q){
    var a = q.productionTimeFastDays, b = q.productionTimeSlowDays;
    if (a == null && b == null) return null;
    if (a == null || a === b) return "ready in " + (b || a) + " days";
    if (b == null) return "ready in " + a + " days";
    return "ready in " + a + "–" + b + " days";
  }
  function country(code){
    try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code; } catch (e) { return code; }
  }
  function parts(q, qty){
    return {
      print: q.priceCents * qty,
      min: q.minimumFeeCents || 0,
      ship: q.shippingPriceCents || 0,
      fee: q.serviceFeeCents || 0,
      total: q.totalCents != null ? q.totalCents : q.priceCents * qty + (q.shippingPriceCents || 0)
    };
  }
  function title(q){
    var f = q.finishGroupName && q.finishGroupName !== q.materialName ? q.finishGroupName : null;
    return q.materialName + (f ? ", " + f : "") + (q.color ? " · " + q.color : "");
  }
  // One entry per material + vendor (its cheapest config), best first,
  // then grouped by vendor + price: a vendor that charges the same for
  // five plastics is one row listing them, not five identical rows.
  // The server's lead and its alternative are always kept and are their
  // group's face, even when six cheaper groups come first.
  function options(quotes, lead){
    var keep = {};
    if (lead) { keep[lead.quoteId] = true; if (lead.alternative) keep[lead.alternative.quoteId] = true; }
    var seen = {}, groups = [], byKey = {};
    quotes.forEach(function(q){
      var k = q.materialId + "|" + q.vendorId;
      if (seen[k] && !keep[q.quoteId]) return;
      seen[k] = true;
      var g = q.vendorId + "|" + (q.totalCents != null ? q.totalCents : q.priceCents);
      var grp = byKey[g];
      if (grp) {
        if (keep[q.quoteId]) { grp.mats = [q.materialName].concat(grp.mats.filter(function(m){ return m !== q.materialName; })); grp.q = q; }
        else if (grp.mats.indexOf(q.materialName) < 0) grp.mats.push(q.materialName);
        return;
      }
      byKey[g] = { q: q, mats: [q.materialName] };
      groups.push(byKey[g]);
    });
    // Each material's cheapest first, so a comparison of seven nylons
    // shows seven nylons, not four FDM vendors; then the rest up to 8.
    var firstOf = {}, picked = [];
    groups.forEach(function(o){ if (!firstOf[o.q.materialId]) { firstOf[o.q.materialId] = true; picked.push(o); } });
    groups.forEach(function(o){ if (picked.length < 8 && picked.indexOf(o) < 0) picked.push(o); });
    groups.forEach(function(o){ if (keep[o.q.quoteId] && picked.indexOf(o) < 0) picked.push(o); });
    return groups.filter(function(o){ return picked.indexOf(o) >= 0; });
  }
  function indexOfQuote(opts, quoteId){
    for (var i = 0; i < opts.length; i++) if (opts[i].q.quoteId === quoteId) return i;
    return -1;
  }
  function alsoIn(o){
    var rest = o.mats.slice(1);
    if (!rest.length) return null;
    var shown = rest.slice(0, 3).join(", ");
    return "Same price in " + shown + (rest.length > 3 ? " and " + (rest.length - 3) + " more" : "");
  }

  function lineItem(color, label, cents, total, note, hollow){
    return h("div", { "class": "item" }, [
      h("div", { "class": "line" }, [
        h("span", { "class": "dot", style: hollow ? "border:2px solid " + color : "background:" + color }),
        h("span", { "class": "lbl" }, [label]),
        h("span", { "class": "pct" }, [note || (pct(cents, total) + "%")]),
        h("span", { "class": "amt" }, [money(cents)])
      ])
    ]);
  }
  // The same stacked bar the comparison uses, on this option's own total.
  function stackBar(pr){
    var segs = [["print", pr.print], ["min", pr.min], ["ship", pr.ship], ["fee", pr.fee]]
      .filter(function(s){ return s[1] > 0; })
      .map(function(s){ return h("i", { style: "width:" + (s[1] / pr.total * 100) + "%;min-width:6px;background:" + COLORS[s[0]] }); });
    return h("div", { "class": "stack", role: "img", "aria-label": "Printing " + pct(pr.print, pr.total) + "%, vendor minimum " + pct(pr.min, pr.total) + "%, shipping " + pct(pr.ship, pr.total) + "%, service fee " + pct(pr.fee, pr.total) + "%" }, segs);
  }

  function header(d){
    var part = d.part || {};
    var stage = h("div", { "class": "stage", id: "stage" }, [
      h("div", { "class": "fallback", id: "fallback", html: '${FALLBACK_ICON.replace(/'/g, "\\'")}' }),
      h("span", { "class": "hint", id: "hint", style: "display:none" }, ["Drag to spin"])
    ]);
    var specs = [];
    if (part.dimensionsMm) {
      var dm = part.dimensionsMm;
      specs.push(h("span", { "class": "muted" }, ["Size"]));
      specs.push(h("span", null, [[dm.x, dm.y, dm.z].map(function(v){ return Math.round(v * 100) / 100; }).join(" × ") + " mm"]));
    }
    if (part.volumeCm3 != null) {
      specs.push(h("span", { "class": "muted" }, ["Volume"]));
      specs.push(h("span", null, [(Math.round(part.volumeCm3 * 100) / 100) + " cm³"]));
    }
    if (d.quantity > 1) {
      specs.push(h("span", { "class": "muted" }, ["Quantity"]));
      specs.push(h("span", null, [String(d.quantity)]));
    }
    return [
      h("div", { "class": "head" }, [
        stage,
        h("div", { "class": "facts" }, [
          h("div", null, [
            h("h2", { "class": "rounded" }, [part.name || "Your model"]),
            part.filename ? h("p", { "class": "file mono" }, [part.filename]) : null
          ]),
          specs.length ? h("div", { "class": "specs" }, specs) : null
        ])
      ]),
      h("div", { "class": "ship" }, [
        h("span", { "class": "ico", html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>' }),
        h("div", { style: "display:flex;flex-direction:column;gap:1px" }, [
          h("span", { "class": "muted", style: "font-size:12px" }, ["Ships to"]),
          h("span", { style: "font-size:15px;font-weight:600" }, [country(d.countryCode || "US")])
        ])
      ])
    ];
  }

  function best(d, opts){
    var o = opts[state.pick] || opts[0];
    var q = o.q;
    var pr = parts(q, d.quantity || 1);
    var lead = d.lead;
    var isLead = lead && q.quoteId === lead.quoteId;
    var label = isLead ? (lead.why === "industrial" ? "Recommended" : "Best price")
      : state.pick === 0 ? "Cheapest" : "Option " + (state.pick + 1);
    var minLine = pr.min > 0
      ? lineItem(COLORS.min, "Vendor minimum", pr.min, pr.total)
      : lineItem(COLORS.min, "Vendor minimum", 0, pr.total, q.minimumKnown === false ? "not confirmed" : "none for this vendor", true);
    return h("section", { "class": "panel", "aria-label": "Price breakdown" }, [
      h("div", { "class": "top" }, [
        h("div", { style: "display:flex;flex-direction:column;gap:3px;min-width:0" }, [
          h("span", { "class": "muted", style: "font-size:12px" }, [label]),
          h("span", { style: "font-size:15px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap" }, [title(q), q.process ? h("span", { "class": "proc" }, [q.process]) : null]),
          h("span", { "class": "vendor" }, [h("span", { html: FACTORY }), q.vendorName]),
          arrival(q) ? h("span", { "class": "eta" }, [h("span", { html: TRUCK }), arrival(q)]) : null,
          alsoIn(o) ? h("span", { "class": "muted", style: "font-size:12.5px" }, [alsoIn(o)]) : null
        ]),
        h("div", { style: "display:flex;flex-direction:column;align-items:flex-end" }, [
          h("span", { "class": "total rounded" }, [money(pr.total)]),
          h("span", { "class": "muted", style: "font-size:12px" }, ["all-in, " + (q.currency || "USD")])
        ])
      ]),
      h("div", { "class": "items" }, [
        lineItem(COLORS.print, "Printing", pr.print, pr.total),
        pr.min > 0 ? minLine : null,
        lineItem(COLORS.ship, "Shipping", pr.ship, pr.total),
        lineItem(COLORS.fee, "Materialize service fee", pr.fee, pr.total),
        pr.min > 0 ? null : minLine
      ]),
      stackBar(pr)
    ]);
  }

  function compare(d, opts){
    var qty = d.quantity || 1;
    var max = opts.reduce(function(m, o){ return Math.max(m, parts(o.q, qty).total); }, 1);
    var rows = opts.map(function(o, i){
      var q = o.q;
      var pr = parts(q, qty);
      var sub = o.mats.length > 1
        ? o.mats.slice(0, 4).join(", ") + (o.mats.length > 4 ? " +" + (o.mats.length - 4) : "")
        : title(q);
      var segs = [["print", pr.print], ["min", pr.min], ["ship", pr.ship], ["fee", pr.fee]]
        .filter(function(s){ return s[1] > 0; })
        .map(function(s){ return h("i", { style: "width:" + (s[1] / max * 100) + "%;min-width:4px;background:" + COLORS[s[0]] }); });
      return h("button", { "class": "row", type: "button", "aria-pressed": String(i === state.pick), onclick: function(){ state.pick = i; state.view = "best"; render(); } }, [
        h("div", { "class": "r1" }, [
          h("div", { "class": "who" }, [
            h("span", { "class": "name" }, [
              h("span", { "class": "fac", html: FACTORY }), q.vendorName,
              q.process ? h("span", { "class": "proc" }, [q.process]) : null,
              d.lead && d.lead.why === "industrial" && q.quoteId === d.lead.quoteId ? h("span", { "class": "pill", style: "background:var(--pick-bg);color:var(--pick-ink);font-size:11.5px;padding:3px 9px" }, ["Recommended"]) : null,
              i === 0 ? h("span", { "class": "pill", style: "background:var(--good-bg);color:var(--good-ink);font-size:11.5px;padding:3px 9px" }, ["Cheapest"]) : null
            ]),
            h("span", { "class": "sub" }, [sub + (arrival(q, true) ? " · " + arrival(q, true) : "")])
          ]),
          h("span", { "class": "price rounded" }, [money(pr.total)])
        ]),
        h("div", { "class": "stack", role: "img", "aria-label": "Printing " + money(pr.print) + ", vendor minimum " + money(pr.min) + ", shipping " + money(pr.ship) + ", fee " + money(pr.fee) }, segs),
        pr.min > 0 ? h("p", { "class": "note" }, [h("span", { "class": "dot", style: "background:var(--min)" }), "Includes a " + money(pr.min) + " vendor minimum: the print alone is " + money(pr.print)]) : null
      ]);
    });
    return h("section", { style: "display:flex;flex-direction:column;gap:12px", "aria-label": "Compare options" }, [
      h("div", { style: "display:flex;justify-content:space-between;align-items:baseline;padding:0 4px" }, [
        h("h3", { style: "margin:0;font-size:15px;font-weight:650" }, [opts.length === 1 ? "1 option" : opts.length + " options, by what you pay"]),
        h("span", { "class": "muted", style: "font-size:12px" }, ["one shared scale"])
      ]),
      h("div", { "class": "list" }, rows),
      h("div", { "class": "legend" }, [
        h("span", null, [h("span", { "class": "dot", style: "background:var(--print)" }), "Printing"]),
        h("span", null, [h("span", { "class": "dot", style: "background:var(--min)" }), "Vendor minimum"]),
        h("span", null, [h("span", { "class": "dot", style: "background:var(--ship)" }), "Shipping"]),
        h("span", null, [h("span", { "class": "dot", style: "background:var(--fee)" }), "Service fee"])
      ])
    ]);
  }

  function render(){
    var d = state.data;
    var quotes = (d && d.quotes) || [];
    if (!quotes.length) {
      app.replaceChildren(h("p", { "class": "muted", style: "margin:4px" }, ["No quotes came back for this model."]));
      return;
    }
    var opts = options(quotes, d.lead);
    if (!state.picked) {
      state.picked = true;
      var li = d.lead ? indexOfQuote(opts, d.lead.quoteId) : -1;
      state.pick = li >= 0 ? li : 0;
    }
    var stageBefore = document.getElementById("stage");
    var kids = header(d);
    if (stageBefore) kids[0].replaceChild(stageBefore, kids[0].firstChild);
    var q = (opts[state.pick] || opts[0]).q;
    var actions = h("div", { "class": "actions" }, [
      h("button", { "class": "btn btn-primary", type: "button", onclick: function(){
        window.mz.followUp("Order the " + title(q) + " option from " + q.vendorName + " (" + money(parts(q, d.quantity || 1).total) + " all-in). Ask me for the shipping address and phone number to use.");
      } }, ["Order this"]),
      opts.length > 1 ? h("button", { "class": "btn btn-soft", type: "button", "aria-expanded": String(state.view === "compare"), onclick: function(){
        state.view = state.view === "compare" ? "best" : "compare"; render();
      } }, [state.view === "compare" ? "Show breakdown" : "Compare " + opts.length + " options"]) : null
    ]);
    var main = state.view === "compare" ? compare(d, opts) : best(d, opts);

    // warnings are written for the model (catalog gaps, unchecked
    // minimums), not the buyer; the card flags an unchecked minimum itself.
    app.replaceChildren.apply(app, kids.concat([main, actions]).filter(Boolean));
    if (!state.mounted && d.part && d.part.model) {
      state.mounted = true;
      var stage = document.getElementById("stage");
      window.mzViewer.mount(stage, d.part.model).then(function(ok){
        if (!ok) return;
        var fb = document.getElementById("fallback"); if (fb) fb.remove();
        var hint = document.getElementById("hint"); if (hint) hint.style.display = "";
      });
    }
  }

  window.mz.onData(function(data){
    if (!data || !Array.isArray(data.quotes)) return;
    state.data = data;
    render();
  });
})();
`;

export function quoteWidgetHtml(): string {
  return widgetDocument({
    title: "Materialize quote",
    styles: STYLES,
    body: BODY,
    script: SCRIPT,
  });
}
