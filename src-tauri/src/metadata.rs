use exif::{In, Reader, Tag, Value};
use flate2::read::ZlibDecoder;
use quick_xml::XmlVersion;
use quick_xml::{
    escape::unescape,
    events::{BytesStart, Event},
    name::{Namespace, ResolveResult},
    reader::NsReader,
};
use serde::Serialize;
use std::{
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

const MAX_XMP_PACKET_BYTES: usize = 8 * 1024 * 1024;
const MAX_XMP_XML_DEPTH: usize = 64;
const TIFF_NS: &str = "http://ns.adobe.com/tiff/1.0/";
const EXIF_NS: &str = "http://ns.adobe.com/exif/1.0/";
const EXIF_EX_NS: &str = "http://cipa.jp/exif/1.0/";
const JPEG_XMP_HEADER: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const PNG_XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhotoMetadata {
    camera: Option<String>,
    lens: Option<String>,
    focal_length: Option<String>,
    date: Option<String>,
    aperture: Option<String>,
    shutter_speed: Option<String>,
    iso: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum MetadataReadStatus {
    Complete,
    Partial,
    Missing,
    ParseError,
    FileError,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetadataReadResult {
    pub(crate) metadata: PhotoMetadata,
    pub(crate) status: MetadataReadStatus,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<String>,
}

impl MetadataReadResult {
    fn new(metadata: PhotoMetadata, status: MetadataReadStatus, diagnostics: Vec<String>) -> Self {
        Self {
            metadata,
            status,
            diagnostics,
        }
    }

    fn file_error(message: impl Into<String>) -> Self {
        Self::new(
            PhotoMetadata::default(),
            MetadataReadStatus::FileError,
            vec![message.into()],
        )
    }
}

#[derive(Debug, Default, Clone)]
struct SourceValues {
    make: Option<String>,
    model: Option<String>,
    lens: Option<String>,
    focal_length: Option<String>,
    aperture: Option<String>,
    shutter_speed: Option<String>,
    iso: Option<String>,
    date: Option<String>,
    subsecond: Option<String>,
    offset: Option<String>,
}

#[derive(Debug, Default, Clone)]
struct XmpValues(SourceValues);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XmpField {
    Make,
    Model,
    Lens,
    FocalLength,
    Aperture,
    ShutterSpeed,
    Iso,
    Date,
}

#[derive(Debug)]
enum XmpExtractionError {
    Malformed(String),
    Io(io::Error),
}

#[derive(Debug, Default)]
struct XmpExtraction {
    packets: Vec<Vec<u8>>,
    warnings: Vec<String>,
}

pub(crate) fn read_photo_metadata_file(path: &Path) -> MetadataReadResult {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) => {
            return MetadataReadResult::file_error(format!("Could not open source: {error}"))
        }
    };
    parse_container(&mut file)
}

fn parse_container<R: Read + Seek>(reader: &mut R) -> MetadataReadResult {
    let mut diagnostics = Vec::new();
    let mut has_parse_error = false;

    if let Err(error) = reader.seek(SeekFrom::Start(0)) {
        return MetadataReadResult::file_error(format!("Could not seek source: {error}"));
    }
    let exif_result = {
        let mut buffered = BufReader::new(&mut *reader);
        Reader::new()
            .continue_on_error(true)
            .read_from_container(&mut buffered)
    };
    let exif = match exif_result {
        Ok(exif) => Some(exif),
        Err(error) => match error.distill_partial_result(|errors| {
            has_parse_error = true;
            diagnostics.extend(
                errors
                    .into_iter()
                    .map(|error| format!("EXIF field: {error}")),
            );
        }) {
            Ok(exif) => Some(exif),
            Err(exif::Error::NotFound(_)) => None,
            Err(exif::Error::Io(error)) => {
                return MetadataReadResult::file_error(format!("Could not read source: {error}"));
            }
            Err(error) => {
                has_parse_error = true;
                diagnostics.push(format!("EXIF parse: {error}"));
                None
            }
        },
    };

    if let Err(error) = reader.seek(SeekFrom::Start(0)) {
        return MetadataReadResult::file_error(format!("Could not seek source: {error}"));
    }
    let extraction = match extract_xmp_packets(reader) {
        Ok(extraction) => extraction,
        Err(XmpExtractionError::Io(error))
            if !matches!(
                error.kind(),
                io::ErrorKind::UnexpectedEof | io::ErrorKind::InvalidData
            ) =>
        {
            return MetadataReadResult::file_error(format!("Could not read source: {error}"));
        }
        Err(XmpExtractionError::Io(error)) => {
            has_parse_error = true;
            diagnostics.push(format!("Container parse: {error}"));
            XmpExtraction::default()
        }
        Err(XmpExtractionError::Malformed(error)) => {
            has_parse_error = true;
            diagnostics.push(format!("XMP extraction: {error}"));
            XmpExtraction::default()
        }
    };
    diagnostics.extend(extraction.warnings);

    let mut xmp = XmpValues::default();
    let mut has_valid_xmp_packet = false;
    for (index, packet) in extraction.packets.iter().enumerate() {
        match parse_xmp_packet(packet) {
            Ok(parsed) => {
                has_valid_xmp_packet = true;
                merge_xmp_values(&mut xmp, parsed);
            }
            Err(error) => {
                has_parse_error = true;
                diagnostics.push(format!("XMP packet {} parse: {error}", index + 1));
            }
        }
    }

    let exif_values = exif.as_ref().map(exif_values).unwrap_or_default();
    let metadata = merge_metadata(&exif_values, &xmp.0, &mut diagnostics);
    let metadata_present = exif.is_some() || has_valid_xmp_packet;
    let required_complete = [
        metadata.camera.as_ref(),
        metadata.lens.as_ref(),
        metadata.focal_length.as_ref(),
        metadata.date.as_ref(),
        metadata.aperture.as_ref(),
        metadata.iso.as_ref(),
    ]
    .into_iter()
    .all(|value| value.is_some());

    let status = if has_parse_error {
        MetadataReadStatus::ParseError
    } else if !metadata_present {
        MetadataReadStatus::Missing
    } else if required_complete {
        MetadataReadStatus::Complete
    } else {
        MetadataReadStatus::Partial
    };

    #[cfg(debug_assertions)]
    for diagnostic in &diagnostics {
        eprintln!("[Lustra metadata] {diagnostic}");
    }

    MetadataReadResult::new(metadata, status, diagnostics)
}

fn exif_values(exif: &exif::Exif) -> SourceValues {
    let make = field_text(exif, Tag::Make);
    let model = field_text(exif, Tag::Model);
    SourceValues {
        make,
        model,
        lens: field_text(exif, Tag::LensModel),
        focal_length: field_number(exif, Tag::FocalLength),
        aperture: field_number(exif, Tag::FNumber),
        shutter_speed: field_exposure(exif, Tag::ExposureTime),
        iso: field_number(exif, Tag::PhotographicSensitivity)
            .or_else(|| field_number(exif, Tag::RecommendedExposureIndex)),
        date: field_text(exif, Tag::DateTimeOriginal),
        subsecond: field_text(exif, Tag::SubSecTimeOriginal),
        offset: field_text(exif, Tag::OffsetTimeOriginal),
    }
}

fn field_text(exif: &exif::Exif, tag: Tag) -> Option<String> {
    exif.get_field(tag, In::PRIMARY)
        .and_then(|field| match &field.value {
            Value::Ascii(values) => values.first().map(|value| {
                String::from_utf8_lossy(value)
                    .trim_matches(|character: char| character.is_whitespace() || character == '\0')
                    .to_owned()
            }),
            _ => Some(field.display_value().to_string().trim().to_owned()),
        })
        .filter(|value| !value.is_empty())
}

fn field_number(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let value = exif.get_field(tag, In::PRIMARY)?.value.clone();
    number_from_exif_value(&value)
}

fn number_from_exif_value(value: &Value) -> Option<String> {
    let number = match value {
        Value::Rational(values) => values.first()?.to_f64(),
        Value::SRational(values) => values.first()?.to_f64(),
        Value::Short(values) => *values.first()? as f64,
        Value::Long(values) => *values.first()? as f64,
        Value::Byte(values) => *values.first()? as f64,
        Value::SShort(values) => *values.first()? as f64,
        Value::SLong(values) => *values.first()? as f64,
        Value::Ascii(values) => parse_number(values.first()?.as_slice())?,
        _ => return None,
    };
    Some(format_number(number))
}

fn field_exposure(exif: &exif::Exif, tag: Tag) -> Option<String> {
    let field = exif.get_field(tag, In::PRIMARY)?;
    match &field.value {
        Value::Rational(values) => {
            let rational = values.first()?;
            if rational.denom == 0 {
                return None;
            }
            let value = rational.to_f64();
            Some(format_exposure(value, rational.num, rational.denom))
        }
        _ => parse_exposure(&field.value.display_as(tag).to_string()),
    }
}

fn format_exposure(value: f64, numerator: u32, denominator: u32) -> String {
    let amount = if numerator == 1 {
        format!("1/{denominator}")
    } else if value > 0.0 && value < 0.5 {
        format!("1/{}", (1.0 / value).round() as u32)
    } else {
        format_number(value)
    };
    format!("{amount} s")
}

fn parse_exposure(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches(" s").trim();
    if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator = numerator.trim().parse::<u32>().ok()?;
        let denominator = denominator.trim().parse::<u32>().ok()?;
        if denominator == 0 {
            return None;
        }
        return Some(format!("{numerator}/{denominator} s"));
    }
    let number = parse_number(value.as_bytes())?;
    Some(format!("{} s", format_number(number)))
}

