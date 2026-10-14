//! Read-only loopback endpoint for the standalone Codex MCP adapter.
use serde_json::{json,Value};
use std::{collections::{HashMap,VecDeque},fs,io::{Read,Write},net::{TcpListener,TcpStream},path::PathBuf,
    sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,AtomicUsize,Ordering},mpsc},time::{Duration,Instant}};
use tauri::{Emitter,Manager,State,WebviewWindow};
#[derive(Default)] pub struct LiveState(Mutex<Option<Arc<Live>>>);
struct Live { app:tauri::AppHandle,token:String,port:u16,closed:AtomicBool,busy:AtomicUsize,
    pending:Mutex<HashMap<String,mpsc::SyncSender<Value>>>,discovery:PathBuf,workspace:PathBuf }
const ARCHITECTURE:&str=include_str!("../bridge-architecture.json");
static MANIFEST:OnceLock<Value>=OnceLock::new();
const BRIDGE_WORKERS:usize=8;
const BRIDGE_QUEUE:usize=64;
#[derive(Default)] struct BridgeMetrics {
    active:AtomicUsize,queued:AtomicUsize,completed:AtomicUsize,rejected:AtomicUsize,
    response_bytes:AtomicUsize,recent:Mutex<VecDeque<Value>>
}
static METRICS:OnceLock<Arc<BridgeMetrics>>=OnceLock::new();
fn handshake(workspace:&PathBuf)->Value {
    static EXE_HASH:OnceLock<Option<String>>=OnceLock::new();
    let exe=EXE_HASH.get_or_init(||{
        use sha2::{Digest,Sha256};
        let mut file=fs::File::open(std::env::current_exe().ok()?).ok()?;
        let mut hash=Sha256::new();let mut bytes=[0u8;65536];
        loop{let n=file.read(&mut bytes).ok()?;if n==0{break}hash.update(&bytes[..n]);}
        Some(hash.finalize().iter().map(|b|format!("{b:02x}")).collect())
    });
    let architecture=MANIFEST.get_or_init(||serde_json::from_str(ARCHITECTURE).expect("Build architecture"));
    let receipt:Value=serde_json::from_str(include_str!("../../engine/vello-surface/build-receipt.json")).unwrap_or(Value::Null);
    json!({"schema":"art-equation.inspection","version":2,"pid":std::process::id(),"workspace":workspace,"executableSha256":exe,"architectureIdentity":architecture["identity"],"wasmSha256":receipt["files"]["engine/vello-surface/generated/p0_engine_wasm_bg.wasm"],"engineBuildFeatures":receipt["features"],"webviewRuntime":tauri::webview_version().ok(),"capabilities":["durable-cursor-events","logs","runtime","architecture","live-model","gemini-bridge"],"activeRendererSource":"art_app_read diagnostics; build capabilities do not identify the active frame backend","telemetryScope":"Recorded native durable batches, typically flushed every second; bounded cursor reads, not physical display timing","readOnly":false})
}
fn runtime_read()->Value {
    // Only app-owned descendants are returned, never other application details.
    use sysinfo::{System,ProcessesToUpdate,ProcessRefreshKind,Pid};
    let mut system=System::new();
    system.refresh_processes_specifics(ProcessesToUpdate::All,true,ProcessRefreshKind::nothing().with_memory().with_cpu());
    let root=Pid::from_u32(std::process::id());let mut ids=std::collections::HashSet::from([root]);
    loop {let old=ids.len();for (pid,process) in system.processes(){if process.parent().is_some_and(|parent|ids.contains(&parent)){ids.insert(*pid);}}if ids.len()==old{break;}}
    let mut processes:Vec<_>=ids.iter().filter_map(|pid|system.process(*pid).map(|process|json!({"pid":pid.as_u32(),"parentPid":process.parent().map(|p|p.as_u32()),"name":process.name().to_string_lossy(),"residentBytes":process.memory(),"virtualBytes":process.virtual_memory(),"cpuTimeMs":process.accumulated_cpu_time(),"runTimeSeconds":process.run_time()}))).collect();
    processes.sort_by_key(|row|row["pid"].as_u64());
    let metrics=METRICS.get().map(|m|json!({"workerLimit":BRIDGE_WORKERS,"queueLimit":BRIDGE_QUEUE,"active":m.active.load(Ordering::Relaxed),"queued":m.queued.load(Ordering::Relaxed),"completed":m.completed.load(Ordering::Relaxed),"rejected":m.rejected.load(Ordering::Relaxed),"responseBytes":m.response_bytes.load(Ordering::Relaxed),"recentRequests":m.recent.lock().unwrap().iter().cloned().collect::<Vec<_>>()}));
    json!({"schema":"art-equation.runtime","version":1,"scope":"App-owned process snapshots and bridge transport diagnostics; resident/virtual bytes are not GPU VRAM or private memory. CPU time is cumulative, not utilization.","pid":std::process::id(),"processes":processes,"bridge":metrics,"readOnly":true})
}
fn busy_response(mut stream:TcpStream) {
    let body=r#"{"ok":false,"error":"Inspection queue is busy; retry after one second"}"#;
    let _=stream.set_write_timeout(Some(Duration::from_millis(100)));
    let _=stream.write_all(format!("HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nRetry-After: 1\r\n\r\n{}",body.len(),body).as_bytes());
}
fn architecture(args:&Value)->Result<Value,String> {
    let manifest=MANIFEST.get_or_init(||serde_json::from_str(ARCHITECTURE).expect("Build-generated architecture must be valid JSON"));
    let offset=args["offset"].as_u64().unwrap_or(0) as usize;
    let limit=args["limit"].as_u64().unwrap_or(4000).clamp(1,8000) as usize;
    match args["section"].as_str().unwrap_or("overview") {
        "overview"=>Ok(json!({"identity":manifest["identity"],"topology":manifest["topology"]})),
        "files"=>{let rows=manifest["files"].as_array().unwrap();Ok(json!({"identity":manifest["identity"],"total":rows.len(),"offset":offset,
            "records":rows.iter().skip(offset).take(limit.min(100)).map(|row|json!({"path":row["path"],"sha256":row["sha256"],"bytes":row["bytes"],"imports":row["imports"]})).collect::<Vec<_>>(),
            "nextOffset":if offset+limit.min(100)<rows.len(){json!(offset+limit.min(100))}else{Value::Null}}))},
        "source"=>{let row=manifest["files"].as_array().unwrap().iter().find(|row|row["path"]==args["path"]).ok_or("Path is not in this build's source manifest")?;
            let text=row["source"].as_str().unwrap();let chars:Vec<char>=text.chars().collect();if offset>chars.len(){return Err("Offset exceeds source length".into());}
            Ok(json!({"identity":manifest["identity"],"path":row["path"],"sha256":row["sha256"],"offset":offset,"paginationUnit":"Unicode scalar values","total":chars.len(),"text":chars.iter().skip(offset).take(limit).collect::<String>(),"nextOffset":if offset+limit<chars.len(){json!(offset+limit)}else{Value::Null}}))},
        _=>Err("Unknown architecture section".into())
    }
}
fn log_read(root:&PathBuf,args:&Value)->Result<Value,String> {
    let directory=root.join("logs");let canonical=directory.canonicalize().map_err(|_|"No native logs available yet")?;
    let mut files=vec![];
    for entry in fs::read_dir(&directory).map_err(|_|"Native logs unavailable")?.flatten() {
        let path=entry.path();let name=entry.file_name().to_string_lossy().to_string();
        if path.is_file() && (name.ends_with(".log")||name.ends_with(".jsonl")) && path.canonicalize().is_ok_and(|path|path.starts_with(&canonical)) {
            let metadata=entry.metadata().map_err(|_|"Log metadata unavailable")?;files.push((name,path,metadata.len()));
        }
    }
    files.sort_by(|a,b|a.0.cmp(&b.0));
    let Some(id)=args["id"].as_str() else{return Ok(json!({"files":files.iter().map(|(id,_,bytes)|json!({"id":id,"bytes":bytes})).collect::<Vec<_>>(),"scope":"Stored native logs; files may rotate or append while reading"}));};
    let (_,path,total)=files.iter().find(|(name,_,_)|name==id).ok_or("Unknown log ID")?;
    let offset=args["offset"].as_u64().unwrap_or(0);let limit=args["limit"].as_u64().unwrap_or(8000).clamp(1,8000);
    if offset>*total{return Err("Offset exceeds log size".into());}
    use std::io::{Seek,SeekFrom};let mut file=fs::File::open(path).map_err(|_|"Log unavailable")?;file.seek(SeekFrom::Start(offset)).map_err(|_|"Log seek failed")?;
    let mut bytes=vec![];file.take(limit).read_to_end(&mut bytes).map_err(|_|"Log read failed")?;
    use base64::Engine;
    let encoded=base64::engine::general_purpose::STANDARD.encode(&bytes);
    let next=if offset+(bytes.len() as u64)<*total { json!(offset+bytes.len() as u64) } else { Value::Null };
    Ok(json!({"id":id,"offset":offset,"paginationUnit":"bytes","total":total,"bytesRead":bytes.len(),"text":String::from_utf8_lossy(&bytes),"nextOffset":next,"note":"UTF-8 may span byte chunks; append rawBytesBase64 for exact reconstruction","rawBytesBase64":encoded}))
}
pub fn native_read(workspace:&PathBuf,tool:&str,args:&Value)->Option<Result<Value,String>> {match tool {
    "art_app_handshake"=>Some(validate_args(args,&[]).map(|_|handshake(workspace))),
    "art_app_events"=>Some(crate::telemetry_cursor::read(workspace,args)),
    "art_app_runtime"=>Some(validate_args(args,&[]).map(|_|runtime_read())),
    "art_app_architecture"=>Some(validate_args(args,&["section","path","offset","limit"]).and_then(|_|architecture(args))),
    "art_app_logs"=>Some(validate_args(args,&["id","offset","limit"]).and_then(|_|log_read(workspace,args))),
    _=>None
}}
fn validate_args(args:&Value,keys:&[&str])->Result<(),String>{
    let object=args.as_object().ok_or("Arguments must be an object")?;
    if object.keys().any(|key|!keys.contains(&key.as_str())){return Err("Unsupported argument".into());}
    for key in ["offset","limit"]{if let Some(value)=object.get(key){let n=value.as_u64().ok_or("Invalid pagination")?;
        if (key=="limit"&&(n==0||n>8000)) || (key=="offset"&&n>1_000_000_000){return Err("Pagination exceeds limits".into());}
    }}
    for key in ["id","path","section"]{if let Some(value)=object.get(key){if value.as_str().is_none_or(|text|text.len()>512){return Err("Invalid record identifier".into());}}}Ok(())
}
impl Live {
    fn inspect(&self,tool:&str,args:Value)->Result<Value,String> {
        if let Some(result)=native_read(&self.workspace,tool,&args){return result;}
        const ALLOWED_UI_TOOLS: &[&str] = &[
            "art_app_status",
            "art_app_read",
            "gemini_app_alter",
            "gemini_app_send_data",
            "gemini_app_track_bug",
            "gemini_app_feedback",
            "gemini_app_execute",
        ];
        if !ALLOWED_UI_TOOLS.contains(&tool){return Err(format!("Unknown or disallowed app tool: {tool}"));}
        let id=uuid::Uuid::new_v4().to_string();let(tx,rx)=mpsc::sync_channel(1);
        self.pending.lock().unwrap().insert(id.clone(),tx);
        let result=self.app.emit("app-inspection-request",json!({"requestId":id,"tool":tool,"arguments":args})).map_err(|_|"Live UI unavailable".to_owned())
            .and_then(|_|rx.recv_timeout(Duration::from_secs(15)).map_err(|_|"Live UI did not answer. Open the main workspace and retry.".to_owned()));
        self.pending.lock().unwrap().remove(&id);result
    }
    fn serve(&self,mut stream:TcpStream) {
        let began=Instant::now();let mut tool_name=String::new();
        let _=stream.set_read_timeout(Some(Duration::from_secs(2)));let _=stream.set_write_timeout(Some(Duration::from_secs(2)));
        let request=(||->Result<Value,String>{
            let mut bytes=vec![];let mut one=[0];
            while !bytes.ends_with(b"\r\n\r\n"){if bytes.len()>=8192{return Err("Header limit".into());}stream.read_exact(&mut one).map_err(|_|"Incomplete request")?;bytes.push(one[0]);}
            let header=std::str::from_utf8(&bytes).map_err(|_|"Invalid header")?;let lines:Vec<_>=header.split("\r\n").collect();
            if lines[0]!="POST /inspect HTTP/1.1"{return Err("Unsupported route".into());}
            let mut length=None;let mut authorized=false;
            for line in lines.iter().skip(1){if let Some((key,value))=line.split_once(':'){
                match key.trim().to_ascii_lowercase().as_str(){
                    "authorization"=>authorized=value.trim()==format!("Bearer {}",self.token),
                    "content-length"=>{if length.is_some(){return Err("Duplicate length".into());}length=Some(value.trim().parse::<usize>().map_err(|_|"Invalid length")?);},
                    "origin"|"transfer-encoding"=>return Err("Browser origins and chunked requests are unavailable".into()),_=>{}
                }
            }}
            if !authorized{return Err("Unauthorized local inspection request".into());}
            let length=length.ok_or("Missing length")?;if length>65536{return Err("Request limit".into());}
            let mut body=vec![0;length];stream.read_exact(&mut body).map_err(|_|"Incomplete body")?;
            let value:Value=serde_json::from_slice(&body).map_err(|_|"Invalid JSON")?;
            tool_name=value["tool"].as_str().unwrap_or("invalid").chars().take(80).collect();
            self.inspect(value["tool"].as_str().ok_or("Missing tool")?,value["arguments"].clone())
        })();
        let ok=request.is_ok();
        let body=match request{Ok(data)=>json!({"ok":true,"data":data}),Err(error)=>json!({"ok":false,"error":error})}.to_string();
        let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{}",body.len(),body);let _=stream.write_all(response.as_bytes());
        if let Some(m)=METRICS.get(){m.completed.fetch_add(1,Ordering::Relaxed);m.response_bytes.fetch_add(body.len(),Ordering::Relaxed);let mut recent=m.recent.lock().unwrap();if recent.len()>=64{recent.pop_front();}recent.push_back(json!({"tool":tool_name,"ok":ok,"elapsedMs":began.elapsed().as_secs_f64()*1000.,"responseBytes":body.len()}));}
    }
}
pub fn start(app:&tauri::AppHandle,workspace:PathBuf)->Result<(),String> {
    let listener=TcpListener::bind("127.0.0.1:0").map_err(|_|"Cannot bind local inspection bridge")?;let port=listener.local_addr().map_err(|_|"Cannot read bridge address")?.port();
    let directory=app.path().app_local_data_dir().map_err(|_|"App data unavailable")?;fs::create_dir_all(&directory).map_err(|_|"App data unavailable")?;
    let instances=directory.join("codex-live-instances");fs::create_dir_all(&instances).map_err(|_|"Cannot create instance discovery")?;
    let discovery=instances.join(format!("{}.json",std::process::id()));
    let token=format!("{}{}",uuid::Uuid::new_v4().simple(),uuid::Uuid::new_v4().simple());
    // Discovery stays in per-user app data, outside projects, diagnostics and exports.
    fs::write(&discovery,json!({"schema":2,"pid":std::process::id(),"workspace":workspace,"port":port,"token":token}).to_string()).map_err(|_|"Cannot publish local bridge discovery")?;
    let live=Arc::new(Live{app:app.clone(),token,port,closed:AtomicBool::new(false),busy:AtomicUsize::new(0),pending:Mutex::new(HashMap::new()),discovery,workspace});
    *app.state::<LiveState>().0.lock().unwrap()=Some(Arc::clone(&live));
    let metrics=Arc::new(BridgeMetrics::default());let _=METRICS.set(Arc::clone(&metrics));
    let(tx,rx)=mpsc::sync_channel::<(TcpStream,Instant)>(BRIDGE_QUEUE);let rx=Arc::new(Mutex::new(rx));
    for _ in 0..BRIDGE_WORKERS {
        let rx=Arc::clone(&rx);let live=Arc::clone(&live);let metrics=Arc::clone(&metrics);
        std::thread::spawn(move||loop {
            let work=rx.lock().unwrap().recv();let Ok((stream,queued_at))=work else{break;};
            metrics.queued.fetch_sub(1,Ordering::AcqRel);
            if live.closed.load(Ordering::Acquire){break;}
            if queued_at.elapsed()>Duration::from_secs(5){metrics.rejected.fetch_add(1,Ordering::Relaxed);busy_response(stream);continue;}
            live.busy.fetch_add(1,Ordering::AcqRel);metrics.active.fetch_add(1,Ordering::AcqRel);
            live.serve(stream);
            metrics.active.fetch_sub(1,Ordering::AcqRel);live.busy.fetch_sub(1,Ordering::AcqRel);
        });
    }
    std::thread::spawn(move||{for stream in listener.incoming(){if live.closed.load(Ordering::Acquire){break;}
        if let Ok(stream)=stream {
            metrics.queued.fetch_add(1,Ordering::AcqRel);
            if let Err(error)=tx.try_send((stream,Instant::now())) {
                metrics.queued.fetch_sub(1,Ordering::AcqRel);metrics.rejected.fetch_add(1,Ordering::Relaxed);
                let (stream,_)=match error {mpsc::TrySendError::Full(work)|mpsc::TrySendError::Disconnected(work)=>work};
                busy_response(stream);
            }
        }
    }});Ok(())
}
#[tauri::command]
pub fn app_inspection_reply(_window:WebviewWindow,state:State<'_,LiveState>,request_id:String,data:Value)->Result<(),String>{
    if data.to_string().len()>512_000{return Err("Inspection result too large".into());}
    let slot=state.0.lock().unwrap();let live=slot.as_ref().ok_or("Live inspection unavailable")?;
    let tx=live.pending.lock().unwrap().remove(&request_id).ok_or("Unknown or expired inspection request")?;tx.try_send(data).map_err(|_|"Inspection request closed".into())
}
pub fn shutdown(state:&LiveState){if let Some(live)=state.0.lock().unwrap().take(){live.closed.store(true,Ordering::Release);let _=TcpStream::connect(("127.0.0.1",live.port));
    // A second app instance may own the discovery file by now.
    if fs::read_to_string(&live.discovery).ok().and_then(|text|serde_json::from_str::<Value>(&text).ok()).is_some_and(|v|v["token"]==live.token){let _=fs::remove_file(&live.discovery);}
    live.pending.lock().unwrap().clear();}}

