#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#include <stdint.h>
#include <sys/sysctl.h>

typedef struct {
    double x;
    double y;
    double width;
    double height;
} LustraRect;

typedef struct {
    uint32_t width;
    uint32_t height;
    uint32_t format;
    uint32_t quality;
    uint32_t preserve_color_space;
    uint32_t style;
    uint32_t custom_color;
    uint32_t inset;
    uint32_t shadow;
    LustraRect image;
    LustraRect visible;
    double blur;
    double brightness;
    double opacity;
    double ambient_intensity;
    double ambient_softness;
    double ambient_brightness;
    uint32_t ambient_edges;
} LustraRenderSettings;

typedef struct {
    const char *text;
    const char *font_family;
    uint32_t weight;
    uint32_t horizontal_anchor;
    uint32_t vertical_anchor;
    uint32_t rgba;
    double x;
    double y;
    double size;
} LustraText;

typedef struct {
    CGImageRef image;
    uint32_t orientation;
    bool has_profile;
} LustraImage;

typedef struct {
    uint8_t *pixels;
    size_t pixel_size;
    uint8_t *icc;
    size_t icc_size;
} LustraEncoded;

#ifdef LUSTRA_HAS_WEBP
extern size_t WebPEncodeRGBA(const uint8_t *, int, int, int, float, uint8_t **);
extern void WebPFree(void *);
#endif

bool lustra_webp_available(void) {
#ifdef LUSTRA_HAS_WEBP
    return true;
#else
    return false;
#endif
}

uint64_t lustra_memory_bytes(void) {
    uint64_t bytes = 0;
    size_t size = sizeof(bytes);
    if (sysctlbyname("hw.memsize", &bytes, &size, NULL, 0) != 0) {
        return 0;
    }
    return bytes;
}

LustraImage *lustra_image_open(const char *path, uint32_t *width, uint32_t *height, uint32_t *error) {
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithFileSystemRepresentation:path isDirectory:NO relativeToURL:nil];
        CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
        if (source == NULL) {
            *error = 1;
            return NULL;
        }

        NSDictionary *properties = CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source, 0, NULL));
        uint64_t input_width = [properties[(__bridge NSString *)kCGImagePropertyPixelWidth] unsignedLongLongValue];
        uint64_t input_height = [properties[(__bridge NSString *)kCGImagePropertyPixelHeight] unsignedLongLongValue];
        uint32_t orientation = [properties[(__bridge NSString *)kCGImagePropertyOrientation] unsignedIntValue];
        if (input_width == 0 || input_height == 0 || input_width > 120000000 / input_height) {
            CFRelease(source);
            *error = 2;
            return NULL;
        }

        CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
        CFRelease(source);
        if (image == NULL) {
            *error = 1;
            return NULL;
        }

        LustraImage *photo = malloc(sizeof(LustraImage));
        if (photo == NULL) {
            CGImageRelease(image);
            *error = 3;
            return NULL;
        }
        photo->image = image;
        photo->orientation = orientation;
        photo->has_profile = properties[(__bridge NSString *)kCGImagePropertyProfileName] != nil;
        *width = (uint32_t)(orientation >= 5 && orientation <= 8 ? CGImageGetHeight(image) : CGImageGetWidth(image));
        *height = (uint32_t)(orientation >= 5 && orientation <= 8 ? CGImageGetWidth(image) : CGImageGetHeight(image));
        return photo;
    }
}

void lustra_image_close(LustraImage *photo) {
    CGImageRelease(photo->image);
    free(photo);
}

void lustra_export_free(void *bytes) {
    free(bytes);
}

static CGRect canvas_rect(LustraRect rect, double canvas_height) {
    return CGRectMake(rect.x, canvas_height - rect.y - rect.height, rect.width, rect.height);
}

static void draw_oriented(
    CGContextRef context,
    const LustraImage *photo,
    CGRect destination
) {
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, destination.origin.x, destination.origin.y);
    CGContextScaleCTM(context, destination.size.width, destination.size.height);

    CGAffineTransform transform = CGAffineTransformIdentity;
    switch (photo->orientation) {
        case 2: transform = CGAffineTransformMake(-1, 0, 0, 1, 1, 0); break;
        case 3: transform = CGAffineTransformMake(-1, 0, 0, -1, 1, 1); break;
        case 4: transform = CGAffineTransformMake(1, 0, 0, -1, 0, 1); break;
        case 5: transform = CGAffineTransformMake(0, -1, -1, 0, 1, 1); break;
        case 6: transform = CGAffineTransformMake(0, -1, 1, 0, 0, 1); break;
        case 7: transform = CGAffineTransformMake(0, 1, 1, 0, 0, 0); break;
        case 8: transform = CGAffineTransformMake(0, 1, -1, 0, 1, 0); break;
    }
    CGContextConcatCTM(context, transform);
    CGContextDrawImage(context, CGRectMake(0, 0, 1, 1), photo->image);
    CGContextRestoreGState(context);
}