fn parse_number(value: &[u8]) -> Option<f64> {
    let value = std::str::from_utf8(value).ok()?.trim();
    let value = value
        .trim_end_matches("mm")
        .trim_end_matches('s')
        .trim_end_matches('f')
        .trim();
    let number = if let Some((numerator, denominator)) = value.split_once('/') {
        let numerator = numerator.trim().parse::<f64>().ok()?;
        let denominator = denominator.trim().parse::<f64>().ok()?;
        if denominator == 0.0 {
            return None;
        }
        numerator / denominator
    } else {
        value.split([',', ' ']).next()?.trim().parse::<f64>().ok()?
    };
    number.is_finite().then_some(number)
}

fn format_number(value: f64) -> String {
    let rounded = format!("{value:.6}");
    rounded
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_owned()
}

fn merge_metadata(
    exif: &SourceValues,
    xmp: &SourceValues,
    diagnostics: &mut Vec<String>,
) -> PhotoMetadata {
    let make = choose_value("cameraMake", &exif.make, &xmp.make, diagnostics);
    let model = choose_value("cameraModel", &exif.model, &xmp.model, diagnostics);
    let camera = combine_camera(make, model);
    let lens = choose_value("lensModel", &exif.lens, &xmp.lens, diagnostics);

    let focal = choose_value(
        "focalLength",
        &exif.focal_length,
        &xmp.focal_length,
        diagnostics,
    )
    .and_then(|value| parse_number(value.as_bytes()))
    .map(|value| format!("{value:.1} mm"));
    let aperture = choose_value("fNumber", &exif.aperture, &xmp.aperture, diagnostics)
        .and_then(|value| parse_number(value.as_bytes()))
        .map(|value| format!("f/{}", format_number(value)));
    let shutter_speed = choose_value(
        "exposureTime",
        &exif.shutter_speed,
        &xmp.shutter_speed,
        diagnostics,
    )
    .and_then(|value| parse_exposure(&value));
    let iso = choose_value("iso", &exif.iso, &xmp.iso, diagnostics)
        .and_then(|value| parse_number(value.as_bytes()))
        .map(format_number);
    let date = choose_date(exif, xmp, diagnostics);

    PhotoMetadata {
        camera,
        lens,
        focal_length: focal,
        date,
        aperture,
        shutter_speed,
        iso,
    }
}

fn choose_value(
    field: &str,
    exif: &Option<String>,
    xmp: &Option<String>,
    diagnostics: &mut Vec<String>,
) -> Option<String> {
    let exif = nonempty(exif.as_deref());
    let xmp = nonempty(xmp.as_deref());
    if let (Some(exif), Some(xmp)) = (exif, xmp) {
        if !exif.eq_ignore_ascii_case(xmp) {
            diagnostics.push(format!(
                "EXIF and XMP differ for {field}; EXIF was selected."
            ));
            #[cfg(debug_assertions)]
            eprintln!("[Lustra metadata] {field}: EXIF={exif:?}; XMP={xmp:?}; selected={exif:?}");
        }
    }
    exif.or(xmp).map(str::to_owned)
}

