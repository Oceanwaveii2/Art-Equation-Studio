//! Font-specific rich text derivative. Semantic HTML, editing and accessibility
//! remain in the app. This module never certifies browser layout equivalence.
use std::{borrow::Cow, collections::HashMap, sync::{Arc, atomic::{AtomicUsize, Ordering}}};
use parley::{FontContext, LayoutContext, Layout, StyleProperty, FontFamily, FontWeight,
    FontStyle, FontVariations, LineHeight, Alignment, AlignmentOptions, PositionedLayoutItem};
use parley::fontique::{Blob, Collection, CollectionOptions, FontInfoOverride};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use skrifa::{FontRef, MetadataProvider, GlyphId, Tag,
    instance::{Size, NormalizedCoord}, outline::{OutlinePen, DrawSettings, HintingInstance, Target, SmoothMode}};

const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;
const MAX_REGISTRY_BYTES: usize = 128 * 1024 * 1024;
const MAX_FONTS: usize = 256;
const MAX_TEXT_BYTES: usize = 64 * 1024;
const MAX_GLYPHS: usize = 16_384;
const MAX_COMMANDS: usize = 262_144;
const MAX_CACHE_COMMANDS: usize = 262_144;
const MAX_CACHE_ENTRIES: usize = 4096;
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

struct Face {
    revision: String, hash: String, original_index: u32, original_bytes: usize,
    blob: Blob<u8>, alias: String, axes: Vec<(String, f32, f32, f32)>,
}

#[derive(Clone, Debug)]
enum Command { M(f32,f32), L(f32,f32), Q(f32,f32,f32,f32), C(f32,f32,f32,f32,f32,f32), Z }

struct Pen { commands: Vec<Command>, overflow: bool }
impl Pen {
    fn push(&mut self, command: Command) {
        if self.commands.len() >= 65_536 { self.overflow = true; }
        else { self.commands.push(command); }
    }
}
impl OutlinePen for Pen {
    fn move_to(&mut self,x:f32,y:f32) { self.push(Command::M(x,-y)); }
    fn line_to(&mut self,x:f32,y:f32) { self.push(Command::L(x,-y)); }
    fn quad_to(&mut self,a:f32,b:f32,x:f32,y:f32) { self.push(Command::Q(a,-b,x,-y)); }
    fn curve_to(&mut self,a:f32,b:f32,c:f32,d:f32,x:f32,y:f32) { self.push(Command::C(a,-b,c,-d,x,-y)); }
    fn close(&mut self) { self.push(Command::Z); }
}
pub const OP_MOVE_TO: f32 = 1.0;
pub const OP_LINE_TO: f32 = 2.0;
pub const OP_QUAD_TO: f32 = 3.0;
pub const OP_CUBIC_TO: f32 = 4.0;
pub const OP_CLOSE: f32 = 5.0;

fn push_binary_command(command: &Command, x: f32, y: f32, out: &mut Vec<f32>) {
    match *command {
        Command::M(a, b) => out.extend_from_slice(&[OP_MOVE_TO, a + x, b + y]),
        Command::L(a, b) => out.extend_from_slice(&[OP_LINE_TO, a + x, b + y]),
        Command::Q(a, b, c, d) => out.extend_from_slice(&[OP_QUAD_TO, a + x, b + y, c + x, d + y]),
        Command::C(a, b, c, d, e, f) => out.extend_from_slice(&[OP_CUBIC_TO, a + x, b + y, c + x, d + y, e + x, f + y]),
        Command::Z => out.push(OP_CLOSE),
    }
}

fn translated(command:&Command,x:f32,y:f32)->Value {
    match *command {
        Command::M(a,b)=>json!(["M",a+x,b+y]), Command::L(a,b)=>json!(["L",a+x,b+y]),
        Command::Q(a,b,c,d)=>json!(["Q",a+x,b+y,c+x,d+y]),
        Command::C(a,b,c,d,e,f)=>json!(["C",a+x,b+y,c+x,d+y,e+x,f+y]), Command::Z=>json!(["Z"]),
    }
}
fn error(code:&str,why:impl std::fmt::Display)->String { format!("{code}: {why}") }
fn fields(value:&Value, allowed:&[&str])->Result<(),String> {
    let object=value.as_object().ok_or_else(||error("TEXT_INPUT_INVALID","expected object"))?;
    if let Some(key)=object.keys().find(|key| !allowed.contains(&key.as_str())) {
        return Err(error("TEXT_UNSUPPORTED",format!("field {key}")));
    }
    Ok(())
}
fn name(value:&Value,key:&str)->Result<String,String> {
    value[key].as_str().filter(|s|!s.is_empty()&&s.len()<=256)
        .map(str::to_owned).ok_or_else(||error("TEXT_INPUT_INVALID",key))
}
fn number(value:&Value,key:&str,default:f32,min:f32,max:f32)->Result<f32,String> {
    if value[key].is_null() { return Ok(default); }
    let n=value[key].as_f64().ok_or_else(||error("TEXT_INPUT_INVALID",key))?;
    if !n.is_finite()||n<f64::from(min)||n>f64::from(max) { return Err(error("TEXT_INPUT_INVALID",key)); }
    Ok(n as f32)
}
fn boolean(value:&Value,key:&str)->Result<bool,String> {
    if value[key].is_null() { return Ok(false); }
    value[key].as_bool().ok_or_else(||error("TEXT_INPUT_INVALID",key))
}
fn color(value:&Value,key:&str,default:&str)->Result<String,String> {
    let raw=value[key].as_str().unwrap_or(default);
    if !value[key].is_null()&&!value[key].is_string() {return Err(error("TEXT_INPUT_INVALID",key));}
    if raw.len()!=9||!raw.starts_with('#')||!raw[1..].bytes().all(|b|b.is_ascii_hexdigit()) {
        return Err(error("TEXT_INPUT_INVALID",format!("{key} requires #rrggbbaa")));
    }
    Ok(raw.to_ascii_lowercase())
}