#[cfg(test)]mod tests{
    use super::*;
    #[test]fn architecture_reads_are_allowlisted_and_paged(){
        let root=std::env::temp_dir();let overview=native_read(&root,"art_app_architecture",&json!({})).unwrap().unwrap();assert!(overview["identity"].as_str().unwrap().len()==64);
        let source=native_read(&root,"art_app_architecture",&json!({"section":"source","path":"src/App.tsx","limit":20})).unwrap().unwrap();assert_eq!(source["text"].as_str().unwrap().chars().count(),20);
        for args in [json!({"section":"source","path":"../../auth.json"}),json!({"offset":-1}),json!({"limit":0}),json!({"limit":8001}),json!({"extra":true}),json!([])]{assert!(native_read(&root,"art_app_architecture",&args).unwrap().is_err());}
    }
    #[test]fn durable_logs_preserve_byte_chunks_and_refuse_arbitrary_paths(){
        let root=std::env::temp_dir().join(format!("ae-bridge-logs-{}",uuid::Uuid::new_v4()));fs::create_dir_all(root.join("logs")).unwrap();
        let bytes="line 🌊\n".as_bytes();fs::write(root.join("logs/performance.jsonl"),bytes).unwrap();
        let page=native_read(&root,"art_app_logs",&json!({"id":"performance.jsonl","offset":5,"limit":2})).unwrap().unwrap();
        use base64::Engine;let decoded=base64::engine::general_purpose::STANDARD.decode(page["rawBytesBase64"].as_str().unwrap()).unwrap();assert_eq!(decoded,&bytes[5..7]);
        assert!(native_read(&root,"art_app_logs",&json!({"id":"../../auth.json"})).unwrap().is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
