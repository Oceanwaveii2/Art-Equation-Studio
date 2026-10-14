import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import fs from 'node:fs/promises'
const exe=process.argv[2]||'D:/0/AE2Target-20261007/debug/art-equation-prototype-25.exe'
const width=513,height=257,rgba=Buffer.alloc(width*height*4)
for(let p=0;p<rgba.length;p+=4){const i=p/4;rgba[p]=i%251;rgba[p+1]=(i*7)%256;rgba[p+2]=(i*13)%256;rgba[p+3]=i%11===0?0:(i*3)%256}
const ow=Math.ceil(width/2),oh=Math.ceil(height/2),expected=Buffer.alloc(ow*oh*4)
for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){let a=0,n=0,rgb=[0,0,0];for(let yy=y*2;yy<Math.min(y*2+2,height);yy++)for(let xx=x*2;xx<Math.min(x*2+2,width);xx++){const p=(yy*width+xx)*4,v=rgba[p+3];a+=v;n++;for(let c=0;c<3;c++)rgb[c]+=rgba[p+c]*v}const p=(y*ow+x)*4;for(let c=0;c<3;c++)expected[p+c]=a?Math.floor((rgb[c]+Math.floor(a/2))/a):0;expected[p+3]=Math.floor((a+Math.floor(n/2))/n)}
async function run(request){const start=performance.now(),child=spawn(exe,['--engine-compute-worker'],{windowsHide:true,stdio:['pipe','pipe','pipe']}),out=[],err=[];child.stdout.on('data',s=>out.push(s));child.stderr.on('data',s=>err.push(s));child.stdin.end(JSON.stringify(request));const timer=setTimeout(()=>child.kill(),60000);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});clearTimeout(timer);assert.equal(code,0,Buffer.concat(err).toString().slice(-2000));const envelope=JSON.parse(Buffer.concat(out));assert.ok(!envelope.error,envelope.error);const result=envelope.result;const pixels=Buffer.from(result.rgbaBase64,'base64');assert.deepEqual(pixels,expected);assert.equal(result.width,ow);assert.equal(result.height,oh);delete result.rgbaBase64;return {...result,externalRoundTripMs:performance.now()-start}}
const report={scope:'Small controlled image-preparation correctness; independent JS pixel oracle. No 4K or canvas benchmark.',fixture:{width,height,outputWidth:ow,outputHeight:oh},exe,rows:[]}
for(const [backend,workers]of [['cpu',1],['cpu',2],['cpu',4],['wgpu',null],['opencl',null]]){const row=await run({width,height,rgbaBase64:rgba.toString('base64'),backend,workers});report.rows.push(row);console.log(JSON.stringify(row))}
report.passed=report.rows.every(row=>row.exactPixels&&row.backendSucceeded)
await fs.mkdir('output/engine-2.6-correctness',{recursive:true});await fs.writeFile('output/engine-2.6-correctness/experimental-native.json',JSON.stringify(report,null,2));assert.ok(report.passed,'Requested backend failed; exact CPU fallback does not qualify that accelerator')
