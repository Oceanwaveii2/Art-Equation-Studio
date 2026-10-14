import type { PaintMatrix } from './paintDisplayList'
/** Conservative largest singular value includes rotated and sheared images.
 * A mip must supply at least one source pixel per physical display pixel. */
export function imageDemand(width:number,height:number,matrix:PaintMatrix,physicalScale:number) {
  if(![width,height,physicalScale,...matrix].every(Number.isFinite)||width<=0||height<=0||physicalScale<=0)
    throw new Error('IMAGE_INVALID: physical image demand invalid')
  const density=physicalScale*maximumTransformScale(matrix)
  let divisor=1
  while(divisor<Math.max(width,height)&&1/(divisor*2)>=density)divisor*=2
  return {width:Math.max(1,Math.ceil(width/divisor)),height:Math.max(1,Math.ceil(height/divisor)),divisor}
}

export function maximumTransformScale(matrix: readonly number[]) {
  const [a,b,c,d]=matrix
  if (![a,b,c,d].every(Number.isFinite)) throw new Error('IMAGE_INVALID: transform invalid')
  const trace=a*a+b*b+c*c+d*d,det=a*d-b*c
  return Math.sqrt((trace+Math.sqrt(Math.max(0,trace*trace-4*det*det)))/2)
}