/// Isolate one TTC face so the shaper cannot accidentally select another face
/// with the same family/attributes. Original content hash and index are retained.
fn isolate_face(data:&[u8],index:u32)->Result<Vec<u8>,String> {
    let font=FontRef::from_index(data,index).map_err(|e|error("FONT_INVALID",e))?;
    if !data.starts_with(b"ttcf") {return Ok(data.to_vec());}
    let records=font.table_directory().table_records();
    if records.is_empty()||records.len()>4096 {return Err(error("FONT_INVALID","table count"));}
    let count=records.len();
    let mut out=vec![0_u8;12+count*16];
    out[0..4].copy_from_slice(&font.table_directory().sfnt_version().to_be_bytes());
    out[4..6].copy_from_slice(&(count as u16).to_be_bytes());
    let pow=(count as u16).ilog2(); let search=(1_u16<<pow)*16;
    out[6..8].copy_from_slice(&search.to_be_bytes());out[8..10].copy_from_slice(&(pow as u16).to_be_bytes());
    out[10..12].copy_from_slice(&((count as u16)*16-search).to_be_bytes());
    let mut head=None;
    for (i,record) in records.iter().enumerate() {
        let tag=record.tag();let bytes=font.table_data(tag).ok_or_else(||error("FONT_INVALID","table offset"))?;
        let bytes=bytes.as_bytes(); let offset=out.len();
        if offset.checked_add(bytes.len()).is_none_or(|n|n>MAX_FONT_BYTES) {return Err(error("FONT_RESOURCE_LIMIT","isolated face bytes"));}
        out.extend_from_slice(bytes);while out.len()%4!=0 {out.push(0);}
        if tag==Tag::new(b"head") {
            if bytes.len()<12 {return Err(error("FONT_INVALID","head table"));}
            out[offset+8..offset+12].fill(0);head=Some(offset);
        }
        let checksum=out[offset..].chunks_exact(4).fold(0_u32,|sum,b|sum.wrapping_add(u32::from_be_bytes(b.try_into().unwrap())));
        let at=12+i*16;out[at..at+4].copy_from_slice(&tag.to_be_bytes());
        out[at+4..at+8].copy_from_slice(&checksum.to_be_bytes());out[at+8..at+12].copy_from_slice(&(offset as u32).to_be_bytes());
        out[at+12..at+16].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
    }
    let sum=out.chunks_exact(4).fold(0_u32,|sum,b|sum.wrapping_add(u32::from_be_bytes(b.try_into().unwrap())));
    let head=head.ok_or_else(||error("FONT_INVALID","missing head"))?;
    out[head+8..head+12].copy_from_slice(&0xb1b0afba_u32.wrapping_sub(sum).to_be_bytes());
    FontRef::new(&out).map_err(|e|error("FONT_INVALID",e))?;
    Ok(out)
}

