use serde_json::json;
use std::{env, fs, path::PathBuf};

fn main() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let source = args
        .next()
        .ok_or("usage: documentation-media-examples <source-photo> <output-directory>")?;
    let output = args
        .next()
        .ok_or("usage: documentation-media-examples <source-photo> <output-directory>")?;
    if args.next().is_some() {
        return Err("unexpected extra argument".to_owned());
    }
    let source = PathBuf::from(source)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let output = PathBuf::from(output);
    fs::create_dir_all(&output).map_err(|error| error.to_string())?;
    let variants = [
        ("white", "white", "#ffffff"),
        ("soft-white", "softWhite", "#faf9f6"),
        ("black", "black", "#000000"),
        ("soft-black", "softBlack", "#1b1b1b"),
        ("custom", "custom", "#d9c6a3"),
        ("blurred", "blurred", "#000000"),
        ("ambient-gradient", "ambientGradient", "#000000"),
        ("edge-stretch", "edgeStretch", "#000000"),
        ("portrait-card", "white", "#ffffff"),
    ];
    for (name, style, color) in variants {
        let portrait = name == "portrait-card";
        let job = json!({
            "id": name,
            "path": source,
            "frame": {
                "style": style,
                "canvasLayout": if portrait { "portraitCard" } else { "standard" },
                "portraitRatio": 0.8,
                "portraitPhotoSize": 82.0,
                "portraitVerticalPosition": 0.0,
                "customColor": color,
                "top": if portrait { 10.0 } else { 12.0 },
                "bottom": if portrait { 10.0 } else { 12.0 },
                "left": if portrait { 10.0 } else { 12.0 },
                "right": if portrait { 10.0 } else { 12.0 },
                "blurStrength": 28.0,
                "backgroundBrightness": 0.45,
                "backgroundOpacity": 100.0,
                "showInset": false,
                "showShadow": true,
                "ambientIntensity": 85.0,
                "ambientSoftness": 65.0,
                "ambientBrightness": 0.0,
                "ambientColorSource": "fullImage",
                "edgeStretchMode": "extend",
                "edgeStretchBlur": 8.0,
                "edgeStretchFade": 12.0
            },
            "crop": {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "rotation": 0.0},
            "text": [],
            "metadata": {}
        });
        let bytes = lustra_lib::render_documentation_example(source.clone(), &job.to_string())?;
        fs::write(output.join(format!("{name}.png")), bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}
