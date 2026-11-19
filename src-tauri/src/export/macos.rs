use super::{
    layout, metadata, ColorSpace, ExportFormat, ExportJob, ExportSettings, FrameStyle, Rect,
    TextItem,
};
use std::{
    ffi::{c_char, c_void, CString},
    os::unix::ffi::OsStrExt,
    path::Path,
    ptr::NonNull,
};

#[repr(C)]
struct NativeRenderSettings {
    width: u32,
    height: u32,
    format: u32,
    quality: u32,
    preserve_color_space: u32,
    style: u32,
    custom_color: u32,
    inset: u32,
    shadow: u32,
    image: Rect,
    visible: Rect,
    blur: f64,
    brightness: f64,
    opacity: f64,
}

#[repr(C)]
struct NativeText {
    text: *const c_char,
    font_family: *const c_char,
    weight: u32,
    horizontal_anchor: u32,
    vertical_anchor: u32,
    rgba: u32,
    x: f64,
    y: f64,
    size: f64,
}

#[derive(Default)]
#[repr(C)]
struct NativeOutput {
    pixels: *mut u8,
    pixel_size: usize,
    icc: *mut u8,
    icc_size: usize,
}

impl NativeOutput {
    fn pixels(&self) -> &[u8] {
        if self.pixels.is_null() {
            &[]
        } else {
            // The native renderer owns both allocations until this wrapper drops.
            unsafe { std::slice::from_raw_parts(self.pixels, self.pixel_size) }
        }
    }

    fn icc(&self) -> &[u8] {
        if self.icc.is_null() {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(self.icc, self.icc_size) }
        }
    }
}

impl Drop for NativeOutput {
    fn drop(&mut self) {
        unsafe {
            lustra_export_free(self.pixels.cast());
            lustra_export_free(self.icc.cast());
        }
    }
}

struct NativeImage(NonNull<c_void>);

impl Drop for NativeImage {
    fn drop(&mut self) {
        unsafe { lustra_image_close(self.0.as_ptr()) };
    }
}

extern "C" {
    fn lustra_webp_available() -> bool;
    fn lustra_memory_bytes() -> u64;
    fn lustra_image_open(
        path: *const c_char,
        width: *mut u32,
        height: *mut u32,
        error: *mut u32,
    ) -> *mut c_void;
    fn lustra_image_close(photo: *mut c_void);
    fn lustra_export_free(bytes: *mut c_void);
    fn lustra_render_image(
        photo: *mut c_void,
        source_width: u32,
        source_height: u32,
        settings: *const NativeRenderSettings,
        text: *const NativeText,
        text_count: usize,
        output: *mut NativeOutput,
    ) -> u32;
}

pub fn available(format: ExportFormat) -> bool {
    format != ExportFormat::Webp || unsafe { lustra_webp_available() }
}

pub fn memory_bytes() -> u64 {
    unsafe { lustra_memory_bytes() }
}

