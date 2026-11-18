// Generators, async functions and iteration protocols under the PBL tiers.
// Output must be identical with every tier/switch setting.
var out = [];
function log(s) { out.push(String(s)); }
function* range(a, b, s) { for (var i = a; i < b; i += (s || 1)) yield i; }
function* fin(log2) { try { yield 1; yield 2; yield 3; } finally { log2.push('fin'); } }
function* deleg() { var r = yield* range(0, 3); yield 'after'; return 'ret'; }
function* echo() { var x = 0; while (true) { try { x = yield x * 2; } catch (e) { x = 'caught:' + e; } if (x === 'stop') return 'stopped'; } }
function* tree(n) { if (n > 0) { yield* tree(n - 1); yield n; yield* tree(n - 1); } }
function* inner() { try { yield 'a'; yield 'b'; } finally { yield 'cleanup'; } }
async function af(x) { var a = await x; var b = await Promise.resolve(a + 1); return a * b; }
async function* ag(n) { for (var i = 0; i < n; i++) yield await Promise.resolve(i * i); }
var total = 0;
for (var rep = 0; rep < 300; rep++) {
  var s = 0;
  for (var v of range(0, 50)) s += v;
  var arr = [...range(0, 20, 3)];
  s += arr.length + arr[arr.length - 1];
  var l2 = [];
  for (var v of fin(l2)) { if (v === 2) break; s += v; }
  s += l2.length;
  var g = echo(); g.next(); s += g.next(5).value; s += g.throw('E').value.length; var r = g.return(9); s += r.value + (r.done ? 1 : 0);
  var g2 = echo(); g2.next(); var st = g2.next('stop'); s += st.value.length + (st.done ? 1 : 0); s += g2.next().done ? 1 : 0;
  var d = deleg(); var dv = []; var x; while (!(x = d.next()).done) dv.push(x.value); s += dv.length + x.value.length;
  for (var t of tree(4)) s = (s + t) | 0;
  var ii = inner(); ii.next(); var c = ii.return(7); s += c.value.length; c = ii.next(); s += c.value + (c.done ? 1 : 0);
  try { var bad = range(0, 2); bad.next(); bad.throw(new Error('x')); } catch (e) { s += e.message.length; }
  var genFn = range; s += Math.max(...genFn(1, 6));
  var [p, q, ...rest] = range(10, 20); s += p + q + rest.length;
  total = (total + s) | 0;
  if (rep % 100 === 0) log('rep ' + rep + ' s=' + s);
}
log('total ' + total);
try { var gr = echo(); gr.next(); var it = gr; it.next.call({}); } catch (e) { log('TypeError ' + (e instanceof TypeError)); }
var running = (function* self() { try { running.next(); } catch (e) { yield 'nest ' + (e instanceof TypeError); } })();
log(running.next().value);
var aout = [];
(async function () {
  var t = 0;
  for (var k = 0; k < 200; k++) t = (t + await af(k)) | 0;
  aout.push('af ' + t);
  var u = 0;
  for await (var v of ag(30)) u += v;
  aout.push('ag ' + u);
  try { await (async function () { await null; throw new Error('boom'); })(); } catch (e) { aout.push('rej ' + e.message); }
})().then(function () { for (var l of out) print(l); for (var l of aout) print(l); print('done'); });
