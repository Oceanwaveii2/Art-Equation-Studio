//! Short native CPU-only experiment. Never a GPU, app-latency or 4K gate.
#[cfg(all(not(target_arch="wasm32"), feature="native-cpu-parallel"))]
fn main() {
    use art_equation_p0_app_surface::cpu::B4CpuRenderer;
    use serde_json::json;
    use sha2::{Digest,Sha256};
    use std::time::Instant;
    let objects:Vec<_>=(0..48).map(|i|{
        let x=20.0+(i%8) as f64*120.0;let y=20.0+(i/8) as f64*115.0;
        json!({"id":format!("curve-{i}"),"kind":"vector","order":i,"visible":true,"locked":false,
            "opacity":0.85,"blendMode":"normal","transform":[1,0,0,1,0,0],
            "bounds":{"x":x,"y":y,"width":110,"height":100},
            "payload":{"commands":[["M",x,y+95.0],["C",x,y-30.0,x+110.0,y-30.0,x+110.0,y+95.0],["Z"]],
                "fill":"#28c9c780","strokeColor":"#e9be71","strokeWidth":2}})
    }).collect();
    let scene=json!({"schema":"art-equation.scene","schemaVersion":1,"documentId":"cpu-thread-probe",
        "sceneId":"cpu-thread-probe","revision":"1","coordinateSystem":{"units":"document-unit","xAxis":"right","yAxis":"down"},
        "environment":{"background":"#102030ff","colorSpace":"srgb"},"objects":objects,"connections":[],"assetIds":[]}).to_string();
    let mut configurations:Vec<_>=[0,2,4].into_iter().map(|threads|{
        let mut renderer=B4CpuRenderer::with_additional_threads(threads).unwrap();
        let pixels=renderer.render(1024,768,&scene,1.0,0.0,0.0).unwrap();
        renderer.render(1024,768,&scene,1.0,0.0,0.0).unwrap();
        (threads,renderer,format!("{:x}",Sha256::digest(pixels)),Vec::<f64>::new())
    }).collect();
    for sample in 0..6 {
        // Rotate order; reuse warmed resources. Includes parse/preparation,
        // rasterization and independently owned output bytes, not pure raster.
        for offset in 0..3 {
            let (threads,renderer,hash,timings)=&mut configurations[(sample+offset)%3];
            let start=Instant::now();
            let pixels=renderer.render(1024,768,&scene,1.0,0.0,0.0).unwrap();
            timings.push(start.elapsed().as_secs_f64()*1000.0);
            assert_eq!(&format!("{:x}",Sha256::digest(&pixels)),hash,"paint changed for {threads} threads");
            std::hint::black_box(pixels);
        }
    }
    let reference=&configurations[0].2;
    assert!(configurations.iter().all(|c|&c.2==reference),"threaded pixels differ");
    let rows:Vec<_>=configurations.iter().map(|(threads,renderer,hash,timings)|{
        let mut sorted=timings.clone();sorted.sort_by(f64::total_cmp);
        json!({"additionalThreads":threads,"samplesMs":timings,"medianMs":(sorted[2]+sorted[3])/2.0,
            "pixelSha256":hash,"resources":renderer.stats()})
    }).collect();
    println!("{}",json!({"scope":"native CPU diagnostic only; synthetic 48-curve 1024x768 scene, no app/GPU/4K qualification",
        "build":"release","availableParallelism":std::thread::available_parallelism().map(|n|n.get()).unwrap_or(1),
        "sceneSha256":format!("{:x}",Sha256::digest(scene.as_bytes())),"configurations":rows}));
}
#[cfg(not(all(not(target_arch="wasm32"), feature="native-cpu-parallel")))]
fn main() { panic!("run this native probe with --release --features native-cpu-parallel"); }
