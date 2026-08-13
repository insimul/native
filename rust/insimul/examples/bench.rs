//! bench.rs — the Rust leg of the D20 measurement (tasklist 250, US-3).
//!
//! The same three phases as `tests/bench.c`, over the same committed world
//! (`bench/world/`) and the same goal list (`bench/world/QUERIES.txt`), through
//! the safe wrapper instead of the raw ABI:
//!
//!   create   `KnowledgeBase::new()` — a cold engine start, once per process.
//!   consult  every world file, in the manifest's order (passed by the caller).
//!   query    every goal, exhausted; the total is printed so a leg that is not
//!            holding the same world is visible before any timing is read.
//!
//! Resident memory is NOT measured here. `insimul` and `insimul-sys` are
//! deliberately dependency-free (no `libc`), and inventing a platform-specific
//! RSS reader in an example would be a worse number than the one the operating
//! system already reports: `scripts/measure.sh` runs this binary under the
//! system timer (`/usr/bin/time -l`) and records peak RSS from that, using the
//! same quantity `getrusage(RUSAGE_SELF).ru_maxrss` gives the native leg.
//!
//!   cargo run --manifest-path rust/Cargo.toml -p insimul --release \
//!             --example bench -- --queries bench/world/QUERIES.txt <world.pl>...

use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut queries_path: Option<String> = None;
    let mut json_path: Option<String> = None;
    let mut label = "rust".to_string();
    let mut files: Vec<String> = Vec::new();

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--queries" => queries_path = args.next(),
            "--json" => json_path = args.next(),
            "--label" => label = args.next().unwrap_or(label),
            other if other.starts_with("--") => {
                eprintln!("bench: unknown option {other}");
                std::process::exit(2);
            }
            other => files.push(other.to_string()),
        }
    }
    if files.is_empty() {
        eprintln!("usage: bench [--json f] [--queries f] [--label s] <world.pl>...");
        std::process::exit(2);
    }

    // Read every input before the clock starts: this measures the engine, not
    // the file system (tests/bench.c does the same).
    let sources: Vec<String> = files
        .iter()
        .map(|f| std::fs::read_to_string(f).unwrap_or_else(|e| panic!("bench: cannot read {f}: {e}")))
        .collect();
    let total_bytes: usize = sources.iter().map(|s| s.len()).sum();
    let goals: Vec<String> = match &queries_path {
        Some(p) => std::fs::read_to_string(p)?
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(str::to_string)
            .collect(),
        None => Vec::new(),
    };

    let t0 = Instant::now();
    let mut kb = insimul::KnowledgeBase::new()?;
    let create_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let t1 = Instant::now();
    for source in &sources {
        kb.consult(source)?;
    }
    let consult_ms = t1.elapsed().as_secs_f64() * 1000.0;

    let t2 = Instant::now();
    let mut solutions = 0usize;
    for goal in &goals {
        // solve_raw: the RAW ABI strings, the same work the native leg does —
        // parsing them into a model would measure serde, not the engine.
        solutions += kb.solve_raw(goal)?.len();
    }
    let query_ms = t2.elapsed().as_secs_f64() * 1000.0;

    println!(
        "bench[{label}]: create {create_ms:.2} ms, consult {consult_ms:.2} ms \
         ({total_bytes} bytes, {} files), query {query_ms:.2} ms ({solutions} solutions)",
        files.len()
    );

    if let Some(path) = json_path {
        let record = format!(
            "{{\"leg\":\"{label}\",\"version\":\"{}\",\
             \"ms\":{{\"create\":{create_ms:.3},\"consult\":{consult_ms:.3},\"query\":{query_ms:.3}}},\
             \"world\":{{\"files\":{},\"bytes\":{total_bytes}}},\"solutions\":{solutions}}}\n",
            insimul::version().replace('\\', "\\\\").replace('"', "\\\""),
            files.len(),
        );
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
        f.write_all(record.as_bytes())?;
    }

    // The KB is still alive here on purpose: the measured process holds the
    // world's KB when the system timer records its peak RSS.
    drop(kb);
    Ok(())
}
