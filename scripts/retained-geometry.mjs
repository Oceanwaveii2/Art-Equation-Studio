import assert from 'node:assert/strict'
import { retainedImageGeometry } from '../src/board/retainedImageGeometry.ts'
const base={left:1,top:38,width:126,height:66,imageWidth:512,imageHeight:256,radius:5,density:2,transform:{a:1,b:0,c:0,d:1}}
for (const angle of [0,17,90,180,270]) for (const flip of [1,-1]) {
  const radians=angle*Math.PI/180, a=Math.cos(radians)*flip,b=Math.sin(radians)*flip,c=-Math.sin(radians),d=Math.cos(radians)
  const geometry=retainedImageGeometry({...base,transform:{a,b,c,d}})
  assert(geometry.indices.length>=3)
  for(let i=0;i<geometry.positions.length;i+=2){
    const x=geometry.positions[i],y=geometry.positions[i+1],u=geometry.uvs[i],v=geometry.uvs[i+1]
    assert(x>=.9999&&x<=127.0001&&y>=37.9999&&y<=104.0001,'all corners stay inside the body')
    assert(u>=-.0001&&u<=1.0001&&v>=-.0001&&v<=1.0001,'UVs never sample outside the source')
    const sourceX=(u-.5)*126,sourceY=(v-.5)*63
    assert(Math.abs(x-(64+a*sourceX+c*sourceY))<.0001&&Math.abs(y-(71+b*sourceX+d*sourceY))<.0001,'clipping preserves the affine image mapping')
    if(y>99 && (x<6 || x>122)) assert((x-(x<6?6:122))**2+(y-99)**2<=25.001,'rounded corner coverage remains inside the arc')
  }
}
const plain=retainedImageGeometry({...base,radius:0,transform:{a:1,b:0,c:0,d:1}})
assert.deepEqual([...plain.uvs],[0,0,1,0,1,1,0,1])
console.log('Retained image clipping: affine UVs, rotations/flips, body and rounded corner containment PASS')
