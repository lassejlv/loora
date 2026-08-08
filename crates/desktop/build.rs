fn main() {
    println!("cargo:rerun-if-changed=assets/windows/app-icon.rc");
    println!("cargo:rerun-if-changed=assets/windows/app-icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        embed_resource::compile("assets/windows/app-icon.rc", embed_resource::NONE)
            .manifest_optional()
            .expect("failed to embed the Windows application icon");
    }
}
