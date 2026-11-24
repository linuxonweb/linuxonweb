import fs from 'node:fs';
const task=process.argv[2];
const m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/layout.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('unexpected layout imports');
const e=new WebAssembly.Instance(m).exports;
const names=['link_map.size','link_map.align','link_map.l_loader','link_map.l_scope','link_map.l_local_scope','r_scope_elem.size','r_found_version.size','Elf32_Sym.size','Lmid_t.size','pthread_mutex_t.size','pthread.gscope_flag','pthread.rtld_catch','native_callsite.size','native_callsite.align'];
const values=Object.fromEntries(names.map((n,i)=>[n,e.native_layout(i)]));
if(values['Elf32_Sym.size']!==16||values['native_callsite.size']!==12||values['native_callsite.align']!==4)throw Error('incoherent ABI');
fs.writeFileSync(`${task}/logs/layout-results.json`,JSON.stringify({pass:true,publicPrototypeAssertions:6,values},null,2)+'\n');console.log(JSON.stringify(values));