static CGColorRef make_color(CGColorSpaceRef srgb, uint32_t rgba) {
    CGFloat components[] = {
        ((rgba >> 24) & 255) / 255.0, ((rgba >> 16) & 255) / 255.0,
        ((rgba >> 8) & 255) / 255.0, (rgba & 255) / 255.0,
    };
    return CGColorCreate(srgb, components);
}

static CGContextRef create_context(uint32_t width, uint32_t height, CGColorSpaceRef color_space) {
    CGContextRef context = CGBitmapContextCreate(
        NULL, width, height, 8, (size_t)width * 4, color_space,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big
    );
    if (context != NULL) {
        CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    }
    return context;
}

static void box_blur(
    const uint8_t *input, uint8_t *output, int line_length, int line_count,
    int pixel_stride, int line_stride, int radius
) {
    int diameter = radius * 2 + 1;
    int last = line_length - 1;
    for (int line = 0; line < line_count; line++) {
        for (int channel = 0; channel < 3; channel++) {
            int base = line * line_stride + channel;
            int sum = input[base] * (radius + 1);
            for (int i = 1; i <= radius; i++) {
                sum += input[base + (i < last ? i : last) * pixel_stride];
            }
            for (int i = 0; i < line_length; i++) {
                output[base + i * pixel_stride] = (uint8_t)((sum + radius) / diameter);
                int incoming = i + radius + 1;
                int outgoing = i - radius;
                sum += input[base + (incoming < last ? incoming : last) * pixel_stride];
                sum -= input[base + (outgoing > 0 ? outgoing : 0) * pixel_stride];
            }
        }
    }
}

