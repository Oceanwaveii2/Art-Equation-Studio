declare module 'utif' {
  export function decode(buffer: ArrayBuffer): Array<{ width: number; height: number; t256?: number[]; t257?: number[] }>
  export function decodeImage(buffer: ArrayBuffer, image: unknown): void
  export function toRGBA8(image: unknown): Uint8Array
}
