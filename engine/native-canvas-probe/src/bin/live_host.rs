//! Interactive native window host for the existing Vello renderer.
//! No WebView, DOM, pixel readback or perpetual animation loop. JSON-line
//! commands and input receipts are a host contract, not a full workspace UI.
use std::{fs, io::{self, BufRead, Read}, path::PathBuf, sync::{Arc, Mutex}};
use art_equation_p0_app_surface::native_gpu::NativeGpuRenderer;
use serde_json::{json, Value};
use art_equation_workspace_core::session::WorkspaceSession;
use winit::{application::ApplicationHandler, dpi::PhysicalSize, event::{ElementState, MouseButton, MouseScrollDelta, WindowEvent}, event_loop::{ActiveEventLoop, EventLoop}, window::{Window,WindowId}};

const MAX_MESSAGE:u64=16*1024*1024;
const MAX_PIXELS:u64=16_777_216;
fn emit(value:Value){println!("{value}")}
fn bounded_file(path:PathBuf)->Result<String,String>{let file=fs::File::open(path).map_err(|e|e.to_string())?;if file.metadata().map_err(|e|e.to_string())?.len()>MAX_MESSAGE{return Err("Host input exceeds 16 MiB".into())}let mut text=String::new();file.take(MAX_MESSAGE+1).read_to_string(&mut text).map_err(|e|e.to_string())?;if text.len() as u64>MAX_MESSAGE{return Err("Host input exceeds 16 MiB".into())}Ok(text)}
#[derive(Clone,Copy)]struct Camera{x:f64,y:f64,scale:f64}
impl Camera{fn value(&self)->Value{json!({"x":self.x,"y":self.y,"scale":self.scale})}fn from(v:&Value)->Result<Self,String>{let c=Self{x:v["x"].as_f64().ok_or("Missing camera x")?,y:v["y"].as_f64().ok_or("Missing camera y")?,scale:v["scale"].as_f64().ok_or("Missing camera scale")?};if ![c.x,c.y,c.scale].iter().all(|v|v.is_finite())||c.scale<0.02||c.scale>64.0{return Err("Invalid native camera".into())}Ok(c)}}
#[derive(Clone,Copy)]enum Wake{Updates,Close}
#[derive(Default)]struct Updates{frame:Option<Value>,camera:Option<Value>,queued:bool}
struct Surface{
 window:Arc<Window>,surface:wgpu::Surface<'static>,device:wgpu::Device,queue:wgpu::Queue,
 texture:wgpu::Texture,view:wgpu::TextureView,blitter:wgpu::util::TextureBlitter,
 renderer:NativeGpuRenderer,config:wgpu::SurfaceConfiguration,paused:bool,
}
fn target(device:&wgpu::Device,width:u32,height:u32)->(wgpu::Texture,wgpu::TextureView){let texture=device.create_texture(&wgpu::TextureDescriptor{label:Some("Native Vello retained output"),size:wgpu::Extent3d{width,height,depth_or_array_layers:1},mip_level_count:1,sample_count:1,dimension:wgpu::TextureDimension::D2,format:wgpu::TextureFormat::Rgba8Unorm,usage:wgpu::TextureUsages::STORAGE_BINDING|wgpu::TextureUsages::TEXTURE_BINDING,view_formats:&[]});let view=texture.create_view(&Default::default());(texture,view)}
impl Surface{
 async fn new(loop_:&ActiveEventLoop,images:&[Value])->Result<Self,String>{
  let window=Arc::new(loop_.create_window(Window::default_attributes().with_title("Art Equation — native Vello canvas host (workspace migration)").with_visible(false).with_inner_size(PhysicalSize::new(640,390))).map_err(|e|e.to_string())?);window.set_ime_allowed(true);
  let mut descriptor=wgpu::InstanceDescriptor::new_without_display_handle();descriptor.backends=wgpu::Backends::VULKAN;
  let instance=wgpu::Instance::new(descriptor);let surface=instance.create_surface(window.clone()).map_err(|e|e.to_string())?;
  let adapter=instance.request_adapter(&wgpu::RequestAdapterOptions{compatible_surface:Some(&surface),power_preference:wgpu::PowerPreference::HighPerformance,..Default::default()}).await.map_err(|e|e.to_string())?;
  let (device,queue)=adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e|e.to_string())?;
  let size=window.inner_size();let config=surface.get_default_config(&adapter,size.width,size.height).ok_or("No native surface configuration")?;surface.configure(&device,&config);
  let (texture,view)=target(&device,config.width,config.height);let blitter=wgpu::util::TextureBlitter::new(&device,config.format);let mut renderer=NativeGpuRenderer::new(&device)?;register(&mut renderer,images)?;
  let info=adapter.get_info();emit(json!({"kind":"native.adapter","name":info.name,"backend":format!("{:?}",info.backend),"webview":false,"dom":false}));
  Ok(Self{window,surface,device,queue,texture,view,blitter,renderer,config,paused:false})
 }
 fn resize(&mut self,size:PhysicalSize<u32>)->Result<(),String>{
  self.paused=size.width==0||size.height==0;if self.paused{return Ok(())}
  if size.width>4096||size.height>4096||u64::from(size.width)*u64::from(size.height)>MAX_PIXELS{self.paused=true;return Err("Native surface exceeds bounded dimensions".into())}
  if size.width!=self.config.width||size.height!=self.config.height{self.config.width=size.width;self.config.height=size.height;self.surface.configure(&self.device,&self.config);(self.texture,self.view)=target(&self.device,size.width,size.height)}
  Ok(())
 }
 fn present(&mut self,scene:&str,camera:Camera)->Result<Value,String>{
  if self.paused{return Ok(json!({"paused":true}))}
  let dpr=self.window.scale_factor();let receipt=self.renderer.render_to_texture(&self.device,&self.queue,&self.view,self.config.width,self.config.height,scene,camera.scale*dpr,camera.x*dpr,camera.y*dpr)?;
  if receipt.gpu_allocation_failure_flags!=0||receipt.gpu_allocation_status!="checked"{return Err("Unchecked Vello GPU allocation".into())}
  let mut frame=None;
  for _ in 0..2{match self.surface.get_current_texture(){wgpu::CurrentSurfaceTexture::Success(value)|wgpu::CurrentSurfaceTexture::Suboptimal(value)=>{frame=Some(value);break},wgpu::CurrentSurfaceTexture::Outdated|wgpu::CurrentSurfaceTexture::Lost=>self.surface.configure(&self.device,&self.config),other=>return Err(format!("Native surface acquisition: {other:?}"))}}
  let frame=frame.ok_or("Native surface recovery exhausted")?;let view=frame.texture.create_view(&Default::default());let mut encoder=self.device.create_command_encoder(&Default::default());self.blitter.copy(&self.device,&mut encoder,&self.view,&view);self.queue.submit([encoder.finish()]);self.window.pre_present_notify();frame.present();self.window.set_visible(true);
  Ok(json!({"renderer":receipt,"camera":camera.value(),"width":self.config.width,"height":self.config.height,"dpr":dpr,"pixelReadbacks":0}))
 }
}
fn register(renderer:&mut NativeGpuRenderer,images:&[Value])->Result<(),String>{
 if images.len()>128{return Err("Native image count limit".into())}
 for image in images{let data=image["pixels"].as_array().ok_or("Invalid native image pixels")?;if data.len()>MAX_PIXELS as usize*4{return Err("Native image byte limit".into())}let pixels=data.iter().map(|v|v.as_u64().filter(|n|*n<=255).map(|n|n as u8).ok_or("Invalid image byte")).collect::<Result<Vec<_>,_>>()?;renderer.register_image(&image["reference"].to_string(),pixels)?}Ok(())
}
struct Host{scene:String,board:String,images:Vec<Value>,surface:Option<Surface>,mailbox:Arc<Mutex<Updates>>,camera:Camera,generation:u64,sequence:u64,command_sequence:u64,cursor:(f64,f64),pan:Option<(f64,f64)>}
impl Host{
 fn input(&mut self,event:Value){self.sequence+=1;emit(json!({"kind":"native.input","sequence":self.sequence,"boardId":self.board,"generation":self.generation,"event":event,"camera":self.camera.value()}))}
 fn redraw(&self){if let Some(s)=&self.surface{if !s.paused{s.window.request_redraw()}}}
 fn frame(&mut self,value:Value)->Result<(),String>{
  let generation=value["generation"].as_u64().ok_or("Missing frame generation")?;if generation<=self.generation{return Err("Obsolete native generation".into())}
  let board=value["boardId"].as_str().filter(|s|!s.is_empty()&&s.len()<=128).ok_or("Missing native board identity")?;
  let scene=value["scene"].as_str().ok_or("Missing native scene")?;if scene.len() as u64>MAX_MESSAGE{return Err("Native scene exceeds limit".into())}
  // Register only validated bounded sources before publishing this revision.
  if let Some(images)=value["images"].as_array(){register(&mut self.surface.as_mut().ok_or("Native host not initialized")?.renderer,images)?}
  let camera=if value.get("camera").is_some(){Camera::from(&value["camera"])?}else{self.camera};self.scene=scene.into();self.board=board.into();self.generation=generation;self.camera=camera;self.redraw();Ok(())
 }
}
impl ApplicationHandler<Wake> for Host{
 fn resumed(&mut self,loop_:&ActiveEventLoop){if self.surface.is_some(){return}match pollster::block_on(Surface::new(loop_,&self.images)){Ok(mut surface)=>{
  // A hidden Windows window does not reliably deliver RedrawRequested. Paint
  // once before revealing it, then use demand-driven native redraw events.
  match surface.present(&self.scene,self.camera){Ok(receipt)=>emit(json!({"kind":"native.present","boardId":self.board,"generation":self.generation,"receipt":receipt})),Err(error)=>{emit(json!({"kind":"native.error","error":error}));loop_.exit();return}}
  self.surface=Some(surface);self.images.clear()
 },Err(error)=>{emit(json!({"kind":"native.error","error":error}));loop_.exit()}}}
 fn user_event(&mut self,loop_:&ActiveEventLoop,event:Wake){if matches!(event,Wake::Close){loop_.exit();return}let updates={let mut value=self.mailbox.lock().unwrap();value.queued=false;std::mem::take(&mut *value)};
  if let Some(frame)=updates.frame{if let Err(error)=self.frame(frame){emit(json!({"kind":"native.error","error":error}))}}
  if let Some(value)=updates.camera{if value["generation"].as_u64()!=Some(self.generation)||value["sequence"].as_u64().is_none_or(|s|s<=self.command_sequence){emit(json!({"kind":"native.error","error":"Obsolete native camera command"}));return}match Camera::from(&value["camera"]){Ok(camera)=>{self.command_sequence=value["sequence"].as_u64().unwrap();self.camera=camera;self.redraw()},Err(error)=>emit(json!({"kind":"native.error","error":error}))}}
 }
 fn window_event(&mut self,loop_:&ActiveEventLoop,_:WindowId,event:WindowEvent){match event{
  WindowEvent::CloseRequested=>{self.input(json!({"type":"close"}));loop_.exit()},
  WindowEvent::RedrawRequested=>{if let Some(surface)=&mut self.surface{match surface.present(&self.scene,self.camera){Ok(receipt)=>emit(json!({"kind":"native.present","boardId":self.board,"generation":self.generation,"receipt":receipt})),Err(error)=>emit(json!({"kind":"native.error","generation":self.generation,"error":error}))}}},
  WindowEvent::Resized(size)=>{if let Some(surface)=&mut self.surface{if let Err(error)=surface.resize(size){emit(json!({"kind":"native.error","error":error}))}}self.input(json!({"type":"resize","width":size.width,"height":size.height}));self.redraw()},
  WindowEvent::ScaleFactorChanged{scale_factor,..}=>{self.input(json!({"type":"dpi","dpr":scale_factor}));self.redraw()},
  WindowEvent::CursorMoved{position,..}=>{let dpr=self.surface.as_ref().map(|s|s.window.scale_factor()).unwrap_or(1.);self.cursor=(position.x/dpr,position.y/dpr);if let Some(previous)=self.pan{self.camera.x+=self.cursor.0-previous.0;self.camera.y+=self.cursor.1-previous.1;self.pan=Some(self.cursor);self.redraw()}self.input(json!({"type":"pointer-move","x":(self.cursor.0-self.camera.x)/self.camera.scale,"y":(self.cursor.1-self.camera.y)/self.camera.scale}))},
  WindowEvent::MouseInput{state,button,..}=>{if button==MouseButton::Middle{self.pan=if state==ElementState::Pressed{Some(self.cursor)}else{None}}self.input(json!({"type":"pointer-button","button":format!("{button:?}"),"pressed":state==ElementState::Pressed,"x":(self.cursor.0-self.camera.x)/self.camera.scale,"y":(self.cursor.1-self.camera.y)/self.camera.scale}))},
  WindowEvent::MouseWheel{delta,..}=>{let amount=match delta{MouseScrollDelta::LineDelta(_,y)=>f64::from(y)*0.12,MouseScrollDelta::PixelDelta(p)=>p.y*0.001};let next=(self.camera.scale*amount.clamp(-2.,2.).exp()).clamp(0.02,64.);let ratio=next/self.camera.scale;self.camera.x=self.cursor.0-(self.cursor.0-self.camera.x)*ratio;self.camera.y=self.cursor.1-(self.cursor.1-self.camera.y)*ratio;self.camera.scale=next;self.input(json!({"type":"wheel"}));self.redraw()},
  WindowEvent::KeyboardInput{event,..}=>self.input(json!({"type":"key","key":format!("{:?}",event.logical_key),"pressed":event.state==ElementState::Pressed,"repeat":event.repeat})),
  WindowEvent::Ime(event)=>self.input(json!({"type":"ime","event":format!("{event:?}")})),
  WindowEvent::Focused(false)=>{self.pan=None;self.input(json!({"type":"focus","focused":false}))},_=>{}
 }}
}
fn main()->Result<(),String>{
 let arguments=std::env::args().collect::<Vec<_>>();
 let directory=PathBuf::from(arguments.get(1).ok_or("Initial fixture directory required")?);
 // The native window owns storage directly. No browser sidecar is needed to
 // load, commit, checkpoint, configure recovery or inspect canonical records.
 let workspace=match arguments.len(){
  2=>None,
  6 if arguments[2]=="--workspace"&&arguments[4]=="--project"=>Some(Arc::new(WorkspaceSession::open(&PathBuf::from(&arguments[3]),&arguments[5],true)?)),
  _=>return Err("Usage: live_host fixture [--workspace root --project id]".into()),
 };
 if let Some(session)=&workspace{emit(json!({"kind":"native.workspace","info":session.info()}))}
 let reader_workspace=workspace.as_ref().map(Arc::downgrade);
 let scene=bounded_file(directory.join("scene-paint.json"))?;let images=serde_json::from_str::<Vec<Value>>(&bounded_file(directory.join("image-uploads.json"))?).map_err(|e|e.to_string())?;
 let event_loop=EventLoop::<Wake>::with_user_event().build().map_err(|e|e.to_string())?;let proxy=event_loop.create_proxy();let mailbox=Arc::new(Mutex::new(Updates::default()));let reader_mailbox=mailbox.clone();
 std::thread::spawn(move||{let stdin=io::stdin();let mut reader=stdin.lock();loop{let mut line=Vec::new();match reader.by_ref().take(MAX_MESSAGE+1).read_until(b'\n',&mut line){Ok(0)=>{let _=proxy.send_event(Wake::Close);break},Ok(_)=>{},Err(_)=>break}if line.len() as u64>MAX_MESSAGE{emit(json!({"kind":"native.error","error":"Native message exceeds 16 MiB"}));let _=proxy.send_event(Wake::Close);break}
  let value=match serde_json::from_slice::<Value>(&line){Ok(value)=>value,Err(error)=>{emit(json!({"kind":"native.error","error":error.to_string()}));continue}};let kind=value["type"].as_str().unwrap_or("");if kind=="close"{let _=proxy.send_event(Wake::Close);break}
  if kind=="workspace"{
   let reply=(||{let session=reader_workspace.as_ref().and_then(|w|w.upgrade()).ok_or("No native workspace configured")?;let operation=value["operation"].as_str().ok_or("Missing storage operation")?;session.execute(operation,value.get("value").cloned().unwrap_or(json!({})))})();
   match reply{Ok(data)=>emit(json!({"kind":"native.workspace.reply","requestId":value["requestId"],"ok":true,"data":data})),Err(error)=>emit(json!({"kind":"native.workspace.reply","requestId":value["requestId"],"ok":false,"error":error}))}
   continue
  }
  if kind!="frame"&&kind!="camera"{emit(json!({"kind":"native.error","error":"Unsupported native host command"}));continue}
  let mut updates=reader_mailbox.lock().unwrap();if kind=="frame"{updates.frame=Some(value)}else{updates.camera=Some(value)}if !updates.queued{updates.queued=true;if proxy.send_event(Wake::Updates).is_err(){break}}
 }});
 let mut host=Host{scene,board:"initial-fixture".into(),images,surface:None,mailbox,camera:Camera{x:0.,y:0.,scale:1.},generation:0,sequence:0,command_sequence:0,cursor:(0.,0.),pan:None};event_loop.run_app(&mut host).map_err(|e|e.to_string())
}
