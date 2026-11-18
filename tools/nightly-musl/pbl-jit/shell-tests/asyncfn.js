// Async functions under the PBL tiers (PBLBC_GENBODY): await chains,
// rejection, try/finally around await, for-await. Output must be identical
// with every tier/switch setting (and node).
var out = [];
function log(s) { out.push(String(s)); }
async function add1(x) { return x + 1; }
async function chain(x) { var a = await add1(x); var b = await add1(a); var c = await b; return a + b + c; }
async function rejects(x) { await null; if (x & 1) throw new Error('odd' + x); return x; }
async function catcher(x) { try { return await rejects(x); } catch (e) { return e.message; } }
async function fin(x, l) { try { await null; if (x % 3 === 0) throw 'T' + x; return x; } finally { await add1(x); l.push('f' + x); } }
async function* agen(n) { for (var i = 0; i < n; i++) { await null; yield i * 3; } }
async function forAwait(n) { var s = 0; for await (var v of agen(n)) s += v; for await (var w of [1, Promise.resolve(2), 3]) s += w; return s; }
async function loopAwait(n) { var s = 0; for (var i = 0; i < n; i++) s += await i; return s; }
async function nested(d) { if (d === 0) return 1; return 1 + await nested(d - 1); }
async function closure(x) { var k = x; var f = () => k; await null; k += 10; await null; return f() + (await Promise.all([add1(k), add1(1)])).join(','); }
(async function () {
  var total = 0;
  for (var rep = 0; rep < 200; rep++) {
    var s = 0;
    s += await chain(rep);
    var m = await catcher(rep); s += typeof m === 'string' ? m.length : m;
    var l = [];
    try { s += await fin(rep, l); } catch (e) { s += e.length; }
    s += l.length;
    s += await forAwait(rep % 7);
    s += await loopAwait(rep % 13);
    s += await nested(rep % 9);
    s += (await closure(rep)).length;
    try { await rejects(1); } catch (e) { s += 100; }
    var r = await Promise.allSettled([rejects(rep), rejects(rep + 1)]);
    s += r.map(function (x) { return x.status.length; }).reduce(function (a, b) { return a + b; });
    total = (total + s) | 0;
    if (rep % 50 === 0) log('rep ' + rep + ' s=' + s);
  }
  log('total ' + total);
})().then(function () { for (var l of out) print(l); print('done'); },
          function (e) { print('FAIL ' + e); });
