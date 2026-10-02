import puppeteer from 'puppeteer-core'
const b = await puppeteer.launch({ executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:'new', args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--window-size=1440,900']})
const p = await b.newPage(); await p.setViewport({width:1440,height:900})
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())})
await p.goto('http://localhost:5180/?stage=furnish&seed=1',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,3000))
let fail=0; const ok=(c,m)=>{console.log(`${c?'✓':'❌'} ${m}`); if(!c)fail++}
const furn=()=>p.evaluate(()=>window.__roomio.getState().design.furniture.map(f=>({a:f.archetype,n:f.name})))
const addRoom=async(label)=>{
  await p.evaluate(()=>document.querySelector('[data-testid=add-room]')?.click()); await new Promise(r=>setTimeout(r,250))
  const clicked = await p.evaluate((label)=>{const pick=document.querySelector('[data-testid=room-type-picker]'); if(!pick)return false; const btn=[...pick.querySelectorAll('button')].find(b=>b.textContent.trim()===label); if(btn){btn.click();return true} return false}, label)
  await new Promise(r=>setTimeout(r,800)); return clicked
}
ok(await p.$('[data-testid=add-room]'), 'Rooms bar present (multi-room) in furnish')

ok(await addRoom('Kitchen'), 'created a Kitchen room')
const kf=await furn(); console.log('   kitchen furniture:', JSON.stringify(kf))
ok(kf.some(f=>f.a==='kitchen-counter'), 'KITCHEN auto-furnished with a Counter')
await p.screenshot({path:'camera-flythrough/scripts/__shots/19-kitchen.png'})

ok(await addRoom('Bathroom'), 'created a Bathroom room')
const bf=await furn(); console.log('   bathroom furniture:', JSON.stringify(bf))
ok(bf.some(f=>f.a==='bath-shower'), 'BATHROOM auto-furnished with a Shower')
ok(bf.some(f=>f.a==='bath-toilet'), 'BATHROOM auto-furnished with a Toilet')
await p.screenshot({path:'camera-flythrough/scripts/__shots/20-bathroom.png'})

ok(errs.filter(e=>!/favicon|401|unauthorized|404/i.test(e)).length===0, `no console errors${errs.length?' :: '+errs.slice(0,3).join(' | '):''}`)
console.log(fail?`\nFAIL (${fail})`:'\nALL PASS — kitchen/bathroom have distinct fixtures')
await b.close(); process.exit(fail?1:0)
