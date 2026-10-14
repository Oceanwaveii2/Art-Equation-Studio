//! One bounded, persistent helper per app. Launch warmth never blocks the UI.
use super::{Request,MAX_BYTES};
use serde_json::{json,Value};
use std::{io::{BufRead,Read,Write},process::{Child,Command,Stdio},sync::{Arc,Mutex,OnceLock,mpsc,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
struct Job { request:Value,reply:mpsc::SyncSender<Result<Value,String>> }
struct Service { jobs:mpsc::SyncSender<Job>,state:Arc<Mutex<Value>>,child:Arc<Mutex<Option<Child>>>,closed:Arc<AtomicBool> }
static SERVICE:OnceLock<Service>=OnceLock::new();
fn service()->&'static Service{SERVICE.get_or_init(||{
    let(tx,rx)=mpsc::sync_channel::<Job>(1);let state=Arc::new(Mutex::new(json!({"phase":"warming","ready":false})));let child=Arc::new(Mutex::new(None));let closed=Arc::new(AtomicBool::new(false));
    let(status,process,stopped)=(state.clone(),child.clone(),closed.clone());
    std::thread::spawn(move||{
        let run=||->Result<(),String>{
            let mut command=Command::new(std::env::current_exe().map_err(|e|e.to_string())?);
            command.arg("--engine-compute-service").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
            #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
            let mut worker=command.spawn().map_err(|e|e.to_string())?;
            let mut input=worker.stdin.take().unwrap();let output=worker.stdout.take().unwrap();
            let pid=worker.id();*process.lock().unwrap()=Some(worker);
            let(write_tx,write_rx)=mpsc::sync_channel::<Vec<u8>>(1);let(read_tx,read_rx)=mpsc::sync_channel(1);
            let writer=std::thread::spawn(move||{for payload in write_rx{if input.write_all(&payload).and_then(|_|input.flush()).is_err(){break}}});
            let reader=std::thread::spawn(move||{let mut source=std::io::BufReader::new(output);loop{
                let mut bytes=Vec::new();let line=source.by_ref().take((MAX_BYTES/2+65536)as u64).read_until(b'\n',&mut bytes);
                if !matches!(line,Ok(n)if n>0)||!bytes.ends_with(b"\n"){break}
                if read_tx.send(serde_json::from_slice::<Value>(&bytes).map_err(|_|"Invalid helper response".to_owned())).is_err(){break}
            }});
            let result=(||{
                let warm=read_rx.recv_timeout(Duration::from_secs(60)).map_err(|_|"Compute warmup timed out or helper exited")??;
                if warm["ready"]!=true{return Err("Compute helper did not finish warmup".into())}
                log::info!("compute preparation warmed in {:.1} ms (isolated helper {pid})",warm["warmupMs"].as_f64().unwrap_or(0.));
                *status.lock().unwrap()=json!({"phase":"ready","ready":true,"pid":pid,"warmup":warm});
                while !stopped.load(Ordering::Acquire){
                    let job=match rx.recv_timeout(Duration::from_millis(100)){Ok(job)=>job,Err(mpsc::RecvTimeoutError::Timeout)=>continue,Err(_)=>break};
                    let start=Instant::now();let mut payload=serde_json::to_vec(&job.request).map_err(|e|e.to_string())?;payload.push(b'\n');
                    write_tx.try_send(payload).map_err(|_|"Compute helper input unavailable")?;
                    let response=read_rx.recv_timeout(Duration::from_secs(60)).map_err(|_|"Compute helper timed out or exited".to_owned()).and_then(|response|response);
                    match response{
                        Ok(value)=>{
                            let result=if let Some(error)=value["error"].as_str(){Err(error.to_owned())}else if value["result"].is_object(){let mut result=value["result"].clone();result["isolatedRoundTripMs"]=json!(start.elapsed().as_secs_f64()*1000.);result["warmSession"]=json!(true);Ok(result)}else{Err("Malformed helper result".into())};
                            let _=job.reply.send(result);
                        },
                        Err(error)=>{let _=job.reply.send(Err(error.to_owned()));return Err(error.to_owned())}
                    }
                }
                Ok(())
            })();
            if let Some(mut child)=process.lock().unwrap().take(){let _=child.kill();let _=child.wait();}
            drop(write_tx);drop(read_rx);let _=writer.join();let _=reader.join();result
        };
        if let Err(error)=run(){log::warn!("compute preparation unavailable: {error}");*status.lock().unwrap()=json!({"phase":"unavailable","ready":false,"reason":error});}
    });Service{jobs:tx,state,child,closed}
})}
pub(crate) fn startup(){let _=service();}
pub(crate) fn status()->Value{SERVICE.get().map(|service|service.state.lock().unwrap().clone()).unwrap_or_else(||json!({"phase":"not-started","ready":false}))}
pub(super) fn request(request:Request)->Result<Value,String>{request_json(serde_json::to_value(request).map_err(|e|e.to_string())?)}
pub(super) fn request_json(request:Value)->Result<Value,String>{
    let service=service();if service.closed.load(Ordering::Acquire){return Err("Compute service is closed".into())}
    let phase=service.state.lock().unwrap().clone();if phase["phase"]=="unavailable"{return Err(phase["reason"].as_str().unwrap_or("Compute helper unavailable").to_owned())}
    let(tx,rx)=mpsc::sync_channel(1);service.jobs.try_send(Job{request,reply:tx}).map_err(|_|"Compute service is busy or unavailable")?;
    rx.recv_timeout(Duration::from_secs(65)).map_err(|_|"Compute service did not answer within its deadline")?
}
pub(crate) fn shutdown(){if let Some(service)=SERVICE.get(){service.closed.store(true,Ordering::Release);
    if let Some(mut child)=service.child.lock().unwrap().take(){let _=child.kill();let _=child.wait();}
    *service.state.lock().unwrap()=json!({"phase":"closed","ready":false});
}}
