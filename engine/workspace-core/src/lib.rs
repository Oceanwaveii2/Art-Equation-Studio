//! P1.5 canonical incremental storage. One bounded native writer; physical board checkpoints.
pub mod session;
use rusqlite::{params,Connection,OptionalExtension,OpenFlags};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::{HashMap,HashSet},fs::{self,OpenOptions},io::Write,path::{Path,PathBuf},sync::{mpsc,OnceLock},time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
type Result<T> = std::result::Result<T,String>;
fn now()->u64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}
fn err(e:impl std::fmt::Display)->String{format!("Save storage: {e}")}
fn digest(bytes:&[u8])->String{Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect()}
pub fn asset_folder(extension:&str)->String{
 let ext=extension.to_ascii_lowercase();let (class,format)=match ext.as_str(){
 "jpg"|"jpeg"=>("Images","Jpg"),"tif"|"tiff"=>("Images","Tiff"),"psd"=>("Images","Psd"),"png"=>("Images","Png"),"webp"=>("Images","Webp"),"gif"=>("Images","Gif"),"svg"=>("Images","Svg"),"avif"=>("Images","Avif"),"bmp"=>("Images","Bmp"),"heic"=>("Images","Heic"),
 "mp4"=>("Video","Mp4"),"mkv"=>("Video","Mkv"),"mov"=>("Video","Mov"),"webm"=>("Video","Webm"),"avi"=>("Video","Avi"),
 "mp3"=>("Audio","Mp3"),"wav"=>("Audio","Wav"),"flac"=>("Audio","Flac"),"ogg"=>("Audio","Ogg"),
 "pdf"=>("Documents","Pdf"),"txt"=>("Documents","Txt"),"md"=>("Documents","Md"),"docx"=>("Documents","Docx"),"ttf"=>("Fonts","Ttf"),"otf"=>("Fonts","Otf"),"glb"=>("Models","Glb"),"gltf"=>("Models","Gltf"),"obj"=>("Models","Obj"),_=>return format!("Other/{}",if ext.chars().all(|c|c.is_ascii_alphanumeric())&&!ext.is_empty(){ext}else{"Unknown".into()})};format!("{class}/{format}")
}
fn id(value:&str)->Result<String>{validate_id(value,"Save ID")}
fn record_id(value:&str)->Result<String>{if value.is_empty()||value.len()>1024||value.chars().any(char::is_control){Err("Invalid stable record ID".into())}else{Ok(value.to_owned())}}
fn open(root:&Path)->Result<Connection>{
 fs::create_dir_all(root).map_err(err)?;
 let db=Connection::open(root.join("state.sqlite")).map_err(err)?;
 db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
 let mode:String=db.query_row("PRAGMA journal_mode=WAL",[],|r|r.get(0)).map_err(err)?;
 if mode!="wal"{return Err("This project filesystem cannot use WAL; use a local project folder.".into());}
 db.execute_batch("PRAGMA synchronous=NORMAL;PRAGMA wal_autocheckpoint=0;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,scope TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,scope,id));
 CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS edits(revision INTEGER PRIMARY KEY,at INTEGER NOT NULL,reason TEXT NOT NULL,changed INTEGER NOT NULL,payload_bytes INTEGER NOT NULL);
 PRAGMA user_version=1;").map_err(err)?;
 Ok(db)
}
fn ro(root:&Path)->Result<Connection>{
 let db=Connection::open_with_flags(root.join("state.sqlite"),OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
 db.busy_timeout(Duration::from_secs(5)).map_err(err)?;Ok(db)
}
fn db_state(db:&Connection,key:&str)->Result<Option<Value>>{
 let text:Option<String>=db.query_row("SELECT value FROM state WHERE key=?1",[key],|r|r.get(0)).optional().map_err(err)?;
 text.map(|s|serde_json::from_str(&s).map_err(err)).transpose()
}
fn set_state(db:&Connection,key:&str,v:&Value)->Result<()>{
 db.execute("INSERT INTO state VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,v.to_string()]).map_err(err)?;Ok(())
}
fn revision(db:&Connection)->Result<u64>{Ok(db_state(db,"revision")?.and_then(|v|v.as_u64()).unwrap_or(0))}
fn record(db:&Connection,kind:&str,scope:&str,id:&str)->Result<Value>{
 let text:String=db.query_row("SELECT value FROM records WHERE kind=?1 AND scope=?2 AND id=?3",params![kind,scope,id],|r|r.get(0)).map_err(err)?;
 serde_json::from_str(&text).map_err(err)
}
fn array_ids(value:&Value,key:&str)->Result<Vec<String>>{
 let a=value[key].as_array().ok_or_else(||format!("Missing {key} record order"))?;
 let mut found=HashSet::new();a.iter().map(|v|{let s=record_id(v.as_str().ok_or("Invalid ordered ID")?)?;if !found.insert(s.clone()){return Err("Duplicate ordered ID".into());}Ok(s)}).collect()
}
fn board(db:&Connection,board_id:&str)->Result<Value>{
 id(board_id)?;
 let meta=record(db,"board","",board_id)?;let mut value=meta["data"].clone();
 if value["id"]!=board_id{return Err("Board identity mismatch".into());}
 for (key,kind) in [("nodes","node"),("connectors","connector")]{
  let rows=array_ids(&meta,key)?.iter().map(|id|record(db,kind,board_id,id)).collect::<Result<Vec<_>>>()?;value[key]=json!(rows);
 }Ok(value)
}
pub fn read_project(root:&Path)->Result<Value>{
 if !root.join("state.sqlite").exists(){return legacy(root);}
 let db=ro(root)?;let tx=db.unchecked_transaction().map_err(err)?;if revision(&tx)?==0{return legacy(root);}assemble(&tx)
}
pub fn copy_database(source:&Path,destination:&Path)->Result<()>{
 let from=ro(source)?;let mut to=Connection::open(destination).map_err(err)?;
 {let backup=rusqlite::backup::Backup::new(&from,&mut to).map_err(err)?;backup.run_to_completion(256,Duration::from_millis(1),None).map_err(err)?;}
 let integrity:String=to.query_row("PRAGMA integrity_check",[],|r|r.get(0)).map_err(err)?;if integrity!="ok"{return Err("Collected database integrity failed".into());}drop(to);
 OpenOptions::new().read(true).write(true).open(destination).and_then(|f|f.sync_all()).map_err(err)
}
pub fn finalize_collection(root:&Path)->Result<Value>{
 if root.join("state.sqlite").exists(){let mut p=Project::new(root.to_path_buf())?;p.checkpoint()?;assemble(&p.db)}else{legacy(root)}
}
fn legacy(root:&Path)->Result<Value>{
 let p=root.join("project.json");let bytes=fs::read(&p).or_else(|_|fs::read(root.join("project.json.backup"))).map_err(err)?;
 serde_json::from_slice(&bytes).map_err(err)
}
fn assemble(db:&Connection)->Result<Value>{
 let meta=record(db,"project","","root")?;let mut project=meta["data"].clone();
 project["boards"]=json!(array_ids(&meta,"boards")?.iter().map(|id|board(db,id)).collect::<Result<Vec<_>>>()?);
 for (key,kind) in [("documents","document"),("assets","asset")]{project[key]=json!(array_ids(&meta,key)?.iter().map(|id|record(db,kind,"",id)).collect::<Result<Vec<_>>>()?);}
 Ok(project)
}
pub fn summary(root:&Path)->Result<Value>{
 if !root.join("state.sqlite").exists(){return legacy(root);}
 let db=ro(root)?;let tx=db.unchecked_transaction().map_err(err)?;if revision(&tx)?==0{return legacy(root);}let meta=record(&tx,"project","","root")?;let mut p=meta["data"].clone();
 let mut boards=vec![];for b in array_ids(&meta,"boards")?{let mut row=record(&tx,"board","",&b)?["data"].clone();
 let first:Option<String>=tx.query_row("SELECT value FROM records WHERE kind='node' AND scope=?1 AND json_extract(value,'$.kind')='image' LIMIT 1",[&b],|r|r.get(0)).optional().map_err(err)?;
 row["nodes"]=json!(first.and_then(|s|serde_json::from_str::<Value>(&s).ok()).into_iter().collect::<Vec<_>>());boards.push(row);}
 p["boards"]=json!(boards);p["assets"]=json!(array_ids(&meta,"assets")?.iter().map(|id|record(&tx,"asset","",id)).collect::<Result<Vec<_>>>()?);Ok(p)
}
fn full_records(p:&Value)->Result<Vec<Value>>{
 let project_id=id(p["id"].as_str().ok_or("Missing project ID")?)?;let mut meta=p.clone();let mut out=vec![];
 let ordered=|rows:&Value|->Result<Value>{let a=rows.as_array().ok_or("Missing collection")?;let mut found=HashSet::new();let mut ids=vec![];for r in a{let key=record_id(r["id"].as_str().ok_or("Missing record ID")?)?;if !found.insert(key.clone()){return Err("Duplicate record ID".into());}ids.push(key);}Ok(json!(ids))};
 for k in ["boards","documents","assets"]{meta.as_object_mut().ok_or("Invalid project")?.remove(k);}
 out.push(json!({"kind":"project","scope":"","id":project_id,"value":{"data":meta,"boards":ordered(&p["boards"])?,"documents":ordered(&p["documents"])?,"assets":ordered(&p["assets"])?}}));
 for b in p["boards"].as_array().ok_or("Missing boards")?{
  let mut data=b.clone();for k in ["nodes","connectors"]{data.as_object_mut().ok_or("Invalid board")?.remove(k);}
  out.push(json!({"kind":"board","scope":"","id":b["id"],"value":{"data":data,"nodes":ordered(&b["nodes"])?,"connectors":ordered(&b["connectors"])?}}));
  for (key,kind) in [("nodes","node"),("connectors","connector")]{for r in b[key].as_array().ok_or("Invalid board collection")?{out.push(json!({"kind":kind,"scope":b["id"],"id":r["id"],"value":r}));}}
 }
 for (key,kind) in [("documents","document"),("assets","asset")]{for r in p[key].as_array().ok_or("Invalid project collection")?{out.push(json!({"kind":kind,"scope":"","id":r["id"],"value":r}));}}Ok(out)
}
fn key(row:&Value,project_id:&str)->Result<(String,String,String)>{
 let kind=row["kind"].as_str().ok_or("Missing record kind")?;
 if !["project","board","node","connector","document","asset"].contains(&kind){return Err("Unsupported save record".into());}
 let scope=row["scope"].as_str().ok_or("Missing scope")?;let rid=record_id(row["id"].as_str().ok_or("Missing record ID")?)?;
 if kind=="board"||kind=="project"{id(&rid)?;}
 if ["node","connector"].contains(&kind){id(scope)?;}else if !scope.is_empty(){return Err("Invalid record scope".into());}
 if kind=="project"&&rid!=project_id{return Err("Project identity mismatch".into());}
 Ok((kind.into(),scope.into(),if kind=="project"{"root".into()}else{rid}))
}
#[cfg(windows)]
fn replace(from:&Path,to:&Path)->Result<()>{
 use std::os::windows::ffi::OsStrExt;
 #[link(name="kernel32")] unsafe extern "system"{fn MoveFileExW(from:*const u16,to:*const u16,flags:u32)->i32;}
 let a:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();let b:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
 if unsafe{MoveFileExW(a.as_ptr(),b.as_ptr(),0x1|0x8)}==0{return Err(err(std::io::Error::last_os_error()));}Ok(())
}
#[cfg(not(windows))]fn replace(from:&Path,to:&Path)->Result<()>{fs::rename(from,to).map_err(err)?;std::fs::File::open(to.parent().ok_or("Missing parent")?).and_then(|f|f.sync_all()).map_err(err)}
fn atomic(path:&Path,bytes:&[u8])->Result<()>{
 fs::create_dir_all(path.parent().ok_or("Missing save parent")?).map_err(err)?;
 let temp=path.with_extension(format!("{}.tmp",uuid::Uuid::new_v4()));let mut file=OpenOptions::new().write(true).create_new(true).open(&temp).map_err(err)?;
 file.write_all(bytes).and_then(|_|file.sync_all()).map_err(err)?;drop(file);replace(&temp,path)
}
struct Project{db:Connection,root:PathBuf,status:Value,dirty:HashSet<String>,organize_pending:bool,last_checkpoint:Instant,last_snapshot:Instant}
impl Project{
 fn new(root:PathBuf)->Result<Self>{
  let db=open(&root)?;let mut status=db_state(&db,"status")?.unwrap_or(json!({"projectRevision":0,"stateSavedAt":null,"projectFileSavedAt":null,"recoverySavedAt":null,"boardCheckpoints":{},"intervalMinutes":10}));
  status["projectRevision"]=json!(revision(&db)?);status["error"]=Value::Null;
  let mut dirty=HashSet::new();if let Ok(meta)=record(&db,"project","","root"){for b in array_ids(&meta,"boards")?{let rev=db_state(&db,&format!("board:{b}"))?.and_then(|v|v.as_u64()).unwrap_or(0);if status["boardCheckpoints"][&b]["revision"].as_u64()!=Some(rev){dirty.insert(b);}}}
  Ok(Self{db,root,status,dirty,organize_pending:true,last_checkpoint:Instant::now(),last_snapshot:Instant::now()})
 }
 fn commit(&mut self,project_id:&str,request:&Value)->Result<Value>{
  let start=Instant::now();let before=revision(&self.db)?;let base=request["baseRevision"].as_u64().ok_or("Missing base revision")?;
  if base!=before{return Err(format!("Save revision conflict: expected {before}, received {base}. Reload before retrying."));}
  let full=request.get("fullProject");if full.is_some()&&before!=0{return Err("Full migration is only allowed before a canonical revision exists".into());}
  let expanded=full.map(full_records).transpose()?;
  let puts=expanded.as_ref().or_else(||request["puts"].as_array()).ok_or("Missing save records")?;let deletes=request["deletes"].as_array().ok_or("Missing removals")?;
  if puts.len()+deletes.len()>200_000{return Err("Save batch exceeds record limit".into());}
  if before==0 && !self.root.join("migration-original/project.json").exists() && self.root.join("project.json").exists(){
   let original=fs::read(self.root.join("project.json")).map_err(err)?;atomic(&self.root.join("migration-original/project.json"),&original)?;
   atomic(&self.root.join("migration-original/receipt.json"),json!({"sha256":digest(&original),"at":now(),"role":"Preserved original, never canonical after migration"}).to_string().as_bytes())?;
  }
  let bytes=request.to_string().len();let mut changed=HashSet::new();let next=if puts.is_empty()&&deletes.is_empty(){before}else{before+1};
  let tx=self.db.transaction().map_err(err)?;
  for row in puts{
   let (kind,scope,rid)=key(row,project_id)?;let v=row.get("value").ok_or("Missing record value")?;
   if kind=="project"&&v["data"]["id"]!=project_id{return Err("Project metadata identity mismatch".into());}
   if kind!="project"&&if kind=="board"{v["data"]["id"]!=rid}else{v["id"]!=rid}{return Err("Record identity mismatch".into());}
   tx.execute("INSERT INTO records VALUES(?1,?2,?3,?4) ON CONFLICT(kind,scope,id) DO UPDATE SET value=excluded.value",params![kind,scope,rid,v.to_string()]).map_err(err)?;
   if kind=="board"{changed.insert(rid);}else if kind=="node"||kind=="connector"{changed.insert(scope);}
  }
  for row in deletes{let(k,s,i)=key(row,project_id)?;if k=="project"{return Err("Cannot remove project metadata".into());}
   tx.execute("DELETE FROM records WHERE kind=?1 AND scope=?2 AND id=?3",params![k,s,i]).map_err(err)?;
   if k=="board"{changed.insert(i);}else if k=="node"||k=="connector"{changed.insert(s);}
  }
  let meta=record(&tx,"project","","root")?;
  if meta["data"]["id"]!=project_id{return Err("Project identity not accepted".into());}
  let board_ids=array_ids(&meta,"boards")?;let all:HashSet<_>=board_ids.iter().cloned().collect();
  // Verify ordered references without reserializing the whole project on each edit.
  for (kind,scope,ids) in [("board","",board_ids),("document","",array_ids(&meta,"documents")?),("asset","",array_ids(&meta,"assets")?)]{
   for rid in ids{let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE kind=?1 AND scope=?2 AND id=?3)",params![kind,scope,rid],|r|r.get(0)).map_err(err)?;if !exists{return Err("Incomplete project record graph".into());}}
  }
  for b in changed.iter().filter(|b|all.contains(*b)){let m=record(&tx,"board","",b)?;for (field,kind) in [("nodes","node"),("connectors","connector")]{for rid in array_ids(&m,field)?{
   let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE kind=?1 AND scope=?2 AND id=?3)",params![kind,b,rid],|r|r.get(0)).map_err(err)?;if !exists{return Err("Incomplete board record graph".into());}
  }}set_state(&tx,&format!("board:{b}"),&json!(next))?;}
  if before==0{let imported=assemble(&tx)?;if let Some(original)=full.or_else(||request.get("verifyProject")){if &imported!=original{return Err("Migration round-trip differs from original".into());}}}
  let at=now();if next!=before{set_state(&tx,"revision",&json!(next))?;tx.execute("INSERT INTO edits VALUES(?1,?2,?3,?4,?5)",params![next as i64,at as i64,request["reason"].as_str().unwrap_or("edit"),(puts.len()+deletes.len()) as i64,bytes as i64]).map_err(err)?;}
  let mut accepted=self.status.clone();accepted["projectRevision"]=json!(next);accepted["stateSavedAt"]=json!(at);accepted["payloadBytes"]=json!(bytes);accepted["changedRecords"]=json!(puts.len()+deletes.len());accepted["error"]=Value::Null;
  set_state(&tx,"status",&accepted)?;tx.commit().map_err(err)?;
  self.status=accepted;self.dirty.extend(changed);self.dirty.retain(|b|all.contains(b));
  if puts.iter().chain(deletes).any(|r|r["kind"]=="asset"){self.organize_pending=true;}
  self.status["commitMs"]=json!(start.elapsed().as_secs_f64()*1000.0);self.status["pendingBoards"]=json!(self.dirty.len());
  log::info!("storage.commit revision={next} records={} payload_bytes={bytes} ms={:.2}",puts.len()+deletes.len(),start.elapsed().as_secs_f64()*1000.0);
  if request["checkpoint"].as_bool()==Some(true)||before==0{if let Err(e)=self.checkpoint(){self.status["error"]=json!(e);}}
  Ok(self.status.clone())
 }
 fn checkpoint(&mut self)->Result<Value>{
  if revision(&self.db)?==0{return Ok(self.status.clone());}
  let start=Instant::now();let project=record(&self.db,"project","","root")?;let boards=array_ids(&project,"boards")?;let mut accepted=self.status.clone();
  if self.organize_pending{self.organize_assets(&project)?;self.organize_pending=false;}
  for b in &boards{
   let rev=db_state(&self.db,&format!("board:{b}"))?.and_then(|v|v.as_u64()).unwrap_or(0);
   if self.dirty.contains(b)||accepted["boardCheckpoints"][b]["revision"].as_u64()!=Some(rev){
    let data=board(&self.db,b)?;let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"projectId":project["data"]["id"],"boardId":b,"revision":rev,"board":data})).map_err(err)?;
    let relative=format!("boards/{b}/saves/{rev}.board.json");let path=self.root.join(&relative);
    atomic(&path,&bytes)?;
    if serde_json::from_slice::<Value>(&fs::read(&path).map_err(err)?).map_err(err)?["board"]!=data{return Err("Board checkpoint verification failed".into());}
    atomic(&self.root.join(format!("boards/{b}/board.json")),&bytes)?;
    accepted["boardCheckpoints"][b]=json!({"revision":rev,"savedAt":now(),"path":relative,"sha256":digest(&bytes)});
   }
  }
  let keep:HashSet<_>=boards.iter().collect();if let Some(map)=accepted["boardCheckpoints"].as_object_mut(){map.retain(|id,_|keep.contains(id));}
  let mut portable=project.clone();
  for (field,kind) in [("documents","document"),("assets","asset")]{portable[field]=json!(array_ids(&project,field)?.iter().map(|id|record(&self.db,kind,"",id)).collect::<Result<Vec<_>>>()?);}
  let manifest=json!({"schemaVersion":1,"projectRevision":revision(&self.db)?,"savedAt":now(),"project":portable,"boardFiles":accepted["boardCheckpoints"]});
  atomic(&self.root.join("project.manifest.json"),&serde_json::to_vec_pretty(&manifest).map_err(err)?)?;
  accepted["projectFileSavedAt"]=manifest["savedAt"].clone();accepted["pendingBoards"]=json!(0);accepted["checkpointMs"]=json!(start.elapsed().as_secs_f64()*1000.0);accepted["error"]=Value::Null;
  set_state(&self.db,"status",&accepted)?;self.status=accepted;self.dirty.clear();self.last_checkpoint=Instant::now();
  self.db.execute_batch("PRAGMA wal_checkpoint(PASSIVE)").map_err(err)?;Ok(self.status.clone())
 }
 fn organize_assets(&self,meta:&Value)->Result<()>{
  let project_id=meta["data"]["id"].as_str().ok_or("Missing project identity")?;let prefix=format!("projects/{project_id}/");let canonical=self.root.canonicalize().map_err(err)?;let mut index=vec![];
  for asset_id in array_ids(meta,"assets")?{
   let asset=record(&self.db,"asset","",&asset_id)?;let Some(relative)=asset["relativePath"].as_str().and_then(|p|p.strip_prefix(&prefix))else{continue};
   let relative=validate_relative_path(relative)?;let source=self.root.join(relative);if !source.is_file(){continue;}
   let source=source.canonicalize().map_err(err)?;if !source.starts_with(&canonical){continue;}
   let ext=source.extension().and_then(|v|v.to_str()).unwrap_or("bin").to_ascii_lowercase();if !ext.chars().all(|c|c.is_ascii_alphanumeric())||ext.len()>16{continue;}
   let filename=id(&asset_id).unwrap_or_else(|_|format!("asset-{}",digest(asset_id.as_bytes())));let sorted=format!("{}/{}.{}",asset_folder(&ext),filename,ext);let target=self.root.join(&sorted);
   if source!=target{
    fs::create_dir_all(target.parent().ok_or("Missing asset folder")?).map_err(err)?;
    if target.exists(){if sha256_file(&target)?.0!=sha256_file(&source)?.0{return Err("Organized asset collision; original preserved".into());}}
    else if fs::hard_link(&source,&target).is_err(){let temp=target.with_extension(format!("{}.copying",uuid::Uuid::new_v4()));fs::copy(&source,&temp).map_err(err)?;OpenOptions::new().write(true).open(&temp).and_then(|f|f.sync_all()).map_err(err)?;replace(&temp,&target)?;}
   }
   index.push(json!({"id":asset_id,"source":asset["relativePath"],"organizedPath":format!("projects/{project_id}/{sorted}")}));
  }
  atomic(&self.root.join("asset-folders.json"),json!({"schemaVersion":1,"savedAt":now(),"assets":index,"policy":"Non-destructive class/format organization; existing references and originals retained"}).to_string().as_bytes())
 }
 fn recovery(&mut self)->Result<Value>{
  self.checkpoint()?;let rev=revision(&self.db)?;if rev==0{return Ok(self.status.clone());}
  let stamp=format!("{}-{rev}-{}",now(),uuid::Uuid::new_v4());let stage=self.root.join("recovery").join(format!(".staging-{stamp}"));fs::create_dir_all(&stage).map_err(err)?;
  let mut backup=Connection::open(stage.join("state.sqlite")).map_err(err)?;
  {let b=rusqlite::backup::Backup::new(&self.db,&mut backup).map_err(err)?;b.run_to_completion(256,Duration::from_millis(1),None).map_err(err)?;}
  let integrity:String=backup.query_row("PRAGMA integrity_check",[],|r|r.get(0)).map_err(err)?;if integrity!="ok"||revision(&backup)?!=rev{return Err("Recovery database verification failed".into());}drop(backup);
  OpenOptions::new().read(true).write(true).open(stage.join("state.sqlite")).and_then(|f|f.sync_all()).map_err(err)?;
  let manifest=fs::read(self.root.join("project.manifest.json")).map_err(err)?;atomic(&stage.join("project.manifest.json"),&manifest)?;
  let root=self.root.join("recovery").join(&stamp);replace(&stage,&root)?;
  let receipt=json!({"schemaVersion":1,"projectRevision":rev,"savedAt":now(),"path":format!("recovery/{stamp}"),"databaseSHA256":digest(&fs::read(root.join("state.sqlite")).map_err(err)?),"manifestSHA256":digest(&manifest)});
  atomic(&self.root.join("recovery/latest.json"),receipt.to_string().as_bytes())?;
  self.status["recoverySavedAt"]=receipt["savedAt"].clone();self.status["recoveryRevision"]=json!(rev);self.status["error"]=Value::Null;set_state(&self.db,"status",&self.status)?;self.last_snapshot=Instant::now();Ok(self.status.clone())
 }
}
struct Work{root:PathBuf,id:String,operation:String,value:Value,reply:mpsc::SyncSender<Result<Value>>}
struct Writer{send:mpsc::SyncSender<Work>}
static WRITER:OnceLock<Writer>=OnceLock::new();
fn writer()->&'static Writer{WRITER.get_or_init(||{
let(tx,rx)=mpsc::sync_channel::<Work>(256);
 std::thread::spawn(move||{
  let mut projects=HashMap::<PathBuf,Project>::new();
  loop{
   match rx.recv_timeout(Duration::from_millis(500)){
    Ok(work)=>{
     let result=(||{
      if work.operation=="close"{if let Some(mut p)=projects.remove(&work.root){p.recovery()?;}return Ok(json!({}));}
      if work.operation=="load"&&!work.root.join("state.sqlite").exists(){return Ok(json!({"project":legacy(&work.root)?,"revision":0}));}
      if work.operation=="status"&&!work.root.join("state.sqlite").exists(){return Ok(json!({"projectRevision":0,"stateSavedAt":null,"projectFileSavedAt":null,"boardCheckpoints":{},"recoverySavedAt":null,"pendingBoards":0,"intervalMinutes":10}));}
      if !projects.contains_key(&work.root){projects.insert(work.root.clone(),Project::new(work.root.clone())?);}
      let p=projects.get_mut(&work.root).unwrap();
      match work.operation.as_str(){
       "commit"=>p.commit(&work.id,&work.value),
       "load"=>Ok(json!({"project":if revision(&p.db)?==0{legacy(&p.root)?}else{assemble(&p.db)?},"revision":revision(&p.db)?})),
       "status"=>{p.status["pendingBoards"]=json!(p.dirty.len());Ok(p.status.clone())},
       "checkpoint"=>p.checkpoint(),"recovery"=>p.recovery(),
       "configure"=>{let n=work.value["intervalMinutes"].as_u64().filter(|n|(1..=1440).contains(n)).ok_or("Recovery interval must be 1â€“1440 minutes")?;p.status["intervalMinutes"]=json!(n);set_state(&p.db,"status",&p.status)?;Ok(p.status.clone())},
       _=>Err("Unknown storage operation".into())
      }
     })();
     if let Err(ref e)=result{if let Some(p)=projects.get_mut(&work.root){p.status["error"]=json!(e);}log::warn!("storage.failure {e}");}
     let _=work.reply.send(result);
    },Err(mpsc::RecvTimeoutError::Disconnected)=>break,Err(mpsc::RecvTimeoutError::Timeout)=>{}
   }
   for p in projects.values_mut(){
    let job=if p.last_snapshot.elapsed()>=Duration::from_secs(p.status["intervalMinutes"].as_u64().unwrap_or(10)*60){Some(true)}else if !p.dirty.is_empty()&&p.last_checkpoint.elapsed()>=Duration::from_secs(5){Some(false)}else{None};
    if let Some(recovery)=job{let result=if recovery{p.recovery()}else{p.checkpoint()};if let Err(e)=result{p.status["error"]=json!(e);p.last_checkpoint=Instant::now();p.last_snapshot=Instant::now();log::warn!("storage.checkpoint_failure {e}");}}
   }
  }
 });Writer{send:tx}
})}
pub fn request(root:PathBuf,project_id:String,operation:&str,value:Value)->Result<Value>{
 // Windows extended and ordinary spellings must address one writer entry.
 // Otherwise closing a native session can leave an alias writer holding its DB.
 fs::create_dir_all(&root).map_err(err)?;
 let root=root.canonicalize().map_err(err)?;
 let(tx,rx)=mpsc::sync_channel(1);writer().send.try_send(Work{root,id:project_id,operation:operation.into(),value,reply:tx}).map_err(|_|"Save writer is busy; pending edit was not acknowledged. Retry.".to_owned())?;
 rx.recv().map_err(|_|"Save writer stopped".to_owned())?
}
pub fn full_save(root:PathBuf,project_id:String,project:Value)->Result<Value>{
 let revision=if root.join("state.sqlite").exists(){revision(&ro(&root)?)?}else{0};
 let puts=full_records(&project)?;
 request(root,project_id.clone(),"commit",json!({"projectId":project_id,"baseRevision":revision,"puts":puts,"deletes":[],"verifyProject":project,"reason":"legacy-or-import","checkpoint":true}))
}

