//! Replay the rpath half of the C build's link interface for THIS crate's
//! binaries (tests, examples, benches).
//!
//! `insimul-sys` already replays `<build-dir>/insimul-link.txt` — but a build
//! script's `rustc-link-arg` only reaches its OWN package's targets, and the
//! binaries that have to *start* are this crate's. An engine that libinsimul
//! links rather than contains (see the manifest's comment in CMakeLists.txt)
//! has an `@rpath`-relative install name, so without this every test binary
//! dies in dyld before `main`.
//!
//! `DEP_INSIMUL_LIB_DIR` comes from insimul-sys's `links = "insimul"` key, so
//! this crate never searches for the build tree itself. No engine is named
//! here: the manifest is a list of directives (leak L-02).

use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=DEP_INSIMUL_LIB_DIR");
    let Some(lib_dir) = std::env::var_os("DEP_INSIMUL_LIB_DIR").map(PathBuf::from) else {
        return;
    };
    let manifest = lib_dir.join("insimul-link.txt");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let Ok(text) = std::fs::read_to_string(&manifest) else {
        return;
    };
    for line in text.lines() {
        if let Some(dir) = line.trim().strip_prefix("rpath=") {
            if !dir.is_empty() {
                println!("cargo:rustc-link-arg=-Wl,-rpath,{dir}");
            }
        }
    }
}
