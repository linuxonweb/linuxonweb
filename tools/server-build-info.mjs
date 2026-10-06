import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const SOURCE_LIMIT = 4 * 1024 * 1024;
const TOTAL_LIMIT = 16 * 1024 * 1024;
async function smallFile(path, limit = SOURCE_LIMIT) {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) throw Error('Build metadata/source is too large');
  const bytes = await readFile(path);
  if (bytes.length > limit) throw Error('Build metadata/source grew beyond limit');
  return {info,bytes};
}
async function json(path) {
  if (!path) return {};
  try {return JSON.parse((await smallFile(path,256*1024)).bytes);} catch {return {};}
}
export function firefoxBuildDate(buildID) {
  if (!/^\d{14}$/.test(buildID ?? '')) return null;
  const value = `${buildID.slice(0,4)}-${buildID.slice(4,6)}-${buildID.slice(6,8)}`;
  const date = new Date(value+'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value ? value : null;
}
// Only explicitly served package routes are listed. Source fingerprints/hash
// cache reads small files; package binaries are never opened or hashed here.
export function createServerBuildInfo({routes,liveRoutes,serverSources,started}) {
  const sourceHashes = new Map();
  const pathFor = url => routes[url]?.path ?? liveRoutes[url];
  async function revision(entries) {
    if(entries.length>256) throw Error('Too many webapp source routes');
    let total=0;const values=[];
    for(const [url,path] of entries.sort(([a],[b])=>a.localeCompare(b))) {
      const info=await stat(path),fingerprint=`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
      total+=info.size;if(!info.isFile()||info.size>SOURCE_LIMIT||total>TOTAL_LIMIT) throw Error('Webapp source limit exceeded');
      let cached=sourceHashes.get(path);
      if(cached?.fingerprint!==fingerprint) {cached={fingerprint,sha256:hash((await smallFile(path)).bytes)};sourceHashes.set(path,cached);}
      values.push([url,cached.sha256]);
    }
    return hash(JSON.stringify(values));
  }
  const serverVersion=revision(serverSources.map((path,index)=>['server-'+index,path]));
  return async function buildInfo({manifest={},status={}}={}) {
    const entries=Object.entries({...Object.fromEntries(Object.entries(routes).map(([url,d])=>[url,d.path])),...liveRoutes});
    const webappVersion=await revision(entries.filter(([url])=>url.startsWith('/linux/')&&!url.includes('/accepted-vulkan/')&&/\.(?:html|js|mjs|css)$/.test(url)));
    const extras=await json(pathFor('/linux/desktop-extras.cpio.json'));
    const provenance=await json(pathFor('/linux/info-wgpu/provenance.json'));
    const tests={
      '/linux/tests/wgpu-desktop/candidate/initramfs.cpio':await json(pathFor('/linux/tests/wgpu-desktop/candidate/package.json')),
      '/linux/accepted-vulkan/tests/guest-vulkan-wgpu/candidate/initramfs.cpio':await json(pathFor('/linux/accepted-vulkan/tests/guest-vulkan-wgpu/candidate/package.json')),
    };
    const byUrl=new Map(Object.entries(manifest.assets??{}).map(([key,a])=>[new URL(a.url,'http://local/linux/').pathname,{key,...a}]));
    const packages=entries.filter(([url])=>/\.(?:wasm|cpio|gz|data)$/.test(url)).map(([url])=>{
      const asset=byUrl.get(url),descriptor=routes[url],test=tests[url];
      let name=asset?.label ?? url.slice('/linux/'.length),version=null,buildDate=null;
      let sha256=asset?.sha256??descriptor?.sha256??test?.archiveSha256??null;
      if(asset?.key==='firefox'){name='Firefox Nightly';version=status.version??null;buildDate=firefoxBuildDate(status.buildID);}
      if(asset?.key==='kernel')name='Linux kernel';
      if(asset?.key==='plain')name='Desktop system (initramfs)';
      if(url==='/linux/desktop-extras.cpio'){name='Desktop extras (clipboard bridge, xclip, glgears, vkgears)';sha256=extras.sha256??sha256;}
      if(url.endsWith('guest_vulkan_wgpu_host_bg.wasm')){name=url.includes('/info-wgpu/')?'Info Rust wgpu renderer':'Accepted Vulkan Rust wgpu renderer';version=provenance.artifacts?.some(a=>a.file==='guest_vulkan_wgpu_host_bg.wasm'&&a.sha256===sha256)?provenance.renderer?.replace(/^Rust wgpu /,'')??null:null;}
      if(test){name=url.includes('/accepted-vulkan/')?'Accepted Vulkan benchmark system':'Vulkan desktop test system';version=test.version??null;}
      return {url,name,version,buildDate,buildID:asset?.key==='firefox'?status.buildID??null:null,revision:sha256};
    });
    return {schema:1,webapp:{version:webappVersion,buildDate:null},server:{version:await serverVersion,buildDate:null,started},packages,
      firefox:{jitVerified:status.jitVerified===true,gpuVerified:status.gpuVerified===true},dateNote:'Unknown means no build date or version was recorded; server start is not a build date.'};
  };
}
