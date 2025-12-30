import type { Label } from './labels';
import { FormFactor } from './labels';
import { BrotherQLRaster } from './raster';

export interface ConversionOptions {
    cut?: boolean;
    dither?: 'none' | 'floyd-steinberg' | 'stucki';
    compress?: boolean;
    red?: boolean;
    rotate?: number | 'auto';
    dpi_600?: boolean;
    hq?: boolean;
    threshold?: number;
    min_visible?: number; // default 0 (no remap)
    max_visible?: number; // default 255 (no remap)
    gamma?: number; // default 1.0 (no correction)
    clahe_alpha?: number; // 0.0 to 1.0 (default 0.0, disabled)
    clahe_limit?: number; // Contrast limit (default 6.0)
    clahe_tiles?: number; // Number of tiles (default 6)
    manual_offset?: number; // Manual shift in dots (positive = left on paper, negative = right)
}

/**
 * Enhanced conversion pipeline for Brother QL printers.
 * Sequence: Rotation -> Grayscale L -> Resize -> CLAHE -> Remap -> 1-bit
 */
export async function convertImage(
    qlr: BrotherQLRaster,
    imageSource: HTMLImageElement | HTMLCanvasElement | OffscreenCanvas,
    label: Label,
    options: ConversionOptions = {}
): Promise<Uint8Array> {
    const {
        cut = true,
        compress = false,
        red = false,
        rotate = 'auto',
        dpi_600 = false,
        hq = true,
        threshold = 70,
        clahe_alpha = 0.0,
        clahe_limit = 6.0,
        clahe_tiles = 6,
        min_visible = 0,
        max_visible = 255,
        gamma = 1.0,
        manual_offset = 0,
        dither = 'none'
    } = options;

    qlr.add_invalidate();
    qlr.add_initialize();
    qlr.add_status_information();

    let currentSource: HTMLImageElement | HTMLCanvasElement | OffscreenCanvas = imageSource;

    // 1. Loading and Rotation
    let finalRotate = 0;
    if (rotate === 'auto') {
        if (label.form_factor === FormFactor.DIE_CUT || label.form_factor === FormFactor.ROUND_DIE_CUT) {
            if (currentSource.width === label.dots_printable[1] && currentSource.height === label.dots_printable[0]) {
                finalRotate = 90;
            }
        } else {
            // For endless labels, rotate landscape images 90 deg to fit tape width better
            if (currentSource.width > currentSource.height) {
                finalRotate = 90;
            }
        }
    } else {
        finalRotate = typeof rotate === 'string' ? 0 : rotate;
    }

    if (finalRotate !== 0) {
        const rotatedCanvas = typeof OffscreenCanvas !== 'undefined'
            ? new OffscreenCanvas(0, 0)
            : document.createElement('canvas');

        if (finalRotate === 90 || finalRotate === 270) {
            rotatedCanvas.width = currentSource.height;
            rotatedCanvas.height = currentSource.width;
        } else {
            rotatedCanvas.width = currentSource.width;
            rotatedCanvas.height = currentSource.height;
        }
        const rCtx = rotatedCanvas.getContext('2d') as any;
        rCtx.translate(rotatedCanvas.width / 2, rotatedCanvas.height / 2);
        rCtx.rotate((finalRotate * Math.PI) / 180);
        rCtx.drawImage(currentSource, -currentSource.width / 2, -currentSource.height / 2);
        currentSource = rotatedCanvas as any;
    }

    // 2. Resize to label printable width respecting ratio
    // 3. Conversion to Grayscale L
    let targetWidth = label.dots_printable[0];
    let targetHeight = label.dots_printable[1];

    if (label.form_factor === FormFactor.DIE_CUT || label.form_factor === FormFactor.ROUND_DIE_CUT) {
        // Fit within the printable box
        const ratio = currentSource.width / currentSource.height;
        const targetRatio = targetWidth / targetHeight;
        if (ratio > targetRatio) {
            targetHeight = Math.round(targetWidth / ratio);
        } else {
            targetWidth = Math.round(targetHeight * ratio);
        }
    } else {
        // Endless: fixed width, variable height
        targetHeight = Math.round((targetWidth / currentSource.width) * currentSource.height);
    }

    const procCanvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(targetWidth, targetHeight)
        : document.createElement('canvas');
    if (procCanvas instanceof HTMLCanvasElement) {
        procCanvas.width = targetWidth;
        procCanvas.height = targetHeight;
    }
    const pCtx = procCanvas.getContext('2d', { willReadFrequently: true }) as any;
    pCtx.fillStyle = 'white';
    pCtx.fillRect(0, 0, targetWidth, targetHeight);
    pCtx.drawImage(currentSource, 0, 0, targetWidth, targetHeight);
    const imgData = pCtx.getImageData(0, 0, targetWidth, targetHeight);
    const pixels = imgData.data;

    const grayPixels = new Float32Array(targetWidth * targetHeight);
    for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const a = pixels[i + 3];
        // Luminance L = 0.299R + 0.587G + 0.114B
        let gray = (0.299 * r + 0.587 * g + 0.114 * b);
        if (a < 128) gray = 255; // White if transparent
        grayPixels[i / 4] = gray;
    }

    // 4. CLAHE (Contrast Limited Adaptive Histogram Equalization)
    if (clahe_alpha > 0) {
        const claheOutput = applyCLAHE(grayPixels, targetWidth, targetHeight, clahe_limit, clahe_tiles, clahe_tiles);
        for (let i = 0; i < grayPixels.length; i++) {
            grayPixels[i] = (1 - clahe_alpha) * grayPixels[i] + clahe_alpha * claheOutput[i];
        }
    }

    // 5. Processing (Dynamic Remap & Gamma) - Only if needed
    const needsRemap = min_visible !== 0 || max_visible !== 255;
    const needsGamma = gamma !== 1.0;

    if (needsRemap || needsGamma) {
        const range = max_visible - min_visible;
        for (let i = 0; i < grayPixels.length; i++) {
            let val = grayPixels[i];

            // 5a. Dynamic Tone Remapping
            if (needsRemap) {
                val = min_visible + (val / 255) * range;
            }

            // 5b. Gamma correction
            if (needsGamma) {
                val = Math.pow(val / 255, gamma) * 255;
            }

            grayPixels[i] = Math.max(0, Math.min(255, val));
        }
    }

    // 6. Final 1-bit conversion (Brother QL)
    const deviceWidth = qlr.get_pixel_width();
    const blackBuffer = new Uint8Array((deviceWidth * targetHeight) / 8);
    const redBuffer = red ? new Uint8Array((deviceWidth * targetHeight) / 8) : undefined;

    // Positioning logic:
    const tapeWidth = label.dots_total[0];
    const printableWidth = label.dots_printable[0];
    const tapeOffsetInHead = Math.floor((deviceWidth - tapeWidth) / 2);
    const printableOffsetInTape = tapeWidth - printableWidth - label.offset_r; // Total offset from the right edge of the head
    let offsetX = tapeOffsetInHead + printableOffsetInTape + (qlr.model_data.additional_offset_r || 0);

    // Centering the image if it's narrower than the printable width
    if (targetWidth < printableWidth) {
        offsetX += Math.floor((printableWidth - targetWidth) / 2);
    }

    // Apply manual adjustment
    offsetX += manual_offset;

    offsetX = Math.max(0, offsetX);

    if (dither === 'none') {
        const thresholdValue = (100 - threshold) / 100 * 255;
        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                const gray = grayPixels[y * targetWidth + x];
                if (gray < thresholdValue) {
                    const devX = x + offsetX;
                    if (devX >= 0 && devX < deviceWidth) {
                        const pixelIdx = y * deviceWidth + devX;
                        const byteIdx = Math.floor(pixelIdx / 8);
                        const bitIdx = 7 - (pixelIdx % 8);
                        blackBuffer[byteIdx] |= (1 << bitIdx);
                    }
                }
            }
        }
    } else {
        const data = new Float32Array(grayPixels);
        const kernel: [number, number, number][] = dither === 'stucki'
            ? [[1, 0, 8 / 42], [2, 0, 4 / 42], [-2, 1, 2 / 42], [-1, 1, 4 / 42], [0, 1, 8 / 42], [1, 1, 4 / 42], [2, 1, 2 / 42], [-2, 2, 1 / 42], [-1, 2, 2 / 42], [0, 2, 4 / 42], [1, 2, 2 / 42], [2, 2, 1 / 42]]
            : [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]];

        for (let y = 0; y < targetHeight; y++) {
            for (let x = 0; x < targetWidth; x++) {
                const idx = y * targetWidth + x;
                const oldPixel = data[idx];
                const newPixel = oldPixel < 128 ? 0 : 255;
                data[idx] = newPixel;
                const error = oldPixel - newPixel;

                if (newPixel === 0) {
                    const devX = x + offsetX;
                    if (devX >= 0 && devX < deviceWidth) {
                        const pixelIdx = y * deviceWidth + devX;
                        const byteIdx = Math.floor(pixelIdx / 8);
                        const bitIdx = 7 - (pixelIdx % 8);
                        blackBuffer[byteIdx] |= (1 << bitIdx);
                    }
                }

                for (const [dx, dy, weight] of kernel) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < targetWidth && ny >= 0 && ny < targetHeight) {
                        data[ny * targetWidth + nx] += error * weight;
                    }
                }
            }
        }
    }

    // Set printer settings
    qlr.pquality = hq;
    if (label.form_factor === FormFactor.DIE_CUT || label.form_factor === FormFactor.ROUND_DIE_CUT) {
        qlr.mtype = 0x0b;
        qlr.mwidth = label.tape_size[0];
        qlr.mlength = label.tape_size[1];
    } else if (label.form_factor === FormFactor.ENDLESS) {
        qlr.mtype = 0x0a;
        qlr.mwidth = label.tape_size[0];
        qlr.mlength = 0;
    } else if (label.form_factor === FormFactor.PTOUCH_ENDLESS) {
        qlr.mtype = 0x00;
        qlr.mwidth = label.tape_size[0];
        qlr.mlength = 0;
    }

    qlr.add_media_and_quality(targetHeight);
    if (cut) {
        qlr.add_autocut(true);
        qlr.add_cut_every(1);
    }
    qlr.dpi_600 = dpi_600;
    qlr.cut_at_end = cut;
    qlr.two_color_printing = red;
    qlr.add_expanded_mode();
    qlr.add_margins(label.feed_margin);
    qlr.add_compression(compress);

    qlr.add_raster_data(blackBuffer, redBuffer, deviceWidth, targetHeight);
    qlr.add_print(true);

    return qlr.data;
}