fn choose_date(
    exif: &SourceValues,
    xmp: &SourceValues,
    diagnostics: &mut Vec<String>,
) -> Option<String> {
    let exif_date = exif
        .date
        .as_deref()
        .and_then(|date| normalize_date(date, exif.subsecond.as_deref(), exif.offset.as_deref()));
    let xmp_date = xmp
        .date
        .as_deref()
        .and_then(|date| normalize_date(date, None, None));
    if let (Some(exif_value), Some(xmp_value)) = (&exif_date, &xmp_date) {
        if !date_values_equivalent(exif_value, xmp_value) {
            diagnostics.push("EXIF and XMP differ for captureDate; EXIF was selected.".to_owned());
            #[cfg(debug_assertions)]
            eprintln!("[Lustra metadata] captureDate: EXIF={exif_value:?}; XMP={xmp_value:?}; selected={exif_value:?}");
        }
    }
    match (exif_date, xmp_date) {
        (Some(mut exif_value), Some(xmp_value)) => {
            // EXIF remains authoritative for the date and time. When the EXIF
            // timestamp omits precision or an offset, retain those components
            // from an equivalent XMP timestamp instead of discarding them.
            if same_date_and_time(&exif_value, &xmp_value) {
                let (exif_base, exif_fraction, exif_zone) = split_timestamp(&exif_value);
                let (_, xmp_fraction, xmp_zone) = split_timestamp(&xmp_value);
                if exif_fraction.is_none() || exif_zone.is_none() {
                    let fraction = exif_fraction
                        .or(xmp_fraction)
                        .map(|value| format!(".{value}"))
                        .unwrap_or_default();
                    let zone = exif_zone.or(xmp_zone).unwrap_or_default();
                    exif_value = format!("{exif_base}{fraction}{zone}");
                }
            }
            Some(exif_value)
        }
        (Some(exif_value), None) => Some(exif_value),
        (None, Some(xmp_value)) => Some(xmp_value),
        (None, None) => None,
    }
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn combine_camera(make: Option<String>, model: Option<String>) -> Option<String> {
    let make = make.and_then(|value| nonempty(Some(&value)).map(str::to_owned));
    let model = model.and_then(|value| nonempty(Some(&value)).map(str::to_owned));
    match (make, model) {
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase()) => {
            Some(model)
        }
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (Some(make), None) => Some(make),
        (None, model) => model,
    }
}

#[derive(Debug, PartialEq, Eq)]
struct DateParts {
    base: String,
    fraction: Option<String>,
    zone: Option<String>,
}

fn normalize_date(value: &str, subsecond: Option<&str>, offset: Option<&str>) -> Option<String> {
    let mut parts = parse_date_parts(value)?;
    if parts.fraction.is_none() {
        parts.fraction = subsecond
            .map(normalize_subsecond)
            .filter(|value| !value.is_empty());
    }
    if parts.zone.is_none() {
        parts.zone = offset.and_then(normalize_timezone);
    }
    Some(format_date_parts(&parts))
}

fn parse_date_parts(value: &str) -> Option<DateParts> {
    let value = value.trim().trim_matches('\0');
    let (date, time_and_zone) = value.split_once('T').or_else(|| value.split_once(' '))?;
    let date = date.trim();
    let mut date_parts = date.split([':', '-']);
    let year = date_parts.next()?.parse::<u32>().ok()?;
    let month = date_parts.next()?.parse::<u32>().ok()?;
    let day = date_parts.next()?.parse::<u32>().ok()?;
    if date_parts.next().is_some() || !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let (time, zone) = split_zone(time_and_zone.trim());
    let (time, fraction) = match time.split_once('.') {
        Some((time, fraction)) => {
            let fraction = normalize_subsecond(fraction);
            (time, (!fraction.is_empty()).then_some(fraction))
        }
        None => (time, None),
    };
    let mut time_parts = time.split(':');
    let hour = time_parts.next()?.parse::<u32>().ok()?;
    let minute = time_parts.next()?.parse::<u32>().ok()?;
    let second = time_parts.next()?.parse::<u32>().ok()?;
    if time_parts.next().is_some() || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let base = format!("{year:04}:{month:02}:{day:02} {hour:02}:{minute:02}:{second:02}");
    Some(DateParts {
        base,
        fraction,
        zone,
    })
}

fn split_zone(value: &str) -> (&str, Option<String>) {
    if let Some(without_z) = value.strip_suffix(['Z', 'z']) {
        return (without_z, Some(value[without_z.len()..].to_owned()));
    }
    if let Some(index) = value
        .char_indices()
        .rev()
        .find_map(|(index, ch)| ((ch == '+' || ch == '-') && index > 0).then_some(index))
    {
        let zone = &value[index..];
        if normalize_timezone(zone).is_some() {
            return (&value[..index], Some(zone.to_owned()));
        }
    }
    (value, None)
}

fn normalize_subsecond(value: &str) -> String {
    let value = value.trim().trim_start_matches('.');
    let digits = value
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>();
    digits
}

fn normalize_timezone(value: &str) -> Option<String> {
    let value = value.trim();
    if matches!(value, "Z" | "z") {
        return Some(value.to_owned());
    }
    let bytes = value.as_bytes();
    if bytes.len() != 6
        || !matches!(bytes[0], b'+' | b'-')
        || bytes[3] != b':'
        || !bytes[1..3].iter().all(u8::is_ascii_digit)
        || !bytes[4..6].iter().all(u8::is_ascii_digit)
    {
        return None;
    }
    let hours = value[1..3].parse::<u8>().ok()?;
    let minutes = value[4..6].parse::<u8>().ok()?;
    (hours <= 23 && minutes <= 59).then_some(value.to_owned())
}

fn format_date_parts(parts: &DateParts) -> String {
    format!(
        "{}{}{}",
        parts.base,
        parts
            .fraction
            .as_ref()
            .map(|value| format!(".{value}"))
            .unwrap_or_default(),
        parts.zone.as_deref().unwrap_or_default()
    )
}

fn split_timestamp(value: &str) -> (String, Option<String>, Option<String>) {
    match parse_date_parts(value) {
        Some(parts) => (parts.base, parts.fraction, parts.zone),
        None => (value.to_owned(), None, None),
    }
}

