#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#include <stdint.h>
#include <string.h>
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
    uint32_t edge_mode;
    double edge_blur;
    double edge_fade;
    double crop_x;
    double crop_y;
    double crop_width;
    double crop_height;
    double rotation;
} LustraRenderSettings;

typedef struct {
    const char *text;
    const char *font_family;
    uint32_t weight;
    uint32_t horizontal_anchor;
    uint32_t vertical_anchor;
    uint32_t photo_relative;
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

static void draw_cropped(CGContextRef context, const LustraImage *photo, CGRect destination, const LustraRenderSettings *settings) {
    CGRect full = CGRectMake(
        destination.origin.x - settings->crop_x * destination.size.width / settings->crop_width,
        destination.origin.y - (1.0 - settings->crop_y - settings->crop_height) * destination.size.height / settings->crop_height,
        destination.size.width / settings->crop_width,
        destination.size.height / settings->crop_height
    );
    double radians = -settings->rotation * M_PI / 180.0;
    double c = fabs(cos(radians)), s = fabs(sin(radians));
    double cover = fmax(destination.size.width / (destination.size.width * c + destination.size.height * s),
                        destination.size.height / (destination.size.height * c + destination.size.width * s));
    CGContextSaveGState(context);
    CGContextTranslateCTM(context, CGRectGetMidX(destination), CGRectGetMidY(destination));
    CGContextRotateCTM(context, radians);
    CGContextScaleCTM(context, cover, cover);
    CGContextTranslateCTM(context, -CGRectGetMidX(destination), -CGRectGetMidY(destination));
    draw_oriented(context, photo, full);
    CGContextRestoreGState(context);
}

static CGColorRef make_color(CGColorSpaceRef srgb, uint32_t rgba) {
    CGFloat components[] = {
        ((rgba >> 24) & 255) / 255.0, ((rgba >> 16) & 255) / 255.0,
        ((rgba >> 8) & 255) / 255.0, (rgba & 255) / 255.0,
    };
    return CGColorCreate(srgb, components);
}

static void rgb_to_hsv(double r, double g, double b, double *h, double *s, double *v) {
    r /= 255.0; g /= 255.0; b /= 255.0;
    double maximum = fmax(r, fmax(g, b)), minimum = fmin(r, fmin(g, b)), delta = maximum - minimum;
    double hue = 0;
    if (delta > 0) {
        if (maximum == r) hue = fmod((g - b) / delta, 6.0);
        else if (maximum == g) hue = (b - r) / delta + 2.0;
        else hue = (r - g) / delta + 4.0;
        hue *= 60.0; if (hue < 0) hue += 360.0;
    }
    *h = hue; *s = maximum == 0 ? 0 : delta / maximum; *v = maximum;
}

static void hsv_to_rgb(double h, double s, double v, double *r, double *g, double *b) {
    double c = v * s, x = c * (1.0 - fabs(fmod(h / 60.0, 2.0) - 1.0)), m = v - c;
    double rp, gp, bp;
    if (h < 60) { rp = c; gp = x; bp = 0; }
    else if (h < 120) { rp = x; gp = c; bp = 0; }
    else if (h < 180) { rp = 0; gp = c; bp = x; }
    else if (h < 240) { rp = 0; gp = x; bp = c; }
    else if (h < 300) { rp = x; gp = 0; bp = c; }
    else { rp = c; gp = 0; bp = x; }
    *r = (rp + m) * 255.0; *g = (gp + m) * 255.0; *b = (bp + m) * 255.0;
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

static bool draw_edge_stretch(CGContextRef context, const LustraImage *photo,
    const LustraRenderSettings *s, CGColorSpaceRef srgb) {
    const double scale = fmin(1.0, 640.0 / fmax(s->width, s->height));
    const uint32_t w = (uint32_t)fmax(1, round(s->width * scale));
    const uint32_t h = (uint32_t)fmax(1, round(s->height * scale));
    CGContextRef layer = create_context(w, h, srgb);
    if (!layer) return false;
    CGRect image = canvas_rect(s->image, s->height);
    CGRect visible = canvas_rect(s->visible, s->height);
    image = CGRectMake(image.origin.x*scale, image.origin.y*scale, image.size.width*scale, image.size.height*scale);
    visible = CGRectMake(visible.origin.x*scale, visible.origin.y*scale, visible.size.width*scale, visible.size.height*scale);
    draw_cropped(layer, photo, image, s);
    uint8_t *pixels = CGBitmapContextGetData(layer);
    size_t bytes = (size_t)w*h*4;
    uint8_t *source = malloc(bytes);
    if (!pixels || !source) { free(source); CGContextRelease(layer); return false; }
    memcpy(source, pixels, bytes);
    int left = (int)floor(visible.origin.x), right = (int)ceil(CGRectGetMaxX(visible))-1;
    int bottom = (int)floor(visible.origin.y), top = (int)ceil(CGRectGetMaxY(visible))-1;
    left = left < 0 ? 0 : left; right = right >= (int)w ? (int)w-1 : right;
    bottom = bottom < 0 ? 0 : bottom; top = top >= (int)h ? (int)h-1 : top;
    if (left > right || bottom > top) { free(source); CGContextRelease(layer); return false; }
    for (int y=0; y<(int)h; y++) for (int x=0; x<(int)w; x++) {
        if (x>=left && x<=right && y>=bottom && y<=top) continue;
        int sx=x, sy=y;
        if (s->edge_mode) {
            if (x<left) sx=left+(left-x-1)%(right-left+1);
            if (x>right) sx=right-(x-right-1)%(right-left+1);
            if (y<bottom) sy=bottom+(bottom-y-1)%(top-bottom+1);
            if (y>top) sy=top-(y-top-1)%(top-bottom+1);
        } else { sx=x<left?left:(x>right?right:x); sy=y<bottom?bottom:(y>top?top:y); }
        size_t dst=((size_t)y*w+x)*4, src=((size_t)sy*w+sx)*4;
        double distance=fmax(x<left?left-x:x>right?x-right:0, y<bottom?bottom-y:y>top?y-top:0);
        double fade=s->edge_fade*fmin(s->width,s->height)/1080.0*scale;
        double t=fade>0?fmax(0,fmin(1,1-distance/fade)):0;
        double weight=t*t*(3-2*t);
        int depth=(int)fmax(1,round(fade));
        int ix=x<left?left+depth:x>right?right-depth:sx;
        int iy=y<bottom?bottom+depth:y>top?top-depth:sy;
        ix=ix<left?left:(ix>right?right:ix); iy=iy<bottom?bottom:(iy>top?top:iy);
        size_t inward=((size_t)iy*w+ix)*4;
        for(int c=0;c<4;c++) pixels[dst+c]=(uint8_t)(source[src+c]*(1-weight)+source[inward+c]*weight);
    }
    free(source);
    double blur=s->edge_blur*fmin(s->width,s->height)/1080.0*scale;
    if (blur>=0.5) {
        uint8_t *tmp=malloc(bytes); if (!tmp) { CGContextRelease(layer); return false; }
        int radius=(int)round(blur);
        for(int i=0;i<3;i++){ box_blur(pixels,tmp,w,h,4,w*4,radius); box_blur(tmp,pixels,h,w,w*4,4,radius); }
        free(tmp);
    }
    CGImageRef image_ref=CGBitmapContextCreateImage(layer);
    CGContextRelease(layer);
    if (!image_ref) return false;
    CGContextDrawImage(context, CGRectMake(0,0,s->width,s->height), image_ref);
    CGImageRelease(image_ref);
    return true;
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
    if (settings->style != 8) {
        CGColorRef color = make_color(srgb, matte);
        CGContextSetFillColorWithColor(context, color);
        CGContextFillRect(context, full);
        CGColorRelease(color);
    }
    if (settings->style == 7) return draw_edge_stretch(context, photo, settings, srgb);
    if (settings->style == 6) {
        CGContextRef sample = create_context(96, 96, srgb);
        if (sample == NULL) return false;
        draw_cropped(sample, photo, CGRectMake(0, 0, 96, 96), settings);
        uint8_t *pixels = CGBitmapContextGetData(sample);
        uint32_t *counts = calloc(9 * 4096, sizeof(uint32_t));
        uint64_t (*sums)[5] = calloc(9 * 4096, sizeof(*sums));
        if (counts == NULL || sums == NULL) { free(counts); free(sums); CGContextRelease(sample); return false; }
        for (int y = 0; y < 96; y++) for (int x = 0; x < 96; x++) {
            if (settings->ambient_edges && x > 16 && x < 79 && y > 16 && y < 79) continue;
            size_t p = ((size_t)y * 96 + x) * 4;
            int tile = (y / 32) * 3 + (x / 32);
            uint32_t key = tile * 4096 + ((pixels[p] >> 4) << 8) + ((pixels[p + 1] >> 4) << 4) + (pixels[p + 2] >> 4);
            counts[key]++; for (int c = 0; c < 3; c++) sums[key][c] += pixels[p + c];
            sums[key][3] += x; sums[key][4] += y;
        }
        CGContextRelease(sample);
        double sr[5], sg[5], sb[5], sh[5], ss[5], sv[5], sx[5], sy[5], sw[5]; int sample_count = 0;
        bool selected[9 * 4096] = {false}; int max_per_tile[9] = {1};
        for (int i = 0; i < 9 * 4096; i++) if ((int)counts[i] > max_per_tile[i / 4096]) max_per_tile[i / 4096] = (int)counts[i];
        for (int n = 0; n < 5; n++) {
            int best = -1; double best_score = -1;
            for (int i = 0; i < 9 * 4096; i++) {
                if (!counts[i] || selected[i]) continue;
                if (counts[i] < fmax(3, max_per_tile[i / 4096] * 0.0125)) continue;
                double r = sums[i][0] / (double)counts[i], g = sums[i][1] / (double)counts[i], b = sums[i][2] / (double)counts[i];
                bool similar = false;
                for (int k = 0; k < sample_count; k++) if (hypot(hypot(r - sr[k], g - sg[k]), b - sb[k]) < 48) similar = true;
                if (similar) continue;
                double chroma = (fmax(r, fmax(g, b)) - fmin(r, fmin(g, b))) / 255.0;
                double light = (r + g + b) / 765.0;
                double score = sqrt((double)counts[i] / max_per_tile[i / 4096]) * (0.35 + fmin(0.9, chroma * 2.0) + fmin(0.06, light * 0.06));
                if (score > best_score) { best = i; best_score = score; }
            }
            if (best < 0) break;
            selected[best] = true;
            double cr = sums[best][0] / (double)counts[best], cg = sums[best][1] / (double)counts[best], cb = sums[best][2] / (double)counts[best];
            sr[sample_count] = cr; sg[sample_count] = cg; sb[sample_count] = cb;
            rgb_to_hsv(cr, cg, cb, &sh[sample_count], &ss[sample_count], &sv[sample_count]);
            sx[sample_count] = sums[best][3] / (double)counts[best] / 95.0;
            sy[sample_count] = sums[best][4] / (double)counts[best] / 95.0;
            sw[sample_count] = sqrt((double)counts[best] / 9216.0);
            sample_count++;
        }
        free(counts); free(sums);
        if (sample_count) {
            CGContextRef mesh = create_context(256, 256, srgb);
            if (mesh == NULL) return false;
            uint8_t *out = CGBitmapContextGetData(mesh);
            double intensity = settings->ambient_intensity, softness = settings->ambient_softness;
            double brightness = settings->ambient_brightness * 100.0;
            double sigma = 0.16 + softness * 0.28;
            double factor = brightness < 0 ? fmax(0, 1 + brightness / 120.0) : 1;
            double lift = brightness > 0 ? brightness * 1.36 : 0;
            for (int py = 0; py < 256; py++) for (int px = 0; px < 256; px++) {
                double nx = px / 255.0, ny = 1.0 - py / 255.0;
                double total = 0, value = 0, saturation = 0, hue_total = 0, hue_x = 0, hue_y = 0;
                double fallback_hue = 0, fallback_strength = -1;
                for (int k = 0; k < sample_count; k++) {
                    double dx = nx - sx[k], dy = ny - sy[k];
                    double w = sw[k] * exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
                    double hw = ss[k] * w * w, radians = sh[k] * M_PI / 180.0;
                    total += w; value += sv[k] * w; saturation += ss[k] * w;
                    hue_total += hw; hue_x += cos(radians) * hw; hue_y += sin(radians) * hw;
                    if (hw > fallback_strength) { fallback_strength = hw; fallback_hue = sh[k]; }
                }
                size_t p = ((size_t)py * 256 + px) * 4;
                double vector_length = hypot(hue_x, hue_y);
                double hue = vector_length / fmax(1e-9, hue_total) < 0.12 ? fallback_hue : fmod(atan2(hue_y, hue_x) * 180.0 / M_PI + 360.0, 360.0);
                double v = fmax(0, fmin(1, (0.47 + (value / total - 0.47) * intensity) * factor + lift / 255.0));
                double sat = fmax(0, fmin(0.96, saturation / total * intensity * (1 + intensity * 0.35)));
                double rr, gg, bb; hsv_to_rgb(hue, sat, v, &rr, &gg, &bb);
                out[p] = (uint8_t)rr; out[p + 1] = (uint8_t)gg; out[p + 2] = (uint8_t)bb;
                out[p + 3] = 255;
            }
            CGImageRef mesh_image = CGBitmapContextCreateImage(mesh);
            CGContextDrawImage(context, full, mesh_image);
            CGImageRelease(mesh_image); CGContextRelease(mesh);
        }
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
    double cropped_width = source_width * settings->crop_width;
    double cropped_height = source_height * settings->crop_height;
    double cover = fmax((width + 4.0 * blur) / cropped_width, (height + 4.0 * blur) / cropped_height);
    double image_width = cropped_width * cover * layer_width / width;
    double image_height = cropped_height * cover * layer_height / height;
    CGContextRef layer = create_context(layer_width, layer_height, srgb);
    if (layer == NULL) {
        return false;
    }
    CGColorRef color = make_color(srgb, matte);
    CGContextSetFillColorWithColor(layer, color);
    CGContextFillRect(layer, CGRectMake(0, 0, layer_width, layer_height));
    CGColorRelease(color);
    draw_cropped(layer, photo, CGRectMake(
        (layer_width - image_width) * 0.5, (layer_height - image_height) * 0.5,
        image_width, image_height
    ), settings);
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
    double unit,
    CGRect photo_bounds
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
        CGRect bounds = item->photo_relative ? photo_bounds : CGRectMake(0, 0, width, height);
        double x = bounds.origin.x + bounds.size.width * horizontal + item->x * unit;
        double y = bounds.origin.y + bounds.size.height - bounds.size.height * vertical - item->y * unit + lines.count * line_height * vertical;
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
        CGRect cropped = canvas_rect(settings->image, settings->height);
        draw_cropped(context, photo, cropped, settings);
        CGContextRestoreGState(context);
        if (settings->inset) {
            draw_inset(context, srgb, visible, settings->style, unit);
        }
        draw_text(context, srgb, text, text_count, settings->width, settings->height, unit, visible);

        bool success = settings->format == 2
            ? encode_extended_webp(context, color_space, settings, output)
            : encode_standard(context, settings, output);
        CGContextRelease(context);
        CGColorSpaceRelease(srgb);
        return success ? 0 : 6;
    }
}
