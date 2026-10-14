import type React from 'react'
import type { BoardNode } from '../model/project'
import { PORT_SEMANTIC_COLORS } from './cardPorts'
import type { NodeGraphPort } from './nodeColumnCommands'

type Props = {
  node: BoardNode
  ports: readonly NodeGraphPort[]
  selectedSocket?: string
  readOnly: boolean
  viewportScale: number
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>, nodeId: string, socket: string) => void
  onKeyboardActivate: (nodeId: string, socket: string) => void
}

/** DOM buttons are the interaction proxies for the engine's typed graph
 * anchors. They do not own the image/card pixels or a second graph document. */
export function NodeGraphControls({ node, ports, selectedSocket, readOnly, viewportScale, onPointerDown, onKeyboardActivate }: Props) {
  if (!ports.length) return null
  const size = Math.min(96, Math.max(6, 18 / Math.max(.1, viewportScale)))
  return <div className="node-graph-sockets" role="group" aria-label={`${node.title} graph sockets`}>
    {ports.map((port) => {
      const offset = `${Math.max(0, Math.min(1, port.normalizedOffset)) * 100}%`
      const style = {
        left: port.side === 'left' ? '0px' : port.side === 'right' ? `calc(100% - ${size}px)` : offset,
        top: port.side === 'top' ? '0px' : port.side === 'bottom' ? `calc(100% - ${size}px)` : offset,
        transform: port.side === 'left' || port.side === 'right' ? 'translateY(-50%)' : 'translateX(-50%)',
        width: size, height: size, borderWidth: Math.min(8, Math.max(1, 2 / Math.max(.1, viewportScale))),
        '--socket-color': PORT_SEMANTIC_COLORS[port.semanticType],
      } as React.CSSProperties
      return <button key={port.key} type="button" className={`node-graph-socket ${selectedSocket === port.key ? 'active' : ''}`}
        data-node-graph-node-id={node.id} data-node-graph-port-key={port.key} data-direction={port.direction}
        aria-label={`${port.label || port.semanticType} socket on ${node.title}; ${port.direction}`}
        aria-pressed={selectedSocket === port.key} title={`${port.label || port.semanticType} · ${port.direction}`}
        disabled={readOnly} style={style}
        onPointerDown={(event) => onPointerDown(event, node.id, port.key)}
        onClick={(event) => { event.stopPropagation(); if (event.detail === 0) onKeyboardActivate(node.id, port.key) }} />
    })}
  </div>
}