/// Explicit registered font authority; no fabricated family or system fallback.
#[cfg_attr(target_arch="wasm32", wasm_bindgen::prelude::wasm_bindgen)]
pub struct TextEngine {
    epoch:String, faces:HashMap<String,Face>, fonts:FontContext,
    layouts:LayoutContext<usize>, cache:HashMap<String,Arc<Vec<Command>>>, cache_commands:usize,
}
impl TextEngine {
    pub fn new_checked(epoch:String)->Result<Self,String> {
        if epoch.is_empty()||epoch.len()>256 {return Err(error("TEXT_INPUT_INVALID","font epoch"));}
        Ok(Self {epoch,faces:HashMap::new(),fonts:FontContext {collection:Collection::new(CollectionOptions {shared:false,system_fonts:false}),source_cache:Default::default()},layouts:LayoutContext::new(),cache:HashMap::new(),cache_commands:0})
    }
    fn accounted_bytes(&self)->usize {self.faces.values().map(|f|f.original_bytes+f.blob.as_ref().len()).sum()}
    pub fn register_checked(&mut self,key:String,revision:String,index:u32,bytes:Vec<u8>)->Result<String,String> {
        if key.is_empty()||key.len()>256||revision.is_empty()||revision.len()>256 {return Err(error("FONT_INVALID","key/revision"));}
        if bytes.is_empty()||bytes.len()>MAX_FONT_BYTES {return Err(error("FONT_RESOURCE_LIMIT","font exceeds 32 MiB"));}
        let hash=format!("{:x}",Sha256::digest(&bytes));
        if let Some(face)=self.faces.get(&key) {
            if face.revision==revision&&face.original_index==index&&face.hash==hash {return Ok(self.face_receipt(&key).to_string());}
            return Err(error("FONT_REVISION_CONFLICT","remove old registered face before replacing key"));
        }
        if self.faces.len()>=MAX_FONTS {return Err(error("FONT_RESOURCE_LIMIT","font count"));}
        let isolated=isolate_face(&bytes,index)?;
        if self.accounted_bytes()+bytes.len()+isolated.len()>MAX_REGISTRY_BYTES {return Err(error("FONT_RESOURCE_LIMIT","128 MiB registry"));}
        let font=FontRef::new(&isolated).map_err(|e|error("FONT_INVALID",e))?;
        let axes=font.axes().iter().map(|a|(a.tag().to_string(),a.min_value(),a.default_value(),a.max_value())).collect();
        let alias=format!("AE_P0_{}",format!("{:x}",Sha256::digest(key.as_bytes())));
        let blob=Blob::new(Arc::new(isolated));
        let added=self.fonts.collection.register_fonts(blob.clone(),Some(FontInfoOverride {family_name:Some(&alias),..Default::default()}));
        if added.len()!=1||added[0].1.len()!=1||added[0].1[0].index()!=0 {return Err(error("FONT_INVALID","selected font must register one exact face"));}
        self.faces.insert(key.clone(),Face{revision,hash,original_index:index,original_bytes:bytes.len(),blob,alias,axes});
        Ok(self.face_receipt(&key).to_string())
    }
    fn face_receipt(&self,key:&str)->Value {
        let face=&self.faces[key];json!({"key":key,"revision":face.revision,"contentHash":face.hash,"faceIndex":face.original_index,"epoch":self.epoch,"axes":face.axes,"fontBytes":face.blob.as_ref().len()})
    }
    pub fn remove_checked(&mut self,key:&str)->Result<(),String> {
        if self.faces.remove(key).is_none(){return Err(error("FONT_NOT_READY",key));}
        self.fonts=FontContext{collection:Collection::new(CollectionOptions{shared:false,system_fonts:false}),source_cache:Default::default()};
        for face in self.faces.values() {self.fonts.collection.register_fonts(face.blob.clone(),Some(FontInfoOverride{family_name:Some(&face.alias),..Default::default()}));}
        self.layouts=LayoutContext::new();self.cache.clear();self.cache_commands=0;Ok(())
    }
    pub fn stats_checked(&self)->Value {json!({"epoch":self.epoch,"fontCount":self.faces.len(),"accountedFontBytes":self.accounted_bytes(),"outlineEntries":self.cache.len(),"outlineCommands":self.cache_commands,"outlineBytesEstimate":self.cache_commands*std::mem::size_of::<Command>(),"unmeasuredScratch":true})}
    pub fn shape_checked(&mut self,request:&str)->Result<String,String> {
        if request.len()>MAX_REQUEST_BYTES {return Err(error("TEXT_RESOURCE_LIMIT","request bytes"));}
        let input:Value=serde_json::from_str(request).map_err(|e|error("TEXT_INPUT_INVALID",e))?;
        fields(&input,&["schema","schemaVersion","id","revision","fontEpoch","text","maxWidth","alignment","transform","spans","overflowWrap","wrapMode","maxCommands","measuredBreaks","baseDirection","outlineScale","layoutAuthority"])?;
        let model_layout=match input["layoutAuthority"].as_str(){Some("model")=>true,Some("dom")=>false,None if input["layoutAuthority"].is_null()=>false,_=>return Err(error("TEXT_INPUT_INVALID","layoutAuthority requires model or dom"))};
        if model_layout && !input["measuredBreaks"].is_null(){return Err(error("TEXT_INPUT_INVALID","model layout cannot use DOM measured breaks"));}
        if input["schema"]!="art-equation.shaped-text"||input["schemaVersion"]!=1 {return Err(error("TEXT_INPUT_INVALID","schema"));}
        let id=name(&input,"id")?;let revision=name(&input,"revision")?;
        if input["fontEpoch"]!=self.epoch {return Err(error("FONT_EPOCH_STALE","font epoch"));}
        let text=input["text"].as_str().ok_or_else(||error("TEXT_INPUT_INVALID","text"))?;
        if text.len()>MAX_TEXT_BYTES {return Err(error("TEXT_RESOURCE_LIMIT","text bytes"));}
        let base_direction=match input["baseDirection"].as_str(){Some("ltr")=>Some(false),Some("rtl")=>Some(true),None if input["baseDirection"].is_null()=>None,_=>return Err(error("TEXT_INPUT_INVALID","baseDirection requires ltr or rtl"))};
        let measured_breaks=if input["measuredBreaks"].is_null(){None}else{
            let raw=input["measuredBreaks"].as_array().filter(|values|values.len()<=8192).ok_or_else(||error("TEXT_INPUT_INVALID","measuredBreaks"))?;
            let mut values=Vec::new();let mut previous=0;
            let graphemes:Vec<_>=icu_segmenter::GraphemeClusterSegmenter::new().segment_str(text).collect();
            for value in raw {let at=value.as_u64().filter(|at|*at>previous as u64&&*at<(text.len() as u64)).ok_or_else(||error("TEXT_INPUT_INVALID","measured break order/range"))? as usize;
                if !text.is_char_boundary(at)||graphemes.binary_search(&at).is_err(){return Err(error("TEXT_INPUT_INVALID","measured break must be a UTF-8 grapheme boundary"));}values.push(at);previous=at;}
            Some(values)
        };
        let command_limit=if input["maxCommands"].is_null(){MAX_COMMANDS}else{input["maxCommands"].as_u64().filter(|n|*n>0&&*n<=MAX_COMMANDS as u64).ok_or_else(||error("TEXT_INPUT_INVALID","maxCommands"))? as usize};
        let width=number(&input,"maxWidth",1_000_000.,0.01,1_000_000.)?;
        let outline_scale=if input["outlineScale"].is_null(){None}else{Some(number(&input,"outlineScale",1.,0.25,16.)?)};
        let transform=input["transform"].as_array().ok_or_else(||error("TEXT_INPUT_INVALID","transform"))?;
        if transform.len()!=6||transform.iter().any(|n|n.as_f64().is_none_or(|v|!v.is_finite()||v.abs()>1e6)) {return Err(error("TEXT_INPUT_INVALID","transform"));}
        let determinant=transform[0].as_f64().unwrap()*transform[3].as_f64().unwrap()-transform[1].as_f64().unwrap()*transform[2].as_f64().unwrap();
        if determinant.abs()<1e-12 {return Err(error("TEXT_INPUT_INVALID","singular transform"));}
        if !input["alignment"].is_null()&&!input["alignment"].is_string(){return Err(error("TEXT_INPUT_INVALID","alignment"));}
        let alignment=match input["alignment"].as_str().unwrap_or("start") {"start"=>Alignment::Start,"end"=>Alignment::End,"left"=>Alignment::Left,"right"=>Alignment::Right,"center"=>Alignment::Center,"justify"=>Alignment::Justify,_=>return Err(error("TEXT_UNSUPPORTED","alignment"))};
        let spans=input["spans"].as_array().ok_or_else(||error("TEXT_INPUT_INVALID","spans"))?;
        let overflow=match input["overflowWrap"].as_str().unwrap_or("normal") {"normal"=>parley::OverflowWrap::Normal,"anywhere"=>parley::OverflowWrap::Anywhere,"break-word"=>parley::OverflowWrap::BreakWord,_=>return Err(error("TEXT_UNSUPPORTED","overflow wrap"))};
        let wrapping=match input["wrapMode"].as_str().unwrap_or("wrap") {"wrap"=>parley::TextWrapMode::Wrap,"nowrap"=>parley::TextWrapMode::NoWrap,_=>return Err(error("TEXT_UNSUPPORTED","wrap mode"))};
        if (!input["overflowWrap"].is_null()&&!input["overflowWrap"].is_string())||(!input["wrapMode"].is_null()&&!input["wrapMode"].is_string()) {return Err(error("TEXT_INPUT_INVALID","wrapping"));}
        if spans.len()>1024 {return Err(error("TEXT_RESOURCE_LIMIT","style count"));}
        let mut checked=Vec::new();let mut next=0;let mut paints=Vec::new();let mut features=Vec::new();
        for span in spans {
            fields(span,&["start","end","fonts","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","variations","features","color","underline","strike","highlight"])?;
            let start=span["start"].as_u64().ok_or_else(||error("TEXT_INPUT_INVALID","span start"))? as usize;
            let end=span["end"].as_u64().ok_or_else(||error("TEXT_INPUT_INVALID","span end"))? as usize;
            if start!=next||end<=start||end>text.len()||!text.is_char_boundary(start)||!text.is_char_boundary(end) {return Err(error("TEXT_INPUT_INVALID","spans must partition UTF-8 bytes"));}next=end;
            let refs=span["fonts"].as_array().filter(|f|!f.is_empty()&&f.len()<=32).ok_or_else(||error("TEXT_INPUT_INVALID","font refs"))?;
            let mut keys=Vec::new();let mut aliases=Vec::new();
            for reference in refs {
                fields(reference,&["key","revision"])?;let key=name(reference,"key")?;let face=self.faces.get(&key).ok_or_else(||error("FONT_NOT_READY",&key))?;
                if reference["revision"]!=face.revision {return Err(error("FONT_REVISION_STALE",&key));}
                keys.push(key);aliases.push(format!("\"{}\"",face.alias));
            }
            let size=number(span,"fontSize",16.,1.,1024.)?;let weight=number(span,"fontWeight",400.,1.,1000.)?;
            if !span["fontStyle"].is_null()&&!span["fontStyle"].is_string(){return Err(error("TEXT_INPUT_INVALID","fontStyle"));}
            let style=match span["fontStyle"].as_str().unwrap_or("normal") {"normal"=>FontStyle::Normal,"italic"=>FontStyle::Italic,_=>return Err(error("TEXT_UNSUPPORTED","font style"))};
            let leading=number(span,"lineHeight",1.2,0.1,10.)?;let spacing=number(span,"letterSpacing",0.,-1024.,1024.)?;
            let vars=span["variations"].as_object();if !span["variations"].is_null()&&vars.is_none(){return Err(error("TEXT_INPUT_INVALID","variations"));}
            let mut variations=Vec::new();
            if let Some(vars)=vars {
                if vars.len()>32 {return Err(error("TEXT_RESOURCE_LIMIT","axes"));}
                for (tag,value) in vars {
                    if tag.len()!=4||!tag.is_ascii(){return Err(error("TEXT_INPUT_INVALID","axis tag"));}
                    let value=value.as_f64().filter(|n|n.is_finite()&&n.abs()<=1e6).ok_or_else(||error("TEXT_INPUT_INVALID","axis value"))? as f32;
                    for key in &keys {let face=&self.faces[key];let axis=face.axes.iter().find(|a|a.0==*tag).ok_or_else(||error("FONT_AXIS_UNSUPPORTED",format!("{key}/{tag}")))?;if value<axis.1||value>axis.3{return Err(error("FONT_AXIS_INVALID",format!("{key}/{tag}")));}}
                    variations.push(parley::FontVariation::new(parley::setting::Tag::new(tag.as_bytes().try_into().unwrap()),value));
                }
            }
            let paint=color(span,"color","#000000ff")?;let highlight=if span["highlight"].is_null(){None}else{Some(color(span,"highlight","#00000000")?)};
            let mut span_features=Vec::new();
            if let Some(settings)=span["features"].as_object() {
                if settings.len()>32{return Err(error("TEXT_RESOURCE_LIMIT","font features"));}
                for (tag,value) in settings {let value=value.as_u64().filter(|n|*n<=65535).ok_or_else(||error("TEXT_INPUT_INVALID","feature value"))?;
                    if tag.len()!=4||!tag.is_ascii(){return Err(error("TEXT_INPUT_INVALID","feature tag"));}
                    span_features.push(parley::FontFeature::new(parley::setting::Tag::new(tag.as_bytes().try_into().unwrap()),value as u16));
                }
            }else if !span["features"].is_null(){return Err(error("TEXT_INPUT_INVALID","features"));}
            features.push(span_features);
            checked.push((start..end,aliases.join(","),size,weight,style,leading,spacing,variations,boolean(span,"underline")?,boolean(span,"strike")?,keys));
            paints.push((paint,highlight));
        }
        if next!=text.len() {return Err(error("TEXT_INPUT_INVALID","style spans do not cover text"));}
        // Design-space layout must not quantize baselines at zoom 1. Raster
        // backing scale is applied once by the shared canvas preparation.
        // Analyze and shape the whole paragraph once. Only allow the measured
        // DOM soft break opportunities; paragraph bidi/contextual shaping never
        // resets at a line boundary. The caller still validates actual output
        // partitions and advances, because an opportunity is not a hard break.
        let break_position=AtomicUsize::new(0);
        let has_measured_breaks=measured_breaks.is_some();
        let measured_override=move |context:parley::LineBreakContext| {
            let at=break_position.fetch_add(context.before.len_utf8(),Ordering::Relaxed)+context.before.len_utf8();
            Some(measured_breaks.as_ref().is_some_and(|breaks|breaks.binary_search(&at).is_ok()))
        };
        let mut builder=self.layouts.ranged_builder(&mut self.fonts,text,1.,false);
        builder.set_base_direction_rtl(base_direction);
        builder.push_default(StyleProperty::OverflowWrap(overflow));builder.push_default(StyleProperty::TextWrapMode(wrapping));
        builder.set_line_break_override(Some(if has_measured_breaks{&measured_override}else{parley::CHROMIUM_LINE_BREAK_OVERRIDE}));
        for (i,(range,families,size,weight,style,leading,spacing,variations,underline,strike,_)) in checked.iter().enumerate() {
            builder.push(StyleProperty::FontFamily(FontFamily::from(families.as_str())),range.clone());
            builder.push(StyleProperty::FontSize(*size),range.clone());builder.push(StyleProperty::FontWeight(FontWeight::new(*weight)),range.clone());
            builder.push(StyleProperty::FontStyle(*style),range.clone());builder.push(StyleProperty::LineHeight(LineHeight::FontSizeRelative(*leading)),range.clone());
            builder.push(StyleProperty::LetterSpacing(*spacing),range.clone());builder.push(StyleProperty::FontVariations(FontVariations::List(Cow::Borrowed(variations))),range.clone());
            builder.push(StyleProperty::FontFeatures(parley::FontFeatures::List(Cow::Borrowed(&features[i]))),range.clone());
            builder.push(StyleProperty::Brush(i),range.clone());builder.push(StyleProperty::Underline(*underline),range.clone());builder.push(StyleProperty::Strikethrough(*strike),range.clone());
        }
        let mut layout:Layout<usize>=builder.build(text);layout.break_all_lines(Some(width));layout.align(alignment,AlignmentOptions::default());
        let paragraph_rtl=layout.is_rtl();let mut operations=Vec::new();let mut operation_lines=Vec::new();let mut glyphs=Vec::new();let mut lines=Vec::new();let mut runs=Vec::new();let mut total_commands=0;
        for (line_index,line) in layout.lines().enumerate() {
            let metrics=line.metrics();lines.push(json!({"index":line_index,"textRange":[line.text_range().start,line.text_range().end],"baseline":metrics.baseline,"advance":metrics.advance,"trailingWhitespace":metrics.trailing_whitespace,"offset":metrics.offset,"height":metrics.line_height}));
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(glyph_run)=item else {return Err(error("TEXT_UNSUPPORTED","inline box"));};
                let run=glyph_run.run();let synth=run.synthesis();if synth.embolden()||synth.skew().is_some(){return Err(error("FONT_SYNTHESIS_UNSUPPORTED","register actual bold/italic face"));}
                let font_data=run.font();let key=self.faces.iter().find(|(_,face)|face.blob.id()==font_data.data.id()).map(|(key,_)|key.clone()).ok_or_else(||error("FONT_NOT_READY","unregistered fallback face"))?;
                let face=&self.faces[&key];if font_data.index!=0 {return Err(error("FONT_FACE_MISMATCH",&key));}
                let style_index=glyph_run.style().brush;if !checked[style_index].10.contains(&key){return Err(error("FONT_NOT_READY","fallback not in declared ordered list"));}
                let font=FontRef::new(face.blob.as_ref()).map_err(|e|error("FONT_INVALID",e))?;
                let coords:Vec<_>=run.normalized_coords().iter().map(|c|NormalizedCoord::from_bits(*c)).collect();
                let font_size=run.font_size();let mut commands=Vec::new();let mut binary_commands=Vec::new();
                let outlines=font.outline_glyphs();
                let hinting=if let Some(scale)=outline_scale{Some(HintingInstance::new(&outlines,Size::new(font_size*scale),coords.as_slice(),Target::Smooth{mode:SmoothMode::Lcd,symmetric_rendering:false,preserve_linear_metrics:true}).map_err(|e|error("FONT_HINTING_INVALID",e))?)}else{None};
                for glyph in glyph_run.positioned_glyphs() {
                    if glyphs.len()>=MAX_GLYPHS {return Err(error("TEXT_RESOURCE_LIMIT","glyph count"));}
                    if glyph.id==0 {return Err(error("FONT_GLYPH_MISSING",format!("{key}/{}",run.text_range().start)));}
                    if font.color_glyphs().get(GlyphId::new(glyph.id)).is_some()||font.bitmap_strikes().iter().any(|strike|strike.get(GlyphId::new(glyph.id)).is_some()) {return Err(error("FONT_COLOR_GLYPH_UNSUPPORTED",&key));}
                    let cache_key=format!("{}/{}/{}/{}/{:?}/{:?}",face.hash,face.original_index,glyph.id,font_size.to_bits(),run.normalized_coords(),outline_scale);
                    let outline=if let Some(cached)=self.cache.get(&cache_key){cached.clone()}else{
                        let outline=font.outline_glyphs().get(GlyphId::new(glyph.id)).ok_or_else(||error("FONT_OUTLINE_MISSING",format!("{key}/{}",glyph.id)))?;
                        let mut pen=Pen{commands:Vec::new(),overflow:false};let settings=if let Some(hinting)=&hinting{DrawSettings::hinted(hinting,false)}else{DrawSettings::unhinted(Size::new(font_size),coords.as_slice())};outline.draw(settings,&mut pen).map_err(|e|error("FONT_OUTLINE_INVALID",e))?;
                        if let Some(scale)=outline_scale{for command in &mut pen.commands{match command{Command::M(a,b)|Command::L(a,b)=>{*a/=scale;*b/=scale},Command::Q(a,b,c,d)=>{*a/=scale;*b/=scale;*c/=scale;*d/=scale},Command::C(a,b,c,d,e,f)=>{*a/=scale;*b/=scale;*c/=scale;*d/=scale;*e/=scale;*f/=scale},Command::Z=>{}}}}
                        if pen.overflow {return Err(error("TEXT_RESOURCE_LIMIT","glyph outline commands"));}
                        if self.cache.len()>=MAX_CACHE_ENTRIES||self.cache_commands+pen.commands.len()>MAX_CACHE_COMMANDS {self.cache.clear();self.cache_commands=0;}
                        self.cache_commands+=pen.commands.len();let outline=Arc::new(pen.commands);self.cache.insert(cache_key,outline.clone());outline
                    };
                    total_commands+=outline.len();if total_commands>command_limit {return Err(error("TEXT_RESOURCE_LIMIT","outline command request limit"));}
                    for c in outline.iter() { push_binary_command(c, glyph.x, glyph.y, &mut binary_commands); }
                    commands.extend(outline.iter().map(|c|translated(c,glyph.x,glyph.y)));
                    if commands.len()>65_536 {return Err(error("TEXT_RESOURCE_LIMIT","run outline commands"));}
                    glyphs.push(json!({"fontKey":key,"glyphId":glyph.id,"x":glyph.x,"y":glyph.y,"advance":glyph.advance,"line":line_index,"emptyOutline":outline.is_empty()}));
                }
                let run_index=runs.len();let paint=&paints[style_index].0;
                if let Some(highlight)=&paints[style_index].1 {operations.push(rect_op(&id,run_index,"highlight",glyph_run.offset(),metrics.baseline-metrics.ascent,glyph_run.advance(),metrics.line_height,highlight,&input["transform"]));operation_lines.push(line_index);}
                if !commands.is_empty(){operations.push(vector_op(format!("{id}:run:{run_index}"),commands,paint,&input["transform"]));operation_lines.push(line_index);}
                for (kind,decoration,offset,size) in [("underline",&glyph_run.style().underline,run.metrics().underline_offset,run.metrics().underline_size),("strike",&glyph_run.style().strikethrough,run.metrics().strikethrough_offset,run.metrics().strikethrough_size)] {
                    // Font metrics use a y-up axis; paint commands use y-down.
                    if let Some(decoration)=decoration {operations.push(rect_op(&id,run_index,kind,glyph_run.offset(),glyph_run.baseline()-decoration.offset.unwrap_or(offset),glyph_run.advance(),decoration.size.unwrap_or(size).max(0.01),&paints[decoration.brush].0,&input["transform"]));operation_lines.push(line_index);}
                }
                // Parley splits ligatures into editing components. These are
                // UTF-8 source ranges, never Unicode->glyph mappings. Keep the
                // component semantics instead of inventing atomic clusters.
                let cluster_info:Vec<_>=run.clusters().map(|c|json!({"textRange":[c.text_range().start,c.text_range().end],"ligatureStart":c.is_ligature_start(),"ligatureContinuation":c.is_ligature_continuation(),"glyphCount":c.glyphs().count(),"advance":c.advance()})).collect();
                let painted_range=run.text_range().start.max(checked[style_index].0.start)..run.text_range().end.min(checked[style_index].0.end);
                runs.push(json!({"font":self.face_receipt(&key),"fontSize":font_size,"normalizedCoords":run.normalized_coords(),"textRange":[painted_range.start,painted_range.end],"fontRunTextRange":[run.text_range().start,run.text_range().end],"clusters":run.clusters().filter(|c|c.text_range().start<painted_range.end&&c.text_range().end>painted_range.start).map(|c|json!([c.text_range().start,c.text_range().end])).collect::<Vec<_>>(),"clusterComponents":cluster_info,"rtl":run.is_rtl(),"line":line_index,"offset":glyph_run.offset(),"baseline":glyph_run.baseline(),"advance":glyph_run.advance(),"binaryCommandFloats":binary_commands.len()}));
            }
        }
        let boundaries:Vec<_>=icu_segmenter::GraphemeClusterSegmenter::new().segment_str(text).collect();
        let graphemes:Vec<_>=boundaries.windows(2).map(|pair|json!([pair[0],pair[1]])).collect();
        // Model layout is the authored authority, not a claim of equality to
        // browser layout. Legacy DOM callers retain their independent oracle.
        let blockers:Vec<&str>=if model_layout {vec![]}else{vec!["TEXT_DOM_LAYOUT_PARITY_PENDING"]};
        Ok(json!({"schema":"art-equation.positioned-outlines","schemaVersion":1,"id":id,"revision":revision,"fontEpoch":self.epoch,"width":layout.width(),"height":layout.height(),"paragraphDirection":if paragraph_rtl{"rtl"}else{"ltr"},"lines":lines,"runs":runs,"glyphs":glyphs,"graphemes":graphemes,"operations":operations,"operationLines":operation_lines,"completePaint":model_layout,"layoutAuthority":if model_layout{"model"}else{"dom"},"blockers":blockers,"hintPolicy":if outline_scale.is_some(){"hinted-shared-linear-metrics-outline"}else{"unhinted-shared-outline"},"outlineScale":outline_scale,"resourceStats":self.stats_checked()}).to_string())
    }
}
fn vector_op(id:String,commands:Vec<Value>,color:&str,transform:&Value)->Value {
    json!({"type":"vector","object":{"id":id,"kind":"vector","order":0,"transform":transform,"payload":{"commands":commands,"fill":color,"fillRule":"nonzero","strokeWidth":0}}})
}
fn rect_op(id:&str,run:usize,kind:&str,x:f32,y:f32,w:f32,h:f32,color:&str,transform:&Value)->Value {
    vector_op(format!("{id}:run:{run}:{kind}"),vec![json!(["M",x,y]),json!(["L",x+w,y]),json!(["L",x+w,y+h]),json!(["L",x,y+h]),json!(["Z"])],color,transform)
}

