import sharp from 'sharp';import fs from 'node:fs/promises';import path from 'node:path';
const dir='../evidence/vector-samples';
// LibRSVG caps a single XML attribute at 10 MiB. The basketball sample's
// embedded PNG exceeds it. Use the same bounded preview conversion on both
// comparison inputs; the editable board and exported originals remain intact.
const textures=new Map(),metrics=[];
async function preview(file){let text=await fs.readFile(file,'utf8');for(const match of [...text.matchAll(/data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=\s]+/g)]){let href=textures.get(match[0]);if(!href){const bytes=Buffer.from(match[0].split(',')[1],'base64');const png=await sharp(bytes,{limitInputPixels:200000000}).resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).png().toBuffer();href='data:image/png;base64,'+png.toString('base64');textures.set(match[0],href)}text=text.replaceAll(match[0],href)}return Buffer.from(text)}
for(const name of ['sample-vision-by-nastka-drabot','sample-miami-by-giordano-poloni','BasketballMohawks']) {
 await sharp(await preview(path.join(dir,name+'.recreated.svg')),{density:72,limitInputPixels:200000000}).resize({width:1200}).png().toFile(path.join(dir,name+'.recreated.png'));
 await sharp(await preview('C:/Users/User/Downloads/'+name+'.svg'),{density:72,limitInputPixels:200000000}).resize({width:1200}).png().toFile(path.join(dir,name+'.source-svg.png'));
 const a=await sharp(path.join(dir,name+'.source-svg.png')).flatten({background:'#ffffff'}).raw().toBuffer({resolveWithObject:true}),b=await sharp(path.join(dir,name+'.recreated.png')).flatten({background:'#ffffff'}).resize(a.info.width,a.info.height).raw().toBuffer();
 let sum=0,bad=0;for(let i=0;i<b.length;i++){const d=Math.abs(a.data[i]-b[i]);sum+=d;if(d>16)bad++};metrics.push({name,comparison:'supplied SVG versus editable export, same CPU renderer',meanAbsoluteChannelError:sum/b.length,channelFractionAbove16:bad/b.length});console.log(metrics.at(-1));
 const pdf=await sharp(path.join(dir,name+'.png')).flatten({background:'#ffffff'}).resize(a.info.width,a.info.height).raw().toBuffer();let pdfSum=0;for(let i=0;i<b.length;i++)pdfSum+=Math.abs(pdf[i]-b[i]);metrics.push({name,comparison:'PDF first page versus editable export, PDF resized to SVG canvas',meanAbsoluteChannelError:pdfSum/b.length});
}

await fs.writeFile(path.join(dir,'drawing-render-metrics.json'),JSON.stringify(metrics,null,2));
