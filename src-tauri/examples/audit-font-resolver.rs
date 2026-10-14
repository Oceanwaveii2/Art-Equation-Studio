#[path = "../src/font_resolver.rs"]
mod font_resolver;
use std::io::{self, Read};
fn main() {
    let mut input=String::new();io::stdin().read_to_string(&mut input).unwrap();
    let value: serde_json::Value=serde_json::from_str(&input).unwrap();
    let result=match value["command"].as_str().unwrap_or("") {
        "resolve_system_font" => font_resolver::resolve(serde_json::from_value(value["request"].clone()).unwrap()).map(|v|serde_json::to_value(v).unwrap()),
        "resolve_system_font_fallbacks" => font_resolver::resolve_fallbacks(serde_json::from_value(value["request"].clone()).unwrap()).map(|v|serde_json::to_value(v).unwrap()),
        _=>Err("Unsupported audit command".to_owned()),
    };
    match result {Ok(value)=>println!("{}",value),Err(error)=>{eprintln!("{}",error);std::process::exit(1)}}
}
