// .apply semantics test (hot loops); prints results to compare across modes.
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
function argsAll() { var s = []; for (var i = 0; i < arguments.length; i++) s.push(show(arguments[i])); return s.join(",") + "|" + arguments.length; }
function sumAll() { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return s + "|" + arguments.length; }
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
// Arguments objects: mapped (sloppy, simple params) and unmapped (strict).
function fwdS() { return sloppy.apply(obj, arguments); }
function fwdT() { "use strict"; return sloppy.apply(obj, arguments); }
function fwdStrictT() { "use strict"; return strict.apply(this, arguments); }
function fwdMapped(a, b) { return sloppy.apply(obj, arguments); }
function fwdMappedMod(a, b) { a = 5; return sloppy.apply(obj, arguments); }
function fwdMappedClosed(a, b) { var f = () => a; a = 6; return sloppy.apply(obj, arguments) + f(); }
function fwdAll() { return argsAll.apply(null, arguments); }
function fwdMany() { return many.apply(obj, arguments); }
run("args0", () => fwdS());
run("args1", () => fwdS(1));
run("args2", () => fwdS(1, 2));
run("args5", () => fwdS(1, 2, 3, 4, 5));
run("argsT0", () => fwdT());
run("argsT3", () => fwdT(1, "x", obj));
run("argsStrict", () => fwdStrictT.call(7, 1, 2));
run("argsStrictU", () => fwdStrictT(1, 2));
run("mapped2", () => fwdMapped(1, 2));
run("mapped1", () => fwdMapped(1));
run("mapped3", () => fwdMapped(1, 2, 3));
run("mappedMod", () => fwdMappedMod(1, 2));
run("mappedClosed", () => fwdMappedClosed(1, 2));
run("argsAllMix", (i) => fwdAll(i % 3, null, undefined, "s", obj));
run("argsMany8", () => fwdMany(1, 2, 3, 4, 5, 6, 7, 8));
run("argsMany2", () => fwdMany(1, 2));
function lenMod() { arguments.length = 2; return argsAll.apply(null, arguments); }
run("lenMod", () => lenMod(1, 2, 3, 4));
function lenMod5() { arguments.length = 5; return argsAll.apply(null, arguments); }
run("lenMod5", () => lenMod5(1, 2));
function elemMod() { arguments[1] = "m"; return argsAll.apply(null, arguments); }
run("elemMod", () => elemMod(1, 2, 3));
function elemDel() { delete arguments[1]; return argsAll.apply(null, arguments); }
run("elemDel", () => elemDel(1, 2, 3));
Object.prototype[1] = "proto1";
run("elemDelProto", () => elemDel(1, 2, 3));
delete Object.prototype[1];
function elemDefGetter() { Object.defineProperty(arguments, 0, { get() { return "g"; } }); return argsAll.apply(null, arguments); }
run("elemGetter", () => elemDefGetter(1, 2));
function iterMod() { arguments[Symbol.iterator] = function* () { yield "it"; }; return argsAll.apply(null, arguments); }
run("iterMod", () => iterMod(1, 2));
var stored = [];
function escape() { stored.push(arguments); return argsAll.apply(null, arguments); }
run("escape", (i) => escape(i & 1, 2));
P("stored " + stored.length + " " + argsAll.apply(null, stored[5]));
function calleeArgs() { arguments[0] = "c"; return Array.prototype.join.call(arguments, ","); }
function fwdCalleeArgs() { var r = calleeArgs.apply(null, arguments); return r + "|" + Array.prototype.join.call(arguments, ","); }
run("calleeArgs", () => fwdCalleeArgs(1, 2, 3));
run("rest", () => (function () { return rest.apply(obj, arguments); })(1, 2, 3));
run("dflt", () => (function () { return dflt.apply(obj, arguments); })(1));
run("argsMod", () => (function () { return argsMod.apply(obj, arguments); })(1, 2));
run("argsStrictMod", () => (function () { return argsStrict.apply(obj, arguments); })(1, 2));
// Arrays.
var packed = [1, "a", obj, null, undefined];
run("arrPacked", () => argsAll.apply(null, packed));
run("arrHoley", () => argsAll.apply(null, [1, , 3]));
run("arrEmpty", () => argsAll.apply(null, []));
var frozen = Object.freeze([4, 5, 6]);
run("arrFrozen", () => argsAll.apply(null, frozen));
Array.prototype[1] = "AP1";
run("arrHoleProto", () => argsAll.apply(null, [1, , 3]));
run("arrPackedProto", () => argsAll.apply(null, [1, 2, 3]));
delete Array.prototype[1];
Object.defineProperty(Array.prototype, 2, { get() { return "getter2"; }, configurable: true });
run("arrHoleGetter", () => argsAll.apply(null, [1, 2, , 4]));
delete Array.prototype[2];
var big = []; for (var i = 0; i < 300; i++) big.push(i);
run("arrBig300", () => sumAll.apply(null, big));
var lim = []; for (var i = 0; i < 375; i++) lim.push(1);
run("arrLim375", () => sumAll.apply(null, lim));
var over = []; for (var i = 0; i < 2000; i++) over.push(1);
run("arrOver2000", () => sumAll.apply(null, over));
var huge = { length: 600000 };
runThrows("tooMany", () => sumAll.apply(null, huge));
var lenArr = [1, 2, 3]; lenArr.length = 5;
run("arrLenGrown", () => argsAll.apply(null, lenArr));
var arrExtra = [1, 2]; arrExtra.foo = 3;
run("arrExtraProp", () => argsAll.apply(null, arrExtra));
class SubArr extends Array {}
var sub = SubArr.from([7, 8]);
run("subArr", () => argsAll.apply(null, sub));
run("arrMutate", (i) => { var a = [i, i + 1]; return argsAll.apply(null, a); });
// Array-likes and others.
run("arrayLike", () => argsAll.apply(null, { length: 2, 0: "x", 1: "y" }));
run("typed", () => argsAll.apply(null, new Int8Array([1, 2, 3])));
runThrows("string", () => argsAll.apply(null, "abc"));
run("nullArg", () => sloppy.apply(obj, null));
run("undefArg", () => sloppy.apply(obj, undefined));
runThrows("numArg", () => sloppy.apply(obj, 5));
runThrows("boolArg", () => sloppy.apply(obj, true));
run("apply0", () => sloppy.apply());
run("apply1", () => sloppy.apply(obj));
run("apply3", () => sloppy.apply(obj, [1, 2], 3));
run("strict0", () => strict.apply());
// thisArg forms.
run("thisPrimS", () => sloppy.apply(5, [1]));
run("thisPrimT", () => strict.apply(5, [1]));
run("thisNullS", () => sloppy.apply(null, [1]));
run("thisNullT", () => strict.apply(null, [1]));
run("thisStrS", () => sloppy.apply("s", [1]));
// Targets.
run("native", () => Math.max.apply(null, [1, 5, 3]));
run("nativeArgs", () => (function () { return Math.max.apply(null, arguments); })(1, 9, 3));
var bound = sloppy.bind(obj, "b");
run("bound", () => bound.apply(null, [1]));
class K { constructor(a) { this.a = a; } }
runThrows("classCtor", () => K.apply(null, [1]));
var prox = new Proxy(sloppy, {});
run("proxy", () => prox.apply(obj, [1, 2]));
var prox2 = new Proxy(sloppy, { apply(t, th, a) { return "trap:" + a.length; } });
run("proxyTrap", () => prox2.apply(obj, [1, 2]));
var nc = {};
runThrows("nonCallable", () => Function.prototype.apply.call(nc, null, [1]));
run("reflect", () => Reflect.apply(sloppy, obj, [1, 2]));
run("reflectArgs", () => (function () { return Reflect.apply(sloppy, obj, arguments); })(3, 4));
// Exceptions and stacks.
function thrower(a) { if (a > 0) throw new Error("boom" + a); return a; }
runThrows("throws", (i) => thrower.apply(null, [i & 1]));
runThrows("throwsArgs", (i) => (function () { return thrower.apply(null, arguments); })(i & 1));
function stackee() { return new Error().stack.split("\n").slice(0, 3).map(function (l) { return l.replace(/:\d+:\d+$/, ""); }).join(";"); }
function stackCaller() { return stackee.apply(null, arguments); }
run("stack", () => stackCaller(1, 2));
function* gen(a, b) { yield a; yield b; }
run("generator", () => [...gen.apply(null, [1, 2])].join(","));
run("generatorArgs", () => (function () { return [...gen.apply(null, arguments)].join(","); })(3, 4));
// Recursion through apply (depth <= 40).
function rec(n) { return n <= 0 ? 0 : 1 + rec.apply(null, [n - 1]); }
run("rec", () => rec(30));
function recA(n) { return n <= 0 ? 0 : 1 + recA.apply(null, arguments.length ? [arguments[0] - 1] : [0]); }
run("recA", () => recA(30));
// Prototype-style Class.create.
var Class = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
var Point = Class.create();
Point.prototype = { initialize: function (x, y) { this.x = x; this.y = y; this.n = arguments.length; } };
run("protoCreate", (i) => { var p = new Point(i, 2); return p.y + "," + p.n + "," + (p.x === i); });
var Vec = Class.create();
Vec.prototype = { initialize: function (a, b, c) { "use strict"; this.s = a + b + c; } };
run("protoCreate3", () => new Vec(1, 2, 3).s);
// CallIgnoresRv
var side = 0;
function inc(d) { side += d; }
for (var i = 0; i < N; i++) inc.apply(null, [1]);
for (var i = 0; i < N; i++) (function () { inc.apply(null, arguments); })(2);
P("ignoresrv side=" + side);
// Overwrite Function.prototype.apply last
var origApply = Function.prototype.apply;
Function.prototype.apply = function (t, a) { return "patched"; };
run("patched", () => sloppy.apply(obj, [1]));
run("patchedArgs", () => (function () { return sloppy.apply(obj, arguments); })(1));
Function.prototype.apply = origApply;
run("restored", () => sloppy.apply(obj, [1]));
print(out.join("\n"));
print("FUNAPPLY DONE");
