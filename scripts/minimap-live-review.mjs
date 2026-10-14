import {chromium} from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve('output/playwright/minimap-live-'+Date.now());await fs.mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080}}),report={scope:'Minimap browser pixels/navigation on disposable authored media. Not native rendering or stress-board qualification.',checks:[],errors:[]}
page.on('pageerror',error=>report.errors.push(error.message))
await page.addInitScript(()=>{const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){if(String(value).startsWith('data:image/svg+xml;charset=utf-8,')){const text=decodeURIComponent(value.split(',').slice(1).join(','));if(text.includes('minimap-grayscale'))window.__minimapSvg=text}descriptor.set.call(this,value)}})})
const check=(name,pass,detail)=>{report.checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name)}
const choose=async name=>{const button=page.locator(`.ocean-toolbar button[aria-label="${name}"]`),details=button.locator('xpath=ancestor::details');if(await details.count()&&!await details.evaluate(el=>el.open))await details.locator('summary').click();await button.click()}
try{
 await page.goto((process.env.AE_UI_URL||'http://127.0.0.1:5312')+'/?catalog=demo');await page.getByRole('button',{name:'Add a document or board',exact:true}).click();await page.getByRole('button',{name:'▧ New board',exact:true}).click();await page.getByRole('group',{name:'Workspace view'}).getByRole('button',{name:'Canvas',exact:true}).click();await page.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
 await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,100,100);ctx.fillStyle='#0000ff';ctx.fillRect(100,0,100,100);const source=canvas.toDataURL()
  ctx.fillStyle='#00ff00';ctx.fillRect(0,0,200,100);const hidden=canvas.toDataURL()
  localStorage.setItem('art-equation-board-clipboard',JSON.stringify({nodes:[
   {id:'mini-left',kind:'image',title:'Left original',body:source,imagePresentation:'artwork',x:-300,y:50,width:400,height:200,color:'#ffffff',imageTransform:{fit:'contain'}},
   {id:'mini-right',kind:'image',title:'Right cropped and flipped',body:source,imagePresentation:'artwork',x:600,y:250,width:200,height:200,color:'#ffffff',imageTransform:{fit:'cover',flipX:true}},
   {id:'mini-hidden',kind:'image',title:'Hidden source',body:hidden,imagePresentation:'artwork',hidden:true,x:10000,y:10000,width:800,height:800,color:'#00ff00'}
  ],connectors:[]}));window.dispatchEvent(new ClipboardEvent('paste'))
 });await choose('Fit board')
 if(!await page.locator('.board-minimap').count())await choose('Minimap')
 await page.waitForFunction(()=>document.querySelector('.board-minimap canvas')?.dataset.imageThumbnails==='2')
 const surface=page.locator('.board-minimap canvas').first()
 const pixels=await surface.evaluate(el=>{const data=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let red=0,blue=0,green=0;for(let i=0;i<data.length;i+=4){if(data[i]>200&&data[i+1]<40&&data[i+2]<40)red++;if(data[i]<40&&data[i+1]<40&&data[i+2]>200)blue++;if(data[i]<40&&data[i+1]>200&&data[i+2]<40)green++}return{red,blue,green}})
 check('image artwork appears in minimap pixels',pixels.red>50&&pixels.blue>50,pixels)
 check('hidden image is omitted from preview and fit bounds',pixels.green===0,pixels)
 await page.keyboard.press('Control+c')
 const authored=await page.evaluate(()=>JSON.parse(localStorage.getItem('art-equation-board-clipboard')).nodes)
 const left=authored.find(node=>node.title==='Left original'),right=authored.find(node=>node.title==='Right cropped and flipped')
 const minX=left.x-40,minY=left.y-40,maxX=right.x+right.width+40,maxY=right.y+right.height+40,world={x:right.x+right.width/2,y:right.y+right.height/2}
 const original=await surface.evaluate(el=>el.toDataURL()),box=await surface.boundingBox()
 await surface.evaluate(el=>{window.__minimapBaseline={width:el.width,height:el.height,pixels:el.getContext('2d').getImageData(0,0,el.width,el.height).data,svg:window.__minimapSvg}})
 const extent={width:maxX-minX,height:maxY-minY},scale=Math.min((box.width-14)/extent.width,(box.height-14)/extent.height),ox=(box.width-extent.width*scale)/2,oy=(box.height-extent.height*scale)/2
 const samples=await surface.evaluate((el,points)=>points.map(point=>Array.from(el.getContext('2d').getImageData(Math.round(point.x*el.width/el.clientWidth),Math.round(point.y*el.height/el.clientHeight),1,1).data)),[left,right].flatMap(node=>[.25,.75].map(f=>({x:ox+(node.x+node.width*f-minX)*scale,y:oy+(node.y+node.height/2-minY)*scale}))))
 const red=p=>p[0]>200&&p[1]<40&&p[2]<40,blue=p=>p[0]<40&&p[1]<40&&p[2]>200
 check('contain and cover thumbnails preserve their actual image orientation',red(samples[0])&&blue(samples[1])&&blue(samples[2])&&red(samples[3]),samples)
 const click={x:box.x+ox+(world.x-minX)*scale,y:box.y+oy+(world.y-minY)*scale};await page.mouse.click(click.x,click.y)
 const center=await page.locator('.board-world').evaluate(el=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(el).transform),stage=el.closest('.canvas-stage');return{x:(stage.clientWidth/2-matrix.e)/matrix.a,y:(stage.clientHeight/2-matrix.f)/matrix.d}})
 check('click recenters on the corresponding board location',Math.abs(center.x-world.x)<2&&Math.abs(center.y-world.y)<2,{center,world})
 const after=await surface.evaluate(el=>el.toDataURL());check('camera navigation retains the content layer',original===after)
 const minimap=page.locator('.board-minimap'),beforeKey=await page.locator('.board-world').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).e);await minimap.focus();await page.keyboard.press('ArrowRight');const moved=await page.locator('.board-world').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).e)
 check('keyboard navigation pans camera',Number.isFinite(moved)&&moved!==beforeKey)
 await page.mouse.move(click.x,click.y);await page.mouse.down();await page.mouse.move(click.x-40,click.y,{steps:8});await page.mouse.up();check('drag navigation leaves content intact',original===await surface.evaluate(el=>el.toDataURL()))
 await page.mouse.click(click.x,click.y);await choose('Select and move')
 await page.getByRole('button',{name:'Show Color and Layers',exact:true}).click()
 const utility=page.getByRole('complementary',{name:'Color and Layers utility',exact:true});await utility.getByRole('tab',{name:'Layers',exact:true}).click();await utility.getByRole('button',{name:'Hide Right cropped and flipped',exact:true}).click()
 await page.getByRole('button',{name:'Hide Color and Layers',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.board-minimap canvas')?.dataset.imageThumbnails==='1')
 check('changing image visibility updates the retained overview',await surface.evaluate(el=>el.toDataURL())!==original)
 await choose('Undo board change');await page.waitForFunction(()=>document.querySelector('.board-minimap canvas')?.dataset.imageThumbnails==='2')
 const restored=await surface.evaluate(el=>{const baseline=window.__minimapBaseline,current=el.getContext('2d').getImageData(0,0,el.width,el.height).data;let different=0,minX=el.width,minY=el.height,maxX=-1,maxY=-1,maximum=0;for(let i=0;i<current.length;i+=4)if(current.slice(i,i+4).some((v,j)=>v!==baseline.pixels[i+j])){different++;const x=(i/4)%el.width,y=Math.floor(i/4/el.width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);for(let j=0;j<4;j++)maximum=Math.max(maximum,Math.abs(current[i+j]-baseline.pixels[i+j]))}return{width:el.width,height:el.height,baselineWidth:baseline.width,baselineHeight:baseline.height,different,minX,minY,maxX,maxY,maximum}})
 check('undo restores the overview artwork',await surface.evaluate(el=>el.toDataURL())===original,restored)
 if(restored.different)report.svgDifference=await page.evaluate(()=>{const summarize=text=>{const svg=new DOMParser().parseFromString(text,'image/svg+xml');return [...svg.querySelectorAll('g,rect,image')].map(el=>({tag:el.tagName,attributes:Object.fromEntries([...el.attributes].filter(a=>a.name!=='href').map(a=>[a.name,a.value]))}))};return {baseline:summarize(window.__minimapBaseline.svg),restored:summarize(window.__minimapSvg)}})
 await page.screenshot({path:path.join(out,'minimap-live.png')});await minimap.screenshot({path:path.join(out,'minimap-detail.png')});check('no browser runtime errors',report.errors.length===0,report.errors)
}catch(error){report.errors.push(error.stack);check('review completed',false,error.message);await page.screenshot({path:path.join(out,'failure.png')})}
finally{report.decision=report.checks.every(c=>c.pass)&&!report.errors.length?'BROWSER_MINIMAP_PASS_ONLY':'REJECT';await fs.writeFile(path.join(out,'review.json'),JSON.stringify(report,null,2));await browser.close();console.log(out);if(report.decision==='REJECT')process.exitCode=1}