fn same_date_and_time(first: &str, second: &str) -> bool {
    let first = split_timestamp(first);
    let second = split_timestamp(second);
    first.0 == second.0
}

fn date_values_equivalent(first: &str, second: &str) -> bool {
    let first = split_timestamp(first);
    let second = split_timestamp(second);
    first.0 == second.0
        && first.1.as_deref().unwrap_or("") == second.1.as_deref().unwrap_or("")
        && first.2.as_deref().unwrap_or("") == second.2.as_deref().unwrap_or("")
}

fn extract_xmp_packets<R: Read + Seek>(
    reader: &mut R,
) -> Result<XmpExtraction, XmpExtractionError> {
    reader
        .seek(SeekFrom::Start(0))
        .map_err(XmpExtractionError::Io)?;
    let mut header = [0; 12];
    let count = reader.read(&mut header).map_err(XmpExtractionError::Io)?;
    reader
        .seek(SeekFrom::Start(0))
        .map_err(XmpExtractionError::Io)?;
    if count >= 2 && header[..2] == [0xff, 0xd8] {
        extract_jpeg_xmp(reader)
    } else if count >= 8 && &header[..8] == b"\x89PNG\r\n\x1a\n" {
        extract_png_xmp(reader)
    } else if count >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        extract_webp_xmp(reader)
    } else {
        Err(XmpExtractionError::Malformed(
            "Unsupported image container.".to_owned(),
        ))
    }
}

fn extract_jpeg_xmp<R: Read + Seek>(reader: &mut R) -> Result<XmpExtraction, XmpExtractionError> {
    let mut soi = [0; 2];
    reader
        .read_exact(&mut soi)
        .map_err(XmpExtractionError::Io)?;
    if soi != [0xff, 0xd8] {
        return Err(XmpExtractionError::Malformed(
            "Invalid JPEG signature.".to_owned(),
        ));
    }
    let mut extraction = XmpExtraction::default();
    loop {
        let marker = match next_jpeg_marker(reader) {
            Ok(Some(marker)) => marker,
            Ok(None) => break,
            Err(error) => return Err(XmpExtractionError::Io(error)),
        };
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0xd8 || (0xd0..=0xd7).contains(&marker) || marker == 0x01 {
            continue;
        }
        let mut length_bytes = [0; 2];
        reader
            .read_exact(&mut length_bytes)
            .map_err(XmpExtractionError::Io)?;
        let length = u16::from_be_bytes(length_bytes) as usize;
        if length < 2 {
            return Err(XmpExtractionError::Malformed(
                "Invalid JPEG segment length.".to_owned(),
            ));
        }
        let payload_len = length - 2;
        if marker == 0xe1 {
            if payload_len > MAX_XMP_PACKET_BYTES + 256 {
                return Err(XmpExtractionError::Malformed(
                    "JPEG APP1 metadata exceeds the size limit.".to_owned(),
                ));
            }
            let mut payload = vec![0; payload_len];
            reader
                .read_exact(&mut payload)
                .map_err(XmpExtractionError::Io)?;
            if let Some(packet) = payload.strip_prefix(JPEG_XMP_HEADER) {
                check_packet_size(packet.len())?;
                extraction.packets.push(trim_packet(packet));
            }
        } else {
            let offset = i64::try_from(payload_len).map_err(|_| {
                XmpExtractionError::Malformed("JPEG segment is too large.".to_owned())
            })?;
            reader
                .seek(SeekFrom::Current(offset))
                .map_err(XmpExtractionError::Io)?;
        }
    }
    Ok(extraction)
}

fn next_jpeg_marker<R: Read>(reader: &mut R) -> io::Result<Option<u8>> {
    let mut byte = [0; 1];
    loop {
        match reader.read_exact(&mut byte) {
            Ok(()) if byte[0] == 0xff => break,
            Ok(()) => continue,
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) => return Err(error),
        }
    }
    loop {
        reader.read_exact(&mut byte)?;
        if byte[0] != 0xff {
            return Ok(Some(byte[0]));
        }
    }
}

fn extract_png_xmp<R: Read + Seek>(reader: &mut R) -> Result<XmpExtraction, XmpExtractionError> {
    reader
        .seek(SeekFrom::Start(8))
        .map_err(XmpExtractionError::Io)?;
    let file_len = reader
        .seek(SeekFrom::End(0))
        .map_err(XmpExtractionError::Io)?;
    reader
        .seek(SeekFrom::Start(8))
        .map_err(XmpExtractionError::Io)?;
    let mut extraction = XmpExtraction::default();
    loop {
        let position = reader.stream_position().map_err(XmpExtractionError::Io)?;
        if position >= file_len {
            return Err(XmpExtractionError::Malformed(
                "PNG is missing its IEND chunk.".to_owned(),
            ));
        }
        let mut chunk_header = [0; 8];
        reader
            .read_exact(&mut chunk_header)
            .map_err(XmpExtractionError::Io)?;
        let length = u32::from_be_bytes(chunk_header[..4].try_into().unwrap()) as usize;
        let kind = &chunk_header[4..8];
        let remaining =
            file_len.saturating_sub(reader.stream_position().map_err(XmpExtractionError::Io)?);
        if length as u64 + 4 > remaining {
            return Err(XmpExtractionError::Malformed(
                "PNG chunk extends beyond the file.".to_owned(),
            ));
        }
        if kind == b"iTXt" {
            if length > MAX_XMP_PACKET_BYTES + 4096 {
                return Err(XmpExtractionError::Malformed(
                    "PNG iTXt metadata exceeds the size limit.".to_owned(),
                ));
            }
            let mut payload = vec![0; length];
            reader
                .read_exact(&mut payload)
                .map_err(XmpExtractionError::Io)?;
            let mut crc = [0; 4];
            reader
                .read_exact(&mut crc)
                .map_err(XmpExtractionError::Io)?;
            if let Some(packet) = parse_png_itxt(&payload)? {
                extraction.packets.push(packet);
            }
        } else {
            let next = i64::try_from(length + 4)
                .map_err(|_| XmpExtractionError::Malformed("PNG chunk is too large.".to_owned()))?;
            reader
                .seek(SeekFrom::Current(next))
                .map_err(XmpExtractionError::Io)?;
        }
        if kind == b"IEND" {
            break;
        }
    }
    Ok(extraction)
}

