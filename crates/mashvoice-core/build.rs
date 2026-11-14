use std::{env, fs, path::PathBuf};

const XOR_MASK: &[u8] = b"MashVoice-Singularity-4.1-MyMasha-Key";

fn main() {
    println!("cargo:rerun-if-env-changed=MASHVOICE_BUILD_UPDATER_TOKEN");
    let raw = env::var("MASHVOICE_BUILD_UPDATER_TOKEN").unwrap_or_default();
    let encoded: Vec<u8> = raw
        .trim()
        .as_bytes()
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ XOR_MASK[i % XOR_MASK.len()])
        .collect();

    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let code = format!(
        "const EMBEDDED_UPDATER_XOR: &[u8] = &{:?};\n",
        encoded
    );
    fs::write(out_dir.join("embedded_updater_tok.rs"), code)
        .expect("write embedded_updater_tok.rs");
}
