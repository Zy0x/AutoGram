const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const MSG_ID = 34404;
const OUT = 'F:/AutoGram/remote/reports/screenshots';
fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const note = m => console.log('[' + new Date().toISOString() + '] >>>', m);
const ok   = m => console.log('[' + new Date().toISOString() + '] OK ', m);
const warn = m => console.log('[' + new Date().toISOString() + '] !  ', m);

async function main() {
  note('=== Remote Test: Media ' + MSG_ID + ' ===');
  const raw = await new Promise((res,rej)=>{ http.get({hostname:'::1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej); });
  const page = JSON.parse(raw).find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=1; const q={};
  await new Promise(r=>ws.on('open',r));
  ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.id&&q[m.id]){const {res,rej}=q[m.id];delete q[m.id];m.error?rej(new Error(m.error.message)):res(m.result);}}catch{}});
  const cmd=(method,params={})=>new Promise((res,rej)=>{const i=id++;q[i]={res,rej};ws.send(JSON.stringify({id:i,method,params}));setTimeout(()=>{if(q[i]){delete q[i];rej(new Error('timeout:'+method));}},15000);});
  const js=async(expr,awaitP=false)=>{try{const r=await cmd('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:awaitP,timeout:awaitP?20000:8000});const v=r?.result?.value;if(typeof v==='string'){try{return JSON.parse(v);}catch{return v;}}return v;}catch(e){return {_err:e.message};}};
  const shot=async(name)=>{try{const r=await cmd('Page.captureScreenshot',{format:'png',quality:85});if(r?.data){fs.writeFileSync(path.join(OUT,name),Buffer.from(r.data,'base64'));note('Shot: '+name);}}catch(e){warn('Shot fail: '+e.message);}};

  await cmd('Runtime.enable').catch(()=>{});
  await cmd('Page.enable').catch(()=>{});

  // Get card coordinates directly
  const card = await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2, w: r.width, h: r.height }; })()');
  note('Card coords: ' + JSON.stringify(card));

  if (!card || !card.x) {
    warn('Card not in DOM, need to scroll or search first');
    process.exit(1);
  }

  await shot('before_click.png');

  // CDP mouse click directly on card
  const t_click = Date.now();
  note('CDP mouse click at (' + Math.round(card.x) + ', ' + Math.round(card.y) + ')...');
  await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
  await sleep(50);
  await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card.x, y: card.y, button: 'left', clickCount: 1 });

  // Wait for modal/video
  let modalMs = null;
  for (let i=0; i<40; i++) {
    await sleep(150);
    const has = await js('!!(document.querySelector("video") || document.querySelector("[class*=modal],[class*=Modal],[class*=preview],[role=dialog]"))');
    if (has) { modalMs = Date.now()-t_click; ok('Modal/Video in ' + modalMs + 'ms!'); break; }
  }
  if (!modalMs) warn('No modal/video in 6s');
  await shot('after_click.png');

  // Check video src
  const vinfo = await js('(() => { const v=document.querySelector("video"); if(!v) return null; return {src:v.src?.slice(0,100),paused:v.paused,readyState:v.readyState}; })()');
  note('Video info: ' + JSON.stringify(vinfo));

  // Monitor 20s
  note('Monitoring 20s...');
  let firstBuf=null, firstPlay=null, lastSt=null;
  for (let tick=0; tick<40; tick++) {
    await sleep(500);
    const st = await js('(() => { const v=document.querySelector("video"); if(!v) return {hasVideo:false}; const b=v.buffered; const rs=[]; for(let i=0;i<b.length;i++) rs.push([+b.start(i).toFixed(2),+b.end(i).toFixed(2)]); const bs=rs.reduce((s,[a,c])=>s+(c-a),0); const dur=v.duration; const bp=dur>0&&isFinite(dur)?+(bs/dur*100).toFixed(1):null; return {hasVideo:true,paused:v.paused,ct:+v.currentTime.toFixed(2),dur:isFinite(dur)?+dur.toFixed(2):null,bs:+bs.toFixed(2),bp,rs:v.readyState,ne:v.networkState,err:v.error?{c:v.error.code,m:v.error.message}:null}; })()');
    if (!st?.hasVideo) continue;
    const elapsed = ((Date.now()-t_click)/1000).toFixed(1);
    if (st.bp>0 && !firstBuf) { firstBuf=Date.now()-t_click; ok('First buffer at ' + firstBuf + 'ms = ' + st.bp + '%'); }
    if (!st.paused && !firstPlay) { firstPlay=Date.now()-t_click; ok('PLAYING at ' + firstPlay + 'ms! ct=' + st.ct + 's'); }
    if (tick%4===0) note('t+' + elapsed + 's | ' + (st.paused?'PAUSED':'PLAYING@'+st.ct+'s') + ' buf=' + (st.bp??'?') + '% (' + st.bs + 's/' + (st.dur??'?') + 's) rs=' + st.rs);
    lastSt=st;
    if (tick===5) await shot('play_2s5.png');
    if (tick===19) await shot('play_10s.png');
    if (st.err) { warn('ERROR: ' + JSON.stringify(st.err)); break; }
  }
  await shot('final.png');

  console.log('');
  console.log('='.repeat(55));
  console.log('HASIL: Media ' + MSG_ID);
  console.log('Modal/Video   :', modalMs!=null?'YES '+modalMs+'ms':'NO');
  console.log('First buffer  :', firstBuf!=null?firstBuf+'ms':'NOT DETECTED');
  console.log('Playback start:', firstPlay!=null?'YES at '+firstPlay+'ms':'NO');
  if (lastSt?.dur && lastSt.dur>0) {
    const dlPct=(lastSt.bs/lastSt.dur*100).toFixed(1);
    console.log('Downloaded    :', lastSt.bs+'s of '+lastSt.dur+'s ('+dlPct+'%)');
    if (+dlPct<15) ok('PROGRESSIVE OK: <15% downloaded = instant streaming!');
    else warn('BUFFER: '+dlPct+'% - check');
  }
  console.log('='.repeat(55));
  ws.close();
}
main().catch(e=>{ console.error('X', e.message); process.exit(1); });