fn parse_png_itxt(payload: &[u8]) -> Result<Option<Vec<u8>>, XmpExtractionError> {
    let Some(keyword_end) = payload.iter().position(|byte| *byte == 0) else {
        return Err(XmpExtractionError::Malformed(
            "PNG iTXt keyword is unterminated.".to_owned(),
        ));
    };
    if &payload[..keyword_end] != PNG_XMP_KEYWORD {
        return Ok(None);
    }
    let mut position = keyword_end + 1;
    let flag = *payload.get(position).ok_or_else(|| {
        XmpExtractionError::Malformed("PNG iTXt compression flag is missing.".to_owned())
    })?;
    position += 1;
    let method = *payload.get(position).ok_or_else(|| {
        XmpExtractionError::Malformed("PNG iTXt compression method is missing.".to_owned())
    })?;
    position += 1;
    position = after_nul(payload, position)?;
    position = after_nul(payload, position)?;
    let text = payload
        .get(position..)
        .ok_or_else(|| XmpExtractionError::Malformed("PNG iTXt text is missing.".to_owned()))?;
    let packet = match flag {
        0 => {
            check_packet_size(text.len())?;
            text.to_vec()
        }
        1 if method == 0 => {
            let decoder = ZlibDecoder::new(text);
            let mut bounded = decoder.take((MAX_XMP_PACKET_BYTES + 1) as u64);
            let mut packet = Vec::new();
            bounded
                .read_to_end(&mut packet)
                .map_err(XmpExtractionError::Io)?;
            check_packet_size(packet.len())?;
            packet
        }
        _ => {
            return Err(XmpExtractionError::Malformed(
                "Unsupported PNG iTXt compression mode.".to_owned(),
            ))
        }
    };
    Ok(Some(trim_packet(&packet)))
}

fn after_nul(payload: &[u8], position: usize) -> Result<usize, XmpExtractionError> {
    let length = payload
        .get(position..)
        .and_then(|remaining| remaining.iter().position(|byte| *byte == 0))
        .ok_or_else(|| {
            XmpExtractionError::Malformed("PNG iTXt field is unterminated.".to_owned())
        })?;
    Ok(position + length + 1)
}

fn extract_webp_xmp<R: Read + Seek>(reader: &mut R) -> Result<XmpExtraction, XmpExtractionError> {
    reader
        .seek(SeekFrom::Start(0))
        .map_err(XmpExtractionError::Io)?;
    let mut riff_header = [0; 12];
    reader
        .read_exact(&mut riff_header)
        .map_err(XmpExtractionError::Io)?;
    if &riff_header[..4] != b"RIFF" || &riff_header[8..] != b"WEBP" {
        return Err(XmpExtractionError::Malformed(
            "Invalid WebP signature.".to_owned(),
        ));
    }
    let riff_end = u64::from(u32::from_le_bytes(riff_header[4..8].try_into().unwrap())) + 8;
    let file_len = reader
        .seek(SeekFrom::End(0))
        .map_err(XmpExtractionError::Io)?;
    if riff_end > file_len || riff_end < 12 {
        return Err(XmpExtractionError::Malformed(
            "Invalid WebP RIFF size.".to_owned(),
        ));
    }
    reader
        .seek(SeekFrom::Start(12))
        .map_err(XmpExtractionError::Io)?;
    let mut extraction = XmpExtraction::default();
    while reader.stream_position().map_err(XmpExtractionError::Io)? + 8 <= riff_end {
        let mut chunk_header = [0; 8];
        reader
            .read_exact(&mut chunk_header)
            .map_err(XmpExtractionError::Io)?;
        let length = u32::from_le_bytes(chunk_header[4..8].try_into().unwrap()) as usize;
        let padding = length % 2;
        let end = reader.stream_position().map_err(XmpExtractionError::Io)?
            + length as u64
            + padding as u64;
        if end > riff_end {
            return Err(XmpExtractionError::Malformed(
                "WebP chunk extends beyond the RIFF boundary.".to_owned(),
            ));
        }
        if &chunk_header[..4] == b"XMP " {
            check_packet_size(length)?;
            let mut packet = vec![0; length];
            reader
                .read_exact(&mut packet)
                .map_err(XmpExtractionError::Io)?;
            extraction.packets.push(trim_packet(&packet));
            if padding != 0 {
                reader
                    .seek(SeekFrom::Current(1))
                    .map_err(XmpExtractionError::Io)?;
            }
        } else {
            reader
                .seek(SeekFrom::Start(end))
                .map_err(XmpExtractionError::Io)?;
        }
    }
    if reader.stream_position().map_err(XmpExtractionError::Io)? != riff_end {
        return Err(XmpExtractionError::Malformed(
            "WebP RIFF has trailing partial chunk data.".to_owned(),
        ));
    }
    Ok(extraction)
}

fn check_packet_size(size: usize) -> Result<(), XmpExtractionError> {
    if size > MAX_XMP_PACKET_BYTES {
        return Err(XmpExtractionError::Malformed(
            "XMP packet exceeds the size limit.".to_owned(),
        ));
    }
    Ok(())
}

fn trim_packet(packet: &[u8]) -> Vec<u8> {
    let packet = packet.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(packet);
    let start = packet
        .iter()
        .position(|byte| !byte.is_ascii_whitespace() && *byte != 0)
        .unwrap_or(packet.len());
    let end = packet
        .iter()
        .rposition(|byte| !byte.is_ascii_whitespace() && *byte != 0)
        .map_or(start, |index| index + 1);
    packet[start..end].to_vec()
}

