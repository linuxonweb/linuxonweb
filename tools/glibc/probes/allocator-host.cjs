const fs=require('fs'),assert=require('assert');
const root=process.env.GLIBC_TASK;if(!root)throw Error('GLIBC_TASK required');
let instance,tp=0,checks=0,calls=[];
const check=(v,message)=>{checks++;assert(v,message)};
const moduleBytes=fs.readFileSync(root+'/objects/gnu-allocator-production.wasm');
const moduleObject=new WebAssembly.Module(moduleBytes);
const imports=WebAssembly.Module.imports(moduleObject);
check(imports.length===3 && imports.every(x=>x.module==='linux'),'only Linux imports');
function syscall(n,a,b,c,d,e,f){calls.push(n);switch(n){case 244:tp=a;return 0;case 178:return 71;case 172:return 70;case 113:case 403:{const view=new DataView(instance.exports.memory.buffer);view.setBigInt64(b,1n,true);view.setBigInt64(b+8,123000n,true);return 0;}case 278:require("crypto").randomFillSync(new Uint8Array(instance.exports.memory.buffer,a,b));return b;case 56:return -2;case 167:return -22;default:throw Error('unexpected syscall '+n+' '+[a,b,c,d,e,f]);}}
instance=new WebAssembly.Instance(moduleObject,{linux:{syscall,get_thread_area:()=>tp,copy_siginfo:()=>{throw Error("host signal not accepted")}}});
const x=instance.exports;
check(x.fixture_init(65536,0)===0,'init');
check(tp===x.fixture_thread_pointer(),'actual struct pthread installed');
check(x.fixture_perturb()===93,'real tunable parsed');
const data=()=>new Uint8Array(x.memory.buffer);
for(const size of [1,7,15,16,31,64,255,4096,131073,1048577]){let p=x.malloc(size);check(p!==0,'malloc '+size);check(p%16===0,'alignment '+size);data().fill(0x6a,p,p+size);let q=x.realloc(p,size+257);check(q!==0,'realloc '+size);check(data().subarray(q,q+size).every(v=>v===0x6a),'preserve '+size);x.free(q);}
let last=0,stablePages=0;
for(let i=0;i<80;i++){let p=x.malloc(1500000);check(p!==0,'large allocation '+i);data().fill(0xaa,p,p+1500000);x.free(p);let q=x.calloc(1,1500000);check(q!==0,'calloc reused '+i);check(data().subarray(q,q+1500000).every(v=>v===0),'calloc zero '+i);x.free(q);if(i===10)stablePages=x.memory.buffer.byteLength; if(i>10)check(x.memory.buffer.byteLength===stablePages,'reuse stable pages '+i);last=q;}
check(x.calloc(0x40000000,16)===0,'calloc overflow');check(x.fixture_errno()===12,'overflow errno');
let p=x.malloc(256);data().fill(0x45,p,p+256);let before=x.__wasm_memory_cursor();check(x.realloc(p,0x7fffffff)===0,'OOM realloc');check(x.fixture_errno()===12,'OOM errno');check(data().subarray(p,p+256).every(v=>v===0x45),'OOM preserves old bytes');check(x.__wasm_memory_cursor()===before,'OOM cursor unchanged');x.free(p);
// Provider contract checks, distinct from GNU allocator checks above.
let cur=x.__wasm_memory_cursor();check(x.__sbrk(0)===cur,'sbrk zero');
check(x.__wasm_memory_init(x.fixture_heap_base(),65536)===-1,'duplicate init');
check(x.__wasm_memory_cursor()===cur,'duplicate init unchanged');
check(x.__sbrk(-1)===-1 && x.fixture_errno()===95,'shrink explicit ENOTSUP');
check(x.__mprotect(x.fixture_heap_base(),65536,0)===-1 && x.fixture_errno()===95,'no fake hardware protection');
let m=x.__mmap(0,65536,3,34,-1,0n);check(m!==-1 && m%65536===0,'provider map alignment');
data().fill(0xcc,m,m+65536);check(x.__munmap(m,65536)===0,'provider logical unmap');
let m2=x.__mmap(0,65536,3,34,-1,0n);check(m2===m,'provider free range reuse');
check(data().subarray(m2,m2+65536).every(v=>v===0),'provider reuse zero');x.__munmap(m2,65536);
cur=x.__wasm_memory_cursor();check(x.__mmap(0,0x7fff0000,3,34,-1,0n)===-1,'provider growth failure');
check(x.__wasm_memory_cursor()===cur,'provider failure cursor unchanged');
const out={scope:'Host syscall fixture; GNU allocator real, actual GNU abort linked; signal execution separate; not real guest/NPTL acceptance',pass:checks,fail:0,imports,heapBase:x.fixture_heap_base(),pages:x.memory.buffer.byteLength/65536,cursor:x.__wasm_memory_cursor(),syscalls:[...new Set(calls)],largeReuseIterations:80};
fs.writeFileSync(root+'/logs/allocator-host-result.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out));
