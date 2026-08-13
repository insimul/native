//! Locate the cmake-built libinsimul and link it into the -sys crate.
//!
//! WHY NOT BINDGEN: `include/insimul.h` is a deliberately tiny, opaque contract
//! (two opaque structs, thirteen `extern "C"` functions, all parameters
//! `*const c_char`/`c_int`). Hand-writing it keeps this crate dependency-free —
//! no libclang on the build host, no 60-crate build-dep tree — which matters
//! because the server track builds this on CI runners and in containers.
//! The cost of hand-writing is drift, so this script *checks* for drift: every
//! `insimul_*` function declared in the header must appear in src/lib.rs, or the
//! build fails (see `check_header_coverage`).
//!
//! Paths are resolved, never hardcoded: the repo root is found by walking up
//! from CARGO_MANIFEST_DIR, and the library directory is discovered under it
//! (or overridden with `INSIMUL_LIB_DIR` / `INSIMUL_INCLUDE_DIR`).

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let root = repo_root(&manifest_dir).unwrap_or_else(|| {
        panic!(
            "insimul-sys: could not find the insimul-native repo root above {}\n\
             (looked for a directory containing both CMakeLists.txt and include/insimul.h)",
            manifest_dir.display()
        )
    });

    let header = match env::var_os("INSIMUL_INCLUDE_DIR") {
        Some(dir) => PathBuf::from(dir).join("insimul.h"),
        None => root.join("include").join("insimul.h"),
    };
    println!("cargo:rerun-if-env-changed=INSIMUL_INCLUDE_DIR");
    println!("cargo:rerun-if-env-changed=INSIMUL_LIB_DIR");
    println!("cargo:rerun-if-changed={}", header.display());
    println!("cargo:rerun-if-changed=src/lib.rs");

    check_header_coverage(&header, &manifest_dir.join("src").join("lib.rs"));

    let lib_dir = find_lib_dir(&root).unwrap_or_else(|| {
        panic!(
            "insimul-sys: no libinsimul.a found under {}\n\
             Build the C core first:\n\
             \n    cmake -B build -S {} && cmake --build build -j\n\n\
             or point INSIMUL_LIB_DIR at a directory containing libinsimul.a.",
            root.display(),
            root.display()
        )
    });

    let lib = lib_dir.join(LIB_FILE);
    println!("cargo:rerun-if-changed={}", lib.display());

    // The cmake tree holds BOTH libinsimul.a and libinsimul.dylib, and a linker
    // searching that directory picks the shared one (which then fails to load at
    // run time: it is not installed and has no usable rpath). Stage the archive
    // alone in OUT_DIR so `static=insimul` can only resolve to it.
    let staged_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    fs::copy(&lib, staged_dir.join(LIB_FILE))
        .unwrap_or_else(|e| panic!("insimul-sys: cannot stage {}: {e}", lib.display()));

    println!("cargo:rustc-link-search=native={}", staged_dir.display());
    println!("cargo:rustc-link-lib=static=insimul");

    replay_link_manifest(&lib_dir);

    // libinsimul embeds Trealla, which needs libm and pthreads (CMakeLists marks
    // both INTERFACE requirements of the `insimul` target). On macOS both live in
    // libSystem and are linked implicitly.
    if !cfg!(target_os = "macos") {
        println!("cargo:rustc-link-lib=dylib=m");
        println!("cargo:rustc-link-lib=dylib=pthread");
    }

    // Downstream crates (the safe wrapper) get these via DEP_INSIMUL_* env vars.
    println!("cargo:root={}", root.display());
    println!("cargo:lib_dir={}", lib_dir.display());
    println!("cargo:include={}", root.join("include").display());
}