fn parse_xmp_packet(packet: &[u8]) -> Result<XmpValues, String> {
    check_packet_size(packet.len()).map_err(|error| format!("{error:?}"))?;
    if std::str::from_utf8(packet).is_err() {
        return Err("XMP packet is not UTF-8.".to_owned());
    }
    let mut reader = NsReader::from_reader(packet);
    reader.config_mut().check_end_names = true;
    reader.config_mut().trim_text(true);
    reader.resolver_mut().set_max_namespace_bindings(64);
    let mut buffer = Vec::new();
    let mut values = XmpValues::default();
    let mut depth = 0usize;
    let mut active: Option<(XmpField, usize, String)> = None;

    loop {
        match reader
            .read_event_into(&mut buffer)
            .map_err(|error| error.to_string())?
        {
            Event::Start(element) => {
                depth += 1;
                if depth > MAX_XMP_XML_DEPTH {
                    return Err("XMP XML nesting exceeds the size limit.".to_owned());
                }
                extract_attributes(&reader, &element, &mut values)?;
                if active.is_none() {
                    if let Some(field) = resolve_xmp_element(&reader, element.name()) {
                        active = Some((field, depth, String::new()));
                    }
                }
            }
            Event::Empty(element) => extract_attributes(&reader, &element, &mut values)?,
            Event::Text(text) => {
                if let Some((_, _, contents)) = active.as_mut() {
                    let decoded = unescape(text.as_ref()).map_err(|error| error.to_string())?;
                    if contents.len().saturating_add(decoded.len()) > 16 * 1024 {
                        return Err("XMP property value exceeds the size limit.".to_owned());
                    }
                    contents.push_str(&decoded);
                }
            }
            Event::CData(text) => {
                if let Some((_, _, contents)) = active.as_mut() {
                    if contents.len().saturating_add(text.len()) > 16 * 1024 {
                        return Err("XMP property value exceeds the size limit.".to_owned());
                    }
                    contents.push_str(text.as_ref());
                }
            }
            Event::End(_) => {
                if active
                    .as_ref()
                    .is_some_and(|(_, active_depth, _)| *active_depth == depth)
                {
                    if let Some((field, _, contents)) = active.take() {
                        assign_xmp_value(&mut values, field, contents.trim());
                    }
                }
                depth = depth.saturating_sub(1);
            }
            Event::DocType(_) => return Err("XMP document types are not accepted.".to_owned()),
            Event::Eof => {
                if depth != 0 {
                    return Err("XMP packet ended before all elements were closed.".to_owned());
                }
                break;
            }
            _ => {}
        }
        buffer.clear();
    }
    Ok(values)
}

fn extract_attributes(
    reader: &NsReader<impl BufRead>,
    element: &BytesStart<'_>,
    values: &mut XmpValues,
) -> Result<(), String> {
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|error| error.to_string())?;
        let Some(field) = resolve_xmp_attribute(reader, attribute.key) else {
            continue;
        };
        let value = attribute
            .normalized_value(XmlVersion::Implicit1_0)
            .map_err(|error| error.to_string())?;
        assign_xmp_value(values, field, value.trim());
    }
    Ok(())
}

fn resolve_xmp_element<R: BufRead>(
    reader: &NsReader<R>,
    name: quick_xml::name::QName<'_>,
) -> Option<XmpField> {
    let (namespace, local) = reader.resolver().resolve_element(name);
    let ResolveResult::Bound(Namespace(uri)) = namespace else {
        return None;
    };
    xmp_field(uri, local.as_ref())
}

fn resolve_xmp_attribute<R: BufRead>(
    reader: &NsReader<R>,
    name: quick_xml::name::QName<'_>,
) -> Option<XmpField> {
    let (namespace, local) = reader.resolver().resolve_attribute(name);
    let ResolveResult::Bound(Namespace(uri)) = namespace else {
        return None;
    };
    xmp_field(uri, local.as_ref())
}

fn xmp_field(namespace: &str, local: &str) -> Option<XmpField> {
    match (namespace, local) {
        (TIFF_NS, "Make") => Some(XmpField::Make),
        (TIFF_NS, "Model") => Some(XmpField::Model),
        (EXIF_EX_NS, "LensModel") => Some(XmpField::Lens),
        (EXIF_NS, "FocalLength") => Some(XmpField::FocalLength),
        (EXIF_NS, "FNumber") => Some(XmpField::Aperture),
        (EXIF_NS, "ExposureTime") => Some(XmpField::ShutterSpeed),
        (
            EXIF_NS,
            "ISOSpeedRatings" | "PhotographicSensitivity" | "RecommendedExposureIndex" | "ISO",
        ) => Some(XmpField::Iso),
        (EXIF_NS, "DateTimeOriginal") => Some(XmpField::Date),
        _ => None,
    }
}

fn assign_xmp_value(values: &mut XmpValues, field: XmpField, raw: &str) {
    let raw = raw.trim();
    if raw.is_empty() {
        return;
    }
    let value = match field {
        XmpField::FocalLength | XmpField::Aperture | XmpField::Iso => {
            parse_number(raw.as_bytes()).map(format_number)
        }
        XmpField::ShutterSpeed => parse_exposure(raw),
        XmpField::Date => normalize_date(raw, None, None),
        _ => Some(raw.to_owned()),
    };
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    let target = &mut values.0;
    let slot = match field {
        XmpField::Make => &mut target.make,
        XmpField::Model => &mut target.model,
        XmpField::Lens => &mut target.lens,
        XmpField::FocalLength => &mut target.focal_length,
        XmpField::Aperture => &mut target.aperture,
        XmpField::ShutterSpeed => &mut target.shutter_speed,
        XmpField::Iso => &mut target.iso,
        XmpField::Date => &mut target.date,
    };
    if slot.is_none() {
        *slot = Some(value);
    }
}

fn merge_xmp_values(target: &mut XmpValues, incoming: XmpValues) {
    let target = &mut target.0;
    let incoming = incoming.0;
    macro_rules! keep_first {
        ($field:ident) => {
            if target.$field.is_none() {
                target.$field = incoming.$field;
            }
        };
    }
    keep_first!(make);
    keep_first!(model);
    keep_first!(lens);
    keep_first!(focal_length);
    keep_first!(aperture);
    keep_first!(shutter_speed);
    keep_first!(iso);
    keep_first!(date);
}

#[cfg(test)]
mod tests {
    use super::*;
    use exif::{experimental::Writer, Field, Rational};
    use std::io::Cursor;

    const XMP_FIXTURE: &[u8] = include_bytes!("../tests/fixtures/dsc_8575.xmp");

    fn parse_bytes(bytes: &[u8]) -> MetadataReadResult {
        parse_container(&mut Cursor::new(bytes))
    }

