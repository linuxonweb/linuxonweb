/* Compile-level loader controls only, not genuine GNU owner acceptance. */
import assert from "node:assert/strict";
import { checkGNUStartupModule } from "./startup-module.mjs";
const header = [0,97,115,109,1,0,0,0];
const section = (id, data) => [id, data.length, ...data];
const exportName = "__wasm_boundary_v3_admit";
const base = [...header, ...section(1, [1,96,0,0]), ...section(3, [1,0]),
    ...section(7, [1,exportName.length,...Buffer.from(exportName),0,0])];
const noStart = new Uint8Array([...base,...section(10,[1,2,0,11])]);
const start = new Uint8Array([...base,...section(8,[0]),...section(10,[1,2,0,11])]);
assert.equal(checkGNUStartupModule(noStart, new WebAssembly.Module(noStart)), true);
assert.throws(() => checkGNUStartupModule(start, new WebAssembly.Module(start)), /start section/);
const legacy = new Uint8Array([...header,...section(1,[1,96,0,0]),...section(3,[1,0]),
    ...section(8,[0]),...section(10,[1,2,0,11])]);
assert.equal(checkGNUStartupModule(legacy,new WebAssembly.Module(legacy)), false);
const inspectedModule = new WebAssembly.Module(noStart);
for (const bytes of [noStart.slice(0,7), new Uint8Array([...header,1,127]),
    new Uint8Array([...header,1,128]),new Uint8Array([...header,1,255,255,255,255,16])])
    assert.throws(() => checkGNUStartupModule(bytes,inspectedModule), /GNU startup/);
const custom = new Uint8Array([...header, ...section(0,[1,120,8]),...noStart.slice(8)]);
assert.equal(checkGNUStartupModule(custom,new WebAssembly.Module(custom)),true);
console.log(JSON.stringify({pass:true,cases:8,runtimeAcceptance:false,
    scope:"module start-section rejection before instantiation; legacy and custom sections preserved"}));
