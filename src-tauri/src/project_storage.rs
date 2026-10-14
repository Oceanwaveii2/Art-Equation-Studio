//! Compatibility adapter for the existing UI. Canonical storage lives in the native core.
pub use art_equation_workspace_core::{asset_folder,copy_database,finalize_collection,full_save,read_project,request,summary,validate_id};
use serde_json::{json,Value};
use tauri::{State,WebviewWindow};
type Result<T> = std::result::Result<T,String>;
fn err(e:impl std::fmt::Display)->String{format!("Save storage: {e}")}
async fn command(window:WebviewWindow,state:State<'_,super::WorkspaceState>,project_id:String,operation:&'static str,value:Value,write:bool)->Result<Value>{
 if window.label()!="main"{return Err("Main workspace owns storage".into());}
 if write&&state.read_only{return Err("This workspace is read-only".into());}
 let project_id=validate_id(&project_id,"Save ID")?;let root=super::project_root(&state.root,&project_id)?;
 if state.read_only{return tauri::async_runtime::spawn_blocking(move||{
  art_equation_workspace_core::read_only(&root,operation)
 }).await.map_err(err)?;}
 tauri::async_runtime::spawn_blocking(move||request(root,project_id,operation,value)).await.map_err(err)?
}
#[tauri::command]pub async fn project_storage_load(window:WebviewWindow,state:State<'_,super::WorkspaceState>,project_id:String)->Result<Value>{command(window,state,project_id,"load",json!({}),false).await}
#[tauri::command]pub async fn project_storage_commit(window:WebviewWindow,state:State<'_,super::WorkspaceState>,delta:Value)->Result<Value>{let project_id=delta["projectId"].as_str().ok_or("Missing project ID")?.to_owned();command(window,state,project_id,"commit",delta,true).await}
#[tauri::command]pub async fn project_storage_status(window:WebviewWindow,state:State<'_,super::WorkspaceState>,project_id:String)->Result<Value>{command(window,state,project_id,"status",json!({}),false).await}
#[tauri::command]pub async fn project_storage_snapshot(window:WebviewWindow,state:State<'_,super::WorkspaceState>,project_id:String)->Result<Value>{command(window,state,project_id,"recovery",json!({}),true).await}
#[tauri::command]pub async fn project_storage_configure(window:WebviewWindow,state:State<'_,super::WorkspaceState>,project_id:String,interval_minutes:u64)->Result<Value>{command(window,state,project_id,"configure",json!({"intervalMinutes":interval_minutes}),true).await}
