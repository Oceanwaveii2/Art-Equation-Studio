import {useState} from 'react'
import type {BoardModel,ProjectAsset} from '../model/project'
import './PrototypeAssetShelf.css'
type Props={assets:ProjectAsset[];board:BoardModel;readOnly:boolean;preview:(asset:ProjectAsset)=>string|undefined;onCover:(id:string)=>void;onIcon:(asset:ProjectAsset)=>void;onPlace:(asset:ProjectAsset)=>void;onManage:()=>void}
export function PrototypeAssetShelf({assets,board,readOnly,preview,onCover,onIcon,onPlace,onManage}:Props){
 const [open,setOpen]=useState(true),[query,setQuery]=useState('')
 const eligible=assets.filter(asset=>asset.status!=='missing'&&asset.kind!=='font'&&asset.kind!=='other')
 const visible=eligible.filter(asset=>!query||asset.displayName.toLowerCase().includes(query.toLowerCase()))
 return <section className="p25-asset-shelf" aria-label="Assignable project assets">
  <header><button type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span aria-hidden="true">{open?'▾':'▸'}</span><span>Assignable assets ({eligible.length})</span></button><small title={board.title}>For: {board.title}</small></header>
  {open&&<><p>Assign covers and icons, or add to the canvas.</p>{eligible.length>8&&<input aria-label="Filter assignable assets" placeholder="Find an asset…" value={query} onChange={event=>setQuery(event.target.value)}/>}
  <div className="p25-asset-shelf-list">{visible.map(asset=><article key={asset.id} className={board.coverAssetId===asset.id?'is-cover':''}>
   <span className="p25-shelf-thumbnail">{preview(asset)?<img src={preview(asset)} alt="" loading="lazy"/>:asset.kind==='video'?'▷':asset.kind==='model'?'◇':'▧'}</span>
   <div className="p25-shelf-identity"><strong title={asset.displayName}>{asset.displayName}</strong><small>{asset.extension.toUpperCase()}</small></div>
    <div className="p25-shelf-actions" role="group" aria-label={`Actions for asset ${asset.displayName}`}>
     <button type="button" disabled={readOnly||asset.kind!=='image'} aria-pressed={board.coverAssetId===asset.id} onClick={()=>onCover(asset.id)} title={`Use ${asset.displayName} as board cover`}>▧ Cover</button>
     <button type="button" disabled={readOnly} onClick={()=>onIcon(asset)} title="Choose a board icon">◇ Icon</button>
     <button type="button" disabled={readOnly} onClick={()=>onPlace(asset)} title={`Place ${asset.displayName} on canvas`}>↗ Canvas</button>
    </div>
  </article>)}</div>{!visible.length&&<p>{eligible.length?'No matching assets.':'Import project assets to assign them here.'}</p>}
  <button type="button" className="p25-shelf-manage" onClick={onManage}>Asset catalog</button></>}
 </section>
}

