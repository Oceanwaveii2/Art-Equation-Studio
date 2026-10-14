//! Bounded native-owned durable telemetry replay. No UI callback or model clone.
use std::{fs::{self,File},io::{BufRead,BufReader,Read,Seek,SeekFrom},path::Path};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use base64::{Engine,engine::general_purpose::URL_SAFE_NO_PAD};
#[derive(Serialize,Deserialize)]#[serde(deny_unknown_fields)]
struct Cursor { version:u8, file:String, offset:u64, row:usize }
fn file_identity(file:&File)->Result<String,String>{
 let mut file=file.try_clone().map_err(|_|"TELEMETRY_FILE_UNAVAILABLE")?;file.seek(SeekFrom::Start(0)).map_err(|_|"TELEMETRY_SEEK_FAILED")?;
 let mut first=Vec::new();BufReader::new(file).take(256_001).read_until(b'\n',&mut first).map_err(|_|"TELEMETRY_READ_FAILED")?;
 if first.len()>256_000{return Err("TELEMETRY_BATCH_TOO_LARGE".into())}
 Ok(Sha256::digest(&first).iter().map(|b|format!("{b:02x}")).collect::<String>())
}
fn identity(path:&Path)->Result<String,String>{file_identity(&File::open(path).map_err(|_|"TELEMETRY_FILE_UNAVAILABLE")?)}
pub fn read(root:&Path,args:&Value)->Result<Value,String>{
 let args=args.as_object().ok_or("Invalid telemetry arguments")?;
 if args.keys().any(|k|!["cursor","sessionId","limit"].contains(&k.as_str())){return Err("Unsupported telemetry argument".into())}
 let limit=match args.get("limit"){None=>100,Some(v)=>v.as_u64().filter(|v|*v>0&&*v<=200).ok_or("Invalid telemetry limit")? as usize};
 let session=match args.get("sessionId"){None=>None,Some(v)=>Some(v.as_str().filter(|s|!s.is_empty()&&s.len()<=128).ok_or("Invalid session ID")?)};
 let directory=root.join("logs");let canonical=directory.canonicalize().map_err(|_|"TELEMETRY_UNAVAILABLE")?;
 let mut files=Vec::new();
 for name in ["performance.previous.jsonl","performance.jsonl"]{
  let path=directory.join(name);
  if path.is_file(){if !path.canonicalize().map_err(|_|"TELEMETRY_FILE_UNAVAILABLE")?.starts_with(&canonical){return Err("Invalid telemetry file".into())}files.push((path.clone(),identity(&path)?));}
 }
 if files.is_empty(){return Err("TELEMETRY_UNAVAILABLE".into())}
 let mut cursor=if let Some(value)=args.get("cursor"){
  let text=value.as_str().filter(|s|s.len()<=1024).ok_or("Invalid telemetry cursor")?;
  let bytes=URL_SAFE_NO_PAD.decode(text).map_err(|_|"Invalid telemetry cursor")?;
  let c:Cursor=serde_json::from_slice(&bytes).map_err(|_|"Invalid telemetry cursor")?;
  if c.version!=1||c.row>2000{return Err("Invalid telemetry cursor".into())}c
 }else{Cursor{version:1,file:files[0].1.clone(),offset:0,row:0}};
 let index=files.iter().position(|(_,id)|*id==cursor.file).ok_or("TELEMETRY_CURSOR_EXPIRED: log rotated out; restart and record the gap")?;
 let mut records=Vec::new();let mut bytes=0;let mut scanned=0;let mut live_tail=false;
 'files:for (path,id) in files.iter().skip(index){
  if cursor.file!=*id{cursor=Cursor{version:1,file:id.clone(),offset:0,row:0}}
  let mut file=File::open(path).map_err(|_|"TELEMETRY_FILE_UNAVAILABLE")?;
  if file_identity(&file)?!=*id{return Err("TELEMETRY_ROTATED_DURING_READ: retry the same cursor".into())}
  if cursor.offset>file.metadata().map_err(|_|"TELEMETRY_FILE_UNAVAILABLE")?.len(){return Err("TELEMETRY_CURSOR_EXPIRED: file truncated".into())}
  file.seek(SeekFrom::Start(cursor.offset)).map_err(|_|"TELEMETRY_SEEK_FAILED")?;let mut reader=BufReader::new(file);
  loop{
   let mut line=Vec::new();let n=(&mut reader).take(256_001).read_until(b'\n',&mut line).map_err(|_|"TELEMETRY_READ_FAILED")?;
   if n==0{live_tail=true;break}
   if n>256_000{return Err("TELEMETRY_BATCH_TOO_LARGE".into())}
   if !line.ends_with(b"\n"){live_tail=true;break 'files} // writer has not finished this batch
   live_tail=false;scanned+=1;
   let batch:Value=serde_json::from_slice(&line).map_err(|_|"TELEMETRY_BATCH_INVALID")?;
   let rows=batch["rows"].as_array().ok_or("TELEMETRY_BATCH_INVALID")?;
   if cursor.row>rows.len(){return Err("Invalid telemetry cursor row".into())}
   for (i,row) in rows.iter().enumerate().skip(cursor.row){
    cursor.row=i;
    if session.is_some_and(|s|batch["session"].as_str()!=Some(s)){continue}
    let record=json!({"session":batch["session"],"batchSequence":batch["batchSequence"],"dropped":batch["dropped"],"historyDropped":batch["historyDropped"],"row":row});
    let size=serde_json::to_vec(&record).map_err(|_|"TELEMETRY_BATCH_INVALID")?.len();
    if size>64_000{return Err("TELEMETRY_EVENT_TOO_LARGE: read raw log chunks".into())}
    if records.len()>=limit||bytes+size>64_000{break 'files}
    bytes+=size;records.push(record);cursor.row=i+1;
   }
   cursor.offset+=n as u64;cursor.row=0;
   if scanned>=4{break 'files}
  }
 }
 let next=URL_SAFE_NO_PAD.encode(serde_json::to_vec(&cursor).map_err(|_|"Cursor encoding failed")?);
 Ok(json!({"schema":"art-equation.events","version":1,"records":records,"nextCursor":next,"atTail":live_tail,"scannedBatches":scanned,"returnedBytes":bytes,"scope":"Durable recorded events; bounded reads, explicit expired-cursor error; timestamps are frontend monotonic time, not physical presentation","readOnly":true}))
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn replay_is_bounded_and_resumable_across_rotation(){
  let root=std::env::temp_dir().join(format!("ae-events-{}",uuid::Uuid::new_v4()));fs::create_dir_all(root.join("logs")).unwrap();
  let path=root.join("logs/performance.jsonl");let batch=json!({"session":"a","rows":[{"sequence":1},{"sequence":2},{"sequence":3}]});fs::write(&path,format!("{batch}\n")).unwrap();
  let a=read(&root,&json!({"limit":1})).unwrap();assert_eq!(a["records"][0]["row"]["sequence"],1);
  fs::rename(&path,root.join("logs/performance.previous.jsonl")).unwrap();fs::write(&path,"{\"session\":\"a\",\"rows\":[{\"sequence\":4}]}\n").unwrap();
  let b=read(&root,&json!({"cursor":a["nextCursor"],"limit":10})).unwrap();assert_eq!(b["records"].as_array().unwrap().len(),3);assert_eq!(b["records"][2]["row"]["sequence"],4);
  fs::remove_file(root.join("logs/performance.previous.jsonl")).unwrap();assert!(read(&root,&json!({"cursor":a["nextCursor"]})).unwrap_err().contains("EXPIRED"));
  for bad in [json!({"limit":0}),json!({"cursor":"bad"}),json!({"extra":true})]{assert!(read(&root,&bad).is_err())}
  fs::remove_dir_all(root).unwrap();
 }
}
