use super::{ExportFormat, ExportSettings, MetadataCorrections};
use exif::{experimental::Writer, Context, Field, In, Reader, Tag, Value};
use std::{
    fs::File,
    io::{BufReader, Cursor},
    path::Path,
};

fn keep_tag(tag: Tag, settings: &ExportSettings) -> bool {
    match tag {
        Tag::Make | Tag::Model => settings.keep_camera,
        Tag::LensMake | Tag::LensModel | Tag::LensSpecification => settings.keep_lens,
        Tag::BodySerialNumber | Tag::LensSerialNumber => settings.keep_serial,
        Tag::DateTime
        | Tag::DateTimeOriginal
        | Tag::DateTimeDigitized
        | Tag::SubSecTime
        | Tag::SubSecTimeOriginal
        | Tag::SubSecTimeDigitized
        | Tag::OffsetTime
        | Tag::OffsetTimeOriginal
        | Tag::OffsetTimeDigitized => settings.keep_date,
        Tag::ExposureTime
        | Tag::ExposureProgram
        | Tag::ExposureBiasValue
        | Tag::ExposureMode
        | Tag::FNumber
        | Tag::ShutterSpeedValue
        | Tag::ApertureValue
        | Tag::MeteringMode
        | Tag::Flash
        | Tag::PhotographicSensitivity
        | Tag::SensitivityType
        | Tag::StandardOutputSensitivity
        | Tag::RecommendedExposureIndex
        | Tag::ISOSpeed
        | Tag::FocalLength
        | Tag::FocalLengthIn35mmFilm => settings.keep_exposure,
        _ => tag.context() == Context::Gps && settings.keep_gps,
    }
}

fn text_field(tag: Tag, text: &str) -> Field {
    Field {
        tag,
        ifd_num: In::PRIMARY,
        value: Value::Ascii(vec![text.as_bytes().to_vec()]),
    }
}

fn ascii(field: &Field) -> Option<&str> {
    let Value::Ascii(values) = &field.value else {
        return None;
    };
    std::str::from_utf8(values.first()?).ok().map(str::trim)
}

pub fn filtered_exif(
    photo: &Path,
    settings: &ExportSettings,
    corrections: &MetadataCorrections,
) -> Result<Option<Vec<u8>>, String> {
    let source = File::open(photo).map_err(|error| error.to_string())?;
    let source = Reader::new()
        .read_from_container(&mut BufReader::new(source))
        .ok();
    let source_fields = source
        .iter()
        .flat_map(|source| source.fields())
        .filter(|field| field.ifd_num == In::PRIMARY);

    let camera = corrections.camera.as_deref().filter(|value| {
        settings.apply_metadata_corrections && settings.keep_camera && !value.trim().is_empty()
    });
    let lens = corrections.lens.as_deref().filter(|value| {
        settings.apply_metadata_corrections && settings.keep_lens && !value.trim().is_empty()
    });
    if [camera, lens]
        .into_iter()
        .flatten()
        .any(|value| !value.is_ascii() || value.contains('\0'))
    {
        return Err(
            "The camera or lens correction cannot be written as an EXIF text field.".to_owned(),
        );
    }

    let make = source
        .as_ref()
        .and_then(|source| source.get_field(Tag::Make, In::PRIMARY))
        .and_then(ascii);
    let mut remove_make = false;
    let corrected_camera = camera.map(|camera| {
        let camera = camera.trim();
        let model = make
            .and_then(|make| {
                let prefix = camera.get(..make.len())?;
                let remaining = camera.get(make.len()..)?;
                (prefix.eq_ignore_ascii_case(make) && remaining.starts_with(char::is_whitespace))
                    .then_some(remaining.trim())
            })
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                remove_make = true;
                camera
            });
        text_field(Tag::Model, model)
    });
    let corrected_lens = lens.map(|lens| text_field(Tag::LensModel, lens.trim()));

    let retained = source_fields.filter(|field| {
        keep_tag(field.tag, settings)
            && !(field.tag == Tag::Make && remove_make)
            && !(field.tag == Tag::Model && corrected_camera.is_some())
            && !(field.tag == Tag::LensModel && corrected_lens.is_some())
    });
    let mut fields = retained
        .chain(corrected_camera.iter())
        .chain(corrected_lens.iter())
        .peekable();
    if fields.peek().is_none() {
        return Ok(None);
    }

    let mut writer = Writer::new();
    for field in fields {
        writer.push_field(field);
    }
    let mut bytes = Cursor::new(Vec::new());
    writer
        .write(&mut bytes, false)
        .map_err(|error| error.to_string())?;
    Ok(Some(bytes.into_inner()))
}

