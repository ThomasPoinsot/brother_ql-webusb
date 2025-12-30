# Technical Documentation 📚

This document provides technical details about the `brother_ql-web` library and the Brother QL raster protocol.

## 🏗️ Architecture

The library is split into several modules:

- **`models.ts`**: Contains definitions for all Brother QL printer models, including their resolutions and physical dimensions.
- **`labels.ts`**: Contains definitions for all supported tape sizes (endless and die-cut).
- **`raster.ts`**: Implements the Brother QL Raster Language protocol generation.
- **`conversion.ts`**: The core image processing pipeline.
- **`webusb.ts`**: A thin wrapper around the WebUSB API for browser communication.
- **`packbits.ts`**: Implements the TIFF PackBits compression algorithm used by Brother printers.

## 🧪 Image Processing Pipeline

The `convertImage` function follows this sequence:

1.  **Rotation**: Automatic or manual rotation to fit the tape orientation.
2.  **Grayscale Conversion**: Luminance-based (0.299R + 0.587G + 0.114B).
3.  **Resizing**: High-quality resizing to the printable width of the loaded tape.
4.  **CLAHE (Optional)**: Contrast Limited Adaptive Histogram Equalization for enhanced local contrast.
5.  **Tone Remapping (Optional)**: Maps the 0-255 range to a custom visible range (e.g., 112-240) to compensate for thermal printer characteristics.
6.  **Gamma Correction (Optional)**: Adjusts the image brightness curve.
7.  **Dithering**: Choice of `Threshold` (None), `Floyd-Steinberg`, or `Stucki`.

## 🔌 WebUSB Setup

To use the library in a web environment, you need to request access to the USB device:

```typescript
const usb = new BrotherQLUSB();
const device = await usb.requestDevice();
await usb.open();
// ... print logic ...
```

### Linux Permissions (udev)
On Linux, create a file at `/etc/udev/rules.d/99-brother.rules`:
```
SUBSYSTEM=="usb", ATTR{idVendor}=="04f9", MODE="0666"
```

## 📜 Protocol References

This library implements the **Raster Command** mode.
- **Initialization**: `ESC @`
- **Status Information Request**: `ESC i S`
- **Raster Data**: `g` or `w` commands depending on compression and color.
- **Print**: `0x1a` (ASCII SUB)

For more details, refer to the [Brother QL series Command Reference](https://support.brother.com).
