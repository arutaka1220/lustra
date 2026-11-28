use std::{env, fs, path::PathBuf};

fn main() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let source = args.next().ok_or(
        "usage: export-renderer-baseline-case <source> <job.json> <settings.json> <output> [count]",
    )?;
    let job = args.next().ok_or("missing job.json")?;
    let settings = args.next().ok_or("missing settings.json")?;
    let output = PathBuf::from(args.next().ok_or("missing output path")?);
    let count = args
        .next()
        .map(|value| value.parse::<usize>().map_err(|error| error.to_string()))
        .transpose()?
        .unwrap_or(1);
    if args.next().is_some() {
        return Err("unexpected extra argument".to_owned());
    }
    if count == 0 || count > 1_000 {
        return Err("count must be between 1 and 1000".to_owned());
    }

    let source = PathBuf::from(source);
    let mut sources = if source.is_dir() {
        let mut paths = fs::read_dir(&source)
            .map_err(|error| error.to_string())?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        paths.retain(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .map(|value| {
                        matches!(
                            value.to_ascii_lowercase().as_str(),
                            "jpg" | "jpeg" | "png" | "webp"
                        )
                    })
                    .unwrap_or(false)
        });
        paths.sort();
        paths
    } else {
        vec![source]
    };
    for path in &mut sources {
        *path = path.canonicalize().map_err(|error| error.to_string())?;
    }
    if sources.is_empty() {
        return Err("source directory contains no supported images".to_owned());
    }
    let job = fs::read_to_string(job).map_err(|error| error.to_string())?;
    let settings = fs::read_to_string(settings).map_err(|error| error.to_string())?;
    let extension = match serde_json::from_str::<serde_json::Value>(&settings)
        .map_err(|error| error.to_string())?
        .get("format")
        .and_then(serde_json::Value::as_str)
    {
        Some("jpeg") => "jpg",
        Some("png") => "png",
        Some("webp") => "webp",
        _ => return Err("settings format must be jpeg, png, or webp".to_owned()),
    };
    if count > 1 {
        fs::create_dir_all(&output).map_err(|error| error.to_string())?;
    } else if let Some(parent) = output.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    for index in 0..count {
        let source = sources[index % sources.len()].clone();
        let bytes = lustra_lib::render_export_example(source, &job, &settings)?;
        let destination = if count == 1 {
            output.clone()
        } else {
            output.join(format!("{index:04}.{extension}"))
        };
        fs::write(destination, bytes).map_err(|error| error.to_string())?;
    }
    Ok(())
}
