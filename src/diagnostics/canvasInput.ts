type Kind = 'pan' | 'zoom'
type Input = { seq: number; at: number; kind: Kind }
export type PaintInput = { seq: number; requestedAt: number }
let nextInputScope = 0
/** Correlates input with the generation actually committed. A smooth rAF loop
 * or an old accepted frame cannot satisfy this measurement. */
export class CanvasInputTracker {
  private readonly inputScope = ++nextInputScope
  private inputs: Input[] = []
  private seq = 0
  private now: () => number
  dropped = 0
  constructor(now = () => performance.now()) { this.now = now }
  mark(kind: Kind) {
    const input = { seq: ++this.seq, at: this.now(), kind }
    this.inputs.push(input)
    if (this.inputs.length > 512) { this.inputs.shift(); this.dropped++ }
    return input.seq
  }
  begin(): PaintInput { return { seq: this.seq, requestedAt: this.now() } }
  commit(request: PaintInput) {
    const end = this.now(), pending = this.inputs.filter(input => input.seq <= request.seq)
    this.inputs = this.inputs.filter(input => input.seq > request.seq)
    if (!pending.length) return undefined
    return { kind: pending.at(-1)!.kind, inputSeq: request.seq, coalesced: pending.length,
      oldestInputMs: end - pending[0].at, latestInputMs: end - pending.at(-1)!.at,
      requestToCommitMs: end - request.requestedAt, pendingInputs: this.inputs.length, dropped: this.dropped,
      // Keep every credited event's kind and age. A mixed pan/zoom batch must
      // not turn all earlier zoom events into the final pan event's latency.
      sampleSchema: 1, inputScope: this.inputScope, inputSamplesJson: JSON.stringify(pending.map(input => ({ seq: input.seq, kind: input.kind, ms: end - input.at }))) }
  }
}
