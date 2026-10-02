// Walk forward/backward in the REAL app: enters LEVEL at eye height, spawns clear
// of furniture, and W/S move correctly — forward never goes backward, backward
// never goes forward (the bug: camera clobbered to a top-down pose, so forward
// fell back to a fixed -z direction independent of where you looked).
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const arr=(()=>{const j=JSON.parse(readFileSync('src/data/personas.json','utf8'));return Array.isArray(j)?j:(j.personas||[])})()
const neo=arr.find(x=>x.genre_id==='neo_deco')
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1440,900']})
const p = await b.newPage(); await p.setViewport({width:1440,height:900})
await p.goto('http://localhost:5180/?stage=furnish&seed=1',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,2500))
await p.evaluate((preset)=>window.__roomio.getState().loadPreset(preset), neo); await new Promise(r=>setTimeout(r,1200))
await p.evaluate(()=>window.__roomioFly.openPanel())
let fail=0; const ok=(c,m)=>{console.log(`${c?'✓':'❌'} ${m}`); if(!c)fail++}
const reenter=async()=>{await p.evaluate(()=>window.__roomioFly.setMode('director')); await p.evaluate(()=>window.__roomioFly.setMode('walk')); await new Promise(r=>setTimeout(r,400))}
const cam=()=>p.evaluate(()=>{const c=window.__roomioFly.walk.camera;c.updateMatrixWorld();const v=new(c.position.constructor)();c.getWorldDirection(v);return{y:+c.position.toArray()[1].toFixed(2),fwdY:+v.y.toFixed(2),pitch:+c.rotation.x.toFixed(3)}})
const inFurn=()=>p.evaluate(()=>{const c=window.__roomioFly.handle.getColliders();const pc=window.__roomioFly.walk.posCm;for(const o of c.furniture){const cs=Math.cos(o.rot),sn=Math.sin(o.rot);const lx=(pc.x-o.cx)*cs+(pc.z-o.cz)*-sn,lz=(pc.x-o.cx)*sn+(pc.z-o.cz)*cs;if(Math.abs(lx)<=o.w/2&&Math.abs(lz)<=o.d/2)return true}return false})
const setYaw=(y)=>p.evaluate((y)=>{const c=window.__roomioFly.walk.camera;c.rotation.set(0,y,0);c.quaternion.setFromEuler(c.rotation)},y)
const fwd=()=>p.evaluate(()=>{const c=window.__roomioFly.walk.camera;c.updateMatrixWorld();const v=new(c.position.constructor)();c.getWorldDirection(v);return[v.x,v.z]})
const pos=()=>p.evaluate(()=>window.__roomioFly.walk.camera.position.toArray())
const tap=async(code,ms=300)=>{await p.evaluate((c)=>window.dispatchEvent(new KeyboardEvent('keydown',{code:c})),code);await new Promise(r=>setTimeout(r,ms));await p.evaluate((c)=>window.dispatchEvent(new KeyboardEvent('keyup',{code:c})),code);await new Promise(r=>setTimeout(r,120))}
const along=async(yaw,code)=>{await reenter();await setYaw(yaw);await new Promise(r=>setTimeout(r,100));const f=await fwd();const a=await pos();await tap(code);const c=await pos();return (c[0]-a[0])*f[0]+(c[2]-a[2])*f[1]}

await reenter()
const c0=await cam()
ok(Math.abs(c0.pitch)<0.1 && Math.abs(c0.fwdY)<0.2, `enters LEVEL (pitch=${c0.pitch}, fwdY=${c0.fwdY})`)
ok(c0.y>1.55 && c0.y<1.65, `eye height ~1.6m (y=${c0.y})`)
ok(!(await inFurn()), 'spawns CLEAR of furniture')

const yaws=[0,0.8,1.6,2.4,3.1,-0.8,-1.6,-2.4]
const ws=[], ss=[]; let inverted=0
for(const y of yaws){ const w=await along(y,'KeyW'); const s=await along(y,'KeyS'); ws.push(w); ss.push(s); if(w<-0.06||s>0.06){inverted++; console.log(`   inverted @yaw ${y}: W=${w.toFixed(2)} S=${s.toFixed(2)}`)} }
ok(inverted===0, `no inversion across ${yaws.length} headings (W never backward, S never forward)`)
ok(Math.max(...ws)>0.4, `FORWARD works (max W = ${Math.max(...ws).toFixed(2)}m along look dir)`)
ok(Math.min(...ss)<-0.4, `BACKWARD works (max S = ${Math.min(...ss).toFixed(2)}m along look dir)`)
console.log(fail?`\nFAIL (${fail})`:'\nALL PASS — forward/backward work properly')
await b.close(); process.exit(fail?1:0)