static bool draw_background(
    CGContextRef context,
    const LustraImage *photo,
    const LustraRenderSettings *settings,
    CGColorSpaceRef srgb,
    uint32_t source_width,
    uint32_t source_height
) {
    const double width = settings->width;
    const double height = settings->height;
    CGRect full = CGRectMake(0, 0, width, height);
    uint32_t matte = settings->style == 0 ? 0x000000ff : settings->style == 1 ? 0xffffffff : settings->style == 3 ? 0xfafaf8ff : settings->style == 4 ? (settings->custom_color << 8) | 0xff : settings->style == 5 ? 0x242424ff : settings->style == 6 ? 0x777777ff : 0x454842ff;
    CGColorRef color = make_color(srgb, matte);
    CGContextSetFillColorWithColor(context, color);
    CGContextFillRect(context, full);
    CGColorRelease(color);
    if (settings->style == 6) {
        CGContextRef sample = create_context(48, 48, srgb);
        if (sample == NULL) return false;
        draw_oriented(sample, photo, CGRectMake(0, 0, 48, 48));
        uint8_t *pixels = CGBitmapContextGetData(sample);
        uint32_t counts[512] = {0}; uint64_t sums[512][3] = {{0}};
        for (int y = 0; y < 48; y++) for (int x = 0; x < 48; x++) {
            if (settings->ambient_edges && x > 8 && x < 39 && y > 8 && y < 39) continue;
            size_t p = ((size_t)y * 48 + x) * 4;
            uint32_t key = ((pixels[p] >> 5) << 6) | ((pixels[p + 1] >> 5) << 3) | (pixels[p + 2] >> 5);
            counts[key]++; for (int c = 0; c < 3; c++) sums[key][c] += pixels[p + c];
        }
        CGContextRelease(sample);
        CGContextSaveGState(context);
        CGContextScaleCTM(context, width / 256.0, height / 256.0);
        uint32_t used[5] = {0};
        for (int n = 0; n < 5; n++) {
            int best = -1; for (int i = 0; i < 512; i++) {
                bool skip = false; for (int j = 0; j < n; j++) if (used[j] == (uint32_t)i + 1) skip = true;
                if (!skip && (best < 0 || counts[i] > counts[best])) best = i;
            }
            if (best < 0 || counts[best] == 0) break;
            used[n] = (uint32_t)best + 1;
            double components[4]; for (int c = 0; c < 3; c++) {
                double value = sums[best][c] / (double)counts[best];
                components[c] = fmax(0, fmin(255, value)) / 255.0;
            } components[3] = 1.0;
            CGFloat locations[] = {0, 1}; CGFloat c0[] = {components[0],components[1],components[2],components[3]}; CGFloat c1[] = {components[0],components[1],components[2],0};
            CGColorRef colors[] = { CGColorCreate(srgb,c0), CGColorCreate(srgb,c1) };
            CGGradientRef gradient = CGGradientCreateWithColors(srgb, (__bridge CFArrayRef)@[( __bridge id)colors[0], (__bridge id)colors[1]], locations);
            double x = fmod(n * 73 + 29, 192) + 32, y = fmod(n * 107 + 41, 192) + 32;
            CGFloat radius = 110 + settings->ambient_softness * 210;
            CGContextSaveGState(context); CGContextSetAlpha(context, settings->ambient_intensity * 0.58);
            CGContextDrawRadialGradient(context, gradient, CGPointMake(x, 256 - y), 0,
                CGPointMake(x, 256 - y), radius, kCGGradientDrawsAfterEndLocation);
            CGContextRestoreGState(context); CGGradientRelease(gradient); CGColorRelease(colors[0]); CGColorRelease(colors[1]);
        }
        if (settings->ambient_brightness != 0) {
            CGFloat alpha = fabs(settings->ambient_brightness) / 200.0;
            CGColorRef tone = make_color(srgb, settings->ambient_brightness > 0 ? 0xffffffff : 0x000000ff);
            CGContextSetAlpha(context, alpha); CGContextSetFillColorWithColor(context, tone);
            CGContextFillRect(context, CGRectMake(0, 0, 256, 256)); CGColorRelease(tone);
        }
        CGContextRestoreGState(context);
        return true;
    }
    if (settings->style != 2 || settings->opacity <= 0) {
        return true;
    }

    // The blur never needs the full pixel count of the final export. The capped
    // layer is scaled back into the same composition coordinates after filtering.
    double scale = fmin(1.0, 640.0 / fmax(width, height));
    uint32_t layer_width = (uint32_t)fmax(1.0, round(width * scale));
    uint32_t layer_height = (uint32_t)fmax(1.0, round(height * scale));
    double blur = settings->blur * fmin(width, height) / 1080.0;
    double cover = fmax(
        (width + 4.0 * blur) / source_width,
        (height + 4.0 * blur) / source_height
    );
    double image_width = source_width * cover * layer_width / width;
    double image_height = source_height * cover * layer_height / height;
    CGContextRef layer = create_context(layer_width, layer_height, srgb);
    if (layer == NULL) {
        return false;
    }
    color = make_color(srgb, matte);
    CGContextSetFillColorWithColor(layer, color);
    CGContextFillRect(layer, CGRectMake(0, 0, layer_width, layer_height));
    CGColorRelease(color);
    draw_oriented(layer, photo, CGRectMake(
        (layer_width - image_width) * 0.5, (layer_height - image_height) * 0.5,
        image_width, image_height
    ));
    size_t byte_count = (size_t)layer_width * layer_height * 4;
    uint8_t *pixels = CGBitmapContextGetData(layer);
    if (blur * scale >= 0.5) {
        uint8_t *temporary = malloc(byte_count);
        if (temporary == NULL) {
            CGContextRelease(layer);
            return false;
        }
        int radius = (int)round(blur * scale);
        for (int pass = 0; pass < 3; pass++) {
            box_blur(pixels, temporary, layer_width, layer_height, 4, layer_width * 4, radius);
            box_blur(temporary, pixels, layer_height, layer_width, layer_width * 4, 4, radius);
        }
        free(temporary);
    }
    if (settings->brightness != 1) {
        for (size_t offset = 0; offset < byte_count; offset += 4) {
            for (size_t channel = 0; channel < 3; channel++) {
                pixels[offset + channel] = (uint8_t)fmin(255, round(pixels[offset + channel] * settings->brightness));
            }
        }
    }
    CGImageRef filtered = CGBitmapContextCreateImage(layer);
    CGContextRelease(layer);
    if (filtered == NULL) {
        return false;
    }
    CGContextSaveGState(context);
    CGContextSetAlpha(context, settings->opacity);
    CGContextDrawImage(context, full, filtered);
    CGContextRestoreGState(context);
    CGImageRelease(filtered);
    return true;
}

static void draw_shadow(CGContextRef context, CGColorSpaceRef srgb, CGRect visible, CGRect full, double unit) {
    CGColorRef color = make_color(srgb, 0x0000004c);
    CGContextSaveGState(context);
    // Preserve the matte through transparent source pixels inside the photo.
    CGContextAddRect(context, full);
    CGContextAddRect(context, visible);
    CGContextEOClip(context);
    CGContextSetShadowWithColor(context, CGSizeMake(0, -4.0 * unit), 8.0 * unit, color);
    CGContextSetRGBFillColor(context, 0, 0, 0, 1);
    CGContextFillRect(context, visible);
    CGContextRestoreGState(context);
    CGColorRelease(color);
}

