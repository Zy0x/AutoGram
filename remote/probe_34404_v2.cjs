const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const OUT = 'F:/AutoGram/remote/reports/screenshots';
fs.mkdirSync(OUT, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const note = m => console.log('[' + new Date().toISOString() + '] >>>', m);
const ok   = m => console.log('[' + new Date().toISOString() + '] OK ', m);
const warn = m => console.log('[' + new Date().toISOString() + '] !  ', m);

async function main() {
  note('=== Probe: Open Preview for 34404 ===');
  const raw = await new Promise((res,rej)=>{ http.get({hostname:'::1',port:9222,path:'/json'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(d));}).on('error',rej); });
  const page = JSON.parse(raw).find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=1; const q={};
  await new Promise(r=>ws.on('open',r));
  ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.id&&q[m.id]){const {res,rej}=q[m.id];delete q[m.id];m.error?rej(new Error(m.error.message)):res(m.result);}}catch{}});
  const cmd=(m,p={})=>new Promise((res,rej)=>{const i=id++;q[i]={res,rej};ws.send(JSON.stringify({id:i,method:m,params:p}));setTimeout(()=>{if(q[i]){delete q[i];rej(new Error('timeout:'+m));}},15000);});
  const js=async(e,aP=false)=>{try{const r=await cmd('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:aP,timeout:aP?20000:8000});const v=r?.result?.value;if(typeof v==='string'){try{return JSON.parse(v);}catch{return v;}}return v;}catch(e){return {_err:e.message};}};
  const shot=async(n)=>{try{const r=await cmd('Page.captureScreenshot',{format:'png',quality:85});if(r?.data)fs.writeFileSync(path.join(OUT,n),Buffer.from(r.data,'base64'));note('Shot:'+n);}catch(e){warn('Shot fail:'+e.message);}};

  await cmd('Runtime.enable').catch(()=>{});
  await cmd('Page.enable').catch(()=>{});

  await shot('p1_start.png');

  // Method: Click play button (.td-video-play) inside the card  
  // This should work regardless of selection state if it's the play button
  const playBtn = await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (!c) return null; const pb = c.querySelector(".td-video-play,.td-play-btn,[class*=play-btn],[class*=play-button]"); if (pb) { const r = pb.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2, cls: pb.className }; } return { noPlayBtn: true, card: c.className }; })()');
  note('Play button coords: ' + JSON.stringify(playBtn));

  // Also check hover area - the card center play overlay
  const hoverPlay = await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (!c) return null; const all = c.querySelectorAll("*"); const plays = Array.from(all).filter(e => /play/i.test(e.className)); return plays.map(e => ({ tag: e.tagName, cls: e.className, vis: getComputedStyle(e).visibility, disp: getComputedStyle(e).display })); })()');
  note('Play elements inside card: ' + JSON.stringify(playBtn));

  // Strategy: hover over the card first to show play button, then click it
  const cardCoords = await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2 }; })()');
  if (!cardCoords) { warn('Card not found'); ws.close(); return; }

  // Step 1: Hover over card to reveal play button
  note('Hovering over card at (' + Math.round(cardCoords.x) + ', ' + Math.round(cardCoords.y) + ')...');
  await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cardCoords.x, y: cardCoords.y });
  await sleep(300);

  // Step 2: Find and click the now-visible play button
  const playCoords = await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (!c) return null; const pb = c.querySelector(".td-video-play"); if (pb) { const r = pb.getBoundingClientRect(); return { x: r.left+r.width/2, y: r.top+r.height/2 }; } return null; })()');
  note('Play button after hover: ' + JSON.stringify(playCoords));

  const t_click = Date.now();

  if (playCoords && playCoords.x) {
    note('Clicking play button at (' + Math.round(playCoords.x) + ', ' + Math.round(playCoords.y) + ')...');
    await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x: playCoords.x, y: playCoords.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x: playCoords.x, y: playCoords.y, button: 'left', clickCount: 1 });
  } else {
    // Fallback: use JS to directly call the click handler  
    note('Fallback: JS invoke onClick of card...');
    await js('(() => { const c = document.querySelector("[data-msg-id=\\"34404\\"]"); if (c) { const event = new MouseEvent("click", {bubbles:true,cancelable:true,detail:2}); c.dispatchEvent(event); } })()');
  }

  // Wait for preview modal
  let modalMs = null;
  for (let i=0; i<50; i++) {
    await sleep(150);
    const has = await js('!!(document.querySelector("video") || document.querySelector("[class*=preview-modal],[class*=PreviewModal],[class*=media-preview],[class*=MediaPreview]"))');
    if (has) { modalMs = Date.now()-t_click; ok('Preview opened in ' + modalMs + 'ms!'); break; }
  }
  if (!modalMs) {
    warn('No preview in 7.5s after play click');
    await shot('p_no_modal.png');
    // Check what's on screen
    const dom = await js('document.body.innerHTML.slice(0, 500)');
    note('Body: ' + String(dom).slice(0,200));
    ws.close();
    return;
  }
  await shot('p2_preview_open.png');

  // Monitor video
  note('Monitoring video 20s...');
  let firstBuf=null, firstPlay=null, lastSt=null;
  for (let tick=0; tick<40; tick++) {
    await sleep(500);
    const st = await js('(() => { const v=document.querySelector("video"); if(!v) return {hasVideo:false}; const b=v.buffered; const rs=[]; for(let i=0;i<b.length;i++) rs.push([+b.start(i).toFixed(2),+b.end(i).toFixed(2)]); const bs=rs.reduce((s,[a,c])=>s+(c-a),0); const dur=v.duration; const bp=dur>0&&isFinite(dur)?+(bs/dur*100).toFixed(1):null; return {hasVideo:true,paused:v.paused,ct:+v.currentTime.toFixed(2),dur:isFinite(dur)?+dur.toFixed(2):null,bs:+bs.toFixed(2),bp,rs:v.readyState,err:v.error?{c:v.error.code,m:v.error.message}:null}; })()');
    if (!st?.hasVideo) continue;
    const elapsed = ((Date.now()-t_click)/1000).toFixed(1);
    if (st.bp>0 && !firstBuf) { firstBuf=Date.now()-t_click; ok('First buffer at ' + firstBuf + 'ms = ' + st.bp + '%'); }
    if (!st.paused && !firstPlay) { firstPlay=Date.now()-t_click; ok('PLAYING at ' + firstPlay + 'ms ct=' + st.ct + 's'); }
    if (tick%4===0) note('t+' + elapsed + 's | ' + (st.paused?'PAUSED':'PLAYING@'+st.ct+'s') + ' buf=' + (st.bp??'?') + '% (' + st.bs + 's/' + (st.dur??'?') + 's) rs=' + st.rs);
    lastSt=st;
    if (tick===5) await shot('p3_2s5.png');
    if (tick===19) await shot('p4_10s.png');
    if (st.err) { warn('Error: '+JSON.stringify(st.err)); break; }
  }
  await shot('p5_final.png');

  console.log('');
  console.log('='.repeat(55));
  console.log('HASIL: Media 34404');
  console.log('Preview opened :', modalMs!=null?'YES ' + modalMs+'ms':'NO');
  console.log('First buffer   :', firstBuf!=null?firstBuf+'ms':'NOT DETECTED');
  console.log('Playback started:', firstPlay!=null?'YES at '+firstPlay+'ms':'NO');
  if (lastSt?.dur && lastSt.dur>0) {
    const dlPct=(lastSt.bs/lastSt.dur*100).toFixed(1);
    console.log('Downloaded     :', lastSt.bs+'s of '+lastSt.dur+'s ('+dlPct+'%)');
    if (+dlPct<15) ok('PROGRESSIVE OK: <15% = instant stream!');
    else warn('Buffer: '+dlPct+'%');
  }
  console.log('='.repeat(55));
  ws.close();
}
main().catch(e=>{ console.error('X', e.message); process.exit(1); });
