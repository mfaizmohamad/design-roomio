import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const arr=(()=>{const j=JSON.parse(readFileSync('src/data/personas.json','utf8'));return Array.isArray(j)?j:(j.personas||[])})()
const neo=arr.find(x=>x.genre_id==='neo_deco')
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1440,900']})
const p = await b.newPage(); await p.setViewport({width:1440,height:900})
let fail=0; const ok=(c,m)=>{console.log(`${c?'✓':'❌'} ${m}`); if(!c)fail++}
const lockOf=(id)=>p.evaluate((id)=>window.__roomio.getState().design.furniture.find(f=>f.id===id)?.locked??null,id)
const count=()=>p.evaluate(()=>window.__roomio.getState().design.furniture.length)
const selId=()=>p.evaluate(()=>window.__roomio.getState().selectedFurnitureId)
const projAny=(excl)=>p.evaluate((excl)=>{
  const st=window.__roomio.getState(); const cam=window.__roomioFly.handle.camera; cam.updateMatrixWorld()
  const cs=st.design.corners; let mnX=1e9,mnZ=1e9,mxX=-1e9,mxZ=-1e9
  for(const c of cs){mnX=Math.min(mnX,c.x);mxX=Math.max(mxX,c.x);mnZ=Math.min(mnZ,c.z);mxZ=Math.max(mxZ,c.z)}
  const ccx=(mnX+mxX)/2,ccz=(mnZ+mxZ)/2; const r=document.querySelector('canvas').getBoundingClientRect(); const V=cam.position.constructor
  for(const item of st.design.furniture){ if(excl&&excl.includes(item.id))continue
    const v=new V((item.x-ccx)/100,(item.h||40)/200,(item.z-ccz)/100); v.project(cam); const sx=r.x+(v.x*.5+.5)*r.width, sy=r.y+(-v.y*.5+.5)*r.height
    if(sx>r.x+45&&sx<r.x+r.width-45&&sy>r.y+90&&sy<r.y+r.height-90&&v.z<1) return {id:item.id,sx,sy}} return null},excl)
const btn=(which)=>p.evaluate((which)=>{const t=document.querySelector('.item-toolbar'); if(!t||!t.offsetParent)return null; const bs=[...t.querySelectorAll('button')]; const el=which==='del'?(bs.find(x=>/danger/.test(x.className))||bs[1]):bs[0]; const r=el.getBoundingClientRect(); return {cx:r.x+r.width/2,cy:r.y+r.height/2}},which)
const realClick=async(x,y)=>{await p.mouse.move(x,y); await new Promise(r=>setTimeout(r,80)); await p.mouse.down(); await new Promise(r=>setTimeout(r,40)); await p.mouse.up(); await new Promise(r=>setTimeout(r,320))}
async function selectReal(excl){const t=await projAny(excl); if(!t)return null; await realClick(t.sx,t.sy); return await selId()}

async function suite(lightMode){
  await p.goto('http://localhost:5180/?stage=furnish&seed=1',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,2500))
  await p.evaluate((preset)=>window.__roomio.getState().loadPreset(preset), neo); await new Promise(r=>setTimeout(r,1500))
  if(lightMode){ await p.evaluate(()=>{const e=[...document.querySelectorAll('button')].find(x=>/light mode/i.test(x.textContent||'')); e&&e.click()}); await new Promise(r=>setTimeout(r,500)) }
  const tag=`[LM=${lightMode}]`
  // LOCK reliability: 3 trials on freshly-selected items
  let lockPass=0
  for(let i=0;i<3;i++){ const id=await selectReal(); if(!id){continue} const l0=await lockOf(id); const lb=await btn('lock'); if(!lb)continue; await realClick(lb.cx,lb.cy); if((await lockOf(id))!==l0) lockPass++; }
  ok(lockPass===3, `${tag} LOCK toggles item.locked on all 3 trials (got ${lockPass}/3)`)
  // DELETE reliability: 3 trials
  let delPass=0
  for(let i=0;i<3;i++){ const c0=await count(); const id=await selectReal(); if(!id)continue; const db=await btn('del'); if(!db)continue; await realClick(db.cx,db.cy); if((await count())===c0-1) delPass++; }
  ok(delPass===3, `${tag} DELETE removes the item on all 3 trials (got ${delPass}/3)`)
}
await suite(false)
await suite(true)
console.log(fail?`\nFAIL (${fail})`:'\nALL PASS — lock & delete work reliably')
await b.close(); process.exit(fail?1:0)
