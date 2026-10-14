//! Read-only runtime discovery. Availability never enables an accelerator.
use serde_json::{json, Value};

#[cfg(windows)]
fn platform_probe() -> Value {
    use std::ffi::c_void;
    #[link(name="kernel32")]
    extern "system" {
        fn LoadLibraryExW(path: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
        fn GetProcAddress(module: *mut c_void, name: *const u8) -> *const c_void;
        fn FreeLibrary(module: *mut c_void) -> i32;
    }
    #[link(name="user32")]
    extern "system" {
        fn GetThreadDpiAwarenessContext() -> *mut c_void;
        fn AreDpiAwarenessContextsEqual(a: *mut c_void, b: *mut c_void) -> i32;
    }
    struct Library(*mut c_void);
    impl Drop for Library { fn drop(&mut self) { unsafe { FreeLibrary(self.0); } } }
    impl Library {
        unsafe fn symbol<T: Copy>(&self,name: &[u8]) -> Result<T,String> {
            let pointer=GetProcAddress(self.0,name.as_ptr());
            if pointer.is_null() || std::mem::size_of::<T>() != std::mem::size_of::<*const c_void>() { return Err("OpenCL entry point unavailable".into()); }
            Ok(std::mem::transmute_copy(&pointer))
        }
    }
    let dpi_v2 = unsafe { AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext(), -4isize as *mut c_void) != 0 };
    let read = || -> Result<Vec<Value>,String> { unsafe {
        let path: Vec<u16>="OpenCL.dll\0".encode_utf16().collect();
        // System32 only: never search project folders for a driver DLL.
        let handle=LoadLibraryExW(path.as_ptr(),std::ptr::null_mut(),0x800);
        if handle.is_null() { return Err("OpenCL runtime is unavailable".into()); }
        let library=Library(handle);
        type Platforms=unsafe extern "system" fn(u32,*mut *mut c_void,*mut u32)->i32;
        type Devices=unsafe extern "system" fn(*mut c_void,u64,u32,*mut *mut c_void,*mut u32)->i32;
        type Info=unsafe extern "system" fn(*mut c_void,u32,usize,*mut c_void,*mut usize)->i32;
        let platforms:Platforms=library.symbol(b"clGetPlatformIDs\0")?;
        let devices:Devices=library.symbol(b"clGetDeviceIDs\0")?;
        let info:Info=library.symbol(b"clGetDeviceInfo\0")?;
        let mut ids=[std::ptr::null_mut();8]; let mut count=0;
        let result=platforms(8,ids.as_mut_ptr(),&mut count);
        if result != 0 { return Err(format!("OpenCL platform discovery returned {result}")); }
        let text = |device: *mut c_void, attribute: u32| -> String {
            let mut size=0;
            if info(device,attribute,0,std::ptr::null_mut(),&mut size)!=0 || size==0 || size>16384 { return String::new(); }
            let mut bytes=vec![0u8;size];
            if info(device,attribute,size,bytes.as_mut_ptr() as *mut c_void,std::ptr::null_mut())!=0 { return String::new(); }
            String::from_utf8_lossy(&bytes).trim_end_matches('\0').chars().take(4000).collect()
        };
        let mut rows=Vec::new();
        for platform in ids.into_iter().take(count.min(8) as usize) {
            let mut device_ids=[std::ptr::null_mut();8]; let mut device_count=0;
            if devices(platform,0xffffffff,8,device_ids.as_mut_ptr(),&mut device_count)!=0 { continue; }
            for device in device_ids.into_iter().take(device_count.min(8) as usize) {
                let extensions=text(device,0x1030);
                rows.push(json!({"name":text(device,0x102b),"vendor":text(device,0x102c),"driver":text(device,0x102d),"version":text(device,0x102f),"externalMemoryAdvertised":extensions.split_whitespace().any(|e|e=="cl_khr_external_memory"),"externalSemaphoreAdvertised":extensions.split_whitespace().any(|e|e=="cl_khr_external_semaphore")}));
            }
        }
        Ok(rows)
    }};
    match read() {
        Ok(devices)=>json!({
            "dpiPerMonitorV2":dpi_v2,
            "opencl":{
                "available":!devices.is_empty(),
                "enabled":false,
                "deprecated":true,
                "recommended":false,
                "devices":devices,
                "qualification":"DEPRECATED. Not recommended for modern Windows pipelines. Lacks native DXGI swapchain integration and requires expensive surface copies. Superseded by Direct3D 12 DirectCompute / HLSL SM 6.6+."
            },
            "directx12":{
                "recommended":true,
                "backend":"wgpu::Backends::DX12",
                "architecture":"DirectCompute / HLSL SM 6.6+",
                "tiledResourcesTier2":"Hardware Sparse Virtual Texturing for 64k x 64k canvases with 1,000+ art cards using bounded VRAM",
                "directStorageGDeflate":"Direct GPU archive & texture decompression >10 GB/s",
                "waveIntrinsics":"SM 6.0-6.6 WaveActivePrefixSum scanline binning with zero bank conflicts",
                "videoDecoderInterop":"Zero-copy hardware video decoding straight into composition render targets"
            }
        }),
        Err(error)=>json!({
            "dpiPerMonitorV2":dpi_v2,
            "opencl":{"available":false,"enabled":false,"deprecated":true,"recommended":false,"devices":[],"reason":error},
            "directx12":{
                "recommended":true,
                "backend":"wgpu::Backends::DX12",
                "architecture":"DirectCompute / HLSL SM 6.6+"
            }
        })
    }
}
#[cfg(not(windows))]
fn platform_probe() -> Value { json!({"opencl":{"available":false,"enabled":false,"deprecated":true,"recommended":false,"reason":"No native discovery adapter for this platform"}}) }
pub(crate) fn report() -> Value {
    let mut value=platform_probe();
    value["hardware"] = super::hardware_discovery::report();
    #[cfg(windows)] { value["hardware"]["nvidiaLibraries"]=super::experimental_compute::nvidia::availability(); }
    value["launchPreferences"] = serde_json::to_value(super::launch_preferences::read()).unwrap_or(Value::Null);
    value["preparationWorkers"]=json!(super::image_pyramid::preparation_workers());
    value["renderer"]=json!("wgpu / Vello GPU and Vello CPU");
    value["experimentalAccelerationEnabled"]=json!(false);
    value["preparationSession"]=super::experimental_compute::status();
    value["optInPreparation"]=json!({
        "command":"prepare_image_experimental",
        "backends":["cpu","wgpu","dx12","vulkan","opencl","cuda-dx12","cuda-dx12-upload"],
        "recommendedBackend":"dx12",
        "deprecatedBackends":["opencl"],
        "automatic":false,
        "operation":"Alpha-weighted 2x RGBA8 reduction",
        "isolation":"Separate bounded worker process; no shared canvas resources",
        "qualification":"Run an explicit comparison to verify this device; discovery creates no compute context"
    });
    value
}
#[tauri::command]
pub(crate) async fn inspect_engine_capabilities() -> Result<Value,String> {
    tauri::async_runtime::spawn_blocking(report).await.map_err(|e|e.to_string())
}
#[cfg(test)] mod tests {
    #[test] fn discovery_never_enables_acceleration() { let result=super::report(); assert_eq!(result["experimentalAccelerationEnabled"],false); assert_eq!(result["opencl"]["enabled"],false); assert!(result["preparationWorkers"].as_u64().unwrap()<=4); }
}
