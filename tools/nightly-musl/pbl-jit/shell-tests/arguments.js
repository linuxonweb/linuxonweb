// arguments semantics test for PBLBC Arguments op
var out = [];
var h = 0;
function mix(v) { h = (h * 31 + (typeof v === "number" ? v | 0 : String(v).length)) | 0; }
function sloppyMapped(a, b) {
  arguments[0] = 10; mix(a);
  b = 20; mix(arguments[1]);
  mix(arguments.length);
  mix(arguments.callee === sloppyMapped ? 1 : 0);
  return arguments;
}
function strictUnmapped(a, b) {
  "use strict";
  arguments[0] = 10; mix(a);
  b = 20; mix(arguments[1]);
  mix(arguments.length);
  var t = 0; try { arguments.callee; } catch (e) { t = 1; } mix(t);
  return arguments;
}
function withDefault(a, b = 5) { arguments[0] = 99; mix(a); mix(b); mix(arguments.length); return arguments; }
function withRest(a, ...r) { arguments[0] = 7; mix(a); mix(r.length); mix(arguments.length); return arguments; }
function sumArgs() { var s = 0; for (var i = 0; i < arguments.length; i++) s += arguments[i]; return s; }
function fwd() { return sumArgs.apply(null, arguments); }
function Ctor() { this.init.apply(this, arguments); }
Ctor.prototype.init = function (x, y) { this.v = x + (y | 0); };
function gcBetween(a, b) {
  var ar = arguments;
  if ((a & 63) == 0) gc();
  if ((a & 255) == 1) gc(null, 'shrinking');
  ar[1] = a * 2; mix(b);
  return ar[0] + ar[1] + ar.length;
}
function thrower(a) { var ar = arguments; if (a % 7 == 3) throw new Error("x" + ar[0]); return ar.length; }
function recurse(n) { if (n <= 0) return arguments.length; return recurse(n - 1, n, n) + arguments[0]; }
function lenOnly() { return arguments.length; }
function argsEscape(a) { return function () { return arguments.length + a; }; }
function setThenRead(a) { a = a + 1; return arguments[0]; }
function setThenReadStrict(a) { "use strict"; a = a + 1; return arguments[0]; }
for (var i = 0; i < 3000; i++) {
  var r1 = sloppyMapped(i, i + 1, i + 2); mix(r1[0]); mix(r1[1]); mix(r1[2]);
  var r1b = sloppyMapped(i); mix(r1b.length); mix(r1b[1]);
  var r2 = strictUnmapped(i, i + 1); mix(r2[0]); mix(r2[1]);
  var r2b = strictUnmapped(); mix(r2b.length);
  withDefault(i); withDefault(i, i, i);
  withRest(i); withRest(i, 1, 2, 3);
  mix(sumArgs(i, 1, 2)); mix(sumArgs()); mix(fwd(i, i, i, i));
  mix(new Ctor(i, 3).v); mix(new Ctor(i).v);
  mix(gcBetween(i, i + 1)); mix(gcBetween(i));
  try { mix(thrower(i, 1)); } catch (e) { mix(e.message); }
  if (i % 100 == 0) mix(recurse(200, 1));
  mix(lenOnly(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  mix(argsEscape(i, 1)(1, 2, 3));
  mix(setThenRead(i)); mix(setThenReadStrict(i));
}
print("ARGS h=" + h);
var deep = 0; try { (function r(n) { deep = n; return r(n + 1, arguments); })(0); } catch (e) { print("ARGS deep " + (e instanceof InternalError || e instanceof RangeError)); }
print("ARGS done");