pub fn attach_exif(
    mut bytes: Vec<u8>,
    exif: Vec<u8>,
    format: ExportFormat,
) -> Result<Vec<u8>, String> {
    match format {
        ExportFormat::Jpeg => {
            if !bytes.starts_with(&[0xff, 0xd8]) {
                return Err("The JPEG encoder produced an invalid file.".to_owned());
            }
            let length =
                u16::try_from(exif.len() + 8).map_err(|_| "The JPEG EXIF data is too large.")?;
            let mut segment = vec![0xff, 0xe1];
            segment.extend(length.to_be_bytes());
            segment.extend(b"Exif\0\0");
            segment.extend(exif);
            bytes.splice(2..2, segment);
            Ok(bytes)
        }
        ExportFormat::Png => {
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                || bytes.get(12..16) != Some(b"IHDR")
                || bytes.len() < 33
            {
                return Err("The PNG encoder produced an invalid file.".to_owned());
            }
            let mut chunk = Vec::with_capacity(exif.len() + 12);
            let length =
                u32::try_from(exif.len()).map_err(|_| "The PNG EXIF data is too large.")?;
            chunk.extend(length.to_be_bytes());
            chunk.extend(b"eXIf");
            chunk.extend(exif);
            let checksum = crc32fast::hash(&chunk[4..]);
            chunk.extend(checksum.to_be_bytes());
            bytes.splice(33..33, chunk);
            Ok(bytes)
        }
        ExportFormat::Webp => {
            if bytes.get(12..16) != Some(b"VP8X") || bytes.len() < 30 {
                return Err("The WebP encoder produced an invalid extended file.".to_owned());
            }
            bytes[20] |= 0x08;
            push_webp_chunk(&mut bytes, b"EXIF", &exif)?;
            set_riff_length(&mut bytes)?;
            Ok(bytes)
        }
    }
}

pub fn webp_with_profile(
    original: Vec<u8>,
    width: u32,
    height: u32,
    profile: &[u8],
) -> Result<Vec<u8>, String> {
    if !original.starts_with(b"RIFF") || original.get(8..12) != Some(b"WEBP") {
        return Err("The WebP encoder produced an invalid file.".to_owned());
    }
    if original.get(12..16) == Some(b"VP8X") {
        if original.len() < 30 {
            return Err("The WebP encoder produced an invalid extended file.".to_owned());
        }
        let mut bytes = original;
        if !profile.is_empty() && bytes[20] & 0x20 == 0 {
            let mut icc_chunk = Vec::new();
            push_webp_chunk(&mut icc_chunk, b"ICCP", profile)?;
            bytes.splice(30..30, icc_chunk);
            bytes[20] |= 0x20;
        }
        set_riff_length(&mut bytes)?;
        return Ok(bytes);
    }
    // libwebp can choose lossy VP8 or lossless VP8L for RGBA input.
    let pixel_chunk = original.get(12..16);
    if pixel_chunk != Some(b"VP8 ") && pixel_chunk != Some(b"VP8L") {
        return Err("The WebP encoder produced an unexpected pixel chunk.".to_owned());
    }
    let mut bytes = b"RIFF\0\0\0\0WEBP".to_vec();
    let mut header = [0; 10];
    header[0] = if profile.is_empty() { 0 } else { 0x20 };
    header[4..7].copy_from_slice(&(width - 1).to_le_bytes()[..3]);
    header[7..10].copy_from_slice(&(height - 1).to_le_bytes()[..3]);
    push_webp_chunk(&mut bytes, b"VP8X", &header)?;
    if !profile.is_empty() {
        push_webp_chunk(&mut bytes, b"ICCP", profile)?;
    }
    bytes.extend(&original[12..]);
    set_riff_length(&mut bytes)?;
    Ok(bytes)
}

fn push_webp_chunk(bytes: &mut Vec<u8>, name: &[u8; 4], payload: &[u8]) -> Result<(), String> {
    let length = u32::try_from(payload.len()).map_err(|_| "A WebP chunk is too large.")?;
    bytes.extend(name);
    bytes.extend(length.to_le_bytes());
    bytes.extend(payload);
    if payload.len() % 2 == 1 {
        bytes.push(0);
    }
    Ok(())
}

fn set_riff_length(bytes: &mut [u8]) -> Result<(), String> {
    let length = u32::try_from(bytes.len() - 8).map_err(|_| "The WebP file is too large.")?;
    bytes[4..8].copy_from_slice(&length.to_le_bytes());
    Ok(())
}
