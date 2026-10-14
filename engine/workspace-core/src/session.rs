//! One native workspace owner. Rendering and storage share this process;
//! commands never require a WebView or a browser's document state.
use std::{fs::{self,File,OpenOptions},io::Write,path::{Path,PathBuf}};
use serde_json::{json,Value};
use crate::{request,read_only,validate_id};

pub struct WorkspaceSession { root:PathBuf, project:PathBuf, id:String, lock:Option<File>, lock_path:PathBuf }
impl WorkspaceSession {
 pub fn open(root:&Path,id:&str,writable:bool)->Result<Self,String>{
  let root=root.canonicalize().map_err(|e|e.to_string())?;
  let id=validate_id(id,"Project ID")?;
  let project=root.join("projects").join(&id).canonicalize().map_err(|e|e.to_string())?;
  if !project.starts_with(&root){return Err("Project path escapes the workspace".into())}
  let lock_path=root.join(".art-equation.workspace.lock");
  let lock=if writable{
   let mut options=OpenOptions::new();options.write(true).create_new(true);
   #[cfg(windows)] {use std::os::windows::fs::OpenOptionsExt;options.share_mode(0);}
   let mut file=options.open(&lock_path).map_err(|e|format!("Native workspace already owned or unavailable: {e}"))?;
   if let Err(e)=writeln!(file,"pid={}\nhost=native-wgpu",std::process::id()).and_then(|_|file.sync_all()){
    drop(file);let _=fs::remove_file(&lock_path);return Err(e.to_string())
   }
   Some(file)
  }else{None};
  Ok(Self{root,project,id,lock,lock_path})
 }
 pub fn info(&self)->Value {json!({"root":self.root,"projectId":self.id,"readOnly":self.lock.is_none(),"lockOwned":self.lock.is_some(),"dom":false,"webview":false})}
 pub fn execute(&self,operation:&str,value:Value)->Result<Value,String>{
  if !matches!(operation,"load"|"status"|"commit"|"checkpoint"|"recovery"|"configure"){return Err("Unsupported native storage operation".into())}
  if self.lock.is_none(){return read_only(&self.project,operation)}
  if operation=="commit"&&value["projectId"].as_str()!=Some(self.id.as_str()){return Err("Commit project does not match native workspace".into())}
  request(self.project.clone(),self.id.clone(),operation,value)
 }
}
impl Drop for WorkspaceSession {
 fn drop(&mut self){if self.lock.is_some(){let _=request(self.project.clone(),self.id.clone(),"close",json!({}));drop(self.lock.take());let _=fs::remove_file(&self.lock_path);}}
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn single_native_owner_incremental_edit_reopen_and_read_only(){
  let root=std::env::temp_dir().join(format!("ae-native-session-{}",uuid::Uuid::new_v4()));let project=root.join("projects/p");fs::create_dir_all(&project).unwrap();
  let original=json!({"id":"p","boards":[{"id":"b","nodes":[{"id":"n","kind":"note","x":0,"body":"Original"}],"connectors":[]}],"documents":[],"assets":[]});
  fs::write(project.join("project.json"),original.to_string()).unwrap();
  let writer=WorkspaceSession::open(&root,"p",true).unwrap();
  assert!(WorkspaceSession::open(&root,"p",true).is_err());
  let initial=writer.execute("load",json!({})).unwrap();assert_eq!(initial["project"],original);
  crate::full_save(project.clone(),"p".into(),original.clone()).unwrap();
  let reader=WorkspaceSession::open(&root,"p",false).unwrap();assert!(reader.execute("commit",json!({})).is_err());assert!(reader.info()["readOnly"].as_bool().unwrap());
  assert!(writer.execute("commit",json!({"projectId":"other"})).is_err());
  let receipt=writer.execute("commit",json!({"projectId":"p","baseRevision":1,"puts":[{"kind":"node","scope":"b","id":"n","value":{"id":"n","kind":"note","x":24,"body":"Original"}}],"deletes":[],"reason":"native-drag"})).unwrap();assert_eq!(receipt["projectRevision"],2);
  assert!(writer.execute("commit",json!({"projectId":"p","baseRevision":1,"puts":[],"deletes":[]})).is_err());
  drop(reader);drop(writer);assert!(!root.join(".art-equation.workspace.lock").exists());
  let reopened=WorkspaceSession::open(&root,"p",true).unwrap();assert_eq!(reopened.execute("load",json!({})).unwrap()["project"]["boards"][0]["nodes"][0]["x"],24);
  drop(reopened);assert!(!root.join(".art-equation.workspace.lock").exists());
  fs::remove_dir_all(&root).unwrap();
 }
}
