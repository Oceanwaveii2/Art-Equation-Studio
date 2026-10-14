type Request={id:number;payload:{blob:Blob;width?:number;height?:number;gray?:boolean;probe?:boolean}}
self.onmessage=async(event:MessageEvent<Request>)=>{
 const {id,payload}=event.data
 let bitmap:ImageBitmap|undefined,canvas:OffscreenCanvas|undefined
 try{
  bitmap=await createImageBitmap(payload.blob)
  if(bitmap.width<=0||bitmap.height<=0||bitmap.width>4096||bitmap.height>4096)throw Error('MODEL_IMAGE_DIMENSIONS_UNSUPPORTED')
  if(payload.probe){self.postMessage({id,result:{width:bitmap.width,height:bitmap.height}});return}
  const width=payload.width||bitmap.width,height=payload.height||bitmap.height
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width>bitmap.width||height>bitmap.height)throw Error('MODEL_IMAGE_DEMAND_INVALID')
  canvas=new OffscreenCanvas(width,height)
  const context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true})
  if(!context)throw Error('MODEL_IMAGE_DECODE_UNAVAILABLE')
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high'
  if(payload.gray)context.filter='grayscale(1)'
  context.drawImage(bitmap,0,0,width,height)
  const pixels=context.getImageData(0,0,width,height).data
  self.postMessage({id,result:{pixels,width,height,sourceWidth:bitmap.width,sourceHeight:bitmap.height}}, {transfer:[pixels.buffer]})
 }catch(error){self.postMessage({id,error:String(error)})}
 finally{bitmap?.close();if(canvas){canvas.width=0;canvas.height=0}}
}
