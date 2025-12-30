# brother_ql-webusb 🖨️

A web application and TypeScript library for printing directly to **Brother QL** series printers from your browser via the **WebUSB** API.

This project is a modern port of the [brother_ql-inventree](https://github.com/inventree/brother_ql-inventree) Python library, optimized for the web with a focus on image quality and ease of use.

## 🚀 Features

- 🔌 **Driverless Printing**: Works directly via WebUSB (Chrome, Edge, Opera).
- 🔍 **Automatic Detection**: Queries the printer to automatically detect the model and the loaded tape (media width/type).
- ✨ **Enhanced Optimization**: Advanced image processing pipeline (CLAHE, Gamma, Dynamic Remapping) for crisp prints, even for photos.
- 📦 **Modular**: Can be used as a standalone web application or as a library in your own project.

## 🛠️ Installation & Development

### Prerequisites
- Node.js (v18+)
- A **WebUSB-compatible** browser (Chrome, Edge, Opera).
- > [!WARNING]
  > **Firefox is not supported** as it does not implement the WebUSB API.

### Installation
```bash
git clone https://github.com/ThomasPoinsot/brother_ql-web.git
cd brother_ql-web
npm install
```

### Development
```bash
npm run dev
```

### Build
```bash
npm run build
```

## 🐧 Linux Setup

For the browser to access the USB device, you need to add a `udev` rule:

1. Create a file `/etc/udev/rules.d/99-brother.rules`.
2. Add the following line:
   ```
   SUBSYSTEM=="usb", ATTR{idVendor}=="04f9", MODE="0666"
   ```
3. Reload udev rules: `sudo udevadm control --reload-rules && sudo udevadm trigger`.

## ⚠️ Compatibility & Drivers

- **Brother Drivers**: On some models, "Editor Lite" mode must be **disabled** (the button/LED on the printer) for the WebUSB interface to be detected.
- **Windows**: Not yet tested on Windows. You might need to use [Zadig](https://zadig.akeo.ie/) to replace the standard Brother driver with the `WinUSB` driver for the web app to see the device.
- **macOS**: Should work out of the box with compatible browsers.

## 📖 Usage

1. Connect your Brother QL printer via USB.
2. Click **Connect Printer** and select your device.
3. The printer model and tape will be detected automatically.
4. Upload an image, adjust settings if needed, and click **Print**.

## ⚖️ License & Credits

- **Credits**: Based on the outstanding work of [pklaus/brother_ql](https://github.com/pklaus/brother_ql) and its fork [inventree/brother_ql-inventree](https://github.com/inventree/brother_ql-inventree).
- **License**: This project is licensed under GPL-3.0 (inherited from the original project). See the `LICENSE` file for details.

---
Made with ❤️ by [Thomas Poinsot](https://github.com/ThomasPoinsot/)
