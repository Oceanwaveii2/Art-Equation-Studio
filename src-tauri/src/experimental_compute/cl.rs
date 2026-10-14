//! Independent OpenCL preparation; explicit copies, no assumed renderer interop.
use std::{ffi::c_void, ptr, time::Instant};
type H=*mut c_void;
type Release=unsafe extern "system" fn(H)->i32;
struct Resources(Vec<(H,Release)>);
impl Drop for Resources{fn drop(&mut self){for(handle,release)in self.0.drain(..).rev(){unsafe{release(handle);}}}}
impl Resources{fn own(&mut self,handle:H,status:i32,release:Release,name:&str)->Result<H,String>{if handle.is_null()||status!=0{return Err(format!("OpenCL {name} failed ({status})"))}self.0.push((handle,release));Ok(handle)}}
fn ok(status:i32,name:&str)->Result<(),String>{if status==0{Ok(())}else{Err(format!("OpenCL {name} failed ({status})"))}}
type Buffer=unsafe extern "system" fn(H,u64,usize,H,*mut i32)->H;
type SetArg=unsafe extern "system" fn(H,u32,usize,*const c_void)->i32;
type Enqueue=unsafe extern "system" fn(H,H,u32,*const usize,*const usize,*const usize,u32,*const H,*mut H)->i32;
type ReadBuffer=unsafe extern "system" fn(H,H,u32,usize,usize,H,u32,*const H,*mut H)->i32;
struct Buffers{_owned:Resources,source:H,output:H,input_capacity:usize,output_capacity:usize}
struct ClPreparation {
    buffers:std::cell::RefCell<Option<Buffers>>,
    // Release OpenCL objects while their function pointers' library is alive.
    _owned:Resources,_library:libloading::Library,ctx:H,q:H,k:H,
    buffer:Buffer,set_arg:SetArg,enqueue:Enqueue,read:ReadBuffer,write:ReadBuffer,release_buffer:Release,details:serde_json::Value,
}
impl ClPreparation {fn new()->Result<Self,String>{unsafe{
    let start=Instant::now();
    let library:libloading::Library=libloading::os::windows::Library::load_with_flags("OpenCL.dll",0x800).map_err(|_|"System OpenCL runtime unavailable")?.into();
    macro_rules! api{($name:literal,$ty:ty)=>{*library.get::<$ty>(concat!($name,"\0").as_bytes()).map_err(|_|concat!("Missing OpenCL entry point: ",$name))?}}
    let platforms=api!("clGetPlatformIDs",unsafe extern "system" fn(u32,*mut H,*mut u32)->i32);
    let devices=api!("clGetDeviceIDs",unsafe extern "system" fn(H,u64,u32,*mut H,*mut u32)->i32);
    let info=api!("clGetDeviceInfo",unsafe extern "system" fn(H,u32,usize,*mut c_void,*mut usize)->i32);
    let context=api!("clCreateContext",unsafe extern "system" fn(*const isize,u32,*const H,Option<unsafe extern "system" fn(*const i8,*const c_void,usize,H)>,H,*mut i32)->H);
    let queue=api!("clCreateCommandQueue",unsafe extern "system" fn(H,H,u64,*mut i32)->H);
    let buffer=api!("clCreateBuffer",Buffer);
    let program=api!("clCreateProgramWithSource",unsafe extern "system" fn(H,u32,*const *const i8,*const usize,*mut i32)->H);
    let build=api!("clBuildProgram",unsafe extern "system" fn(H,u32,*const H,*const i8,Option<unsafe extern "system" fn(H,H)>,H)->i32);
    let build_info=api!("clGetProgramBuildInfo",unsafe extern "system" fn(H,H,u32,usize,H,*mut usize)->i32);
    let kernel=api!("clCreateKernel",unsafe extern "system" fn(H,*const i8,*mut i32)->H);
    let set_arg=api!("clSetKernelArg",SetArg);
    let enqueue=api!("clEnqueueNDRangeKernel",Enqueue);
    let read=api!("clEnqueueReadBuffer",ReadBuffer);let write=api!("clEnqueueWriteBuffer",ReadBuffer);
    let release_context=api!("clReleaseContext",Release);let release_queue=api!("clReleaseCommandQueue",Release);
    let release_buffer=api!("clReleaseMemObject",Release);let release_program=api!("clReleaseProgram",Release);let release_kernel=api!("clReleaseKernel",Release);
    let mut ids=[ptr::null_mut();8];let mut count=0;ok(platforms(8,ids.as_mut_ptr(),&mut count),"platform discovery")?;
    let mut candidates=Vec::new();
    for platform in ids.into_iter().take(count.min(8) as usize){let mut ids=[ptr::null_mut();8];let mut count=0;
        if devices(platform,4,8,ids.as_mut_ptr(),&mut count)==0{for device in ids.into_iter().take(count.min(8)as usize){let mut vendor=0u32;info(device,0x1001,4,&mut vendor as *mut _ as H,ptr::null_mut());candidates.push((vendor!=0x10de,device));}}
    }
    candidates.sort_by_key(|(non_nvidia,_)|*non_nvidia);let device=candidates.first().map(|(_,d)|*d).ok_or("No OpenCL GPU device available")?;
    let text=|attribute:u32|->String{let mut n=0;if info(device,attribute,0,ptr::null_mut(),&mut n)!=0||n==0||n>16384{return String::new()}let mut bytes=vec![0u8;n];if info(device,attribute,n,bytes.as_mut_ptr()as H,ptr::null_mut())!=0{return String::new()}String::from_utf8_lossy(&bytes).trim_end_matches('\0').to_owned()};
    let mut owned=Resources(Vec::new());let mut status=0;
    let ctx=context(ptr::null(),1,&device,None,ptr::null_mut(),&mut status);let ctx=owned.own(ctx,status,release_context,"context")?;
    let q=queue(ctx,device,0,&mut status);let q=owned.own(q,status,release_queue,"queue")?;
    let source=r#"
__kernel void downsample(__global const uchar4* src,__global uchar4* dst,uint width,uint height){
 uint ow=(width+1)/2,oh=(height+1)/2,id=get_global_id(0);if(id>=ow*oh)return;
 uint x=(id%ow)*2,y=(id/ow)*2,n=0,a=0;uint3 sum=(uint3)(0);
 for(uint yy=y;yy<min(y+2,height);yy++)for(uint xx=x;xx<min(x+2,width);xx++){
  uchar4 p=src[yy*width+xx];uint alpha=p.w;sum+=convert_uint3(p.xyz)*alpha;a+=alpha;n++;
 }
 uint3 rgb=(uint3)(0);if(a)rgb=(sum+(uint3)(a/2))/a;
 dst[id]=(uchar4)(convert_uchar3(rgb),(uchar)((a+n/2)/n));
}
"#;
    let source_ptr=source.as_ptr()as *const i8;let source_len=source.len();
    let p=program(ctx,1,&source_ptr,&source_len,&mut status);let p=owned.own(p,status,release_program,"program")?;
    let result=build(p,1,&device,b"-cl-std=CL1.2\0".as_ptr()as *const i8,None,ptr::null_mut());
    if result!=0{let mut log=vec![0u8;16384];let mut n=0;build_info(p,device,0x1183,log.len(),log.as_mut_ptr()as H,&mut n);return Err(format!("OpenCL kernel compilation failed ({result}): {}",String::from_utf8_lossy(&log[..n.min(log.len())]).trim_end_matches('\0')))}
    let k=kernel(p,b"downsample\0".as_ptr()as *const i8,&mut status);let k=owned.own(k,status,release_kernel,"kernel")?;
    let details=serde_json::json!({"device":text(0x102b),"driver":text(0x102d),"vendor":text(0x102c),"startupSetupMs":start.elapsed().as_secs_f64()*1000.,"sharing":"Explicit copies; no external-memory interop"});
    Ok(Self{buffers:std::cell::RefCell::new(None),_owned:owned,_library:library,ctx,q,k,buffer,set_arg,enqueue,read,write,release_buffer,details})
}}
fn filter(&self,rgba:&[u8],width:u32,height:u32)->Result<(Vec<u8>,serde_json::Value),String>{unsafe{
    let transfer=Instant::now();let mut status=0;
    let(ctx,q,k,buffer,set_arg,enqueue,read,release_buffer)=(self.ctx,self.q,self.k,self.buffer,self.set_arg,self.enqueue,self.read,self.release_buffer);
    let count=width.div_ceil(2)*height.div_ceil(2);let mut output=vec![0u8;count as usize*4];
    let mut slot=self.buffers.borrow_mut();let created=slot.as_ref().is_none_or(|b|b.input_capacity<rgba.len()||b.output_capacity<output.len());
    if created {
        let input_capacity=rgba.len().next_power_of_two();let output_capacity=output.len().next_power_of_two();let mut owned=Resources(Vec::new());
        let src=buffer(ctx,4,input_capacity,ptr::null_mut(),&mut status);let src=owned.own(src,status,release_buffer,"retained input buffer")?;
        let dst=buffer(ctx,2,output_capacity,ptr::null_mut(),&mut status);let dst=owned.own(dst,status,release_buffer,"retained output buffer")?;
        *slot=Some(Buffers{_owned:owned,source:src,output:dst,input_capacity,output_capacity});
    }
    let buffers=slot.as_ref().unwrap();let(src,dst)=(buffers.source,buffers.output);
    ok((self.write)(q,src,1,0,rgba.len(),rgba.as_ptr()as H,0,ptr::null(),ptr::null_mut()),"input upload")?;
    ok(set_arg(k,0,std::mem::size_of::<H>(),&src as *const _ as *const c_void),"input argument")?;
    ok(set_arg(k,1,std::mem::size_of::<H>(),&dst as *const _ as *const c_void),"output argument")?;
    ok(set_arg(k,2,4,&width as *const _ as *const c_void),"width argument")?;ok(set_arg(k,3,4,&height as *const _ as *const c_void),"height argument")?;
    let work=count as usize;ok(enqueue(q,k,1,ptr::null(),&work,ptr::null(),0,ptr::null(),ptr::null_mut()),"dispatch")?;
    ok(read(q,dst,1,0,output.len(),output.as_mut_ptr()as H,0,ptr::null(),ptr::null_mut()),"blocking readback")?;
    let mut details=self.details.clone();details["setupMs"]=serde_json::json!(0);details["transferComputeReadbackMs"]=serde_json::json!(transfer.elapsed().as_secs_f64()*1000.);details["retainedDevice"]=serde_json::json!(true);details["buffersCreated"]=serde_json::json!(created);details["retainedBufferBytes"]=serde_json::json!(buffers.input_capacity+buffers.output_capacity);
    Ok((output,details))
}}}
thread_local!{static PREPARATION:std::cell::RefCell<Option<Result<ClPreparation,String>>>=const{std::cell::RefCell::new(None)};}
pub(super) fn shutdown(){PREPARATION.with(|slot|drop(slot.borrow_mut().take()));}
pub(super) fn filter(rgba:&[u8],width:u32,height:u32)->Result<(Vec<u8>,serde_json::Value),String>{PREPARATION.with(|slot|{
    let mut slot=slot.borrow_mut();let context=slot.get_or_insert_with(ClPreparation::new);match context{Ok(context)=>context.filter(rgba,width,height),Err(error)=>Err(error.clone())}
})}
