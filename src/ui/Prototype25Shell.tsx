import { requestAppFrame } from '../canvas-engine/appFrameClock'
import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import './Prototype25Shell.css'
import './SidebarResponsive.css'

export type Prototype25ShellSlots = {
  header: ReactNode
  workspaceNotice?: ReactNode
  workspaceHeading?: ReactNode
  navigator: ReactNode
  boardNavigation: ReactNode
  workspace: ReactNode
  inspector: ReactNode
  boardStrip: ReactNode
  overlays: ReactNode
  status: ReactNode
  focusBar: ReactNode
}

export type Prototype25ShellProps = {
  rootProps?: HTMLAttributes<HTMLDivElement>
  slots: Prototype25ShellSlots
  theme: 'navy' | 'dark' | 'light'
  projectTitle: string
  projectDetailsOpen: boolean
  onProjectDetailsOpenChange: (open: boolean) => void
  navigationWidth?: number
}

/** Presentation only: every slot keeps its existing controller, commands and editor instances. */
export function Prototype25Shell({ rootProps = {}, slots, theme, projectTitle, projectDetailsOpen, onProjectDetailsOpenChange, navigationWidth }: Prototype25ShellProps) {
  const [compactHeader, setCompactHeader] = useState(false)
  const detailsClose = useRef<HTMLButtonElement>(null)
  const detailsPanel = useRef<HTMLElement>(null)
  const closeProjectDetails = () => { onProjectDetailsOpenChange(false); requestAppFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Toggle project inspector"]')?.focus()) }
  useEffect(() => {
    if (!projectDetailsOpen) return
    detailsClose.current?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && detailsPanel.current?.contains(document.activeElement)) {
        event.preventDefault(); event.stopPropagation(); closeProjectDetails()
      }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [projectDetailsOpen])
  const { className, ...attributes } = rootProps
  const style = { ...attributes.style, ...(navigationWidth === undefined ? {} : { '--p25-navigation-width': `${Math.max(176, Math.min(360, navigationWidth))}px` }) } as CSSProperties
  return <div {...attributes} style={style} className={[className, 'studio-shell', 'p1-v2-shell', 'prototype25-integrated-shell', `workspace-${theme}`, compactHeader ? 'p25-compact-aquarium' : ''].filter(Boolean).join(' ')} data-ui-shell="prototype-2.5" data-engine-integration="canonical-production-controller">
    {slots.focusBar}
    <div className="p25-windowbar"><span>ART EQUATION STUDIO <i>PROTOTYPE 2.5</i></span><button type="button" aria-label={compactHeader ? 'Expand aquarium header' : 'Compact aquarium header'} aria-pressed={compactHeader} onClick={() => setCompactHeader(value => !value)} title={compactHeader ? 'Expand aquarium header' : 'Compact aquarium header'}>{compactHeader ? 'Expand header' : 'Compact header'}</button></div>
    {slots.header}
    {slots.workspaceNotice}
    <div className={'p25-workspace-body app-body' + (slots.navigator ? ' p25-with-navigation' : '')}>
      {slots.navigator && <div className="p25-navigation-slot">{slots.navigator}</div>}
      <section className="p25-workspace-center project-center" aria-label="Project workspace">
        <div className="p25-workspace-heading">{slots.workspaceHeading || <div><span>Project <i>›</i> {projectTitle}</span></div>}</div>
        {slots.boardNavigation && <div className="p25-board-navigation-slot">{slots.boardNavigation}</div>}
        <div className="p25-workspace-slot">{slots.workspace}</div>
        {slots.boardStrip && <div className="p25-board-strip-slot">{slots.boardStrip}</div>}
      </section>
    </div>
    <section ref={detailsPanel} id="p25-project-details" className="p25-project-details" role="dialog" aria-label="Project details" hidden={!projectDetailsOpen}>
      <header><div><strong>Project details</strong><small>Project, document and selection controls</small></div><button ref={detailsClose} type="button" aria-label="Close project details" onClick={closeProjectDetails}>×</button></header>
      {slots.inspector}
    </section>
    {slots.overlays}
    {slots.status}
  </div>
}