#[cfg(target_arch="wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
impl TextEngine {
    #[wasm_bindgen::prelude::wasm_bindgen(constructor)]
    pub fn new(epoch:String)->Result<TextEngine,wasm_bindgen::JsValue> {Self::new_checked(epoch).map_err(|e|wasm_bindgen::JsValue::from_str(&e))}
    pub fn register_font(&mut self,key:String,revision:String,face_index:u32,bytes:Vec<u8>)->Result<String,wasm_bindgen::JsValue> {self.register_checked(key,revision,face_index,bytes).map_err(|e|wasm_bindgen::JsValue::from_str(&e))}
    pub fn remove_font(&mut self,key:String)->Result<(),wasm_bindgen::JsValue> {self.remove_checked(&key).map_err(|e|wasm_bindgen::JsValue::from_str(&e))}
    pub fn shape(&mut self,request:String)->Result<String,wasm_bindgen::JsValue> {self.shape_checked(&request).map_err(|e|wasm_bindgen::JsValue::from_str(&e))}
    pub fn resource_stats(&self)->String {self.stats_checked().to_string()}
}

#[cfg(test)]
mod tests {
    use super::*;
    const LATIN:&[u8]=include_bytes!("../fixtures/fonts/NotoSans-wdth-wght.ttf");
    const ARABIC:&[u8]=include_bytes!("../fixtures/fonts/NotoSansArabic-wdth-wght.ttf");
    fn engine()->TextEngine {
        let mut e=TextEngine::new_checked("test-epoch".into()).unwrap();
        e.register_checked("latin".into(),"1".into(),0,LATIN.to_vec()).unwrap();
        e.register_checked("arabic".into(),"1".into(),0,ARABIC.to_vec()).unwrap();e
    }
    fn request(text:&str)->Value {json!({"schema":"art-equation.shaped-text","schemaVersion":1,"id":"text-fixture","revision":"1","fontEpoch":"test-epoch","text":text,"maxWidth":400,"alignment":"left","transform":[1,0,0,1,0,0],"spans":[{"start":0,"end":text.len(),"fonts":[{"key":"latin","revision":"1"},{"key":"arabic","revision":"1"}],"fontSize":24,"color":"#000000ff"}]})}
    fn shape(e:&mut TextEngine,v:&Value)->Value {serde_json::from_str(&e.shape_checked(&v.to_string()).unwrap()).unwrap()}
    #[test] fn model_layout_is_explicit_and_cannot_bypass_source_validation() {
        let mut e=engine();let mut req=request("Engine-owned text");
        assert_eq!(shape(&mut e,&req)["completePaint"],false);
        req["layoutAuthority"]=json!("model");let model=shape(&mut e,&req);
        assert_eq!(model["completePaint"],true);assert_eq!(model["layoutAuthority"],"model");assert_eq!(model["blockers"],json!([]));
        assert!(!model["operations"].as_array().unwrap().is_empty());
        req["measuredBreaks"]=json!([6]);assert!(e.shape_checked(&req.to_string()).is_err());req.as_object_mut().unwrap().remove("measuredBreaks");
        req["spans"][0]["fonts"][0]["revision"]=json!("stale");assert!(e.shape_checked(&req.to_string()).is_err());
        req["spans"][0]["fonts"][0]["revision"]=json!("1");req["layoutAuthority"]=json!("trusted");assert!(e.shape_checked(&req.to_string()).is_err());
    }
    #[test] fn backing_scale_hinting_preserves_layout_and_separates_cached_outlines() {
        let mut e=engine();let normal=shape(&mut e,&request("office سلام"));
        for scale in [1.,1.5,2.] {let previous=e.cache.len();let mut req=request("office سلام");req["outlineScale"]=json!(scale);let hinted=shape(&mut e,&req);assert_eq!(normal["lines"],hinted["lines"]);assert_eq!(normal["glyphs"],hinted["glyphs"]);assert_eq!(hinted["hintPolicy"],"hinted-shared-linear-metrics-outline");assert!(e.cache.len()>previous);}
        for bad in [json!(0),json!(17),json!("1.5")] {let mut req=request("x");req["outlineScale"]=bad;assert!(e.shape_checked(&req.to_string()).is_err());}
    }
    #[test] fn decoration_axis_and_painted_style_source_ranges_are_correct() {
        let mut req=request("before under strike");req["spans"]=json!([
            {"start":0,"end":7,"fonts":[{"key":"latin","revision":"1"}],"fontSize":24},
            {"start":7,"end":13,"fonts":[{"key":"latin","revision":"1"}],"fontSize":24,"underline":true,"highlight":"#ffff00ff"},
            {"start":13,"end":19,"fonts":[{"key":"latin","revision":"1"}],"fontSize":24,"strike":true}]);
        let paint=shape(&mut engine(),&req);let baseline=paint["lines"][0]["baseline"].as_f64().unwrap();
        for operation in paint["operations"].as_array().unwrap(){let id=operation["object"]["id"].as_str().unwrap();let y=operation["object"]["payload"]["commands"][0][2].as_f64().unwrap();if id.ends_with(":underline"){assert!(y>baseline)}if id.ends_with(":strike"){assert!(y<baseline)}}
        assert!(paint["runs"].as_array().unwrap().iter().any(|run|run["textRange"]==json!([7,13])));
    }
    #[test] fn registered_face_identity_and_original_bytes_are_hashed() {
        let e=engine();let receipt=e.face_receipt("latin");assert_eq!(receipt["contentHash"],format!("{:x}",Sha256::digest(LATIN)));assert_eq!(receipt["faceIndex"],0);
        assert!(receipt["axes"].as_array().unwrap().iter().any(|a|a[0]=="wght"));assert_eq!(e.stats_checked()["fontCount"],2);
    }
    #[test] fn real_ligature_shaping_is_not_per_character_cmap() {
        let shaped=shape(&mut engine(),&request("office ffi"));
        assert!(shaped["glyphs"].as_array().unwrap().len()<"office ffi".len());
        let components=shaped["runs"][0]["clusterComponents"].as_array().unwrap();
        assert!(components.iter().any(|c|c["ligatureStart"]==true&&c["glyphCount"]==1));
        assert!(components.iter().filter(|c|c["ligatureContinuation"]==true&&c["glyphCount"]==0).count()>=2);
    }
    #[test] fn semantic_editor_ligature_disable_uses_real_opentype_features() {
        let mut e=engine();let normal=shape(&mut e,&request("office ffi"));let mut disabled=request("office ffi");disabled["spans"][0]["features"]=json!({"liga":0});
        let disabled=shape(&mut e,&disabled);assert!(disabled["glyphs"].as_array().unwrap().len()>normal["glyphs"].as_array().unwrap().len());
        for bad in [json!({"liga":-1}),json!({"liga":65536}),json!({"bad":0}),json!([1])] {let mut req=request("x");req["spans"][0]["features"]=bad;assert!(e.shape_checked(&req.to_string()).is_err());}
    }
    #[test] fn shaping_caller_command_limit_bounds_json_scratch_before_emission() {
        let mut e=engine();let mut req=request("Bounded outline output");req["maxCommands"]=json!(1);assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("TEXT_RESOURCE_LIMIT"));
        for limit in [json!(0),json!(-1),json!(262145),json!(1.5),json!("100")] {req["maxCommands"]=limit;assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("TEXT_INPUT_INVALID"));}
    }
    #[test] fn combining_marks_are_shaped_with_utf8_clusters() {
        let text="x\u{301}";let shaped=shape(&mut engine(),&request(text));
        let glyphs=shaped["glyphs"].as_array().unwrap();assert!(glyphs.iter().any(|g|g["advance"].as_f64().unwrap()==0.));assert!(glyphs.iter().all(|g|g["glyphId"]!=0));
        assert_eq!(shaped["graphemes"],json!([[0,text.len()]]));
        assert_eq!(shaped["runs"][0]["clusters"],json!([[0,1],[1,text.len()]]));
    }
    #[test] fn arabic_uses_registered_fallback_face_and_visual_rtl_runs() {
        let shaped=shape(&mut engine(),&request("hello سلام"));let runs=shaped["runs"].as_array().unwrap();
        assert!(runs.iter().any(|r|r["rtl"]==true&&r["font"]["key"]=="arabic"));
        let font=FontRef::new(ARABIC).unwrap();let nominal=font.charmap().map('س').unwrap().to_u32();
        assert!(shaped["glyphs"].as_array().unwrap().iter().any(|g|g["fontKey"]=="arabic"&&g["glyphId"]!=nominal));
    }
    #[test] fn wrapped_layout_preserves_line_fragments_and_spaces() {
        let mut req=request("one two three four five six");req["maxWidth"]=json!(95);let shaped=shape(&mut engine(),&req);
        assert!(shaped["lines"].as_array().unwrap().len()>1);assert!(shaped["glyphs"].as_array().unwrap().iter().any(|g|g["emptyOutline"]==true&&g["advance"].as_f64().unwrap()>0.));
        assert_eq!(shaped["completePaint"],false);assert_eq!(shaped["blockers"][0],"TEXT_DOM_LAYOUT_PARITY_PENDING");
    }
    #[test] fn measured_soft_breaks_keep_one_paragraph_bidi_context_and_original_utf8_ranges() {
        let text="hello سلام mixed سلام end";let mut req=request(text);req["maxWidth"]=json!(125);req["measuredBreaks"]=json!(["hello سلام ".len(),"hello سلام mixed ".len(),"hello سلام mixed سلام ".len()]);
        let shaped=shape(&mut engine(),&req);assert_eq!(shaped["paragraphDirection"],"ltr");
        assert!(shaped["runs"].as_array().unwrap().iter().any(|run|run["rtl"]==true));
        assert!(shaped["lines"].as_array().unwrap().len()>1);let allowed=req["measuredBreaks"].as_array().unwrap();
        for line in shaped["lines"].as_array().unwrap(){let end=&line["textRange"][1];assert!(end==&json!(text.len())||allowed.contains(end));}
        assert_eq!(shaped["operations"].as_array().unwrap().len(),shaped["operationLines"].as_array().unwrap().len());
        for boundaries in [json!([1,1]),json!([0]),json!([65536]),json!([7]),json!([text.len()]),json!("invalid")] {
            req["measuredBreaks"]=boundaries;assert!(engine().shape_checked(&req.to_string()).unwrap_err().starts_with("TEXT_INPUT_INVALID"));
        }
        let mut combining=request("x\u{301} y");combining["measuredBreaks"]=json!([1]);assert!(engine().shape_checked(&combining.to_string()).is_err());
    }
    #[test] fn explicit_css_base_direction_changes_bidi_without_inserting_source_characters() {
        let mut e=engine();let text="سلام office 123.";let original=request(text);let auto=shape(&mut e,&original);assert_eq!(auto["paragraphDirection"],"rtl");
        let mut ltr=original.clone();ltr["baseDirection"]=json!("ltr");let ltr=shape(&mut e,&ltr);assert_eq!(ltr["paragraphDirection"],"ltr");assert_ne!(ltr["operations"],auto["operations"]);assert_eq!(ltr["graphemes"],auto["graphemes"]);
        let mut latin=request("office 123");latin["baseDirection"]=json!("rtl");let latin=shape(&mut e,&latin);assert_eq!(latin["paragraphDirection"],"rtl");assert_eq!(latin["lines"][0]["textRange"],json!([0,"office 123".len()]));
        for value in [json!("auto"),json!(false),json!(0),json!("invalid")] {let mut invalid=original.clone();invalid["baseDirection"]=value;assert!(e.shape_checked(&invalid.to_string()).unwrap_err().starts_with("TEXT_INPUT_INVALID"));}
        let again=shape(&mut e,&original);assert_eq!(again["paragraphDirection"],"rtl");assert_eq!(again["operations"],auto["operations"]);
    }
    #[test] fn variable_weight_changes_normalized_coords_and_outlines() {
        let mut e=engine();let normal=shape(&mut e,&request("Variable"));let mut bold=request("Variable");bold["spans"][0]["fontWeight"]=json!(700);let bold=shape(&mut e,&bold);
        assert_ne!(normal["runs"][0]["normalizedCoords"],bold["runs"][0]["normalizedCoords"]);assert_ne!(normal["operations"],bold["operations"]);
    }
    #[test] fn explicit_axes_are_validated_and_applied() {
        let mut e=engine();let mut narrow=request("Widths");narrow["spans"][0]["variations"]=json!({"wdth":75});let normal=shape(&mut e,&request("Widths"));let narrow=shape(&mut e,&narrow);
        assert!(narrow["width"].as_f64().unwrap()<normal["width"].as_f64().unwrap());
        for variation in [json!({"FAKE":12}),json!({"wght":2000}),json!({"wght":null})] {let mut bad=request("x");bad["spans"][0]["variations"]=variation;assert!(e.shape_checked(&bad.to_string()).is_err());}
    }
    #[test] fn mixed_styles_and_decorations_have_explicit_ordered_paint() {
        let mut req=request("left right");let mut a=req["spans"][0].clone();a["end"]=json!(5);a["underline"]=json!(true);a["highlight"]=json!("#ffff0080");let mut b=a.clone();b["start"]=json!(5);b["end"]=json!(10);b["color"]=json!("#0000ffff");b["fontWeight"]=json!(700);b["strike"]=json!(true);req["spans"]=json!([a,b]);let shaped=shape(&mut engine(),&req);
        let ops=shaped["operations"].as_array().unwrap();assert!(ops.iter().any(|o|o["object"]["id"].as_str().unwrap().contains("highlight")));assert!(ops.iter().any(|o|o["object"]["id"].as_str().unwrap().contains("underline")));assert!(ops.iter().any(|o|o["object"]["id"].as_str().unwrap().contains("strike")));
    }
    #[test] fn missing_faces_revisions_epochs_and_glyphs_are_typed_refusals() {
        let mut e=engine();let mut req=request("x");req["fontEpoch"]=json!("stale");assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("FONT_EPOCH_STALE"));
        let mut req=request("x");req["spans"][0]["fonts"][0]["revision"]=json!("old");assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("FONT_REVISION_STALE"));
        let mut req=request("x");req["spans"][0]["fonts"][0]["key"]=json!("missing");assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("FONT_NOT_READY"));
        assert!(e.shape_checked(&request("🦄").to_string()).unwrap_err().starts_with("FONT_GLYPH_MISSING"));
    }
    #[test] fn fake_italic_cannot_silently_use_upright_outlines() {
        let mut req=request("italic");req["spans"][0]["fontStyle"]=json!("italic");assert!(engine().shape_checked(&req.to_string()).unwrap_err().starts_with("FONT_SYNTHESIS_UNSUPPORTED"));
    }
    #[test] fn malformed_spans_nonfinite_geometry_unknown_fields_are_rejected() {
        let mut e=engine();for mut req in [request("سلام"),request("x"),request("x"),request("x"),request("x")] {
            match req["text"].as_str().unwrap(){"سلام"=>req["spans"][0]["end"]=json!(1),_=>req["transform"]=json!([0,0,0,0,0,0])};assert!(e.shape_checked(&req.to_string()).is_err());
        }
        let mut req=request("x");req["html"]=json!("<span>x</span>");assert!(e.shape_checked(&req.to_string()).unwrap_err().starts_with("TEXT_UNSUPPORTED"));
    }
    #[test] fn registry_conflicts_removal_and_cache_lifetime_are_bounded() {
        let mut e=engine();e.register_checked("latin".into(),"1".into(),0,LATIN.to_vec()).unwrap();
        assert!(e.register_checked("latin".into(),"2".into(),0,LATIN.to_vec()).unwrap_err().starts_with("FONT_REVISION_CONFLICT"));
        shape(&mut e,&request("cached outlines"));assert!(e.cache_commands>0);e.remove_checked("latin").unwrap();assert_eq!(e.cache_commands,0);
        assert!(e.shape_checked(&request("x").to_string()).is_err());
    }
    #[test] fn malformed_fonts_and_invalid_face_index_are_refused() {
        let mut e=engine();for bytes in [vec![],vec![0;32],b"not a font".to_vec()] {assert!(e.register_checked("bad".into(),"1".into(),0,bytes).is_err());}
        assert!(e.register_checked("bad".into(),"1".into(),1,LATIN.to_vec()).is_err());
    }
    #[test] fn prepared_outline_operations_render_on_actual_cpu_pipeline() {
        let mut req=request("office سلام");req["transform"]=json!([1,0,0,1,12,10]);let shaped=shape(&mut engine(),&req);
        let list=json!({"schema":"art-equation.display-list","schemaVersion":2,"sceneId":"real-text","revision":"1","environment":{"background":"#00000000","colorSpace":"srgb"},"resources":[],"operations":shaped["operations"]});
        let pixels=crate::cpu::render_cpu_snapshot(400,120,&list.to_string(),1.,0.,0.).unwrap();let painted=pixels.chunks_exact(4).filter(|p|p[3]>0).count();assert!(painted>200);assert!(pixels[0..4].iter().all(|b|*b==0));
    }
    #[cfg(windows)]
    #[test] fn ttc_selected_face_is_isolated_and_cjk_fallback_can_shape() {
        let bytes=std::fs::read("C:/Windows/Fonts/msyh.ttc").expect("native Chinese fixture font installed");let mut e=engine();e.register_checked("cjk".into(),"native-fixture".into(),0,bytes).unwrap();
        let mut req=request("Latin 中文");req["spans"][0]["fonts"].as_array_mut().unwrap().push(json!({"key":"cjk","revision":"native-fixture"}));let shaped=shape(&mut e,&req);
        assert!(shaped["runs"].as_array().unwrap().iter().any(|r|r["font"]["key"]=="cjk"));
    }
}
