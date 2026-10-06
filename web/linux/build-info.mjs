export function compareWebappBuild(loaded,server) {
  return typeof loaded==='string'&&loaded.length>0&&typeof server==='string'&&server.length>0?loaded!==server:null;
}
export function installBuildInfo({footer,loadedRevision=document.querySelector('meta[name="webapp-revision"]')?.content,fetchImpl=fetch,eventTarget=window,documentTarget=document,intervalMs=60000}) {
  let busy=false,closed=false,timer;
  const message=footer.querySelector('[data-build-message]'),rows=footer.querySelector('tbody'),refresh=footer.querySelector('[data-refresh-page]');
  refresh.addEventListener('click',event=>{event.preventDefault();location.reload();});
  function text(node,value){node.textContent=value??'Unknown';}
  function identity(info){return `${info?.version?.slice(0,12)??'Unknown'} · build date ${info?.buildDate??'Unknown'}`;}
  async function check(){
    if(closed||busy)return;busy=true;
    try{
      const response=await fetchImpl(new URL('./server-build.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error('HTTP '+response.status);
      const info=await response.json();if(info.schema!==1||!Array.isArray(info.packages)||info.packages.length>256)throw Error('Invalid build metadata');
      if(closed)return;
      text(footer.querySelector('[data-webapp-build]'),identity({version:loadedRevision,buildDate:null}));
      text(footer.querySelector('[data-available-webapp]'),identity(info.webapp));
      text(footer.querySelector('[data-server-build]'),identity(info.server));
      text(footer.querySelector('[data-server-start]'),info.server?.started);
      const stale=compareWebappBuild(loadedRevision,info.webapp?.version);
      footer.dataset.stale=stale===null?'unknown':String(stale);refresh.hidden=stale!==true;
      text(message,stale===true?'This page is older than the server. Refresh page to load the update.':stale===false?'This page matches the server.':'Page revision unavailable; refresh detection is Unknown.');
      rows.replaceChildren();
      for(const pkg of info.packages){const row=documentTarget.createElement('tr');for(const value of [pkg.name,pkg.version,pkg.buildDate]){const cell=documentTarget.createElement('td');text(cell,value);row.append(cell);}rows.append(row);}
      footer.dataset.state='ready';
    }catch(error){if(!closed){footer.dataset.state='unavailable';text(message,'Server build information unavailable. '+error.message);}}
    finally{busy=false;}
  }
  const focus=()=>{if(!documentTarget.hidden)void check();};
  eventTarget.addEventListener('focus',focus);documentTarget.addEventListener('visibilitychange',focus);
  timer=setInterval(focus,intervalMs);void check();
  return {check,close(){closed=true;clearInterval(timer);eventTarget.removeEventListener('focus',focus);documentTarget.removeEventListener('visibilitychange',focus);}};
}
