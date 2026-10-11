//! Real OS/process fixture; runs unchanged on Windows and a physical Android ABI.
use autogram_core::platform::file_lock::try_lock_exclusive;
use std::{fs::{self, OpenOptions}, io::ErrorKind, process::Command};

#[test]
fn child_lock_probe() {
    let Some(path) = std::env::var_os("AUTOGRAM_LOCK_FIXTURE") else { return };
    let file = OpenOptions::new().read(true).write(true).open(path).unwrap();
    match std::env::var("AUTOGRAM_LOCK_MODE").unwrap().as_str() {
        "contended" => assert_eq!(try_lock_exclusive(&file).unwrap_err().kind(), ErrorKind::WouldBlock),
        "hold_and_exit" => {
            try_lock_exclusive(&file).unwrap();
            // Intentionally skip destructors: the OS must release this descriptor.
            std::process::exit(0);
        }
        _ => panic!("Unknown fixture mode"),
    }
}

#[test]
fn exclusive_lock_blocks_other_process_and_survives_holder_exit() {
    let root = std::env::temp_dir().join(format!("autogram-lock-fixture-{}", rand::random::<u64>()));
    fs::create_dir(&root).unwrap();
    let path = root.join("owned.lock");
    let file = OpenOptions::new().read(true).write(true).create_new(true).open(&path).unwrap();
    try_lock_exclusive(&file).unwrap();
    let other = OpenOptions::new().read(true).write(true).open(&path).unwrap();
    assert_eq!(try_lock_exclusive(&other).unwrap_err().kind(), ErrorKind::WouldBlock);
    let child = |mode: &str| Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "child_lock_probe", "--nocapture"])
        .env("AUTOGRAM_LOCK_FIXTURE", &path).env("AUTOGRAM_LOCK_MODE", mode)
        .status().unwrap();
    assert!(child("contended").success());
    drop(file);
    assert!(child("hold_and_exit").success());
    try_lock_exclusive(&other).unwrap();
    drop(other);
    fs::remove_file(&path).unwrap();
    fs::remove_dir(&root).unwrap();
}
