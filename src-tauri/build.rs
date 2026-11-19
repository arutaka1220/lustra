fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let mut compiler = cc::Build::new();
        let webp = macos_webp_library();
        if webp.is_some() {
            compiler.define("LUSTRA_HAS_WEBP", None);
        }
        println!("cargo:rerun-if-changed=src/export/macos.m");
        compiler
            .file("src/export/macos.m")
            .flag("-fobjc-arc")
            .compile("lustra_macos_export");
        if let Some(library) = webp {
            println!("cargo:rustc-link-search=native={}", library.display());
            println!("cargo:rustc-link-lib=static=webp");
            println!("cargo:rustc-link-lib=static=sharpyuv");
        }
        for framework in ["Foundation", "CoreGraphics", "CoreText", "ImageIO"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}

fn macos_webp_library() -> Option<std::path::PathBuf> {
    println!("cargo:rerun-if-env-changed=LUSTRA_WEBP_STATIC_DIR");
    let (architecture, default_directory) = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref()
    {
        Ok("aarch64") => ("arm64", "/opt/homebrew/lib"),
        Ok("x86_64") => ("x86_64", "/usr/local/lib"),
        _ => return None,
    };
    let directory = std::env::var_os("LUSTRA_WEBP_STATIC_DIR")
        .map_or_else(|| default_directory.into(), std::path::PathBuf::from);
    for filename in ["libwebp.a", "libsharpyuv.a"] {
        let path = directory.join(filename);
        if !path.is_file() {
            return None;
        }
        println!("cargo:rerun-if-changed={}", path.display());
        let architectures = std::process::Command::new("lipo")
            .arg("-archs")
            .arg(&path)
            .output()
            .ok()?;
        if !architectures.status.success()
            || !String::from_utf8_lossy(&architectures.stdout)
                .split_whitespace()
                .any(|candidate| candidate == architecture)
        {
            return None;
        }
    }
    Some(directory)
}
