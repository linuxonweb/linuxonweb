import fs from 'node:fs';
import crypto from 'node:crypto';
const [native,fpcast,output] = process.argv.slice(2);
if (!native || !fpcast || !output || fs.existsSync(output)) throw new Error('unique native fpcast output paths required');
const rows=[];
for (const file of [native,fpcast]) {
 const bytes=fs.readFileSync(file),module=new WebAssembly.Module(bytes);
 const imports=WebAssembly.Module.imports(module);
 if(imports.length) throw new Error('synthetic closed conversion module must have no imports');
 const instance=new WebAssembly.Instance(module,{}),e=instance.exports;
 e.__wasm_init_tls(1048576);
 const failed=e.run_tests(),passed=e.pass_count(),again=e.fail_count();
 const layout=Array.from({length:12},(_,i)=>e.layout(i));
 if(failed!==0 || again!==0 || passed!==24612 || layout[0]!==104 || layout[1]!==8 || layout[2]!==104 || layout[3]!==128 || layout[4]!==128) throw new Error(JSON.stringify({file,passed,failed,again,layout}));
 rows.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),passed,failed,imports,layout});
}
const result={pass:true,scope:'actual GNU internal converter with synthetic legacy/stat64 inputs; not kernel or guest acceptance',results:rows};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
