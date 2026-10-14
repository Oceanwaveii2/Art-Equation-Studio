//! Read-only installed-font resolution through Fontique's Windows font backend.
//! The caller supplies family/face attributes, never an arbitrary file path.
use fontique::{Collection, CollectionOptions, FontStyle, FontWeight, FontWidth, SourceKind, GenericFamily, Script, FallbackKey};
use serde::{Deserialize, Serialize};
use base64::Engine;
use sha2::{Digest, Sha256};
use skrifa::{FontRef, MetadataProvider};
use std::{collections::BTreeSet, io::Read, sync::{Mutex, OnceLock}};

const MAX_FONT_BYTES: u64 = 32 * 1024 * 1024;
static COLLECTION: OnceLock<Mutex<Collection>> = OnceLock::new();

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct FontResolveRequest {
    pub family: String,
    pub weight: f32,
    pub italic: bool,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct FontFallbackRequest {
    pub families: Vec<String>, pub text: String, pub weight: f32, pub italic: bool,
    pub locale: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct FontFallbackReceipt {
    pub families: Vec<String>, pub uncovered_code_points: Vec<u32>, pub method: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ResolvedFont {
    pub requested_family: String,
    pub resolved_family: String,
    pub requested_weight: f32,
    pub resolved_weight: f32,
    pub resolved_style: String,
    pub face_index: u32,
    pub content_hash: String,
    pub file_identity: String,
    pub axes: Vec<FontAxis>,
    pub synthesis_required: bool,
    // Bounded binary transport avoids one JSON number allocation per font byte.
    #[serde(rename="bytesBase64", serialize_with="serialize_font_bytes")]
    pub bytes: Vec<u8>,
}
fn serialize_font_bytes<S:serde::Serializer>(bytes:&[u8], serializer:S)->Result<S::Ok,S::Error> {
    serializer.serialize_str(&base64::engine::general_purpose::STANDARD.encode(bytes))
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct FontAxis { pub tag:String, pub minimum:f32, pub default:f32, pub maximum:f32 }

pub fn resolve(request:FontResolveRequest)->Result<ResolvedFont,String> {
    if request.family.trim().is_empty()||request.family.len()>256||!request.weight.is_finite()||!(1.0..=1000.0).contains(&request.weight) {
        return Err("FONT_INPUT_INVALID: family/weight".into());
    }
    let database=COLLECTION.get_or_init(||Mutex::new(Collection::new(CollectionOptions{shared:false,system_fonts:true})));
    let mut database=database.lock().map_err(|_|"FONT_RESOLVER_FAILED: font database lock")?;
    let family=if let Some(generic)=GenericFamily::parse(request.family.trim()) {
        let id=database.generic_families(generic).next().ok_or_else(||format!("FONT_FAMILY_NOT_FOUND: {}",request.family))?;
        database.family(id).ok_or_else(||format!("FONT_FAMILY_NOT_FOUND: {}",request.family))?
    }else {database.family_by_name(request.family.trim()).ok_or_else(||format!("FONT_FAMILY_NOT_FOUND: {}",request.family))?};
    let style=if request.italic {FontStyle::Italic}else{FontStyle::Normal};
    let face=family.match_font(FontWidth::NORMAL,style,FontWeight::new(request.weight),true)
        .ok_or_else(||format!("FONT_FACE_NOT_FOUND: {}",request.family))?;
    let (identity,bytes)=match face.source().kind() {
        SourceKind::Path(path)=>{
            let mut file=std::fs::File::open(path).map_err(|e|format!("FONT_FILE_UNAVAILABLE: {e}"))?;
            let length=file.metadata().map_err(|e|format!("FONT_FILE_UNAVAILABLE: {e}"))?.len();
            if length==0||length>MAX_FONT_BYTES {return Err("FONT_RESOURCE_LIMIT: 32 MiB font payload".into());}
            let mut bytes=Vec::with_capacity(length as usize);
            (&mut file).take(MAX_FONT_BYTES+1).read_to_end(&mut bytes).map_err(|e|format!("FONT_FILE_UNAVAILABLE: {e}"))?;
            if bytes.len() as u64!=length {return Err("FONT_FILE_CHANGED: byte count changed while reading".into());}
            // The returned identity is informational. It is never accepted as an
            // input path, nor used as a content identity by the canvas registry.
            (path.to_string_lossy().into_owned(),bytes)
        },
        SourceKind::Memory(blob)=>{
            if blob.as_ref().is_empty()||blob.as_ref().len() as u64>MAX_FONT_BYTES{return Err("FONT_RESOURCE_LIMIT: font payload".into());}
            (format!("installed-memory:{}",blob.id()),blob.as_ref().to_vec())
        },
    };
    let font=FontRef::from_index(&bytes,face.index()).map_err(|e|format!("FONT_INVALID: {e}"))?;
    let axes=font.axes().iter().map(|a|FontAxis{tag:a.tag().to_string(),minimum:a.min_value(),default:a.default_value(),maximum:a.max_value()}).collect();
    let synth=face.synthesis(FontWidth::NORMAL,style,FontWeight::new(request.weight));
    Ok(ResolvedFont{requested_family:request.family,resolved_family:family.name().into(),requested_weight:request.weight,
        resolved_weight:face.weight().value(),resolved_style:format!("{}",face.style()),face_index:face.index(),
        content_hash:Sha256::digest(&bytes).iter().map(|byte|format!("{byte:02x}")).collect(),file_identity:identity,axes,
        synthesis_required:synth.embolden()||synth.skew().is_some(),bytes})
}

/// Fontique delegates script/locale fallback to the installed platform backend
/// (DirectWrite on Windows). Nominal coverage only chooses real candidate
/// files: contextual shaping remains Parley/HarfRust's responsibility.
pub fn resolve_fallbacks(request:FontFallbackRequest)->Result<FontFallbackReceipt,String> {
    if request.families.is_empty() || request.families.len()>32 || request.families.iter().any(|f|f.trim().is_empty()||f.len()>256)
        || request.text.is_empty() || request.text.len()>32768 || !request.weight.is_finite() || !(1.0..=1000.0).contains(&request.weight)
        || request.locale.as_ref().is_some_and(|locale|locale.is_empty()||locale.len()>128) {
        return Err("FONT_INPUT_INVALID: bounded fallback request".into());
    }
    let mut missing:BTreeSet<char>=request.text.chars().filter(|c|!c.is_control()&&!c.is_whitespace()).collect();
    let cover=|face:&ResolvedFont, missing:&mut BTreeSet<char>|->Result<(),String>{
        let font=FontRef::from_index(&face.bytes,face.face_index).map_err(|e|format!("FONT_INVALID: {e}"))?;
        let charmap=font.charmap();missing.retain(|c|charmap.map(*c).is_none());Ok(())
    };
    for family in &request.families {
        match resolve(FontResolveRequest{family:family.clone(),weight:request.weight,italic:request.italic}) {
            Ok(face)=>cover(&face,&mut missing)?,
            Err(error) if error.starts_with("FONT_FAMILY_NOT_FOUND")=>{},
            Err(error)=>return Err(error),
        }
    }
    let scripts=icu_properties::CodePointMapData::<icu_properties::props::Script>::new();
    let names=icu_properties::PropertyNamesShort::<icu_properties::props::Script>::new();
    let mut candidates=Vec::new();let mut visited=BTreeSet::new();
    for c in &missing {
        let Some(name)=names.get(scripts.get(*c)) else {continue};
        if name.len()!=4 || !visited.insert(name.to_string()) {continue;}
        let mut tag=[0u8;4];tag.copy_from_slice(name.as_bytes());
        let key=match request.locale.as_deref(){Some(locale)=>FallbackKey::from((Script::from_bytes(tag),locale)),None=>FallbackKey::new(Script::from_bytes(tag),None)};
        let database=COLLECTION.get_or_init(||Mutex::new(Collection::new(CollectionOptions{shared:false,system_fonts:true})));
        let mut database=database.lock().map_err(|_|"FONT_RESOLVER_FAILED: font database lock")?;
        let ids:Vec<_>=database.fallback_families(key).take(32).collect();
        for id in ids {if let Some(family)=database.family(id) {let name=family.name().to_string();if !candidates.contains(&name){candidates.push(name);}}}
    }
    let mut selected=Vec::new();
    for family in candidates {
        if missing.is_empty(){break;}
        if selected.len()>=16{return Err("FONT_RESOURCE_LIMIT: fallback face count".into());}
        let face=resolve(FontResolveRequest{family:family.clone(),weight:request.weight,italic:request.italic})?;
        if face.synthesis_required {continue;}
        let before=missing.len();cover(&face,&mut missing)?;if missing.len()!=before{selected.push(family);}
    }
    Ok(FontFallbackReceipt{families:selected,uncovered_code_points:missing.into_iter().map(|c|c as u32).collect(),method:"fontique-native-script-locale-fallback-with-actual-face-coverage"})
}

#[tauri::command]
pub async fn resolve_system_font(request:FontResolveRequest)->Result<ResolvedFont,String> {
    tauri::async_runtime::spawn_blocking(move||resolve(request)).await.map_err(|e|format!("FONT_RESOLVER_FAILED: {e}"))?
}
#[tauri::command]
pub async fn resolve_system_font_fallbacks(request:FontFallbackRequest)->Result<FontFallbackReceipt,String> {
    tauri::async_runtime::spawn_blocking(move||resolve_fallbacks(request)).await.map_err(|e|format!("FONT_RESOLVER_FAILED: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn malformed_request_is_rejected_before_discovery() {
        for weight in [f32::NAN,0.0,1001.0] {assert!(resolve(FontResolveRequest{family:"Arial".into(),weight,italic:false}).is_err());}
        assert!(resolve(FontResolveRequest{family:"".into(),weight:400.,italic:false}).is_err());
    }
    #[cfg(windows)]
    #[test] fn generic_family_reports_the_actual_platform_face() {
        let font=resolve(FontResolveRequest{family:"sans-serif".into(),weight:400.,italic:false}).unwrap();
        assert_ne!(font.resolved_family,"sans-serif");FontRef::from_index(&font.bytes,font.face_index).unwrap();
    }
    #[cfg(windows)]
    #[test] fn native_font_resolves_actual_bytes_and_face() {
        let font=resolve(FontResolveRequest{family:"Segoe UI".into(),weight:400.,italic:false}).unwrap();
        assert_eq!(font.resolved_family,"Segoe UI");assert!(font.bytes.len()>1024);assert_eq!(font.content_hash.len(),64);
        FontRef::from_index(&font.bytes,font.face_index).unwrap();assert!(!font.synthesis_required);
    }
    #[cfg(windows)]
    #[test] fn nonexistent_family_cannot_silently_resolve_default_font() {
        assert!(resolve(FontResolveRequest{family:"AE_P0_DefinitelyMissing_20261003".into(),weight:400.,italic:false}).err().unwrap().starts_with("FONT_FAMILY_NOT_FOUND"));
    }
    #[cfg(windows)]
    #[test] fn native_fallbacks_resolve_installed_cjk_faces_without_guessed_family_names() {
        let receipt=resolve_fallbacks(FontFallbackRequest{families:vec!["Inter".into()],text:"Actual 日本語 中文".into(),weight:400.,italic:false,locale:Some("ja".into())}).unwrap();
        assert!(!receipt.families.is_empty());assert!(receipt.uncovered_code_points.is_empty());
        for family in receipt.families {let face=resolve(FontResolveRequest{family,weight:400.,italic:false}).unwrap();assert!(!face.synthesis_required);FontRef::from_index(&face.bytes,face.face_index).unwrap();}
    }
    #[test] fn unbounded_or_malformed_fallbacks_are_rejected() {
        assert!(resolve_fallbacks(FontFallbackRequest{families:vec![],text:"x".into(),weight:400.,italic:false,locale:None}).unwrap_err().starts_with("FONT_INPUT_INVALID"));
    }
    #[cfg(windows)]
    #[test] fn launch_language_samples_have_actual_native_glyph_coverage() {
        for (locale,text) in [("zh-CN","简体中文 普通话 图形硬件 颜色 图层"),("ja","日本語 ハードウェア 起動設定"),("pt-BR","Português Aceleração preparação"),("pt-PT","Ecrã definições detetados"),("es","Español Comprobación aceleración"),("ko","한국어 그래픽") ] {
            let receipt=resolve_fallbacks(FontFallbackRequest{families:vec!["Segoe UI".into()],text:text.into(),weight:400.,italic:false,locale:Some(locale.into())}).unwrap();
            println!("{locale}: {:?}",receipt);
            assert!(receipt.uncovered_code_points.is_empty(),"{locale}: uncovered glyphs {:?}",receipt.uncovered_code_points);
        }
    }
}
