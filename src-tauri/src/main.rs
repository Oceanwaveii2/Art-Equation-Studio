// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if art_equation_studio_lib::experimental_compute::worker_main() { return; }
    art_equation_studio_lib::run();
}
