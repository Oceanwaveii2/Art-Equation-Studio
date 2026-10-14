import {useEffect,useState} from 'react'
import {getProjectStorageStatus,type SavePolicy,type StorageStatus} from '../storage/workspace'
import type {ProjectModel} from '../model/project'
const stamp=(n?:number)=>n?new Date(n).toLocaleString():'Not yet saved'
export function SaveSettingsPanel({project,enabled,readOnly,policy,pending,onPolicy,onFlush}:{project:ProjectModel;enabled:boolean;readOnly:boolean;policy:SavePolicy;pending:boolean;onPolicy:(p:SavePolicy)=>void;onFlush:()=>Promise<void>}){
 const [status,setStatus]=useState<StorageStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[custom,setCustom]=useState(String(policy.intervalMinutes)),[customShown,setCustomShown]=useState(false)
 useEffect(()=>{if(!enabled)return;let live=true;setStatus(null);const refresh=()=>void getProjectStorageStatus(project.id).then(v=>{if(live)setStatus(v)}).catch(e=>{if(live)setError(String(e))});refresh();const timer=window.setInterval(refresh,4000);return ()=>{live=false;window.clearInterval(timer)}},[enabled,project.id])
 async function flush(){setBusy(true);setError('');try{await onFlush();setStatus(await getProjectStorageStatus(project.id))}catch(e){setError(String(e))}finally{setBusy(false)}}
 return <section aria-label="Saving and recovery"><h2>Saving and recovery</h2>
  <label><span>Automatic saving</span><select aria-label="Automatic saving mode" value={policy.mode} disabled={readOnly} onChange={e=>onPolicy({...policy,mode:e.target.value as SavePolicy['mode']})}><option value="continuous">Continuously save edits</option><option value="interval">Save only at the selected interval</option></select></label>
  <small>{policy.mode==='continuous'?'Edits save continuously. The interval controls additional recovery snapshots.':'Edits remain pending until the next automatic save. Manual Save and closing flush your latest edits and board files.'}</small>
  <label><span>{policy.mode==='continuous'?'Recovery snapshot interval':'Automatic save and recovery interval'}</span><select aria-label="Save interval" value={!customShown&&[5,10,30].includes(policy.intervalMinutes)?String(policy.intervalMinutes):'custom'} disabled={readOnly} onChange={e=>{if(e.target.value==='custom'){setCustomShown(true);setCustom(String(policy.intervalMinutes))}else {setCustomShown(false);onPolicy({...policy,intervalMinutes:Number(e.target.value)})}}}><option value="5">5 minutes</option><option value="10">10 minutes</option><option value="30">30 minutes</option><option value="custom">Custom</option></select></label>
  {(customShown||![5,10,30].includes(policy.intervalMinutes))&&<label><span>Custom minutes (1–1440)</span><input type="number" aria-label="Custom save minutes" min="1" max="1440" step="1" value={custom} disabled={readOnly} onChange={e=>setCustom(e.target.value)}/><button type="button" disabled={readOnly||!Number.isInteger(Number(custom))||Number(custom)<1||Number(custom)>1440} onClick={()=>onPolicy({...policy,intervalMinutes:Number(custom)})}>Apply interval</button></label>}
  <div className="settings-readout"><span>Current edits</span><strong>{pending?'Waiting to save':'No pending content edits'}</strong></div>
  {!enabled?<small>Native project and board save files are available in the desktop app.</small>:<>
   <div className="settings-readout"><span>Project state committed</span><strong>{stamp(status?.stateSavedAt)}</strong></div>
   <div className="settings-readout"><span>Project manifest saved</span><strong>{stamp(status?.projectFileSavedAt)}</strong></div>
   <div className="settings-readout"><span>Recovery snapshot saved</span><strong>{stamp(status?.recoverySavedAt)}</strong></div>
   <small>{status?.pendingBoards||0} board files awaiting checkpoint. Project revision {status?.projectRevision||0}.</small>
   <details><summary>Individual board saves ({project.boards.length})</summary><div className="settings-save-board-list">{project.boards.map(b=><div className="settings-readout" key={b.id}><span>{b.title}</span><strong>{stamp(status?.boardCheckpoints?.[b.id]?.savedAt)}</strong></div>)}</div></details>
   <button type="button" disabled={readOnly||busy} onClick={()=>void flush()}>{busy?'Saving…':'Save project, boards and recovery snapshot now'}</button>
  </>}
  {(error||status?.error)&&<p role="alert">{error||status?.error}</p>}
 </section>
}

