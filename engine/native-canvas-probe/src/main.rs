//! Small native-window correctness probe. Uses the existing Vello adapter and
//! the identical validated display-list fixture; this is not a new renderer.
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use art_equation_p0_app_surface::native_gpu::NativeGpuRenderer;
use serde_json::{Value, json};
use winit::{application::ApplicationHandler, event::WindowEvent, event_loop::{ActiveEventLoop, EventLoop}, window::{Window, WindowId}};

struct SurfaceState {
    window: Arc<Window>, surface: wgpu::Surface<'static>, device: wgpu::Device,
    queue: wgpu::Queue, texture: wgpu::Texture, view: wgpu::TextureView,
    blitter: wgpu::util::TextureBlitter, renderer: NativeGpuRenderer,
    config: wgpu::SurfaceConfiguration, adapter: Value,
}
struct Probe { directory: PathBuf, scene: String, state: Option<SurfaceState>, receipts: Vec<Value>, failure: Option<String> }
impl Probe {
    async fn initialize(&self, event_loop: &ActiveEventLoop) -> Result<SurfaceState,String> {
        let window=Arc::new(event_loop.create_window(Window::default_attributes().with_title("Art Equation — native wgpu correctness probe").with_inner_size(winit::dpi::PhysicalSize::new(640,390))).map_err(|e|e.to_string())?);
        let mut descriptor=wgpu::InstanceDescriptor::new_without_display_handle();descriptor.backends=wgpu::Backends::VULKAN;
        let instance=wgpu::Instance::new(descriptor);
        let surface=instance.create_surface(window.clone()).map_err(|e|e.to_string())?;
        let adapter=instance.request_adapter(&wgpu::RequestAdapterOptions{compatible_surface:Some(&surface),power_preference:wgpu::PowerPreference::HighPerformance,..Default::default()}).await.map_err(|e|e.to_string())?;
        let info=adapter.get_info();let identity=json!({"name":info.name,"backend":format!("{:?}",info.backend),"deviceType":format!("{:?}",info.device_type)});
        let (device,queue)=adapter.request_device(&wgpu::DeviceDescriptor::default()).await.map_err(|e|e.to_string())?;
        let config=surface.get_default_config(&adapter,640,390).ok_or("No compatible window surface")?;surface.configure(&device,&config);
        let texture=device.create_texture(&wgpu::TextureDescriptor{label:Some("Same Vello canvas output"),size:wgpu::Extent3d{width:640,height:390,depth_or_array_layers:1},mip_level_count:1,sample_count:1,dimension:wgpu::TextureDimension::D2,format:wgpu::TextureFormat::Rgba8Unorm,usage:wgpu::TextureUsages::STORAGE_BINDING|wgpu::TextureUsages::TEXTURE_BINDING|wgpu::TextureUsages::COPY_SRC,view_formats:&[]});
        let view=texture.create_view(&Default::default());let blitter=wgpu::util::TextureBlitter::new(&device,config.format);let mut renderer=NativeGpuRenderer::new(&device)?;
        let uploads:Vec<Value>=serde_json::from_str(&fs::read_to_string(self.directory.join("image-uploads.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
        for upload in uploads {let pixels=upload["pixels"].as_array().ok_or("Invalid upload")?.iter().map(|p|p.as_u64().filter(|v|*v<=255).map(|v|v as u8).ok_or("Invalid pixel")).collect::<Result<Vec<_>,_>>()?;renderer.register_image(&upload["reference"].to_string(),pixels)?;}
        Ok(SurfaceState{window,surface,device,queue,texture,view,blitter,renderer,config,adapter:identity})
    }
    fn frame(&mut self)->Result<(),String>{
        let s=self.state.as_mut().ok_or("No surface")?;let step=self.receipts.len();let (scale,x,y)=match step{0=>(1.,0.,0.),1=>(1.,18.,12.),_=>(0.9,0.,0.)};
        let receipt=s.renderer.render_to_texture(&s.device,&s.queue,&s.view,640,390,&self.scene,scale,x,y)?;
        if receipt.gpu_allocation_failure_flags!=0||receipt.gpu_allocation_status!="checked"{return Err("Unchecked GPU allocation".into())}
        let frame=match s.surface.get_current_texture(){wgpu::CurrentSurfaceTexture::Success(frame)|wgpu::CurrentSurfaceTexture::Suboptimal(frame)=>frame,other=>return Err(format!("Native surface acquisition: {other:?}"))};let target=frame.texture.create_view(&Default::default());let mut encoder=s.device.create_command_encoder(&Default::default());s.blitter.copy(&s.device,&mut encoder,&s.view,&target);s.queue.submit([encoder.finish()]);frame.present();
        let mut row=serde_json::to_value(receipt).map_err(|e|e.to_string())?;row["camera"]=json!({"scale":scale,"x":x,"y":y});
        if step==0 {
            // One bounded verification readback. The presentation path above
            // has no readback; this is solely a test pixel oracle.
            let buffer=s.device.create_buffer(&wgpu::BufferDescriptor{label:Some("Probe pixel verification only"),size:640*390*4,usage:wgpu::BufferUsages::COPY_DST|wgpu::BufferUsages::MAP_READ,mapped_at_creation:false});
            let mut encoder=s.device.create_command_encoder(&Default::default());encoder.copy_texture_to_buffer(wgpu::TexelCopyTextureInfo{texture:&s.texture,mip_level:0,origin:wgpu::Origin3d::ZERO,aspect:wgpu::TextureAspect::All},wgpu::TexelCopyBufferInfo{buffer:&buffer,layout:wgpu::TexelCopyBufferLayout{offset:0,bytes_per_row:Some(640*4),rows_per_image:Some(390)}},wgpu::Extent3d{width:640,height:390,depth_or_array_layers:1});
            let submitted=s.queue.submit([encoder.finish()]);let (tx,rx)=std::sync::mpsc::channel();buffer.slice(..).map_async(wgpu::MapMode::Read,move|r|{let _=tx.send(r);});s.device.poll(wgpu::PollType::Wait{submission_index:Some(submitted),timeout:Some(Duration::from_secs(15))}).map_err(|e|e.to_string())?;rx.recv_timeout(Duration::from_secs(15)).map_err(|e|e.to_string())?.map_err(|e|e.to_string())?;
            let bytes=buffer.slice(..).get_mapped_range();let left=&bytes[(210*640+60)*4..(210*640+60)*4+4];let right=&bytes[(210*640+240)*4..(210*640+240)*4+4];row["pixels"]=json!({"left":left,"right":right});if left!=[55,213,181,255]||right!=[255,210,105,255]{return Err("Native GPU image pixels differ".into())}fs::write(self.directory.join("native-gpu.rgba"),&bytes).map_err(|e|e.to_string())?;drop(bytes);buffer.unmap();
        }
        self.receipts.push(row);Ok(())
    }
    fn save(&self){let report=json!({"scope":"640x390 native wgpu/Vello window; same authored glyph/image/graph display list, three camera frames. No browser or DOM. Not product integration, app latency or 4K acceptance.","passed":self.failure.is_none()&&self.receipts.len()==3,"failure":self.failure,"adapter":self.state.as_ref().map(|s|&s.adapter),"surfaceFormat":self.state.as_ref().map(|s|format!("{:?}",s.config.format)),"receipts":self.receipts});let _=fs::write(self.directory.join("native-report.json"),serde_json::to_vec_pretty(&report).unwrap());}
}
impl ApplicationHandler for Probe {
    fn resumed(&mut self,event_loop:&ActiveEventLoop){if self.state.is_some(){return}match pollster::block_on(self.initialize(event_loop)){Ok(state)=>{state.window.request_redraw();self.state=Some(state)},Err(e)=>{self.failure=Some(e);self.save();event_loop.exit()}}}
    fn window_event(&mut self,event_loop:&ActiveEventLoop,_:WindowId,event:WindowEvent){match event{WindowEvent::RedrawRequested=>{if let Err(e)=self.frame(){self.failure=Some(e);self.save();event_loop.exit();return}if self.receipts.len()==3{self.save();event_loop.exit()}else{self.state.as_ref().unwrap().window.request_redraw()}},WindowEvent::CloseRequested=>{self.failure=Some("Probe closed before verification".into());self.save();event_loop.exit()},_=>{}}}
}
fn main(){let directory=PathBuf::from(std::env::args().nth(1).expect("Fixture directory required"));let scene=fs::read_to_string(directory.join("scene-paint.json")).expect("Validated fixture required");let mut app=Probe{directory,scene,state:None,receipts:vec![],failure:None};EventLoop::new().unwrap().run_app(&mut app).unwrap();if app.failure.is_some(){std::process::exit(1)}}
