//! Optional NVIDIA preparation, confined to the bounded compute helper.
//! NT handles and dedicated mappings belong to this module, not the viewport.
use std::{ffi::{c_void,CString},ptr,time::{Duration,Instant},path::PathBuf};
use serde_json::{json,Value};
use windows::{core::{Interface,PCWSTR},Win32::{Foundation::CloseHandle,Graphics::Direct3D12::*}};
type H=*mut c_void;
type Release=unsafe extern "system" fn(H)->i32;
type SetDevice=unsafe extern "system" fn(i32)->i32;
type Memcpy=unsafe extern "system" fn(H,*const c_void,usize,i32,H)->i32;
type Sync=unsafe extern "system" fn(H)->i32;
type ImportMemory=unsafe extern "system" fn(*mut H,*const MemoryDesc)->i32;
type MapMemory=unsafe extern "system" fn(*mut H,H,*const BufferDesc)->i32;
type ImportSemaphore=unsafe extern "system" fn(*mut H,*const SemaphoreDesc)->i32;
type SemaphoreOp=unsafe extern "system" fn(*const H,*const SemaphoreParams,u32,H)->i32;
type Launch=unsafe extern "system" fn(H,u32,u32,u32,u32,u32,u32,u32,H,*mut H,*mut H)->i32;
#[repr(C)] struct MemoryDesc{kind:i32,handle:[usize;2],size:u64,flags:u32,reserved:[u32;16]}
#[repr(C)] struct BufferDesc{offset:u64,size:u64,flags:u32,reserved:[u32;16]}
#[repr(C)] struct SemaphoreDesc{kind:i32,handle:[usize;2],flags:u32,reserved:[u32;16]}
// CUDA 13 driver_types.h: fence/nvSciSync/keyedMutex plus reserved parameters.
// Signal and wait layouts have the same size for D3D12 fence use (144 bytes).
#[repr(C)] struct SemaphoreParams{value:u64,other:[u64;8],flags:u32,reserved:[u32;16]}
fn ok(code:i32,name:&str)->Result<(),String>{if code==0{Ok(())}else{Err(format!("NVIDIA {name} returned {code}"))}}
pub(crate) fn runtime_path(name:&str)->Result<PathBuf,String>{
    let root=std::env::current_exe().map_err(|e|e.to_string())?.parent().ok_or("Missing executable directory")?.join("tools/nvidia/bin");
    let candidates=vec![root.join(name)];
    #[cfg(debug_assertions)] let candidates={let mut paths=candidates;paths.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tools/nvidia/bin").join(name));paths};
    candidates.into_iter().find(|p|p.is_file()).ok_or_else(||format!("Optional NVIDIA library {name} is missing; install the pinned local runtime package"))
}
unsafe fn library(name:&str)->Result<libloading::Library,String>{
    // Absolute optional package path; dependencies only alongside it/System32.
    libloading::os::windows::Library::load_with_flags(runtime_path(name)?,0x1100).map(Into::into).map_err(|e|e.to_string())
}
struct Cuda {
    // Libraries outlive every function pointer and GPU object.
    _driver:libloading::Library,_runtime:libloading::Library,
    stream:H,module:H,function:H,device:i32,name:String,luid:[u8;8],
    free:Release,stream_destroy:Release,module_unload:Release,set_device:SetDevice,
    synchronize:Sync,memcpy:Memcpy,import_memory:ImportMemory,map_memory:MapMemory,destroy_memory:Release,
    import_semaphore:ImportSemaphore,destroy_semaphore:Release,wait:SemaphoreOp,signal:SemaphoreOp,launch:Launch,
    malloc:unsafe extern "system" fn(*mut H,usize)->i32,
}
impl Cuda {
    unsafe fn new(expected_luid:Option<[u8;8]>)->Result<Self,String>{
        let driver:libloading::Library=libloading::os::windows::Library::load_with_flags("nvcuda.dll",0x800).map_err(|e|e.to_string())?.into();
        let runtime=library("cudart64_13.dll")?;
        macro_rules! d{($n:literal,$t:ty)=>{*driver.get::<$t>(concat!($n,"\0").as_bytes()).map_err(|e|e.to_string())?}}
        macro_rules! r{($n:literal,$t:ty)=>{*runtime.get::<$t>(concat!($n,"\0").as_bytes()).map_err(|e|e.to_string())?}}
        let init=d!("cuInit",unsafe extern "system" fn(u32)->i32);ok(init(0),"driver initialization")?;
        let count=d!("cuDeviceGetCount",unsafe extern "system" fn(*mut i32)->i32);let mut n=0;ok(count(&mut n),"device count")?;
        let get=d!("cuDeviceGet",unsafe extern "system" fn(*mut i32,i32)->i32);
        let luid_api=d!("cuDeviceGetLuid",unsafe extern "system" fn(*mut u8,*mut u32,i32)->i32);
        let name_api=d!("cuDeviceGetName",unsafe extern "system" fn(*mut u8,i32,i32)->i32);
        let mut matched=None;
        for ordinal in 0..n.min(16){let mut device=0;ok(get(&mut device,ordinal),"device identity")?;let mut luid=[0;8];let mut mask=0;
            if luid_api(luid.as_mut_ptr(),&mut mask,device)==0 && mask==1 && expected_luid.is_none_or(|l|l==luid){matched=Some((ordinal,device,luid));break}
        }
        let(ordinal,device,luid)=matched.ok_or("No CUDA device with the matching single-node DX12 LUID")?;
        let mut name=[0u8;256];ok(name_api(name.as_mut_ptr(),256,device),"device name")?;
        let set_device=r!("cudaSetDevice",SetDevice);ok(set_device(ordinal),"runtime device selection")?;
        let stream_create=r!("cudaStreamCreateWithFlags",unsafe extern "system" fn(*mut H,u32)->i32);
        let stream_destroy=r!("cudaStreamDestroy",Release);let mut stream=ptr::null_mut();ok(stream_create(&mut stream,1),"stream creation")?;
        let module_load=d!("cuModuleLoadData",unsafe extern "system" fn(*mut H,*const c_void)->i32);
        let module_unload=d!("cuModuleUnload",Release);
        let mut module=ptr::null_mut();let ptx=CString::new(include_str!("nvidia.ptx")).unwrap();
        if let Err(e)=ok(module_load(&mut module,ptx.as_ptr().cast()),"PTX load"){stream_destroy(stream);return Err(e)}
        let get_function=d!("cuModuleGetFunction",unsafe extern "system" fn(*mut H,H,*const i8)->i32);let mut function=ptr::null_mut();
        if let Err(e)=ok(get_function(&mut function,module,c"downsample".as_ptr()),"kernel function"){module_unload(module);stream_destroy(stream);return Err(e)}
        // Entry-point resolution precedes production use; missing symbols fall back.
        Ok(Self{stream,module,function,device:ordinal,name:String::from_utf8_lossy(&name).trim_end_matches('\0').into(),luid,
            free:r!("cudaFree",Release),set_device,stream_destroy,module_unload,
            synchronize:r!("cudaStreamSynchronize",Sync),memcpy:r!("cudaMemcpyAsync",Memcpy),
            import_memory:r!("cudaImportExternalMemory",ImportMemory),map_memory:r!("cudaExternalMemoryGetMappedBuffer",MapMemory),destroy_memory:r!("cudaDestroyExternalMemory",Release),
            import_semaphore:r!("cudaImportExternalSemaphore",ImportSemaphore),destroy_semaphore:r!("cudaDestroyExternalSemaphore",Release),
            wait:r!("cudaWaitExternalSemaphoresAsync",SemaphoreOp),signal:r!("cudaSignalExternalSemaphoresAsync",SemaphoreOp),launch:d!("cuLaunchKernel",Launch),
            malloc:r!("cudaMalloc",unsafe extern "system" fn(*mut H,usize)->i32),_driver:driver,_runtime:runtime})
    }
    unsafe fn fence_op(&self,fence:H,value:u64,signal:bool)->Result<(),String>{
        let params=SemaphoreParams{value,other:[0;8],flags:0,reserved:[0;16]};
        ok((if signal{self.signal}else{self.wait})(&fence,&params,1,self.stream),"shared fence operation")
    }
    unsafe fn run(&self,src:H,dst:H,width:u32,height:u32)->Result<(),String>{
        let mut src=src;let mut dst=dst;let mut width=width;let mut height=height;
        let mut params=[(&mut src as *mut H).cast(),(&mut dst as *mut H).cast(),(&mut width as *mut u32).cast(),(&mut height as *mut u32).cast()];
        ok((self.launch)(self.function,(width.div_ceil(2)*height.div_ceil(2)).div_ceil(64),1,1,64,1,1,0,self.stream,params.as_mut_ptr(),ptr::null_mut()),"shared-memory kernel")
    }
}
impl Drop for Cuda{fn drop(&mut self){unsafe{(self.set_device)(self.device);(self.synchronize)(self.stream);(self.module_unload)(self.module);(self.stream_destroy)(self.stream);}}}
struct Mapping{pointer:H,memory:H,free:Release,destroy:Release}
impl Drop for Mapping{fn drop(&mut self){unsafe{(self.free)(self.pointer);(self.destroy)(self.memory);}}}
unsafe fn buffer(device:&ID3D12Device,size:u64,heap:D3D12_HEAP_TYPE,shared:bool)->Result<ID3D12Resource,String>{
    let properties=D3D12_HEAP_PROPERTIES{Type:heap,CreationNodeMask:1,VisibleNodeMask:1,..Default::default()};
    let desc=D3D12_RESOURCE_DESC{Dimension:D3D12_RESOURCE_DIMENSION_BUFFER,Width:size,Height:1,DepthOrArraySize:1,MipLevels:1,SampleDesc:windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC{Count:1,Quality:0},Layout:D3D12_TEXTURE_LAYOUT_ROW_MAJOR,..Default::default()};
    let state=if heap==D3D12_HEAP_TYPE_READBACK{D3D12_RESOURCE_STATE_COPY_DEST}else if heap==D3D12_HEAP_TYPE_DEFAULT{D3D12_RESOURCE_STATE_COMMON}else{D3D12_RESOURCE_STATE_GENERIC_READ};
    let mut resource=None;
    device.CreateCommittedResource(&properties,if shared{D3D12_HEAP_FLAG_SHARED}else{D3D12_HEAP_FLAG_NONE},&desc,state,None,&mut resource).map_err(|e|e.to_string())?;
    resource.ok_or("DX12 resource missing".into())
}
unsafe fn mapping(cuda:&Cuda,device:&ID3D12Device,resource:&ID3D12Resource,size:u64)->Result<Mapping,String>{
    let handle=device.CreateSharedHandle(resource,None,0x10000000,PCWSTR::null()).map_err(|e|e.to_string())?;
    let allocation=device.GetResourceAllocationInfo(0,&[resource.GetDesc()]).SizeInBytes;
    let desc=MemoryDesc{kind:5,handle:[handle.0 as usize,0],size:allocation,flags:1,reserved:[0;16]};
    let mut memory=ptr::null_mut();let result=ok((cuda.import_memory)(&mut memory,&desc),"DX12 resource import");let _=CloseHandle(handle);result?;
    let mut pointer=ptr::null_mut();let desc=BufferDesc{offset:0,size,flags:0,reserved:[0;16]};
    if let Err(e)=ok((cuda.map_memory)(&mut pointer,memory,&desc),"DX12 mapped buffer"){(cuda.destroy_memory)(memory);return Err(e)}
    Ok(Mapping{pointer,memory,free:cuda.free,destroy:cuda.destroy_memory})
}
struct SharedBuffers{
    // Mappings are dropped first, while CUDA and DX12 resources remain alive.
    src_mapping:Mapping,dst_mapping:Mapping,
    source:ID3D12Resource,output:ID3D12Resource,upload:ID3D12Resource,readback:ID3D12Resource,
    input_capacity:u64,output_capacity:u64,
}
struct SharedPreparation{
    buffers:Option<SharedBuffers>,cuda:Cuda,
    fence:ID3D12Fence,semaphore:H,value:u64,allocator:ID3D12CommandAllocator,list:ID3D12GraphicsCommandList,
    queue:ID3D12CommandQueue,raw:ID3D12Device,_device:wgpu::Device,
    gpu_upload:bool,details:Value,
}
impl SharedPreparation{
    unsafe fn new(gpu_upload:bool)->Result<Self,String>{
        let start=Instant::now();let mut descriptor=wgpu::InstanceDescriptor::new_without_display_handle();descriptor.backends=wgpu::Backends::DX12;
        let instance=wgpu::Instance::new(descriptor);
        let adapter=pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions{power_preference:wgpu::PowerPreference::HighPerformance,force_fallback_adapter:false,compatible_surface:None})).map_err(|e|e.to_string())?;
        if adapter.get_info().vendor!=0x10de{return Err("CUDA interop requires the selected DX12 device to be NVIDIA".into())}
        let(device,_)=pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor::default())).map_err(|e|e.to_string())?;
        let hal=device.as_hal::<wgpu::hal::api::Dx12>().ok_or("DX12 device unavailable")?;
        let raw=hal.raw_device().clone();let queue=hal.raw_queue().clone();drop(hal);
        if raw.GetNodeCount()!=1{return Err("Linked-node DX12 adapters are unsupported".into())}
        if gpu_upload{let mut feature=D3D12_FEATURE_DATA_D3D12_OPTIONS16::default();raw.CheckFeatureSupport(D3D12_FEATURE_D3D12_OPTIONS16,&mut feature as *mut _ as _,std::mem::size_of_val(&feature)as u32).map_err(|e|e.to_string())?;if !feature.GPUUploadHeapSupported.as_bool(){return Err("DX12 GPU upload heaps are unsupported on this adapter/configuration".into())}}
        let luid=raw.GetAdapterLuid();let mut expected=[0;8];expected[..4].copy_from_slice(&luid.LowPart.to_le_bytes());expected[4..].copy_from_slice(&luid.HighPart.to_le_bytes());
        let cuda=Cuda::new(Some(expected))?;
        let allocator=raw.CreateCommandAllocator(D3D12_COMMAND_LIST_TYPE_DIRECT).map_err(|e|e.to_string())?;
        let list:ID3D12GraphicsCommandList=raw.CreateCommandList(0,D3D12_COMMAND_LIST_TYPE_DIRECT,&allocator,None).map_err(|e|e.to_string())?;list.Close().map_err(|e|e.to_string())?;
        let fence=raw.CreateFence::<ID3D12Fence>(0,D3D12_FENCE_FLAG_SHARED).map_err(|e|e.to_string())?;
        let handle=raw.CreateSharedHandle(&fence,None,0x10000000,PCWSTR::null()).map_err(|e|e.to_string())?;
        let desc=SemaphoreDesc{kind:4,handle:[handle.0 as usize,0],flags:0,reserved:[0;16]};let mut semaphore=ptr::null_mut();
        let imported=ok((cuda.import_semaphore)(&mut semaphore,&desc),"DX12 fence import");let _=CloseHandle(handle);imported?;
        let details=json!({"device":cuda.name,"luidMatched":cuda.luid==expected,"adapterBackend":"Dx12","sharing":"Dedicated DX12 resources imported into CUDA; explicit shared timeline fence","gpuUploadHeaps":gpu_upload,"startupSetupMs":start.elapsed().as_secs_f64()*1000.});
        Ok(Self{buffers:None,cuda,fence,semaphore,value:0,allocator,list,queue,raw,_device:device,gpu_upload,details})
    }
    unsafe fn copy(&self,to:&ID3D12Resource,from:&ID3D12Resource,size:u64)->Result<(),String>{
        self.allocator.Reset().map_err(|e|e.to_string())?;self.list.Reset(&self.allocator,None).map_err(|e|e.to_string())?;
        // Buffers in COMMON implicitly promote for copies and decay after this
        // ExecuteCommandLists. UPLOAD/READBACK retain their fixed legal states.
        self.list.CopyBufferRegion(to,0,from,0,size);self.list.Close().map_err(|e|e.to_string())?;
        let command:windows::Win32::Graphics::Direct3D12::ID3D12CommandList=self.list.cast().map_err(|e|e.to_string())?;self.queue.ExecuteCommandLists(&[Some(command)]);Ok(())
    }
    unsafe fn finish(&mut self)->Result<(),String>{
        self.value+=1;self.queue.Signal(&self.fence,self.value).map_err(|e|e.to_string())?;
        let deadline=Instant::now()+Duration::from_secs(10);
        while self.fence.GetCompletedValue()<self.value{if Instant::now()>=deadline{return Err("Shared DX12/CUDA fence timed out".into())}std::thread::sleep(Duration::from_millis(1));}
        if self.fence.GetCompletedValue()==u64::MAX{return Err("DX12 device removed".into())}Ok(())
    }
    unsafe fn filter(&mut self,rgba:&[u8],width:u32,height:u32)->Result<(Vec<u8>,Value),String>{
        ok((self.cuda.set_device)(self.cuda.device),"device activation")?;
        let start=Instant::now();let output_size=u64::from(width.div_ceil(2))*u64::from(height.div_ceil(2))*4;
        let created=self.buffers.as_ref().is_none_or(|b|b.input_capacity<rgba.len()as u64||b.output_capacity<output_size);
        if created{
            // All previous work has completed; grow once, bounded by input cap.
            let input_capacity=(rgba.len()as u64).next_power_of_two();let output_capacity=output_size.next_power_of_two().max(4);
            let source=buffer(&self.raw,input_capacity,D3D12_HEAP_TYPE_DEFAULT,true)?;
            let output=buffer(&self.raw,output_capacity,D3D12_HEAP_TYPE_DEFAULT,true)?;
            let src_mapping=mapping(&self.cuda,&self.raw,&source,input_capacity)?;let dst_mapping=mapping(&self.cuda,&self.raw,&output,output_capacity)?;
            let upload=buffer(&self.raw,input_capacity,if self.gpu_upload{D3D12_HEAP_TYPE_GPU_UPLOAD}else{D3D12_HEAP_TYPE_UPLOAD},false)?;
            let readback=buffer(&self.raw,output_capacity,D3D12_HEAP_TYPE_READBACK,false)?;
            self.buffers=Some(SharedBuffers{src_mapping,dst_mapping,source,output,upload,readback,input_capacity,output_capacity});
        }
        let b=self.buffers.as_ref().unwrap();let mut address=ptr::null_mut();let no_read=D3D12_RANGE{Begin:0,End:0};
        b.upload.Map(0,Some(&no_read),Some(&mut address)).map_err(|e|e.to_string())?;
        ptr::copy_nonoverlapping(rgba.as_ptr(),address.cast(),rgba.len());b.upload.Unmap(0,Some(&D3D12_RANGE{Begin:0,End:rgba.len()}));
        self.copy(&b.source,&b.upload,rgba.len()as u64)?;
        // Wait on the upload on the CPU before resetting the command allocator.
        self.finish()?;
        self.cuda.fence_op(self.semaphore,self.value,false)?;
        let b=self.buffers.as_ref().unwrap();self.cuda.run(b.src_mapping.pointer,b.dst_mapping.pointer,width,height)?;
        self.value+=1;self.cuda.fence_op(self.semaphore,self.value,true)?;
        self.queue.Wait(&self.fence,self.value).map_err(|e|e.to_string())?;
        self.copy(&b.readback,&b.output,output_size)?;self.finish()?;
        ok((self.cuda.synchronize)(self.cuda.stream),"shared completion")?;
        let b=self.buffers.as_ref().unwrap();let mut address=ptr::null_mut();b.readback.Map(0,Some(&D3D12_RANGE{Begin:0,End:output_size as usize}),Some(&mut address)).map_err(|e|e.to_string())?;
        let pixels=std::slice::from_raw_parts(address.cast::<u8>(),output_size as usize).to_vec();b.readback.Unmap(0,Some(&no_read));
        let mut details=self.details.clone();details["buffersCreated"]=json!(created);details["retainedBufferBytes"]=json!(b.input_capacity*2+b.output_capacity*2);details["transferComputeReadbackMs"]=json!(start.elapsed().as_secs_f64()*1000.);
        Ok((pixels,details))
    }
}
impl Drop for SharedPreparation{fn drop(&mut self){unsafe{
    // The helper process bounds hangs. Never free live GPU objects after timeout.
    if (self.cuda.synchronize)(self.cuda.stream)!=0{std::process::abort()}
    self.buffers.take();(self.cuda.destroy_semaphore)(self.semaphore);
}}}
thread_local!{static SHARED:std::cell::RefCell<std::collections::HashMap<bool,Result<SharedPreparation,String>>>=std::cell::RefCell::new(std::collections::HashMap::new());}
pub(crate) fn filter(rgba:&[u8],width:u32,height:u32,gpu_upload:bool)->Result<(Vec<u8>,Value),String>{
    SHARED.with(|slot|unsafe{let mut slot=slot.borrow_mut();let created=!slot.contains_key(&gpu_upload);
        let result=match slot.entry(gpu_upload).or_insert_with(||SharedPreparation::new(gpu_upload)){Ok(context)=>context.filter(rgba,width,height).map(|(pixels,mut details)|{details["contextCreated"]=json!(created);details["setupMs"]=if created{details["startupSetupMs"].clone()}else{json!(0)};(pixels,details)}),Err(e)=>Err(e.clone())};
        // Retire a failed context instead of reusing partially completed work.
        if let Err(e)=&result{slot.insert(gpu_upload,Err(e.clone()));}result
    })
}
pub(crate) fn shutdown(){SHARED.with(|slot|slot.borrow_mut().clear());}
pub(crate) fn availability()->Value{json!({"runtimePackaged":runtime_path("cudart64_13.dll").is_ok(),"nvjpegPackaged":runtime_path("nvjpeg64_13.dll").is_ok(),"qualification":"Library presence only; explicit native jobs verify device and pixels"})}
#[repr(C)]struct JpegImage{channel:[H;4],pitch:[usize;4]}
type JpegInfo=unsafe extern "system" fn(H,*const u8,usize,*mut i32,*mut i32,*mut i32,*mut i32)->i32;
type JpegDecode=unsafe extern "system" fn(H,H,*const u8,usize,i32,*mut JpegImage,H)->i32;
struct CudaMemory{pointer:H,free:Release,capacity:usize}
impl Drop for CudaMemory{fn drop(&mut self){unsafe{(self.free)(self.pointer);}}}
struct Nvjpeg{
    memory:Option<CudaMemory>,state:H,handle:H,destroy_state:Release,destroy_handle:Release,
    info:JpegInfo,decode:JpegDecode,hardware_available:bool,cuda:Cuda,_library:libloading::Library,
}
impl Nvjpeg{
    unsafe fn new()->Result<Self,String>{
        let library=library("nvjpeg64_13.dll")?;
        macro_rules! j{($n:literal,$t:ty)=>{*library.get::<$t>(concat!($n,"\0").as_bytes()).map_err(|e|e.to_string())?}}
        let create=j!("nvjpegCreateEx",unsafe extern "system" fn(i32,H,H,u32,*mut H)->i32);
        let create_state=j!("nvjpegJpegStateCreate",unsafe extern "system" fn(H,*mut H)->i32);
        let destroy_handle=j!("nvjpegDestroy",Release);let destroy_state=j!("nvjpegJpegStateDestroy",Release);
        let info=j!("nvjpegGetImageInfo",JpegInfo);let decode=j!("nvjpegDecode",JpegDecode);
        let cuda=Cuda::new(None)?;let mut hardware=ptr::null_mut();
        let hardware_available=create(3,ptr::null_mut(),ptr::null_mut(),0,&mut hardware)==0;
        if hardware_available{destroy_handle(hardware);}
        let mut handle=ptr::null_mut();ok(create(0,ptr::null_mut(),ptr::null_mut(),4,&mut handle),"nvJPEG creation")?;
        let mut state=ptr::null_mut();if let Err(e)=ok(create_state(handle,&mut state),"nvJPEG state"){destroy_handle(handle);return Err(e)}
        Ok(Self{memory:None,state,handle,destroy_state,destroy_handle,info,decode,hardware_available,cuda,_library:library})
    }
    unsafe fn decode(&mut self,bytes:&[u8])->Result<(Vec<u8>,u32,u32,Value),String>{
        ok((self.cuda.set_device)(self.cuda.device),"JPEG device activation")?;
        let start=Instant::now();let mut components=0;let mut subsampling=0;let mut widths=[0;4];let mut heights=[0;4];
        ok((self.info)(self.handle,bytes.as_ptr(),bytes.len(),&mut components,&mut subsampling,widths.as_mut_ptr(),heights.as_mut_ptr()),"JPEG dimensions")?;
        let(width,height)=(u32::try_from(widths[0]).map_err(|_|"Invalid JPEG width")?,u32::try_from(heights[0]).map_err(|_|"Invalid JPEG height")?);
        if ![1,3].contains(&components)||width==0||height==0||width>4096||height>4096||u64::from(width)*u64::from(height)*4>super::MAX_BYTES as u64{return Err("JPEG exceeds bounded dimensions or uses unsupported components".into())}
        let size=width as usize*height as usize*3;let created=self.memory.as_ref().is_none_or(|m|m.capacity<size);
        if created{let capacity=size.next_power_of_two();let mut pointer=ptr::null_mut();ok((self.cuda.malloc)(&mut pointer,capacity),"JPEG output allocation")?;self.memory=Some(CudaMemory{pointer,free:self.cuda.free,capacity});}
        let memory=self.memory.as_ref().unwrap();let mut destination=JpegImage{channel:[memory.pointer,ptr::null_mut(),ptr::null_mut(),ptr::null_mut()],pitch:[width as usize*3,0,0,0]};
        ok((self.decode)(self.handle,self.state,bytes.as_ptr(),bytes.len(),5,&mut destination,self.cuda.stream),"JPEG decode")?;
        let mut rgb=vec![0u8;size];ok((self.cuda.memcpy)(rgb.as_mut_ptr().cast(),memory.pointer,size,2,self.cuda.stream),"JPEG readback")?;ok((self.cuda.synchronize)(self.cuda.stream),"JPEG completion")?;
        let mut rgba=Vec::with_capacity(width as usize*height as usize*4);for p in rgb.chunks_exact(3){rgba.extend_from_slice(&[p[0],p[1],p[2],255]);}
        Ok((rgba,width,height,json!({"device":self.cuda.name,"decoder":"nvJPEG default backend","hardwareBackendAvailable":self.hardware_available,"hardwareBackendUsed":"Not asserted; the library selects its default single-image implementation","buffersCreated":created,"retainedBufferBytes":memory.capacity,"decodeReadbackMs":start.elapsed().as_secs_f64()*1000.})))
    }
}
impl Drop for Nvjpeg{fn drop(&mut self){unsafe{(self.cuda.set_device)(self.cuda.device);if (self.cuda.synchronize)(self.cuda.stream)!=0{std::process::abort()}self.memory.take();(self.destroy_state)(self.state);(self.destroy_handle)(self.handle);}}}
thread_local!{static JPEG:std::cell::RefCell<Option<Result<Nvjpeg,String>>>=const{std::cell::RefCell::new(None)};}
pub(crate) fn decode_jpeg(bytes:&[u8])->Result<(Vec<u8>,u32,u32,Value),String>{JPEG.with(|slot|unsafe{
    let mut slot=slot.borrow_mut();let created=slot.is_none();let start=Instant::now();let context=slot.get_or_insert_with(||Nvjpeg::new());
    let setup_ms=start.elapsed().as_secs_f64()*1000.;let result=match context{Ok(context)=>context.decode(bytes).map(|(pixels,w,h,mut details)|{details["contextCreated"]=json!(created);details["setupMs"]=json!(if created{setup_ms}else{0.});(pixels,w,h,details)}),Err(e)=>Err(e.clone())};
    if let Err(e)=&result{*slot=Some(Err(e.clone()));}result
})}
pub(crate) fn shutdown_jpeg(){JPEG.with(|slot|slot.borrow_mut().take());}
#[cfg(test)]mod tests{#[test]fn ffi_layouts_match_pinned_cuda_headers(){assert_eq!(std::mem::size_of::<super::MemoryDesc>(),104);assert_eq!(std::mem::size_of::<super::BufferDesc>(),88);assert_eq!(std::mem::size_of::<super::SemaphoreDesc>(),96);assert_eq!(std::mem::size_of::<super::SemaphoreParams>(),144);}}