pub fn render(path: &Path, job: &ExportJob, settings: &ExportSettings) -> Result<Vec<u8>, String> {
    let path = CString::new(path.as_os_str().as_bytes()).map_err(|_| "Invalid source path.")?;
    let (mut source_width, mut source_height, mut error) = (0, 0, 0);
    let photo = unsafe {
        lustra_image_open(
            path.as_ptr(),
            &mut source_width,
            &mut source_height,
            &mut error,
        )
    };
    let photo = NativeImage(NonNull::new(photo).ok_or_else(|| error_message(error))?);
    let layout = layout(&job.frame, source_width, source_height, settings.size)?;
    if settings.format == ExportFormat::Webp && (layout.width > 16_383 || layout.height > 16_383) {
        return Err(
            "WebP is limited to 16,383 pixels on each side. Choose a smaller size.".to_owned(),
        );
    }
    let render_settings = NativeRenderSettings {
        width: layout.width,
        height: layout.height,
        format: match settings.format {
            ExportFormat::Jpeg => 0,
            ExportFormat::Png => 1,
            ExportFormat::Webp => 2,
        },
        quality: u32::from(settings.quality),
        preserve_color_space: u32::from(matches!(settings.color_space, ColorSpace::Original)),
        style: match job.frame.style {
            FrameStyle::Black => 0,
            FrameStyle::White => 1,
            FrameStyle::Blurred => 2,
            FrameStyle::SoftWhite => 3,
            FrameStyle::Custom => 4,
        },
        custom_color: parse_hex_color(job.frame.custom_color.as_deref().unwrap_or("#000000")),
        inset: u32::from(job.frame.show_inset),
        shadow: u32::from(job.frame.show_shadow),
        image: layout.image,
        visible: layout.visible_image,
        blur: job.frame.blur_strength.clamp(0.0, 120.0),
        brightness: job.frame.background_brightness.clamp(0.0, 200.0) / 100.0,
        opacity: job.frame.background_opacity.clamp(0.0, 100.0) / 100.0,
    };

    let text_data = job
        .text
        .iter()
        .map(TextData::from_item)
        .collect::<Result<Vec<_>, _>>()?;
    let text = text_data.iter().map(TextData::native).collect::<Vec<_>>();
    let mut output = NativeOutput::default();
    let error = unsafe {
        lustra_render_image(
            photo.0.as_ptr(),
            source_width,
            source_height,
            &render_settings,
            text.as_ptr(),
            text.len(),
            &mut output,
        )
    };
    if error != 0 {
        return Err(error_message(error));
    }
    let bytes = output.pixels().to_vec();
    if settings.format == ExportFormat::Webp {
        metadata::webp_with_profile(bytes, layout.width, layout.height, output.icc())
    } else {
        Ok(bytes)
    }
}

fn parse_hex_color(value: &str) -> u32 {
    let value = value.strip_prefix('#').unwrap_or(value);
    if value.len() == 6 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        u32::from_str_radix(value, 16).unwrap_or(0)
    } else {
        0
    }
}

fn error_message(error: u32) -> String {
    match error {
        1 => "The source could not be decoded as an image.",
        2 => "The source image is too large or has invalid dimensions.",
        3 => "Could not allocate the export canvas.",
        4 => "Preserving the original ICC profile requires an RGB source profile. Select sRGB for this photo.",
        5 => "Could not render the blurred background.",
        _ => "The selected codec could not encode the exported image.",
    }.to_owned()
}

struct TextData<'a> {
    text: CString,
    font_family: CString,
    item: &'a TextItem,
}

impl<'a> TextData<'a> {
    fn from_item(item: &'a TextItem) -> Result<Self, String> {
        let text = CString::new(item.text.as_str())
            .map_err(|_| "The frame text contains an invalid character.")?;
        let font_family =
            CString::new(item.font_family.as_str()).map_err(|_| "The frame font is invalid.")?;
        Ok(Self {
            text,
            font_family,
            item,
        })
    }

    fn native(&self) -> NativeText {
        let (horizontal_anchor, vertical_anchor) = match self.item.anchor.as_str() {
            "top-left" => (0, 0),
            "top-center" => (1, 0),
            "top-right" => (2, 0),
            "bottom-center" => (1, 2),
            "bottom-right" => (2, 2),
            "center" => (1, 1),
            _ => (0, 2),
        };
        let color = self.item.color.trim_start_matches('#');
        let rgba = match color.len() {
            6 => u32::from_str_radix(color, 16).map(|rgb| (rgb << 8) | 0xff),
            _ => u32::from_str_radix(color, 16),
        }
        .unwrap_or(0xffff_ffff);
        NativeText {
            text: self.text.as_ptr(),
            font_family: self.font_family.as_ptr(),
            weight: self.item.weight.clamp(100, 900),
            horizontal_anchor,
            vertical_anchor,
            rgba,
            x: self.item.x.clamp(-10_000.0, 10_000.0),
            y: self.item.y.clamp(-10_000.0, 10_000.0),
            size: self.item.size.clamp(1.0, 360.0),
        }
    }
}