#[cfg(test)]mod tests{
 use super::*;

 #[test]fn original_stress_corpus_preserves_caption_ids_and_complete_semantics(){
  let path=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/workspace/projects/p1-v2-studies/project.json");let original:Value=serde_json::from_slice(&fs::read(path).unwrap()).unwrap();let project_id=original["id"].as_str().unwrap();
  let mut p=Project::new(root()).unwrap();let ack=p.commit(project_id,&json!({"baseRevision":0,"fullProject":original,"puts":[],"deletes":[],"checkpoint":true})).unwrap();
  assert!(ack["error"].is_null(),"{ack}");assert_eq!(assemble(&p.db).unwrap(),original);assert_eq!(p.status["boardCheckpoints"].as_object().unwrap().len(),original["boards"].as_array().unwrap().len());
  assert!(original["boards"].as_array().unwrap().iter().flat_map(|b|b["nodes"].as_array().unwrap()).any(|n|n["id"].as_str().unwrap().contains(':')));
 }

 fn fixture()->Value{json!({"id":"p","title":"Original","updatedAt":"initial","boards":[{"id":"b","title":"Board","nodes":[{"id":"n","kind":"note","x":0,"body":"Text"}],"connectors":[],"viewport":{"x":0,"y":0,"scale":1},"drawing":{"layers":[{"id":"l"}]}}],"documents":[{"id":"d","content":{"text":"authored"}}],"assets":[{"id":"a","relativePath":"projects/p/Images/Jpg/a.jpg"}],"other":{"retained":true}})}
 fn root()->PathBuf{let p=std::env::temp_dir().join(format!("ae-p15-{}",uuid::Uuid::new_v4()));fs::create_dir_all(&p).unwrap();p}
 fn initial(p:&mut Project,value:&Value)->Value{p.commit("p",&json!({"baseRevision":0,"puts":full_records(value).unwrap(),"deletes":[],"verifyProject":value,"checkpoint":true})).unwrap()}
 fn edit(p:&mut Project,x:i64)->Result<Value>{p.commit("p",&json!({"baseRevision":revision(&p.db)?,"puts":[{"kind":"node","scope":"b","id":"n","value":{"id":"n","kind":"note","x":x,"body":"Text"}}],"deletes":[],"reason":"move-node"}))}
 #[test]fn migration_increment_reopen_and_physical_checkpoints(){
  let root=root();let original=fixture();fs::write(root.join("project.json"),original.to_string()).unwrap();let original_hash=digest(&fs::read(root.join("project.json")).unwrap());
  let mut p=Project::new(root.clone()).unwrap();let first=initial(&mut p,&original);assert_eq!(assemble(&p.db).unwrap(),original);assert!(first["error"].is_null());assert_eq!(first["boardCheckpoints"]["b"]["revision"],1);
  let ack=edit(&mut p,42).unwrap();assert_eq!(ack["projectRevision"],2);assert_eq!(ack["boardCheckpoints"]["b"]["revision"],1);assert!(ack["payloadBytes"].as_u64().unwrap()<1000);
  assert!(p.commit("p",&json!({"baseRevision":1,"puts":[],"deletes":[]})).is_err());assert_eq!(revision(&p.db).unwrap(),2);
  p.checkpoint().unwrap();assert_eq!(p.status["boardCheckpoints"]["b"]["revision"],2);p.recovery().unwrap();assert_eq!(p.status["recoveryRevision"],2);
  let latest:Value=serde_json::from_slice(&fs::read(root.join("recovery/latest.json")).unwrap()).unwrap();let recovered=root.join(latest["path"].as_str().unwrap());assert_eq!(read_project(&recovered).unwrap()["boards"][0]["nodes"][0]["x"],42);
  drop(p);assert_eq!(read_project(&root).unwrap()["boards"][0]["nodes"][0]["x"],42);assert_eq!(digest(&fs::read(root.join("project.json")).unwrap()),original_hash);assert_eq!(digest(&fs::read(root.join("migration-original/project.json")).unwrap()),original_hash);
 }
 #[test]fn failed_checkpoint_does_not_erase_committed_state_or_claim_physical_success(){
  let root=root();let mut p=Project::new(root.clone()).unwrap();initial(&mut p,&fixture());let before=p.status["boardCheckpoints"]["b"].clone();
  // Create a directory where the next immutable save file must go: real IO failure.
  fs::create_dir(root.join("boards/b/saves/2.board.json")).unwrap();
  let mut request=json!({"baseRevision":1,"puts":[{"kind":"node","scope":"b","id":"n","value":{"id":"n","kind":"note","x":12}}],"deletes":[],"checkpoint":true});
  let ack=p.commit("p",&request).unwrap();assert_eq!(ack["projectRevision"],2);assert!(ack["error"].is_string());assert_eq!(ack["boardCheckpoints"]["b"],before);assert!(p.dirty.contains("b"));
  fs::remove_dir(root.join("boards/b/saves/2.board.json")).unwrap();request["baseRevision"]=json!(2);request["puts"]=json!([]);
  let recovered=p.commit("p",&request).unwrap();assert!(recovered["error"].is_null());assert_eq!(recovered["boardCheckpoints"]["b"]["revision"],2);
 }
 #[test]fn malformed_graph_and_sqlite_full_roll_back_the_entire_edit(){
  let mut p=Project::new(root()).unwrap();initial(&mut p,&fixture());let before=assemble(&p.db).unwrap();
  assert!(p.commit("p",&json!({"baseRevision":1,"puts":[],"deletes":[{"kind":"node","scope":"b","id":"n"}]})).is_err());assert_eq!(assemble(&p.db).unwrap(),before);assert_eq!(revision(&p.db).unwrap(),1);
  let pages:i64=p.db.query_row("PRAGMA page_count",[],|r|r.get(0)).unwrap();p.db.pragma_update(None,"max_page_count",pages).unwrap();
  let full=p.commit("p",&json!({"baseRevision":1,"puts":[{"kind":"node","scope":"b","id":"n","value":{"id":"n","kind":"note","body":"X".repeat(2_000_000)}}],"deletes":[]}));
  assert!(full.unwrap_err().contains("full"));assert_eq!(revision(&p.db).unwrap(),1);assert_eq!(assemble(&p.db).unwrap(),before);
 }
 #[test]fn atomic_replacement_keeps_a_complete_json_file(){
  let root=root();let target=root.join("manifest.json");atomic(&target,br#"{"version":1}"#).unwrap();atomic(&target,br#"{"version":2}"#).unwrap();assert_eq!(serde_json::from_slice::<Value>(&fs::read(target).unwrap()).unwrap()["version"],2);
 }
 #[test]fn crash_child(){
  let Ok(path)=std::env::var("AE_P15_CRASH_TEST")else{return};let mut p=Project::new(PathBuf::from(path)).unwrap();initial(&mut p,&fixture());edit(&mut p,73).unwrap();
  std::process::exit(9); // No destructors, no explicit checkpoint after acknowledgement.
 }
 #[test]fn abrupt_process_exit_preserves_acknowledged_wal_edit(){
  let root=root();let child=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","tests::crash_child","--nocapture"]).env("AE_P15_CRASH_TEST",&root).status().unwrap();assert_eq!(child.code(),Some(9));
  let recovered=read_project(&root).unwrap();assert_eq!(recovered["boards"][0]["nodes"][0]["x"],73);let p=Project::new(root).unwrap();assert!(p.dirty.contains("b"));assert_eq!(p.status["projectRevision"],2);assert_eq!(p.status["boardCheckpoints"]["b"]["revision"],1);
 }
}



