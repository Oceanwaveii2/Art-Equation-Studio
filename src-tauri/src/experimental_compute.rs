//! Opt-in derivative preparation. CPU, wgpu and OpenCL share an integer,
//! alpha-weighted 2x box filter. No renderer handles or authored state enter it.
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{io::{Read, Write}, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};
const MAX_BYTES: usize = 16 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
#[derive(Deserialize, Serialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Request { pub width:u32, pub height:u32, pub rgba_base64:String, pub backend:String, pub workers:Option<usize> }
fn input(request:&Request)->Result<Vec<u8>,String> {
    let bytes=u64::from(request.width)*u64::from(request.height)*4;
    if request.width==0 || request.height==0 || request.width>4096 || request.height>4096 || bytes>MAX_BYTES as u64 || request.rgba_base64.len()>MAX_BYTES*4/3+8 {return Err("Image preparation accepts at most 4 megapixels of RGBA8".into())}
    if !["cpu","wgpu","dx12","vulkan","opencl","cuda-dx12","cuda-dx12-upload"].contains(&request.backend.as_str()) {return Err("Unknown preparation backend".into())}
    if request.workers.is_some_and(|workers|workers==0||workers>4){return Err("CPU preparation permits 1 to 4 reserved-capacity workers".into())}
    let rgba=STANDARD.decode(&request.rgba_base64).map_err(|_|"Invalid RGBA encoding")?;
    if rgba.len()!=bytes as usize {return Err("RGBA length does not match dimensions".into())}
    Ok(rgba)
}
pub(crate) fn cpu(rgba:&[u8],width:u32,height:u32)->Vec<u8> {
    let ow=width.div_ceil(2);let oh=height.div_ceil(2);let mut out=vec![0; (ow*oh*4) as usize];
    for y in 0..oh {for x in 0..ow {let mut a=0u32;let mut rgb=[0u32;3];let mut n=0;
        for yy in y*2..(y*2+2).min(height) {for xx in x*2..(x*2+2).min(width) {
            let p=((yy*width+xx)*4) as usize;let alpha=u32::from(rgba[p+3]);a+=alpha;n+=1;
            for channel in 0..3 {rgb[channel]+=u32::from(rgba[p+channel])*alpha;}
        }}
        let p=((y*ow+x)*4) as usize;
        for channel in 0..3 {out[p+channel]=if a==0 {0} else {((rgb[channel]+a/2)/a) as u8};}
        out[p+3]=((a+n/2)/n) as u8;
    }} out
}
fn cpu_parallel(rgba:&[u8],width:u32,height:u32,requested:Option<usize>)->(Vec<u8>,usize) {
    let ow=width.div_ceil(2);let oh=height.div_ceil(2);
    let available=super::image_pyramid::preparation_workers();
    let workers=if rgba.len()<256*1024{1}else{requested.unwrap_or(available).min(available).min(oh as usize).max(1)};
    if workers==1{return(cpu(rgba,width,height),1)}
    let mut output=vec![0; (ow*oh*4)as usize];let rows=(oh as usize).div_ceil(workers);
    std::thread::scope(|scope|{for(index,chunk)in output.chunks_mut(rows*ow as usize*4).enumerate(){
        scope.spawn(move||{let start=index*rows*2;let end=(start+rows*2).min(height as usize);
            let source=&rgba[start*width as usize*4..end*width as usize*4];
            chunk.copy_from_slice(&cpu(source,width,(end-start)as u32));
        });
    }});(output,(oh as usize).div_ceil(rows))
}
struct GpuBuffers {
    source:wgpu::Buffer, uniform:wgpu::Buffer, output:wgpu::Buffer, readback:wgpu::Buffer, group:wgpu::BindGroup,
    input_capacity:u64, output_capacity:u64,
}
struct GpuPreparation {
    buffers:std::cell::RefCell<Option<GpuBuffers>>,
    device:wgpu::Device, queue:wgpu::Queue, pipeline:wgpu::ComputePipeline,
    details:serde_json::Value, error:std::sync::Arc<std::sync::Mutex<Option<String>>>,
}
impl GpuPreparation {
    fn new(backend: &str)->Result<Self,String>{pollster::block_on(async {
        let start=Instant::now();let mut descriptor=wgpu::InstanceDescriptor::new_without_display_handle();
        descriptor.backends=match backend { "dx12" => wgpu::Backends::DX12, "vulkan" => wgpu::Backends::VULKAN, _ => return Err("Invalid native backend".into()) };
        let instance=wgpu::Instance::new(descriptor);
        let adapter=instance.request_adapter(&wgpu::RequestAdapterOptions{power_preference:wgpu::PowerPreference::HighPerformance,force_fallback_adapter:false,compatible_surface:None}).await.map_err(|e|e.to_string())?;
        let info=adapter.get_info();let(device,queue)=adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e|e.to_string())?;
        let error=std::sync::Arc::new(std::sync::Mutex::new(None));let errors=error.clone();
        device.on_uncaptured_error(std::sync::Arc::new(move|e|{*errors.lock().unwrap()=Some(e.to_string())}));
        let module=device.create_shader_module(wgpu::ShaderModuleDescriptor{label:Some("AE persistent preparation"),source:wgpu::ShaderSource::Wgsl(r#"
@group(0) @binding(0) var<storage,read> src:array<u32>;
@group(0) @binding(1) var<storage,read_write> dst:array<u32>;
@group(0) @binding(2) var<uniform> dimensions:vec4<u32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) gid:vec3<u32>) {
 let width=dimensions.x;let height=dimensions.y;let ow=(width+1u)/2u;let oh=(height+1u)/2u;
 let id=gid.x;if(id>=ow*oh){return;}
 let x=(id%ow)*2u;let y=(id/ow)*2u;
 var sum=vec3<u32>(0);var alpha=0u;var n=0u;
 for(var yy=y;yy<min(y+2u,height);yy++){for(var xx=x;xx<min(x+2u,width);xx++){
  let p=src[yy*width+xx];let a=p>>24u;sum+=vec3<u32>(p&255u,(p>>8u)&255u,(p>>16u)&255u)*a;alpha+=a;n++;
 }}
 var rgb=vec3<u32>(0);if(alpha>0u){rgb=(sum+vec3<u32>(alpha/2u))/alpha;}
 dst[id]=rgb.x|(rgb.y<<8u)|(rgb.z<<16u)|(((alpha+n/2u)/n)<<24u);
}
"#.into())});
        let pipeline=device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor{label:Some("AE persistent preparation"),layout:None,module:&module,entry_point:Some("main"),compilation_options:Default::default(),cache:None});
        if let Some(reason)=error.lock().unwrap().take(){return Err(reason)}
        Ok(Self{buffers:std::cell::RefCell::new(None),device,queue,pipeline,error,details:serde_json::json!({"device":info.name,"vendor":info.vendor,"adapterBackend":format!("{:?}",info.backend),"startupSetupMs":start.elapsed().as_secs_f64()*1000.})})
    })}
    fn filter(&self,rgba:&[u8],width:u32,height:u32)->Result<(Vec<u8>,serde_json::Value),String>{
        let transfer=Instant::now();let ow=width.div_ceil(2);let oh=height.div_ceil(2);let size=u64::from(ow)*u64::from(oh)*4;
        let mut slot=self.buffers.borrow_mut();
        let buffers_created=slot.as_ref().is_none_or(|b|b.input_capacity<rgba.len() as u64 || b.output_capacity<size);
        if buffers_created {
            let input_capacity=(rgba.len() as u64).next_power_of_two();let output_capacity=size.next_power_of_two().max(4);
            let make=|label,size,usage|self.device.create_buffer(&wgpu::BufferDescriptor{label:Some(label),size,usage,mapped_at_creation:false});
            let source=make("retained prepared input",input_capacity,wgpu::BufferUsages::STORAGE|wgpu::BufferUsages::COPY_DST);
            let uniform=make("retained dimensions",16,wgpu::BufferUsages::UNIFORM|wgpu::BufferUsages::COPY_DST);
            let output=make("retained prepared output",output_capacity,wgpu::BufferUsages::STORAGE|wgpu::BufferUsages::COPY_SRC);
            let readback=make("retained readback",output_capacity,wgpu::BufferUsages::COPY_DST|wgpu::BufferUsages::MAP_READ);
            let group=self.device.create_bind_group(&wgpu::BindGroupDescriptor{label:None,layout:&self.pipeline.get_bind_group_layout(0),entries:&[wgpu::BindGroupEntry{binding:0,resource:source.as_entire_binding()},wgpu::BindGroupEntry{binding:1,resource:output.as_entire_binding()},wgpu::BindGroupEntry{binding:2,resource:uniform.as_entire_binding()}]});
            *slot=Some(GpuBuffers{source,uniform,output,readback,group,input_capacity,output_capacity});
        }
        let buffers=slot.as_ref().unwrap();let readback=&buffers.readback;
        self.queue.write_buffer(&buffers.source,0,rgba);
        let dimensions=[width,height,0,0].into_iter().flat_map(u32::to_le_bytes).collect::<Vec<_>>();
        self.queue.write_buffer(&buffers.uniform,0,&dimensions);
        let mut encoder=self.device.create_command_encoder(&Default::default());{
            let mut pass=encoder.begin_compute_pass(&wgpu::ComputePassDescriptor{label:None,timestamp_writes:None});pass.set_pipeline(&self.pipeline);pass.set_bind_group(0,&buffers.group,&[]);pass.dispatch_workgroups((ow*oh).div_ceil(64),1,1);
        }
        encoder.copy_buffer_to_buffer(&buffers.output,0,readback,0,size);let submission=self.queue.submit([encoder.finish()]);
        let(tx,rx)=std::sync::mpsc::sync_channel(1);readback.slice(..size).map_async(wgpu::MapMode::Read,move|result|{let _=tx.send(result);});
        self.device.poll(wgpu::PollType::Wait{submission_index:Some(submission),timeout:Some(Duration::from_secs(10))}).map_err(|e|e.to_string())?;
        rx.recv_timeout(Duration::from_secs(1)).map_err(|e|e.to_string())?.map_err(|e|e.to_string())?;
        if let Some(reason)=self.error.lock().unwrap().take(){return Err(reason)}
        let result=readback.slice(..size).get_mapped_range().to_vec();readback.unmap();
        let mut details=self.details.clone();details["setupMs"]=serde_json::json!(0);details["transferComputeReadbackMs"]=serde_json::json!(transfer.elapsed().as_secs_f64()*1000.);details["retainedDevice"]=serde_json::json!(true);details["buffersCreated"]=serde_json::json!(buffers_created);details["retainedBufferBytes"]=serde_json::json!(buffers.input_capacity+buffers.output_capacity*2+16);
        Ok((result,details))
    }
}
thread_local!{static GPU_PREPARATION:std::cell::RefCell<std::collections::HashMap<String,Result<GpuPreparation,String>>>=std::cell::RefCell::new(std::collections::HashMap::new());}
fn wgpu_filter(rgba:&[u8],width:u32,height:u32,requested:&str)->Result<(Vec<u8>,serde_json::Value),String>{
    let preferences=super::launch_preferences::read();
    let mut failures=Vec::new();
    if requested=="wgpu" && preferences.preparation_acceleration!="standard" {
        match nvidia_filter(rgba,width,height,preferences.preparation_acceleration=="cuda-dx12-upload") {
            Ok((pixels,mut details))=>{details["actualBackend"]=serde_json::json!(preferences.preparation_acceleration);return Ok((pixels,details))},
            Err(reason)=>failures.push(format!("{}: {reason}",preferences.preparation_acceleration)),
        }
    }
    let preference=if requested=="wgpu" {preferences.native_backend}else{requested.into()};
    let candidates: Vec<&str>=match preference.as_str(){"dx12"=>vec!["dx12","vulkan"],"vulkan"=>vec!["vulkan","dx12"],_=>vec!["dx12","vulkan"]};
    for backend in candidates {
        let result=GPU_PREPARATION.with(|slot|{let mut slot=slot.borrow_mut();let created=!slot.contains_key(backend);match slot.entry(backend.into()).or_insert_with(||GpuPreparation::new(backend)){
            Ok(context)=>context.filter(rgba,width,height).map(|(pixels,mut details)|{details["contextCreated"]=serde_json::json!(created);details["setupMs"]=if created{details["startupSetupMs"].clone()}else{serde_json::json!(0)};(pixels,details)}),Err(error)=>Err(error.clone())}});
        match result {Ok((pixels,mut details))=>{details["requestedNativeBackend"]=serde_json::json!(preference);details["backendFallbacks"]=serde_json::json!(failures);return Ok((pixels,details))},Err(error)=>failures.push(format!("{backend}: {error}"))}
    }
    Err(failures.join("; "))
}
#[cfg(windows)]
mod cl;
#[cfg(windows)]
pub(crate) mod nvidia;
fn nvidia_filter(rgba:&[u8],width:u32,height:u32,upload:bool)->Result<(Vec<u8>,serde_json::Value),String>{
    #[cfg(windows)] { nvidia::filter(rgba,width,height,upload) }
    #[cfg(not(windows))] { let _=(rgba,width,height,upload);Err("CUDA/DX12 sharing requires Windows".into()) }
}
#[cfg(not(windows))]
fn opencl_filter(_: &[u8],_:u32,_:u32)->Result<(Vec<u8>,serde_json::Value),String>{Err("OpenCL experiment is Windows-only".into())}
#[cfg(windows)]
fn opencl_filter(rgba:&[u8],width:u32,height:u32)->Result<(Vec<u8>,serde_json::Value),String>{cl::filter(rgba,width,height)}
pub fn execute(request:Request)->Result<serde_json::Value,String> {
    let start=Instant::now();let rgba=input(&request)?;let expected=cpu(&rgba,request.width,request.height);
    let cpu_ms=start.elapsed().as_secs_f64()*1000.;let accelerator=Instant::now();
    let result=match request.backend.as_str(){"wgpu"|"dx12"|"vulkan"=>wgpu_filter(&rgba,request.width,request.height,&request.backend),"opencl"=>opencl_filter(&rgba,request.width,request.height),"cuda-dx12"|"cuda-dx12-upload"=>nvidia_filter(&rgba,request.width,request.height,request.backend=="cuda-dx12-upload"),_=>{let(pixels,workers)=cpu_parallel(&rgba,request.width,request.height,request.workers);Ok((pixels,serde_json::json!({"device":"CPU","workers":workers}))) }};
    let(used,output,details,fallback)=match result{
        Ok((pixels,details)) if pixels==expected=>{
            let used=if ["dx12","vulkan"].contains(&request.backend.as_str()){details["adapterBackend"].as_str().unwrap_or("unknown").to_lowercase()}else{request.backend.clone()};
            let used=details["actualBackend"].as_str().unwrap_or(&used).to_owned();
            let fallback=if used!=request.backend && request.backend!="wgpu"{Some(format!("Requested {} unavailable; completed on {used}",request.backend))}else{None};
            (used,pixels,details,fallback)
        },
        Ok(_)=>("cpu".into(),expected,serde_json::json!({}),Some("Accelerator pixels differ from the authoritative integer filter".to_owned())),
        Err(reason)=>("cpu".into(),expected,serde_json::json!({}),Some(reason))};
    let compute_ms=accelerator.elapsed().as_secs_f64()*1000.;
    Ok(serde_json::json!({"requested":request.backend,"used":used,"width":request.width.div_ceil(2),"height":request.height.div_ceil(2),"rgbaBase64":STANDARD.encode(output),"exactPixels":true,"backendSucceeded":fallback.is_none(),"fallbackReason":fallback,"details":details,"cpuValidationMs":cpu_ms,"backendEndToEndMs":compute_ms,"totalMs":start.elapsed().as_secs_f64()*1000.,"qualification":"Controlled preparation only; shared-resource status is reported per path; no canvas performance claim"}))
}
mod session;
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct JpegRequest { pub jpeg_base64:String }
fn jpeg_input(request:&JpegRequest)->Result<Vec<u8>,String>{
    if request.jpeg_base64.len()>8*1024*1024*4/3+8{return Err("Experimental JPEG compressed input exceeds 8 MiB".into())}
    let bytes=STANDARD.decode(&request.jpeg_base64).map_err(|_|"Invalid JPEG encoding")?;
    if bytes.len()<3||!bytes.starts_with(&[255,216,255]){return Err("Expected JPEG bytes".into())}Ok(bytes)
}
fn execute_jpeg(request:JpegRequest)->Result<serde_json::Value,String>{
    let start=Instant::now();let bytes=jpeg_input(&request)?;
    let mut reader=image::ImageReader::with_format(std::io::Cursor::new(&bytes),image::ImageFormat::Jpeg);
    let mut limits=image::Limits::default();limits.max_image_width=Some(4096);limits.max_image_height=Some(4096);limits.max_alloc=Some(64*1024*1024);reader.limits(limits);
    let (width,height)=reader.into_dimensions().map_err(|e|e.to_string())?;
    if u64::from(width)*u64::from(height)*4>MAX_BYTES as u64{return Err("Experimental JPEG decoded size exceeds 4 megapixels".into())}
    let mut reader=image::ImageReader::with_format(std::io::Cursor::new(&bytes),image::ImageFormat::Jpeg);
    let mut limits=image::Limits::default();limits.max_alloc=Some(64*1024*1024);reader.limits(limits);
    let expected=reader.decode().map_err(|e|e.to_string())?.into_rgba8().into_raw();let cpu_ms=start.elapsed().as_secs_f64()*1000.;
    let backend_start=Instant::now();
    #[cfg(windows)] let result=nvidia::decode_jpeg(&bytes);
    #[cfg(not(windows))] let result:Result<(Vec<u8>,u32,u32,serde_json::Value),String>=Err("Optional nvJPEG requires Windows".into());
    let (used,pixels,mut details,fallback)=match result{
        Ok((pixels,w,h,mut details)) if w==width&&h==height&&pixels.len()==expected.len()=>{
            let max_delta=pixels.iter().zip(&expected).map(|(a,b)|a.abs_diff(*b)).max().unwrap_or(0);
            let mean_delta=pixels.iter().zip(&expected).map(|(a,b)|u64::from(a.abs_diff(*b))).sum::<u64>()as f64/pixels.len()as f64;
            details["maxChannelDelta"]=serde_json::json!(max_delta);details["meanChannelDelta"]=serde_json::json!(mean_delta);
            // JPEG decoder rounding can differ; refuse anything beyond 2/255
            // and report the difference instead of claiming identical pixels.
            if max_delta<=2 {("nvjpeg",pixels,details,None)}else{("cpu",expected.clone(),details,Some(format!("nvJPEG channel delta {max_delta} exceeds the 2/255 validation limit")))}
        },
        Ok(_)=>("cpu",expected.clone(),serde_json::json!({}),Some("nvJPEG returned mismatched image dimensions".into())),
        Err(reason)=>("cpu",expected.clone(),serde_json::json!({}),Some(reason)),
    };
    let output=cpu(&pixels,width,height);let exact=output==cpu(&expected,width,height);details["cpuDecodeValidationMs"]=serde_json::json!(cpu_ms);
    Ok(serde_json::json!({"requested":"nvjpeg","used":used,"width":width.div_ceil(2),"height":height.div_ceil(2),"rgbaBase64":STANDARD.encode(output),"exactPixels":exact,"backendSucceeded":fallback.is_none(),"fallbackReason":fallback,"details":details,"backendEndToEndMs":backend_start.elapsed().as_secs_f64()*1000.,"totalMs":start.elapsed().as_secs_f64()*1000.,"qualification":"Bounded JPEG decode plus CPU derivative; includes readback and independent CPU validation. No canvas or dedicated JPEG hardware speed claim"}))
}
fn execute_payload(value:serde_json::Value)->Result<serde_json::Value,String>{
    if value.get("jpegBase64").is_some(){execute_jpeg(serde_json::from_value(value).map_err(|e|e.to_string())?)}else{execute(serde_json::from_value(value).map_err(|e|e.to_string())?)}
}
#[tauri::command]
pub(crate) async fn prepare_jpeg_experimental(request:JpegRequest)->Result<serde_json::Value,String>{
    jpeg_input(&request)?;
    if BUSY.swap(true,Ordering::AcqRel){return Err("An experimental preparation job is already running".into())}
    tauri::async_runtime::spawn_blocking(move||{
        struct Admission;impl Drop for Admission{fn drop(&mut self){BUSY.store(false,Ordering::Release)}}let _admission=Admission;
        session::request_json(serde_json::to_value(request).map_err(|e|e.to_string())?)
    }).await.map_err(|e|e.to_string())?
}
pub(crate) use session::{startup,shutdown,status};
#[tauri::command]
pub(crate) fn inspect_preparation_session()->serde_json::Value { session::status() }
/// Worker services remain outside the editing process; retain shader/device
/// state for this session and terminate on parent stdin EOF.
pub fn worker_main()->bool {
    use std::io::BufRead;
    if std::env::args().any(|arg|arg=="--engine-hardware-probe") {
        let mut report=super::engine_capabilities::report();
        let samples=[("zh-CN","简体中文 普通话 图形硬件"),("ja","日本語 ハードウェア"),("ko","한국어 그래픽"),("pt-BR","Português Aceleração"),("pt-PT","Ecrã definições"),("es","Español Comprobación")];
        report["nativeFontCoverage"]=serde_json::json!(samples.map(|(locale,text)|match super::font_resolver::resolve_fallbacks(super::font_resolver::FontFallbackRequest{families:vec!["Segoe UI".into()],text:text.into(),weight:400.,italic:false,locale:Some(locale.into())}){
            Ok(receipt)=>serde_json::json!({"locale":locale,"sample":text,"receipt":receipt}),Err(reason)=>serde_json::json!({"locale":locale,"error":reason})
        }));
        let _=writeln!(std::io::stdout(),"{}",report);return true
    }
    let service=std::env::args().any(|arg|arg=="--engine-compute-service");
    if !service && !std::env::args().any(|arg|arg=="--engine-compute-worker"){return false}
    // Release driver resources before Rust begins destroying unrelated TLS
    // used inside wgpu/OpenCL. This also runs on failed pipe writes.
    struct DriverSession;
    impl Drop for DriverSession { fn drop(&mut self) {
        GPU_PREPARATION.with(|slot|slot.borrow_mut().clear());
        #[cfg(windows)] { cl::shutdown();nvidia::shutdown();nvidia::shutdown_jpeg(); }
    }}
    let _driver_session=DriverSession;
    let mut out=std::io::stdout().lock();
    if service {
        let start=Instant::now();let mut rows=Vec::new();
        for backend in ["wgpu","opencl"] {
            let result=execute(Request{width:2,height:2,rgba_base64:STANDARD.encode([255u8;16]),backend:backend.into(),workers:None});
            rows.push(match result{Ok(mut value)=>{value.as_object_mut().unwrap().remove("rgbaBase64");value},Err(error)=>serde_json::json!({"requested":backend,"error":error})});
        }
        let ready=serde_json::json!({"ready":true,"warmupMs":start.elapsed().as_secs_f64()*1000.,"backends":rows});
        if writeln!(out,"{}",ready).and_then(|_|out.flush()).is_err(){return true}
        let mut source=std::io::stdin().lock();
        loop {
            let mut bytes=Vec::new();let count=source.by_ref().take((MAX_BYTES*4/3+2048)as u64).read_until(b'\n',&mut bytes);
            if !matches!(count,Ok(n)if n>0) {break}
            if !bytes.ends_with(b"\n"){break}
            let result=serde_json::from_slice(&bytes).map_err(|e|e.to_string()).and_then(execute_payload);
            let envelope=match result{Ok(result)=>serde_json::json!({"result":result}),Err(error)=>serde_json::json!({"error":error})};
            if writeln!(out,"{}",envelope).and_then(|_|out.flush()).is_err(){break}
        }
    }else{
        let mut bytes=Vec::new();let result=std::io::stdin().take((MAX_BYTES*4/3+2048)as u64).read_to_end(&mut bytes).map_err(|e|e.to_string()).and_then(|_|serde_json::from_slice(&bytes).map_err(|e|e.to_string())).and_then(execute);
        let envelope=match result{Ok(result)=>serde_json::json!({"result":result}),Err(error)=>serde_json::json!({"error":error})};let _=write!(out,"{}",envelope);
    }
    true
}
#[tauri::command]
pub(crate) async fn prepare_image_experimental(request:Request)->Result<serde_json::Value,String> {
    input(&request)?;
    if BUSY.swap(true,Ordering::AcqRel){return Err("An experimental preparation job is already running".into())}
    tauri::async_runtime::spawn_blocking(move||{
        struct Admission;impl Drop for Admission{fn drop(&mut self){BUSY.store(false,Ordering::Release)}}let _admission=Admission;
        session::request(request)
    }).await.map_err(|e|e.to_string())?
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn alpha_weighted_edges_and_odd_dimensions(){assert_eq!(cpu(&[255,0,0,0,0,10,0,255,0,0,255,255],3,1),vec![0,10,0,128,0,0,255,255]);assert_eq!(cpu(&[200,100,50,0],1,1),vec![0,0,0,0]);}
    #[test] fn parallel_cpu_matches_serial_at_odd_row_boundaries(){let width=513;let height=257;let input=(0..width*height*4).map(|i|(i%251)as u8).collect::<Vec<_>>();let expected=cpu(&input,width,height);for workers in [1,2,4]{assert_eq!(cpu_parallel(&input,width,height,Some(workers)).0,expected)}}
    #[test] fn malformed_and_oversized_requests_refuse_before_device_creation(){for(width,height,bytes,backend)in[(0,1,vec![],"cpu"),(1,1,vec![0;3],"opencl"),(4096,4096,vec![],"wgpu"),(1,1,vec![0;4],"unknown")]{assert!(input(&Request{width,height,rgba_base64:STANDARD.encode(bytes),backend:backend.into(),workers:None}).is_err())}}
}