/**
 * CLAHE Algorithm Implementation
 */
function applyCLAHE(src: Float32Array, width: number, height: number, limit: number, tilesX: number, tilesY: number): Float32Array {
    const dst = new Float32Array(src.length);
    const tileSizeX = Math.floor(width / tilesX);
    const tileSizeY = Math.floor(height / tilesY);

    const histograms = new Float32Array(tilesX * tilesY * 256);
    for (let ty = 0; ty < tilesY; ty++) {
        for (let tx = 0; tx < tilesX; tx++) {
            const histIdx = (ty * tilesX + tx) * 256;
            const startY = ty * tileSizeY;
            const startX = tx * tileSizeX;
            const endY = (ty === tilesY - 1) ? height : startY + tileSizeY;
            const endX = (tx === tilesX - 1) ? width : startX + tileSizeX;
            const nPixels = (endY - startY) * (endX - startX);
            const clipLimit = Math.max(1, Math.floor(limit * nPixels / 256));

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const val = Math.floor(Math.max(0, Math.min(255, src[y * width + x])));
                    histograms[histIdx + val]++;
                }
            }

            let clipped = 0;
            for (let i = 0; i < 256; i++) {
                if (histograms[histIdx + i] > clipLimit) {
                    clipped += histograms[histIdx + i] - clipLimit;
                    histograms[histIdx + i] = clipLimit;
                }
            }
            const redist = clipped / 256;
            for (let i = 0; i < 256; i++) histograms[histIdx + i] += redist;

            let sum = 0;
            for (let i = 0; i < 256; i++) {
                sum += histograms[histIdx + i];
                histograms[histIdx + i] = (sum / nPixels) * 255;
            }
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tx = (x - tileSizeX / 2) / tileSizeX;
            const ty = (y - tileSizeY / 2) / tileSizeY;
            const tx1 = Math.floor(tx);
            const ty1 = Math.floor(ty);
            const tx2 = tx1 + 1;
            const ty2 = ty1 + 1;
            const fx = tx - tx1;
            const fy = ty - ty1;
            const v = Math.floor(src[y * width + x]);
            const getCDF = (tpx: number, tpy: number) => {
                const cx = Math.max(0, Math.min(tilesX - 1, tpx));
                const cy = Math.max(0, Math.min(tilesY - 1, tpy));
                return histograms[(cy * tilesX + cx) * 256 + v];
            };
            const c11 = getCDF(tx1, ty1);
            const c21 = getCDF(tx2, ty1);
            const c12 = getCDF(tx1, ty2);
            const c22 = getCDF(tx2, ty2);
            dst[y * width + x] = (1 - fy) * ((1 - fx) * c11 + fx * c21) + fy * ((1 - fx) * c12 + fx * c22);
        }
    }
    return dst;
}
