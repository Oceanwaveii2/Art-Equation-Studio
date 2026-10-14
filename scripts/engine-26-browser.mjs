import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import UTIF from 'utif'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const output='output/engine-2.6-correctness'
await fs.mkdir(output,{recursive:true})
const pixels=new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255])
let source=Buffer.from(UTIF.encodeImage(pixels,2,2))
const server=await createServer({cacheDir:'node_modules/.vite-engine-26',optimizeDeps:{entries:['scripts/fixtures/engine-26-worker.html'],include:['utif']},server:{watch:null,host:'127.0.0.1',port:5286,strictPort:true}})
await server.listen()
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const context=await browser.newContext(),page=await context.newPage(),errors=[]
page.on('pageerror',error=>errors.push(error.message))
await context.route('**/engine-26-source.tif',route=>route.fulfill({body:source,contentType:'image/tiff'}))
const report={scope:'Real worker/IDB correctness only; no performance or 4K qualification',checks:[]}
try {
  await page.goto('http://127.0.0.1:5286/scripts/fixtures/engine-26-worker.html')
  const decode=()=>page.evaluate(async()=>{
    const {decodeTiff}=await import('/src/board/preparationWorkers.ts')
    const result=await decodeTiff(location.origin+'/engine-26-source.tif',new AbortController().signal,true)
    const image=await createImageBitmap(result.blob),canvas=new OffscreenCanvas(2,2),ctx=canvas.getContext('2d')
    ctx.drawImage(image,0,0); image.close()
    return {width:result.width,height:result.height,pixels:[...ctx.getImageData(0,0,2,2).data],cacheHit:result.cacheHit,cacheStored:result.cacheStored}
  })
  const first=await decode(); assert.deepEqual(first.pixels,[...pixels]);assert.equal(first.cacheHit,false);assert.equal(first.cacheStored,true)
  report.checks.push({name:'Actual background TIFF decode matches source pixels',result:first})
  await page.reload()
  const reopened=await decode();assert.equal(reopened.cacheHit,true);assert.deepEqual(reopened.pixels,[...pixels]);report.checks.push({name:'Disk preview survives page/worker restart',result:reopened})
  pixels[0]=12;source=Buffer.from(UTIF.encodeImage(pixels,2,2))
  const changed=await decode();assert.equal(changed.cacheHit,false);assert.deepEqual(changed.pixels,[...pixels]);report.checks.push({name:'Same path with changed source content invalidates cached derivative',result:changed})
  const cache=await page.evaluate(async()=>{
    const m=await import('/src/board/derivedDiskCache.ts')
    await m.clearDerivedCache()
    const blob=new Blob([new Uint8Array([1,2,3])],{type:'image/png'})
    const damagedKey='tiff-utif-3.1-png-v1:'+'f'.repeat(64)
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open('art-equation-derived-engine-26',2)
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(['previews','metadata'],'readwrite')
        tx.objectStore('previews').put({key:damagedKey,blob,width:1,height:1,bytes:NaN,used:0})
        tx.objectStore('metadata').put({key:damagedKey,width:1,height:1,bytes:NaN,used:0})
        tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)
      };request.onerror=()=>reject(request.error)
    })
    for(let index=0;index<130;index++) await m.writeDerivedPreview('tiff-utif-3.1-png-v1:'+index.toString(16).padStart(64,'0'),blob,1,1)
    const status=await m.derivedCacheStatus()
    const oldest=await m.readDerivedPreview('tiff-utif-3.1-png-v1:'+'0'.repeat(64))
    const invalid=await m.writeDerivedPreview('bad key',blob,1,1)
    const damaged=await m.readDerivedPreview(damagedKey)
    await m.clearDerivedCache()
    return {status,oldestPresent:Boolean(oldest),damagedPresent:Boolean(damaged),invalidAccepted:invalid,after:await m.derivedCacheStatus()}
  })
  assert.equal(cache.status.entries,128);assert.equal(cache.status.bytes,384);assert.equal(cache.oldestPresent,false);assert.equal(cache.damagedPresent,false);assert.equal(cache.invalidAccepted,false);assert.equal(cache.after.entries,0)
  report.checks.push({name:'Transactional LRU entry cap, malformed-key rejection and clear',result:cache})
  const concurrency=await page.evaluate(async()=>{
    const m=await import('/src/board/derivedDiskCache.ts')
    const blob=new Blob(['png'],{type:'image/png'}),key=index=>'tiff-utif-3.1-png-v1:'+index.toString(16).padStart(64,'0')
    await Promise.all(Array.from({length:140},(_,index)=>m.writeDerivedPreview(key(index),blob,1,1)))
    const status=await m.derivedCacheStatus()
    const touched=await m.readDerivedPreview(key(12))
    await m.derivedCacheStatus() // transaction fence for the best-effort recency touch
    await m.writeDerivedPreview(key(140),blob,1,1)
    return {status,touchedPresent:Boolean(touched),kept:Boolean(await m.readDerivedPreview(key(12))),evicted:Boolean(await m.readDerivedPreview(key(13))),after:await m.derivedCacheStatus()}
  })
  assert.equal(concurrency.status.entries,128);assert.equal(concurrency.status.bytes,384);assert.equal(concurrency.kept,true);assert.equal(concurrency.evicted,false);assert.equal(concurrency.after.entries,128)
  report.checks.push({name:'Concurrent cache writes stay bounded and a read refreshes LRU without loading all previews',result:concurrency})
  const migration=await page.evaluate(async()=>{
    const m=await import('/src/board/derivedDiskCache.ts'),name='art-equation-derived-engine-26'
    await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error)})
    await new Promise((resolve,reject)=>{
      const r=indexedDB.open(name,1);r.onupgradeneeded=()=>r.result.createObjectStore('previews',{keyPath:'key'})
      r.onsuccess=()=>{const db=r.result,tx=db.transaction('previews','readwrite');tx.objectStore('previews').put({key:'old-derivative',blob:new Blob(['old'])});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>reject(tx.error)}
      r.onerror=()=>reject(r.error)
    })
    return await m.derivedCacheStatus()
  })
  assert.equal(migration.available,true);assert.equal(migration.entries,0);assert.equal(migration.bytes,0)
  report.checks.push({name:'Closed connections reopen and old derivative schema resets its unaccounted payloads',result:migration})
  const unavailablePage=await context.newPage()
  await unavailablePage.goto('http://127.0.0.1:5286/scripts/fixtures/engine-26-worker.html')
  const unavailable=await unavailablePage.evaluate(async()=>{
    IDBFactory.prototype.open=()=>{throw new DOMException('Controlled profile failure','SecurityError')}
    const m=await import('/src/board/derivedDiskCache.ts'),key='tiff-utif-3.1-png-v1:'+'a'.repeat(64)
    return {hit:Boolean(await m.readDerivedPreview(key)),stored:await m.writeDerivedPreview(key,new Blob(['png'],{type:'image/png'}),1,1),status:await m.derivedCacheStatus()}
  })
  assert.equal(unavailable.hit,false);assert.equal(unavailable.stored,false);assert.equal(unavailable.status.available,false)
  report.checks.push({name:'Unavailable profile falls back without cache-read or write failures',result:unavailable})
  await unavailablePage.close()
  // A corrupt cached PNG with a valid source key must repair from the source.
  await page.evaluate(async bytes=>{
    const m=await import('/src/board/derivedDiskCache.ts'),key=await m.derivedCacheKey(new Uint8Array(bytes).buffer)
    await m.writeDerivedPreview(key,new Blob(['corrupt png'],{type:'image/png'}),2,2)
  },[...source])
  const repaired=await decode();assert.equal(repaired.cacheHit,false);assert.deepEqual(repaired.pixels,[...pixels]);report.checks.push({name:'Corrupt prepared preview repairs without changing the original',result:repaired})
  assert.deepEqual(errors,[])
  report.passed=true
} catch(error) { report.passed=false;report.error=String(error);throw error }
finally {await fs.writeFile(output+'/browser.json',JSON.stringify({...report,errors},null,2));await browser.close();await server.close()}
console.log(JSON.stringify(report))