    fn png_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut chunk = Vec::new();
        chunk.extend((data.len() as u32).to_be_bytes());
        chunk.extend(kind);
        chunk.extend(data);
        let crc = crc32fast::hash(&chunk[4..]);
        chunk.extend(crc.to_be_bytes());
        chunk
    }

    fn png_with_exif(exif: &[u8]) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend(1u32.to_be_bytes());
        ihdr.extend(1u32.to_be_bytes());
        ihdr.extend([8, 2, 0, 0, 0]);
        bytes.extend(png_chunk(b"IHDR", &ihdr));
        bytes.extend(png_chunk(b"eXIf", exif));
        bytes.extend(png_chunk(b"IDAT", &[0, 0, 0, 0]));
        bytes.extend(png_chunk(b"IEND", &[]));
        bytes
    }

    fn png_with_itxt(xmp: &[u8], compressed: bool) -> Vec<u8> {
        let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend(1u32.to_be_bytes());
        ihdr.extend(1u32.to_be_bytes());
        ihdr.extend([8, 2, 0, 0, 0]);
        bytes.extend(png_chunk(b"IHDR", &ihdr));

        let mut itxt = PNG_XMP_KEYWORD.to_vec();
        itxt.push(0);
        itxt.push(u8::from(compressed));
        itxt.push(0);
        itxt.extend([0, 0]);
        if compressed {
            use flate2::{write::ZlibEncoder, Compression};
            use std::io::Write;
            let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
            encoder.write_all(xmp).unwrap();
            itxt.extend(encoder.finish().unwrap());
        } else {
            itxt.extend(xmp);
        }
        bytes.extend(png_chunk(b"iTXt", &itxt));
        bytes.extend(png_chunk(b"IDAT", &[0, 0, 0, 0]));
        bytes.extend(png_chunk(b"IEND", &[]));
        bytes
    }

    fn jpeg_segment(marker: u8, payload: &[u8]) -> Vec<u8> {
        let mut segment = vec![0xff, marker];
        segment.extend(((payload.len() + 2) as u16).to_be_bytes());
        segment.extend(payload);
        segment
    }

    fn jpeg_with_xmp(xmp: &[u8], exif: Option<&[u8]>) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8];
        if let Some(exif) = exif {
            let mut payload = b"Exif\0\0".to_vec();
            payload.extend(exif);
            bytes.extend(jpeg_segment(0xe1, &payload));
        }
        let mut payload = JPEG_XMP_HEADER.to_vec();
        payload.extend(xmp);
        bytes.extend(jpeg_segment(0xe1, &payload));
        bytes.extend([0xff, 0xd9]);
        bytes
    }

    fn webp_with_xmp(xmp: &[u8]) -> Vec<u8> {
        let mut body = b"WEBP".to_vec();
        body.extend(b"XMP ");
        body.extend((xmp.len() as u32).to_le_bytes());
        body.extend(xmp);
        if xmp.len() % 2 == 1 {
            body.push(0);
        }
        let mut bytes = b"RIFF".to_vec();
        bytes.extend((body.len() as u32).to_le_bytes());
        bytes.extend(body);
        bytes
    }

    fn webp_with_exif(exif: &[u8]) -> Vec<u8> {
        let mut body = b"WEBP".to_vec();
        body.extend(b"EXIF");
        body.extend((exif.len() as u32).to_le_bytes());
        body.extend(exif);
        if exif.len() % 2 == 1 {
            body.push(0);
        }
        let mut bytes = b"RIFF".to_vec();
        bytes.extend((body.len() as u32).to_le_bytes());
        bytes.extend(body);
        bytes
    }

    fn make_exif(fields: &[Field]) -> Vec<u8> {
        let mut writer = Writer::new();
        for field in fields {
            writer.push_field(field);
        }
        let mut output = Cursor::new(Vec::new());
        writer.write(&mut output, false).unwrap();
        output.into_inner()
    }

    fn ascii_field(tag: Tag, value: &str) -> Field {
        Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Ascii(vec![value.as_bytes().to_vec()]),
        }
    }

    fn rational_field(tag: Tag, numerator: u32, denominator: u32) -> Field {
        Field {
            tag,
            ifd_num: In::PRIMARY,
            value: Value::Rational(vec![Rational {
                num: numerator,
                denom: denominator,
            }]),
        }
    }

    #[test]
    fn reads_provided_nikon_xmp_values_from_png_itxt() {
        let result = parse_bytes(&png_with_itxt(XMP_FIXTURE, false));
        assert_eq!(result.status, MetadataReadStatus::Complete);
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
        assert_eq!(
            result.metadata.lens.as_deref(),
            Some("NIKKOR Z 24-70mm f/4 S")
        );
        assert_eq!(result.metadata.focal_length.as_deref(), Some("46.0 mm"));
        assert_eq!(result.metadata.aperture.as_deref(), Some("f/6.3"));
        assert_eq!(result.metadata.iso.as_deref(), Some("51200"));
        assert_eq!(
            result.metadata.date.as_deref(),
            Some("2026:11:07 14:19:45.90+09:00")
        );
    }

    #[test]
    fn reads_the_repository_png_and_jpeg_metadata_samples() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let jpeg = read_photo_metadata_file(&root.join("test_exif_01.jpg"));
        let png = read_photo_metadata_file(&root.join("test_exif_02.png"));
        for result in [jpeg, png] {
            assert_eq!(
                result.metadata.camera.as_deref(),
                Some("NIKON CORPORATION NIKON Z 6_2")
            );
            assert_eq!(
                result.metadata.lens.as_deref(),
                Some("NIKKOR Z 24-70mm f/4 S")
            );
            assert_eq!(result.metadata.iso.as_deref(), Some("51200"));
            assert_eq!(
                result.metadata.date.as_deref(),
                Some("2026:11:07 14:19:45.90+09:00")
            );
        }
    }

    #[test]
    fn reads_png_exif_chunk() {
        let fields = [
            ascii_field(Tag::Make, "NIKON CORPORATION"),
            ascii_field(Tag::Model, "NIKON Z 6_2"),
            ascii_field(Tag::LensModel, "NIKKOR Z 24-70mm f/4 S"),
        ];
        let result = parse_bytes(&png_with_exif(&make_exif(&fields)));
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
        assert_eq!(
            result.metadata.lens.as_deref(),
            Some("NIKKOR Z 24-70mm f/4 S")
        );
    }

    #[test]
    fn reads_webp_exif_chunk() {
        let fields = [
            ascii_field(Tag::Make, "NIKON CORPORATION"),
            ascii_field(Tag::Model, "NIKON Z 6_2"),
            ascii_field(Tag::LensModel, "NIKKOR Z 24-70mm f/4 S"),
        ];
        let result = parse_bytes(&webp_with_exif(&make_exif(&fields)));
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
        assert_eq!(
            result.metadata.lens.as_deref(),
            Some("NIKKOR Z 24-70mm f/4 S")
        );
    }

    #[test]
    fn reads_compressed_png_itxt_xmp() {
        let result = parse_bytes(&png_with_itxt(XMP_FIXTURE, true));
        assert_eq!(result.status, MetadataReadStatus::Complete);
        assert_eq!(result.metadata.iso.as_deref(), Some("51200"));
    }

    #[test]
    fn reads_xmp_by_namespace_uri_when_prefixes_change() {
        let xml = br#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:cam="http://ns.adobe.com/tiff/1.0/" xmlns:opt="http://cipa.jp/exif/1.0/" xmlns:shot="http://ns.adobe.com/exif/1.0/" cam:Make="NIKON CORPORATION" cam:Model="NIKON Z 6_2" opt:LensModel="NIKKOR Z 24-70mm f/4 S" shot:FocalLength="46/1" shot:FNumber="63/10" shot:ISOSpeedRatings="51200" shot:DateTimeOriginal="2026:11:07 14:19:45.90+09:00"/></rdf:RDF></x:xmpmeta>"#;
        let result = parse_bytes(&png_with_itxt(xml, false));
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
        assert_eq!(
            result.metadata.date.as_deref(),
            Some("2026:11:07 14:19:45.90+09:00")
        );
    }

    #[test]
    fn reads_jpeg_app1_xmp_and_merges_with_exif_per_field() {
        let fields = [
            ascii_field(Tag::Make, "NIKON CORPORATION"),
            ascii_field(Tag::Model, "NIKON Z 6_2"),
            rational_field(Tag::FocalLength, 46, 1),
            rational_field(Tag::FNumber, 63, 10),
            rational_field(Tag::PhotographicSensitivity, 51200, 1),
            ascii_field(Tag::DateTimeOriginal, "2026:11:07 14:19:45"),
            ascii_field(Tag::SubSecTimeOriginal, "90"),
            ascii_field(Tag::OffsetTimeOriginal, "+09:00"),
        ];
        let exif = make_exif(&fields);
        let result = parse_bytes(&jpeg_with_xmp(XMP_FIXTURE, Some(&exif)));
        assert_eq!(result.status, MetadataReadStatus::Complete);
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
        assert_eq!(
            result.metadata.lens.as_deref(),
            Some("NIKKOR Z 24-70mm f/4 S")
        );
        assert_eq!(result.metadata.focal_length.as_deref(), Some("46.0 mm"));
        assert_eq!(result.metadata.aperture.as_deref(), Some("f/6.3"));
        assert_eq!(result.metadata.iso.as_deref(), Some("51200"));
        assert_eq!(
            result.metadata.date.as_deref(),
            Some("2026:11:07 14:19:45.90+09:00")
        );
    }

    #[test]
    fn reads_webp_xmp_chunk() {
        let result = parse_bytes(&webp_with_xmp(XMP_FIXTURE));
        assert_eq!(result.status, MetadataReadStatus::Complete);
        assert_eq!(
            result.metadata.lens.as_deref(),
            Some("NIKKOR Z 24-70mm f/4 S")
        );
    }

    #[test]
    fn preserves_exif_priority_when_sources_conflict() {
        let fields = [
            ascii_field(Tag::Make, "NIKON"),
            ascii_field(Tag::Model, "Z 6_2"),
        ];
        let result = parse_bytes(&jpeg_with_xmp(XMP_FIXTURE, Some(&make_exif(&fields))));
        assert_eq!(result.metadata.camera.as_deref(), Some("NIKON Z 6_2"));
        assert!(result
            .diagnostics
            .iter()
            .any(|message| message.contains("cameraMake")));
    }

    #[test]
    fn distinguishes_missing_metadata_partial_metadata_and_parse_failure() {
        let empty_png = {
            let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
            let mut ihdr = vec![0; 13];
            ihdr[..4].copy_from_slice(&1u32.to_be_bytes());
            ihdr[4..8].copy_from_slice(&1u32.to_be_bytes());
            ihdr[8] = 8;
            bytes.extend(png_chunk(b"IHDR", &ihdr));
            bytes.extend(png_chunk(b"IEND", &[]));
            bytes
        };
        assert_eq!(parse_bytes(&empty_png).status, MetadataReadStatus::Missing);
        let present_without_requested_fields = parse_bytes(&png_with_itxt(
            br#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""/></rdf:RDF></x:xmpmeta>"#,
            false,
        ));
        assert_eq!(
            present_without_requested_fields.status,
            MetadataReadStatus::Partial
        );
        let partial = parse_bytes(&png_with_itxt(
            br#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="NIKON"/></rdf:RDF></x:xmpmeta>"#,
            false,
        ));
        assert_eq!(partial.status, MetadataReadStatus::Partial);
        let malformed = parse_bytes(&png_with_itxt(b"<x:xmpmeta><broken>", false));
        assert_eq!(malformed.status, MetadataReadStatus::ParseError);
    }

    #[test]
    fn distinguishes_source_file_read_failure() {
        let path = std::env::temp_dir().join(format!(
            "lustra-metadata-missing-{}.jpg",
            std::process::id()
        ));
        let result = read_photo_metadata_file(&path);
        assert_eq!(result.status, MetadataReadStatus::FileError);
    }

    #[test]
    fn keeps_valid_exif_if_xmp_packet_is_malformed() {
        let fields = [
            ascii_field(Tag::Make, "NIKON CORPORATION"),
            ascii_field(Tag::Model, "NIKON Z 6_2"),
        ];
        let exif = make_exif(&fields);
        let result = parse_bytes(&jpeg_with_xmp(b"<broken", Some(&exif)));
        assert_eq!(result.status, MetadataReadStatus::ParseError);
        assert_eq!(
            result.metadata.camera.as_deref(),
            Some("NIKON CORPORATION NIKON Z 6_2")
        );
    }

    #[test]
    fn rejects_xmp_doctype_and_oversized_packets() {
        let xmp = br#"<!DOCTYPE x [<!ENTITY ex "bad">]><x:xmpmeta xmlns:x="adobe:ns:meta/">&ex;</x:xmpmeta>"#;
        assert!(parse_xmp_packet(xmp).is_err());
        assert!(parse_xmp_packet(&vec![b' '; MAX_XMP_PACKET_BYTES + 1]).is_err());
    }
}