static void draw_inset(CGContextRef context, CGColorSpaceRef srgb, CGRect visible, uint32_t style, double unit) {
    CGRect inset = CGRectInset(visible, 7.0 * unit, 7.0 * unit);
    if (CGRectIsEmpty(inset)) {
        return;
    }
    CGColorRef color = make_color(srgb, style == 1 || style == 3 ? 0x18191661 : 0xffffff99);
    CGContextSetStrokeColorWithColor(context, color);
    CGContextSetLineWidth(context, unit);
    CGContextStrokeRect(context, inset);
    CGColorRelease(color);
}

static CTFontRef create_font(NSString *name, double size, uint32_t weight) {
    if ([name isEqualToString:@"sans-serif"]) {
        name = @"Arial";
    } else if ([name isEqualToString:@"serif"]) {
        name = @"Times New Roman";
    } else if ([name isEqualToString:@"monospace"]) {
        name = @"Menlo";
    }
    CTFontRef base = CTFontCreateWithName((__bridge CFStringRef)name, size, NULL);
    NSString *family = CFBridgingRelease(CTFontCopyFamilyName(base));
    NSString *full_name = CFBridgingRelease(CTFontCopyFullName(base));
    NSString *postscript = CFBridgingRelease(CTFontCopyPostScriptName(base));
    if ([name caseInsensitiveCompare:family] != NSOrderedSame
        && [name caseInsensitiveCompare:full_name] != NSOrderedSame
        && [name caseInsensitiveCompare:postscript] != NSOrderedSame) {
        CFRelease(base);
        base = CTFontCreateWithName(CFSTR("Arial"), size, NULL);
        family = CFBridgingRelease(CTFontCopyFamilyName(base));
    }
    const double css_weights[] = { -0.8, -0.6, -0.4, 0.0, 0.23, 0.3, 0.4, 0.56, 0.62 };
    uint32_t index = fmax(0, fmin(8, ((double)weight - 100) / 100));
    NSDictionary *attributes = @{
        (__bridge NSString *)kCTFontFamilyNameAttribute: family,
        (__bridge NSString *)kCTFontTraitsAttribute: @{
            (__bridge NSString *)kCTFontWeightTrait: @(css_weights[index]),
        },
    };
    CTFontDescriptorRef descriptor = CTFontDescriptorCreateWithAttributes((__bridge CFDictionaryRef)attributes);
    CTFontRef font = CTFontCreateWithFontDescriptor(descriptor, size, NULL);
    CFRelease(descriptor);
    CFRelease(base);
    return font;
}

static void draw_text(
    CGContextRef context,
    CGColorSpaceRef srgb,
    const LustraText *items,
    size_t count,
    double width,
    double height,
    double unit
) {
    CGContextSetTextMatrix(context, CGAffineTransformIdentity);
    for (size_t index = 0; index < count; index++) {
        const LustraText *item = items + index;
        NSString *text = [NSString stringWithUTF8String:item->text];
        NSString *font_name = [NSString stringWithUTF8String:item->font_family];
        if (text.length == 0 || font_name.length == 0) {
            continue;
        }
        double size = item->size * unit;
        double line_height = size * 1.2;
        CTFontRef font = create_font(font_name, size, item->weight);
        CGColorRef color = make_color(srgb, item->rgba);
        NSDictionary *attributes = @{
            (__bridge NSString *)kCTFontAttributeName: (__bridge id)font,
            (__bridge NSString *)kCTForegroundColorAttributeName: (__bridge id)color,
        };
        NSArray<NSString *> *lines = [text componentsSeparatedByString:@"\n"];
        double horizontal = item->horizontal_anchor * 0.5;
        double vertical = item->vertical_anchor * 0.5;
        double x = width * horizontal + item->x * unit;
        double y = height - height * vertical - item->y * unit + lines.count * line_height * vertical;
        double baseline = y - (line_height + CTFontGetAscent(font) - CTFontGetDescent(font)) * 0.5;
        for (NSString *line_text in lines) {
            NSAttributedString *attributed = [[NSAttributedString alloc] initWithString:line_text attributes:attributes];
            CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)attributed);
            double line_width = CTLineGetTypographicBounds(line, NULL, NULL, NULL);
            CGContextSetTextPosition(context, x - line_width * horizontal, baseline);
            CTLineDraw(line, context);
            CFRelease(line);
            baseline -= line_height;
        }
        CGColorRelease(color);
        CFRelease(font);
    }
}

