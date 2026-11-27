use oxipng::{optimize_from_memory, Options};
use png::{ColorType, Decoder, Transformations};
use serde::Serialize;
use std::{env, fs, io::Cursor, path::PathBuf};

#[derive(Serialize)]
struct OptimizationResult {
    index: usize,
    before_bytes: usize,
    after_bytes: usize,
    width: u32,
    height: u32,
    has_alpha: bool,
}

fn optimize_png(original: &[u8]) -> Result<Vec<u8>, String> {
    let mut options = Options::from_preset(2);
    options.palette_reduction = false;
    options.optimize_alpha = false;
    optimize_from_memory(original, &options).map_err(|error| error.to_string())
}

fn validate_png(data: &[u8]) -> Result<(u32, u32, bool), String> {
    let mut decoder = Decoder::new(Cursor::new(data));
    decoder.set_transformations(Transformations::EXPAND | Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let mut pixels = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("PNG dimensions exceed supported limits")?
    ];
    let frame = reader
        .next_frame(&mut pixels)
        .map_err(|error| error.to_string())?;
    pixels.truncate(frame.buffer_size());

    if frame.width < 100 || frame.height < 100 {
        return Err(format!(
            "implausible PNG dimensions: {} × {}",
            frame.width, frame.height
        ));
    }
    let (channels, alpha_channel) = match frame.color_type {
        ColorType::Grayscale => (1, None),
        ColorType::Rgb => (3, None),
        ColorType::GrayscaleAlpha => (2, Some(1)),
        ColorType::Rgba => (4, Some(3)),
        ColorType::Indexed => return Err("indexed PNG was not expanded".to_owned()),
    };
    let mut first_pixel: Option<&[u8]> = None;
    let mut uniform = true;
    let mut visible = false;
    for pixel in pixels.chunks_exact(channels) {
        if first_pixel.is_some_and(|first| first != pixel) {
            uniform = false;
        }
        first_pixel.get_or_insert(pixel);
        if alpha_channel.map_or(true, |index| pixel[index] != 0) {
            visible = true;
        }
    }
    if !visible {
        return Err("PNG is fully transparent".to_owned());
    }
    if uniform {
        return Err("PNG is visually blank (every pixel is identical)".to_owned());
    }
    Ok((frame.width, frame.height, alpha_channel.is_some()))
}

fn main() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let mut report_path = None;
    let mut paths = Vec::new();
    while let Some(arg) = args.next() {
        if arg == "--report-json" {
            report_path = Some(PathBuf::from(
                args.next().ok_or("--report-json requires an output path")?,
            ));
        } else {
            paths.push(PathBuf::from(arg));
        }
    }
    if paths.is_empty() {
        return Err(
            "usage: documentation-media-optimize [--report-json <path>] <png> [png ...]".to_owned(),
        );
    }

    let mut results = Vec::with_capacity(paths.len());
    for (index, path) in paths.iter().enumerate() {
        let original = fs::read(path).map_err(|error| format!("{}: {error}", path.display()))?;
        let optimized =
            optimize_png(&original).map_err(|error| format!("{}: {error}", path.display()))?;
        let (width, height, has_alpha) =
            validate_png(&optimized).map_err(|error| format!("{}: {error}", path.display()))?;
        let temp_path = path.with_extension("png.oxipng-tmp");
        fs::write(&temp_path, &optimized)
            .map_err(|error| format!("{}: {error}", temp_path.display()))?;
        fs::rename(&temp_path, path).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            format!("{}: {error}", path.display())
        })?;
        results.push(OptimizationResult {
            index,
            before_bytes: original.len(),
            after_bytes: optimized.len(),
            width,
            height,
            has_alpha,
        });
    }

    let report = serde_json::to_vec(&results).map_err(|error| error.to_string())?;
    if let Some(path) = report_path {
        fs::write(&path, report).map_err(|error| format!("{}: {error}", path.display()))?;
    } else {
        println!(
            "{}",
            String::from_utf8(report).map_err(|error| error.to_string())?
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{optimize_png, validate_png};
    use png::{BitDepth, ColorType, Decoder, Encoder};
    use std::io::Cursor;

    fn decode(bytes: &[u8]) -> (u32, u32, ColorType, Vec<u8>) {
        let mut reader = Decoder::new(Cursor::new(bytes)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        pixels.truncate(frame.buffer_size());
        (frame.width, frame.height, frame.color_type, pixels)
    }

    #[test]
    fn optimization_preserves_rgba_pixels_and_transparency() {
        let original_pixels = [
            255, 0, 0, 255, 0, 255, 0, 64, 0, 0, 255, 0, 255, 255, 255, 128,
        ];
        let mut original = Vec::new();
        {
            let mut encoder = Encoder::new(&mut original, 2, 2);
            encoder.set_color(ColorType::Rgba);
            encoder.set_depth(BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&original_pixels)
                .unwrap();
        }

        let optimized = optimize_png(&original).unwrap();

        assert_eq!(decode(&original), decode(&optimized));
    }

    #[test]
    fn validation_rejects_blank_and_fully_transparent_images() {
        fn encode(pixel: [u8; 4]) -> Vec<u8> {
            let pixels = pixel.repeat(100 * 100);
            let mut bytes = Vec::new();
            let mut encoder = Encoder::new(&mut bytes, 100, 100);
            encoder.set_color(ColorType::Rgba);
            encoder.set_depth(BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&pixels)
                .unwrap();
            bytes
        }

        assert!(validate_png(&encode([10, 10, 10, 255]))
            .unwrap_err()
            .contains("visually blank"));
        assert!(validate_png(&encode([10, 10, 10, 0]))
            .unwrap_err()
            .contains("fully transparent"));
    }
}
