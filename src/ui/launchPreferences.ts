import { useSyncExternalStore } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
export function readLaunchTheme(): 'navy'|'dark'|'light'|undefined {try{const value=localStorage.getItem('art-equation:ui-theme:v1');return value==='navy'||value==='dark'||value==='light'?value:undefined}catch{return undefined}}
export function saveLaunchTheme(value:'navy'|'dark'|'light'){try{localStorage.setItem('art-equation:ui-theme:v1',value)}catch{/* Workspace disk settings remain the native persistence path. */}}
export type LaunchLanguage = 'en' | 'zh-CN' | 'ja' | 'pt-BR' | 'pt-PT' | 'es'
export type LaunchPreferences = { language: LaunchLanguage; nativeBackend: 'auto' | 'dx12' | 'vulkan'; preparationAcceleration: 'standard' | 'cuda-dx12' | 'cuda-dx12-upload' }
export const launchLanguages: { id: LaunchLanguage; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'zh-CN', label: '简体中文（普通话）' },
  { id: 'ja', label: '日本語' }, { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'pt-PT', label: 'Português (Portugal)' }, { id: 'es', label: 'Español' },
]
const key = 'art-equation:launch-preferences:v1'
const valid = (p: unknown): p is LaunchPreferences => !!p && typeof p === 'object'
  && launchLanguages.some(l => l.id === (p as LaunchPreferences).language)
  && ['auto', 'dx12', 'vulkan'].includes((p as LaunchPreferences).nativeBackend)
  && ['standard', 'cuda-dx12', 'cuda-dx12-upload'].includes((p as LaunchPreferences).preparationAcceleration || 'standard')
let current: LaunchPreferences = { language: 'en', nativeBackend: 'auto', preparationAcceleration: 'standard' }
try { const saved: unknown = JSON.parse(localStorage.getItem(key) || 'null'); if (valid(saved)) current = { ...saved, preparationAcceleration: saved.preparationAcceleration || 'standard' } } catch { /* defaults */ }
const listeners = new Set<() => void>()
let revision = 0
let loaded: Promise<void> | undefined
let writes: Promise<unknown> = Promise.resolve()
function publish(p: LaunchPreferences) { current = { ...p, preparationAcceleration: p.preparationAcceleration || 'standard' }; localStorage.setItem(key, JSON.stringify(p)); for (const listener of listeners) listener() }
export function hydrateLaunchPreferences() {
  return loaded ||= (isTauri() ? (() => {
    const started = revision
    return invoke<LaunchPreferences>('get_launch_preferences').then(p => { if (valid(p) && started === revision) publish(p) })
  })() : Promise.resolve())
}
export function saveLaunchPreferences(p: LaunchPreferences) {
  if (!valid(p)) return Promise.reject(new Error('Invalid launch preferences'))
  revision++; publish(p)
  // Serialize writes so rapid language/backend changes cannot save out of order.
  const result = writes.catch(() => undefined).then(() => isTauri() ? invoke('set_launch_preferences', { preferences: p }) : undefined)
  writes = result
  return result
}
export function useLaunchPreferences() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current)
}

export type LaunchLayout = 'milinotes'|'graphing'|'advanced-split'
export function readLaunchLayout():LaunchLayout {try{const value=localStorage.getItem('art-equation:launch-layout:v1');if(value==='graphing'||value==='advanced-split')return value}catch{}return 'milinotes'}
export function saveLaunchLayout(value:LaunchLayout){try{localStorage.setItem('art-equation:launch-layout:v1',value)}catch{}}

export type CanvasUiPersonality = 'classical' | 'milanote'
export function readCanvasUiPersonality(): CanvasUiPersonality {
  try {
    const value = localStorage.getItem('art-equation:canvas-ui-personality:v1')
    if (value === 'classical' || value === 'milanote') return value
  } catch {}
  return 'classical'
}
export function saveCanvasUiPersonality(value: CanvasUiPersonality) {
  try {
    localStorage.setItem('art-equation:canvas-ui-personality:v1', value)
  } catch {}
}

