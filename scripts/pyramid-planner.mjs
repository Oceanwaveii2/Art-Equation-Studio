import assert from 'node:assert/strict'
import { planPyramid, validPyramid } from '../src/canvas-engine/imagePyramid.ts'
const p={schemaVersion:1,width:40001,height:1025,maxLevel:16,tileSize:512,overlap:1,format:'png',tilesRelativePath:'projects/p/assets/pyramids/a/image_files',posterRelativePath:'projects/p/assets/pyramids/a/poster.png',manifestRelativePath:'projects/p/assets/pyramids/a/manifest.json'}
assert(validPyramid(p)); assert(!validPyramid({...p,maxLevel:100}));assert(!validPyramid({...p,tilesRelativePath:'projects/p/assets/pyramids/../../evil'}))
for(const demand of [.001,.01,.1,.5,1,2,8]) for(const capacity of [1,4,49]) {
 const tiles=planPyramid(p,{x:0,y:0,width:p.width,height:p.height},demand,capacity)
 assert(tiles.length>0&&tiles.length<=capacity)
 for(const tile of tiles) {assert(tile.x>=0&&tile.y>=0&&tile.x+tile.width<=p.width&&tile.y+tile.height<=p.height);assert(tile.pixelWidth<=514&&tile.pixelHeight<=514)}
 assert.equal(tiles.reduce((sum,t)=>sum+t.width*t.height,0),p.width*p.height)
}
const atEdge=planPyramid(p,{x:0,y:0,width:512,height:512},1); assert.equal(atEdge.length,1);assert.equal(atEdge[0].level,16)
assert.equal(planPyramid(p,{x:40001,y:0,width:100,height:100},1).length,0)
assert.equal(planPyramid(p,{x:512,y:512,width:512,height:512},1)[0].key,'16/1_1.png')
assert(planPyramid(p,{x:0,y:0,width:1024,height:512},.5)[0].level<planPyramid(p,{x:0,y:0,width:1024,height:512},1)[0].level)
console.log('Pyramid planning PASS: capacity, mip/DPI, exact edges, complete coverage, overlap and manifest validation')
