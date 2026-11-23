# Portrait Card canvas layout

Portrait Card is a canvas composition mode. It keeps the selected Frame style as the canvas background and places the cropped photo above that background. Standard remains the default for existing and restored sessions.

On first selection, Portrait Card initializes to a 4:5 canvas, an 80% photo width, centered vertical position, blurred background, blur strength 32 and brightness 90. The canvas ratio, photo width (40–90%), normalized vertical position, background style, blur and brightness are stored in the existing frame session data and participate in All Photos / This Photo edits and undo history. Switching to Standard preserves those values and its existing padding and effects.

The photo stays horizontally centered and retains its aspect ratio after Crop & Rotate. Vertical position ranges from -0.5 to 0.5, where zero is centered. The editor supports numeric/slider adjustments, reset and vertical dragging. Photo-relative text and watermark anchors use the visible photo bounds; canvas-relative anchors continue to use the complete canvas.

The background reuses the existing frame painter and Rust renderer. Portrait Card blur and brightness have independent settings from Standard blur. Export dimensions use the requested canvas ratio; Original bases the canvas width on the cropped source width, while fixed sizes use the short canvas edge. JPEG, PNG and WebP continue through the existing export pipeline and metadata options.