static bool copy_data(CFDataRef data, uint8_t **bytes, size_t *size) {
    if (data == NULL || CFDataGetLength(data) <= 0) {
        return false;
    }
    size_t length = (size_t)CFDataGetLength(data);
    uint8_t *copy = malloc(length);
    if (copy == NULL) {
        return false;
    }
    memcpy(copy, CFDataGetBytePtr(data), length);
    *bytes = copy;
    *size = length;
    return true;
}

static bool encode_standard(CGContextRef context, const LustraRenderSettings *settings, LustraEncoded *output) {
    CGImageRef image = CGBitmapContextCreateImage(context);
    if (image == NULL) {
        return false;
    }
    NSMutableData *bytes = [NSMutableData data];
    CFStringRef type = settings->format == 0 ? CFSTR("public.jpeg") : CFSTR("public.png");
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)bytes, type, 1, NULL);
    bool success = false;
    if (destination != NULL) {
        NSDictionary *options = settings->format == 0 ? @{
            (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @(settings->quality / 100.0),
        } : @{};
        CGImageDestinationAddImage(destination, image, (__bridge CFDictionaryRef)options);
        success = CGImageDestinationFinalize(destination) && copy_data((__bridge CFDataRef)bytes, &output->pixels, &output->pixel_size);
        CFRelease(destination);
    }
    CGImageRelease(image);
    return success;
}

static bool encode_extended_webp(
    CGContextRef context,
    CGColorSpaceRef color_space,
    const LustraRenderSettings *settings,
    LustraEncoded *output
) {
#ifndef LUSTRA_HAS_WEBP
    return false;
#else
    if (settings->width > 16383 || settings->height > 16383) {
        return false;
    }
    uint8_t *encoded = NULL;
    size_t length = WebPEncodeRGBA(
        CGBitmapContextGetData(context), settings->width, settings->height,
        (int)CGBitmapContextGetBytesPerRow(context), settings->quality, &encoded
    );
    if (length == 0 || encoded == NULL) {
        return false;
    }
    output->pixels = malloc(length);
    if (output->pixels == NULL) {
        WebPFree(encoded);
        return false;
    }
    memcpy(output->pixels, encoded, length);
    output->pixel_size = length;
    WebPFree(encoded);

    CFDataRef icc = CGColorSpaceCopyICCData(color_space);
    bool copied = copy_data(icc, &output->icc, &output->icc_size);
    if (icc != NULL) {
        CFRelease(icc);
    }
    return copied;
#endif
}

uint32_t lustra_render_image(
    const LustraImage *photo,
    uint32_t source_width,
    uint32_t source_height,
    const LustraRenderSettings *settings,
    const LustraText *text,
    size_t text_count,
    LustraEncoded *output
) {
    @autoreleasepool {
        CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
        CGColorSpaceRef source_space = photo->has_profile ? CGImageGetColorSpace(photo->image) : NULL;
        if (settings->preserve_color_space && source_space != NULL
            && CGColorSpaceGetModel(source_space) != kCGColorSpaceModelRGB) {
            CGColorSpaceRelease(srgb);
            return 4;
        }
        CGColorSpaceRef color_space = settings->preserve_color_space && source_space != NULL ? source_space : srgb;
        CGContextRef context = create_context(settings->width, settings->height, color_space);
        if (context == NULL) {
            CGColorSpaceRelease(srgb);
            return 3;
        }
        if (!draw_background(context, photo, settings, srgb, source_width, source_height)) {
            CGContextRelease(context);
            CGColorSpaceRelease(srgb);
            return 5;
        }

        double unit = fmin(settings->width, settings->height) / 1080.0;
        CGRect visible = canvas_rect(settings->visible, settings->height);
        if (settings->shadow) {
            draw_shadow(context, srgb, visible, CGRectMake(0, 0, settings->width, settings->height), unit);
        }
        CGContextSaveGState(context);
        CGContextClipToRect(context, visible);
        draw_oriented(context, photo, canvas_rect(settings->image, settings->height));
        CGContextRestoreGState(context);
        if (settings->inset) {
            draw_inset(context, srgb, visible, settings->style, unit);
        }
        draw_text(context, srgb, text, text_count, settings->width, settings->height, unit);

        bool success = settings->format == 2
            ? encode_extended_webp(context, color_space, settings, output)
            : encode_standard(context, settings, output);
        CGContextRelease(context);
        CGColorSpaceRelease(srgb);
        return success ? 0 : 6;
    }
}