/// Replay `<build-dir>/insimul-link.txt`, the link interface CMake wrote down.
///
/// `libinsimul.a` is self-contained for one engine selection and not for
/// another: an engine compiled INTO the archive needs nothing here, while an
/// engine the archive merely references is a shared library this crate has to
/// find at link time and the loader has to find at run time. Cargo cannot read
/// CMake's link interface, so the build tree states it in a two-token-per-line
/// file and this function replays it.
///
/// This function names no engine on purpose (leak L-02): the vendor appears in
/// the generated file as a value, never in code that would have to be edited to
/// swap engines. A build tree without the file is fine — it predates this or
/// needs nothing.
fn replay_link_manifest(lib_dir: &Path) {
    let manifest = lib_dir.join("insimul-link.txt");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let Ok(text) = fs::read_to_string(&manifest) else { return };

    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match key.trim() {
            "search" => println!("cargo:rustc-link-search=native={value}"),
            "lib" => println!("cargo:rustc-link-lib=dylib={value}"),
            // The engine's install name is @rpath-relative, so a test binary
            // that links it will not START without this.
            "rpath" => println!("cargo:rustc-link-arg=-Wl,-rpath,{value}"),
            // `engine=` is provenance for a human reading the file; nothing to
            // replay, and NOT a cargo:warning — a build that is working
            // correctly must not print one.
            _ => {}
        }
    }
}

const LIB_FILE: &str = "libinsimul.a";

/// Walk up from `start` looking for the insimul-native checkout.
fn repo_root(start: &Path) -> Option<PathBuf> {
    start.ancestors().find_map(|dir| {
        let is_root =
            dir.join("CMakeLists.txt").is_file() && dir.join("include").join("insimul.h").is_file();
        is_root.then(|| dir.to_path_buf())
    })
}

/// `INSIMUL_LIB_DIR`, else the usual cmake build trees under the repo root
/// (`build/`, `build-*/`, plus per-config subdirs for multi-config generators).
fn find_lib_dir(root: &Path) -> Option<PathBuf> {
    if let Some(dir) = env::var_os("INSIMUL_LIB_DIR") {
        let dir = PathBuf::from(dir);
        return dir.join(LIB_FILE).is_file().then_some(dir);
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        let mut trees: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.is_dir()
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .is_some_and(|n| n == "build" || n.starts_with("build-"))
            })
            .collect();
        trees.sort();
        // `build/` first, then any `build-*` variant, so the canonical tree wins.
        trees.sort_by_key(|p| p.file_name().and_then(|n| n.to_str()) != Some("build"));
        for tree in trees {
            candidates.push(tree.join("Release"));
            candidates.push(tree.join("Debug"));
            candidates.push(tree);
        }
    }
    candidates.into_iter().find(|d| d.join(LIB_FILE).is_file())
}

/// Fail the build if the header declares an `insimul_*` function this crate does
/// not bind. This is the drift guard that replaces bindgen.
fn check_header_coverage(header: &Path, lib_rs: &Path) {
    let (Ok(header_src), Ok(lib_src)) = (fs::read_to_string(header), fs::read_to_string(lib_rs))
    else {
        panic!(
            "insimul-sys: cannot read {} and {}",
            header.display(),
            lib_rs.display()
        );
    };

    let missing: Vec<String> = declared_functions(&header_src)
        .into_iter()
        .filter(|name| !lib_src.contains(&format!("fn {name}(")))
        .collect();

    if !missing.is_empty() {
        panic!(
            "insimul-sys: {} declares function(s) not bound in src/lib.rs: {}\n\
             Add the matching `extern \"C\"` declaration(s).",
            header.display(),
            missing.join(", ")
        );
    }
}

/// Every `insimul_<name>(` occurrence in the header that is a declaration
/// (i.e. outside comments). The header only mentions functions in comments and
/// in their own declarations, so a comment-stripping scan is exact enough.
fn declared_functions(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    for decl in strip_block_comments(src).split(';') {
        let Some(open) = decl.find('(') else { continue };
        let name: String = decl[..open]
            .chars()
            .rev()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if name.starts_with("insimul_") && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

fn strip_block_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;
    while let Some(start) = rest.find("/*") {
        out.push_str(&rest[..start]);
        match rest[start..].find("*/") {
            Some(end) => rest = &rest[start + end + 2..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}
