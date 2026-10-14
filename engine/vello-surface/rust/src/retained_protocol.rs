//! Ordered render-display-list patches; canonical document/history stay external.
use serde::Deserialize;
use serde_json::Value;
#[derive(Debug)]
pub struct RetainedScene { pub revision:u32, pub json:String, value:Value }
#[derive(Deserialize)]#[serde(deny_unknown_fields)]
struct Patch { start:usize, delete_count:usize, insert:Vec<Value>, metadata:Value }
impl RetainedScene {
 pub fn load(json:&str,previous:u32)->Result<Self,String>{
  let value=crate::parse_snapshot(json)?;
  Self::validated(value,previous)
 }
 fn validated(mut value:Value,previous:u32)->Result<Self,String>{
  let revision=previous.checked_add(1).ok_or("RETAINED_REVISION_EXHAUSTED")?;
  value["revision"]=Value::String(revision.to_string());
  let json=serde_json::to_string(&value).map_err(|e|e.to_string())?;
  let parsed=crate::parse_snapshot(&json)?;
  crate::prepared_scene::prepare_snapshot(&parsed)?;
  Ok(Self{revision,json,value})
 }
 pub fn patch(&self,json:&str,expected:u32)->Result<Self,String>{
  if expected!=self.revision{return Err("RETAINED_REVISION_MISMATCH".into())}
  if json.len()>crate::MAX_SNAPSHOT_BYTES{return Err("RETAINED_PATCH_TOO_LARGE".into())}
  let patch:Patch=serde_json::from_str(json).map_err(|_|"RETAINED_PATCH_INVALID")?;
  let metadata=patch.metadata.as_object().ok_or("RETAINED_PATCH_INVALID")?;
  if metadata.contains_key("operations")||metadata.contains_key("revision"){return Err("RETAINED_PATCH_INVALID".into())}
  let mut next=self.value.clone();
  let operations=next["operations"].as_array_mut().ok_or("RETAINED_OPERATIONS_REQUIRED")?;
  let end=patch.start.checked_add(patch.delete_count).filter(|e|*e<=operations.len()).ok_or("RETAINED_PATCH_RANGE")?;
  operations.splice(patch.start..end,patch.insert);
  // Replace top-level metadata exactly; old resources/settings cannot leak.
  let operations=next["operations"].take();next=patch.metadata;next["operations"]=operations;
  Self::validated(next,self.revision)
 }
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn patches_are_atomic_and_revision_checked(){
  let json=r##"{"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"a","revision":"1","environment":{"background":"#000000ff","colorSpace":"srgb"},"resources":[],"operations":[]}"##;
  let current=RetainedScene::load(json,0).unwrap();
  assert!(current.patch("{}",0).unwrap_err().contains("REVISION"));
  assert!(current.patch(r#"{"start":2,"delete_count":0,"insert":[],"metadata":{}}"#,1).is_err());
  let mut metadata:Value=serde_json::from_str(json).unwrap();metadata.as_object_mut().unwrap().remove("revision");metadata.as_object_mut().unwrap().remove("operations");
  let patch=serde_json::json!({"start":0,"delete_count":0,"insert":[],"metadata":metadata});
  let next=current.patch(&patch.to_string(),1).unwrap();assert_eq!(next.revision,2);assert_eq!(current.revision,1);
 }
}
