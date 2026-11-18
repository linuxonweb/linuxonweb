// Extra getter cases for PBLBC_GETTER: over-recursion, realms, debugger, generator/async getters.
var out = [];
function P(s) { out.push(String(s)); }
var N = 400;
// Unbounded recursion through a getter: caught at several depths.
var deep = { get d() { return this.d + 1; } };
var msgs = {};
for (var i = 0; i < 30; i++) {
  try { deep.d; msgs["ok"] = 1; } catch (e) { msgs[e.constructor.name + ":" + e.message] = 1; }
}
P("deepRec -> " + Object.keys(msgs).join(" ; "));
// Recursion via getter + call alternation, counted depth on catch.
var depth = 0, maxd = 0;
var alt = { get a() { depth++; if (depth > maxd) maxd = depth; try { return f2(); } finally { depth--; } } };
function f2() { return alt.a; }
var c2 = {};
for (var i = 0; i < 10; i++) { try { alt.a; } catch (e) { c2[e.constructor.name] = 1; } }
P("altRec -> " + Object.keys(c2).join(",") + " depth0=" + depth);
// Getter defined in another realm (same compartment) and in another compartment.
if (typeof newGlobal === "function") {
  var g1 = newGlobal({ sameCompartmentAs: this });
  g1.eval("var ro = { get v() { return typeof globalThis.ro + ':' + (this === ro); } };");
  var ro = g1.ro, rr;
  for (var i = 0; i < N; i++) rr = ro.v;
  P("realmGet = " + rr);
  var g2 = newGlobal({ newCompartment: true });
  g2.eval("var co = { get v() { return 'cc' + (this === co); } };");
  var co = g2.co, cr;
  for (var i = 0; i < N; i++) cr = co.v;
  P("compGet = " + cr);
  // Debugger observing the getter frames midway.
  var dg = newGlobal({ newCompartment: true });
  dg.eval("var dob = { n: 0, get v() { return this.n++; } }; function loop(k) { var s = 0; for (var i = 0; i < k; i++) s += dob.v; return s; }");
  P("dbgBefore = " + dg.loop(N));
  var dbg = new Debugger(dg);
  var entered = 0, popped = 0;
  dbg.onEnterFrame = function (fr) { if (fr.callee && fr.callee.name === "get v") { entered++; fr.onPop = function () { popped++; }; } };
  P("dbgDuring = " + dg.loop(50) + " entered=" + entered + " popped=" + popped);
  dbg.removeAllDebuggees();
  P("dbgAfter = " + dg.loop(N));
}
// Generator / async functions as getters.
var gg = {};
Object.defineProperty(gg, "g", { get: function* () { yield this.k; }, configurable: true });
gg.k = 7;
var gs = 0;
for (var i = 0; i < N; i++) gs += gg.g.next().value;
P("genGetter = " + gs);
var ag = {};
Object.defineProperty(ag, "a", { get: async function () { return 1; } });
var ap = 0;
for (var i = 0; i < N; i++) ap += (ag.a instanceof Promise) ? 1 : 0;
P("asyncGetter = " + ap);
// Getter that triggers GC and allocation pressure.
var gcg = { get v() { var a = []; for (var j = 0; j < 50; j++) a.push({ j: j }); if (this.c++ % 97 === 0 && typeof gc === "function") gc(); return a.length; }, c: 0 };
var gt = 0;
for (var i = 0; i < 2000; i++) gt += gcg.v;
P("gcGetter = " + gt);
// Getter with a long loop (interrupt checks inside the callee) and try/catch.
var lg = { get v() { var s = 0; for (var j = 0; j < 300; j++) { try { if (j === 150) throw j; s += j; } catch (e) { s -= e; } } return s; } };
var lt = 0;
for (var i = 0; i < 300; i++) lt += lg.v;
P("loopGetter = " + lt);
// Exceptions thrown from deep inside getters caught by the reading frame.
var eg = { get v() { return inner(this.k++); }, k: 0 };
function inner(k) { if (k % 5 === 4) throw new TypeError("t" + k); return k; }
var ec = 0, es = 0;
for (var i = 0; i < N; i++) { try { es += eg.v; } catch (e) { ec++; } }
P("excGetter = " + es + " caught=" + ec);
print(out.join("\n"));
