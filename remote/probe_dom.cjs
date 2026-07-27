const http = require('http');
const WebSocket = require('ws');
async function probe() {
  const raw = await new Promise((res,rej)=>{ http.get({hostname:'::1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej); });
  const page = JSON.parse(raw).find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=1; const q={};
  await new Promise(r=>ws.on('open',r));
  ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.id&&q[m.id]){const {res,rej}=q[m.id];delete q[m.id];m.error?rej(new Error(m.error.message)):res(m.result);}}catch{}});
  const cmd=(method,params={})=>new Promise((res,rej)=>{const i=id++;q[i]={res,rej};ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(q[i]){delete q[i];rej('timeout');}},8000);});
  const js=async(expr)=>{try{const r=await cmd('Runtime.evaluate',{expression:expr,returnByValue:true,timeout:8000});return r?.result?.value;}catch(e){return String(e);}};
  const r1=await js('JSON.stringify(Array.from(document.querySelectorAll("[data-msg-id]")).slice(0,5).map(e=>({tag:e.tagName,id:e.dataset.msgId,cls:e.className.slice(0,60)})))');
  console.log('data-msg-id els:', r1);
  const r2=await js('(() => { const all=Array.from(document.querySelectorAll("[class*=card],[class*=Card],[class*=media-item],[class*=MediaItem]")).slice(0,3); return JSON.stringify(all.map(e=>({cls:e.className.slice(0,80),attrs:Array.from(e.attributes).filter(a=>a.name.startsWith("data-")).map(a=>a.name+"="+a.value.slice(0,20)).join(",")}))); })()');
  console.log('card variants:', r2);
  ws.close();
}
probe().catch(console.error);
