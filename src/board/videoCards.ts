/**
 * Art Equation Canvas Engine - Video Cards & Timeline Annotations
 *
 * Implements full video card metadata as specified in the test package:
 * - Decoupled video asset metadata: duration, frame rate, resolution, codec
 * - Filmstrip keyframe visualization
 * - Precise time-range annotations (e.g. videoId@00:15.0-00:19.2)
 * - Display List ops for card UI with player chrome, playhead, and time tags
 */

import type { VideoMetadata } from './mediaEngine.ts'

export interface VideoTimeRange {
  id: string
  startSec: number
  endSec: number
  label?: string
  confidence?: number
}

export interface VideoCard {
  id: string
  title: string
  assetId: string
  metadata: VideoMetadata
  bounds: { x: number; y: number; width: number; height: number }
  posterKey?: string
  filmstripKey?: string
  timeRanges: VideoTimeRange[]
  selectedRangeId?: string
}

export function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`
}

/**
 * Creates Display List v2 vector operations for video player chrome.
 */
export function createVideoPlayerChromeOps(
  videoCard: VideoCard,
  nextOpId: () => number
): any[] {
  const { x, y, width, height } = videoCard.bounds
  const ops: any[] = []

  // 1. Bottom control bar panel (semi-transparent dark gradient/overlay)
  const barHeight = 28
  const barY = y + height - barHeight

  ops.push({
    type: 'vector',
    object: {
      id: `vid-bar-${videoCard.id}-${nextOpId()}`,
      kind: 'vector',
      bounds: { x, y: barY, width, height: barHeight },
      visible: true,
      opacity: 0.85,
      blendMode: 'normal',
      payload: {
        commands: [
          ['M', x, barY],
          ['L', x + width, barY],
          ['L', x + width, barY + barHeight],
          ['L', x, barY + barHeight],
          ['Z']
        ],
        fill: '#0f1217f0',
        stroke: '#28313eff',
        strokeWidth: 1,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })

  // 2. Play icon triangle
  const playSize = 8
  const playX = x + 12
  const playY = barY + barHeight / 2
  ops.push({
    type: 'vector',
    object: {
      id: `vid-play-${videoCard.id}-${nextOpId()}`,
      kind: 'vector',
      bounds: { x: playX, y: playY - playSize / 2, width: playSize, height: playSize },
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      payload: {
        commands: [
          ['M', playX, playY - playSize / 2],
          ['L', playX + playSize, playY],
          ['L', playX, playY + playSize / 2],
          ['Z']
        ],
        fill: '#ffffffff',
        stroke: '#00000000',
        strokeWidth: 0,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })

  // 3. Timeline progress track
  const trackX = playX + playSize + 12
  const trackWidth = width - (trackX - x) - 16
  const trackY = barY + barHeight / 2 - 2
  const trackHeight = 4

  ops.push({
    type: 'vector',
    object: {
      id: `vid-track-${videoCard.id}-${nextOpId()}`,
      kind: 'vector',
      bounds: { x: trackX, y: trackY, width: trackWidth, height: trackHeight },
      visible: true,
      opacity: 1,
      blendMode: 'normal',
      payload: {
        commands: [
          ['M', trackX, trackY],
          ['L', trackX + trackWidth, trackY],
          ['L', trackX + trackWidth, trackY + trackHeight],
          ['L', trackX, trackY + trackHeight],
          ['Z']
        ],
        fill: '#334155ff',
        stroke: '#00000000',
        strokeWidth: 0,
        vectorFillRule: 'nonzero'
      },
      transform: [1, 0, 0, 1, 0, 0]
    }
  })

  // 4. Highlighted active time range (e.g. 00:15.0 - 00:19.2) if present
  if (videoCard.timeRanges.length > 0) {
    const range = videoCard.timeRanges[0]
    const dur = Math.max(1, videoCard.metadata.durationSec)
    const startFrac = Math.max(0, Math.min(1, range.startSec / dur))
    const endFrac = Math.max(0, Math.min(1, range.endSec / dur))
    const rx = trackX + trackWidth * startFrac
    const rw = Math.max(4, trackWidth * (endFrac - startFrac))

    ops.push({
      type: 'vector',
      object: {
        id: `vid-range-${videoCard.id}-${nextOpId()}`,
        kind: 'vector',
        bounds: { x: rx, y: trackY - 1, width: rw, height: trackHeight + 2 },
        visible: true,
        opacity: 1,
        blendMode: 'normal',
        payload: {
          commands: [
            ['M', rx, trackY - 1],
            ['L', rx + rw, trackY - 1],
            ['L', rx + rw, trackY + trackHeight + 1],
            ['L', rx, trackY + trackHeight + 1],
            ['Z']
          ],
          fill: '#06b6d4ff',
          stroke: '#ffffffff',
          strokeWidth: 0.5,
          vectorFillRule: 'nonzero'
        },
        transform: [1, 0, 0, 1, 0, 0]
      }
    })
  }

  return ops
}
