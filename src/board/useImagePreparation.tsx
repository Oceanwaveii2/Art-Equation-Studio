import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectAsset, ProjectModel } from '../model/project'
import { cancelImagePyramid, imagePyramidStatus, startImagePyramid, type PyramidJob } from '../storage/workspace'
import { validPyramid } from '../canvas-engine/imagePyramid'

export function useImagePreparation(projectId: string, setProject: Dispatch<SetStateAction<ProjectModel>>) {
  const [task, setTask] = useState<{ job: PyramidJob; source: string; name: string } | null>(null)
  const [error, setError] = useState(''), busy = useRef(false)
  const prepare = async (asset: ProjectAsset) => {
    if (busy.current) { setError('Finish or cancel the current image preparation first.'); return }
    busy.current = true; setError('')
    const source = asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath
    try { setTask({ job: await startImagePyramid(projectId, asset.id, source), source, name: asset.displayName }) }
    catch (error) { setError(String(error)); busy.current = false }
  }
  const jobId = task?.job.id
  useEffect(() => {
    if (!jobId || !task) return
    const source = task.source
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const job = await imagePyramidStatus(jobId)
        if (stopped) return
        setTask(current => current?.job.id === jobId ? { ...current, job } : current)
        if (job.phase === 'complete' && validPyramid(job.pyramid)) {
          setProject(current => current.id !== job.projectId ? current : { ...current, assets: current.assets.map(asset => asset.id === job.assetId && (asset.status === 'moved' ? asset.managedRelativePath || asset.relativePath : asset.relativePath) === source ? { ...asset, imagePyramid: job.pyramid, thumbnailRelativePath: job.pyramid!.posterRelativePath, status: 'available' } : asset) })
        }
        if (['complete', 'failed', 'cancelled'].includes(job.phase)) { busy.current = false; return }
        timer = setTimeout(poll, 500)
      } catch (error) { if (!stopped) { setError(String(error)); timer = setTimeout(poll, 1500) } }
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
    // Poll lifetime is the native job, not progress updates or board selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, setProject])
  const done = task && ['complete', 'failed', 'cancelled'].includes(task.job.phase)
  const notice = (task || error) && <aside className="pyramid-preparation" aria-label="Tiled image preparation">
    <span role="status">{error || (task?.job.phase === 'complete' ? `${task.name}: tiled image ready` : `${task?.name}: ${task?.job.phase}`)}{task?.job.error && ` · ${task.job.error}`}</span>
    {task && !done && <button type="button" onClick={() => void cancelImagePyramid(task.job.id).catch(error => setError(String(error)))}>Cancel</button>}
    {(!task || done) && <button type="button" onClick={() => { setTask(null); setError('') }}>Dismiss</button>}
  </aside>
  return { prepare, notice }
}