// Host-independent validation; the native writer cannot depend on a WebView.
pub fn validate_id(value:&str,label:&str)->Result<String>{
 let value=value.trim();if value.is_empty()||value.len()>80||!value.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'||c=='_'){return Err(format!("{label} must contain only letters, numbers, hyphens, or underscores"))}Ok(value.to_owned())
}
fn validate_relative_path(value:&str)->Result<PathBuf>{
 let path=Path::new(value);if value.trim().is_empty()||path.is_absolute(){return Err("Workspace paths must be non-empty relative paths".into())}
 if path.components().any(|c|matches!(c,std::path::Component::ParentDir|std::path::Component::RootDir|std::path::Component::Prefix(_))){return Err("Workspace paths cannot escape the portable workspace".into())}Ok(path.to_owned())
}
fn sha256_file(path:&Path)->Result<(String,u64)>{
 use std::io::Read;
 let mut file=fs::File::open(path).map_err(err)?;let size=file.metadata().map_err(err)?.len();let mut hash=Sha256::new();let mut buffer=[0u8;1024*1024];loop{let count=file.read(&mut buffer).map_err(err)?;if count==0{break}hash.update(&buffer[..count]);}Ok((hash.finalize().iter().map(|b|format!("{b:02x}")).collect(),size))
}
/// Read without creating a database or starting a writer for a locked workspace.
pub fn read_only(root:&Path,operation:&str)->Result<Value>{
 if operation=="load"{Ok(json!({"project":read_project(root)?,"revision":if root.join("state.sqlite").exists(){revision(&ro(root)?)?}else{0}}))}
 else if operation=="status"{if root.join("state.sqlite").exists(){Ok(db_state(&ro(root)?,"status")?.unwrap_or(json!({})))}else{Ok(json!({"projectRevision":0}))}}
 else{Err("Read-only workspace cannot execute storage writes".into())}
}
