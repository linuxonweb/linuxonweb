// .call semantics test (hot loops); prints results to compare across modes.
var out = [];
function P(s) { out.push(String(s)); }
function show(v) {
  if (v === null) return "null";
  var t = typeof v;
  if (t === "object" || t === "function") {
    try { return t + ":" + Object.prototype.toString.call(v) + (v && v.tag ? ":" + v.tag : ""); } catch (e) { return t + ":?"; }
  }
  return t + ":" + String(v);
}
var N = 400;
function sloppy(a, b) { return show(this) + "|" + show(a) + "|" + show(b) + "|" + arguments.length; }
function strict(a, b) { "use strict"; return show(this) + "|" + show(a) + "|" + show(b) + "|" + arguments.length; }
function rest(a, ...r) { return show(this) + "|" + a + "|" + r.join(","); }
function dflt(a, b = 7) { return show(this) + "|" + a + "|" + b; }
function argsMod(a) { arguments[0] = 99; return a + "|" + arguments.length; }
function argsStrict(a) { "use strict"; arguments[0] = 99; return a + "|" + arguments.length; }
function many(a, b, c, d, e, f) { return [a, b, c, d, e, f].join(",") + "|" + arguments.length; }
var obj = { tag: "o" };
function run(name, fn) {
  var r, last;
  try {
    for (var i = 0; i < N; i++) { r = fn(i); if (i > 0 && r !== last) { P(name + " DIVERGE at " + i + ": " + last + " vs " + r); } last = r; }
    P(name + " = " + r);
  } catch (e) {
    P(name + " threw " + (e && e.constructor && e.constructor.name) + ": " + e.message);
  }
}
function runThrows(name, fn) {
  var msgs = {};
  for (var i = 0; i < N; i++) {
    try { var r = fn(i); msgs["ok:" + r] = 1; } catch (e) { msgs[(e && e.constructor && e.constructor.name) + ":" + e.message] = 1; }
  }
  P(name + " -> " + Object.keys(msgs).join(" ; "));
}
run("sloppy0", () => sloppy.call());
run("sloppy1", () => sloppy.call(obj));
run("sloppy2", () => sloppy.call(obj, 1));
run("sloppy3", () => sloppy.call(obj, 1, 2));
run("sloppy4", () => sloppy.call(obj, 1, 2, 3));
run("sloppyprim", () => sloppy.call(5, "x"));
run("sloppynull", () => sloppy.call(null, 1));
run("sloppyundef", () => sloppy.call(undefined, 1));
run("sloppystr", () => sloppy.call("s", 1, 2));
run("strict0", () => strict.call());
run("strictprim", () => strict.call(5, "x"));
run("strictnull", () => strict.call(null, 1));
run("strictundef", () => strict.call(undefined, 1, 2));
run("strictobj", () => strict.call(obj, 1, 2, 3, 4));
run("rest", () => rest.call(obj, 1, 2, 3, 4));
run("rest0", () => rest.call(obj));
run("dflt1", () => dflt.call(obj, 1));
run("dflt2", () => dflt.call(obj, 1, 2));
run("dfltU", () => dflt.call(obj, 1, undefined));
run("argsMod", () => argsMod.call(obj, 1, 2));
run("argsStrict", () => argsStrict.call(obj, 1));
run("many", (i) => many.call(obj, i % 3, 2, 3, 4, 5, 6, 7, 8));
run("manyfew", (i) => many.call(obj, i % 3));
run("closure", (i) => { var k = i % 5; function c(x) { return k + x + show(this); } return c.call(obj, 3); });
run("arrow", () => { var self = this; var a = (x) => show(this) + x; return a.call(obj, 1); });
// Native / bound / class / proxy / non-callable
run("native", () => Math.max.call(null, 1, 5, 3));
run("nativeslice", () => Array.prototype.slice.call([1, 2, 3], 1).join(","));
run("bound", () => sloppy.bind(obj, 1).call({ tag: "x" }, 2));
class K { constructor(a) { this.a = a; } }
runThrows("classctor", () => K.call(obj, 1));
runThrows("classctor0", () => K.call());
var px = new Proxy(sloppy, {});
run("proxy", () => px.call(obj, 1, 2));
var pxf = new Proxy(function () { return "pf"; }, { apply: function (t, th, args) { return "trap:" + show(th) + ":" + args.length; } });
run("proxytrap", () => pxf.call(obj, 1, 2));
runThrows("noncallable", () => Function.prototype.call.call({}, 1));
runThrows("noncallable2", () => { var o = { call: Function.prototype.call }; return o.call(1); });
run("callcall", () => Function.prototype.call.call(sloppy, obj, 1, 2));
run("callcallcall", () => Function.prototype.call.call(Function.prototype.call, sloppy, obj, 1));
// Own call property and later overwritten Function.prototype.call
function ownf(a) { return "ownf" + a; }
ownf.call = function (t, a) { return "own:" + show(t) + a; };
run("owncall", () => ownf.call(obj, 1));
// Exceptions
function thrower(a) { if (a > 0) throw new RangeError("boom" + a); return "nothrow"; }
runThrows("thrower", (i) => thrower.call(obj, i % 2));
// Stack
function stk() { return new Error().stack.split("\n").map(function (l) { return l.replace(/:\d+:\d+$/, ""); }).join(";"); }
function stkOuter() { return stk.call(obj); }
run("stack", () => stkOuter());
function stkStrict() { "use strict"; return Error().stack.split("\n").length; }
run("stack2", () => stkStrict.call(1));
// Recursion
function fib(n) { return n < 2 ? n : fib.call(this, n - 1) + fib.call(this, n - 2); }
run("fibcall", () => fib.call(null, 12));
function deep(n) { return n === 0 ? 0 : 1 + deep.call(null, n - 1); }
run("deepok", () => deep.call(null, 40));
// Generators / async-ish
function* gen(a) { yield show(this); yield a; }
run("gen", () => { var g = gen.call(obj, 4); return g.next().value + "," + g.next().value; });
// Methods using this
var C = function (x) { this.x = x; };
C.prototype.get = function (y) { return this.x + y; };
function Sub(x) { C.call(this, x * 2); }
run("superctor", (i) => new Sub(i % 4).x);
run("method", (i) => C.prototype.get.call({ x: i % 3 }, 10));
// Different arities on the same site
var fns = [sloppy, strict, rest, dflt, many];
run("polysite", (i) => fns[i % 5].call(obj, i % 7, 2));
// call on value that changes between scripted and native
var mix = [sloppy, Math.max, sloppy.bind(null), K];
runThrows("mixsite", (i) => mix[i % 4].call(null, 1, 2));
// Getter of this-boxing
function boxType() { return typeof this; }
run("box", () => boxType.call(1) + boxType.call("s") + boxType.call(true) + boxType.call(Symbol.iterator));
// Arguments object in callee via .call with no extra args
function argLen() { return arguments.length + ":" + Array.prototype.join.call(arguments, "-"); }
run("argLen0", () => argLen.call(obj));
run("argLen3", () => argLen.call(obj, 1, 2, 3));
// CallIgnoresRv
var side = 0;
function inc(d) { side += d; }
for (var i = 0; i < N; i++) inc.call(null, 1);
P("ignoresrv side=" + side);
// Overwrite Function.prototype.call last
var origCall = Function.prototype.call;
Function.prototype.call = function (t) { return "patched"; };
run("patched", () => sloppy.call(obj, 1));
Function.prototype.call = origCall;
run("restored", () => sloppy.call(obj, 1));
print(out.join("\n"));
print("FUNCALL DONE");
