import {
  Canvas,
  IText,
  FabricImage,
  Rect,
  FabricObject
} from 'fabric';
import { ALL_MODELS } from './brother-lib/models';
import { ALL_LABELS, FormFactor } from './brother-lib/labels';
import { BrotherQLUSB } from './brother-lib/webusb';
import { BrotherQLRaster } from './brother-lib/raster';
import { convertImage } from './brother-lib/conversion';

console.log('--- Studio Stable Engine (Final Polish) ---');

const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const connectionStatus = document.getElementById('connectionStatus')!;
const printControls = document.getElementById('printControls')!;
const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
const labelSelect = document.getElementById('labelSelect') as HTMLSelectElement;
const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const printBtn = document.getElementById('printBtn') as HTMLButtonElement;
const printStatus = document.getElementById('printStatus')!;
const cutCheck = document.getElementById('cutCheck') as HTMLInputElement;
const redCheck = document.getElementById('redCheck') as HTMLInputElement;

// Editor buttons
const addTextBtn = document.getElementById('addTextBtn') as HTMLButtonElement;
const addImageBtn = document.getElementById('addImageBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;

// Zoom & Dimensions 
const wrapper = document.getElementById('wrapper') as HTMLDivElement;
const zoomRange = document.getElementById('zoomRange') as HTMLInputElement;
const zoomLevelLabel = document.getElementById('zoomLevel')!;
const dimWidthLabel = document.getElementById('dimWidth')!;
const dimHeightLabel = document.getElementById('dimHeight')!;

// Sidebar features
const lengthWrapper = document.getElementById('lengthWrapper')!;
const labelLengthInput = document.getElementById('labelLength') as HTMLInputElement;
const orientationSelect = document.getElementById('orientationSelect') as HTMLSelectElement;

// Advanced controls
const ditherSelect = document.getElementById('ditherSelect') as HTMLSelectElement;
const rotateSelect = document.getElementById('rotateSelect') as HTMLSelectElement;
const manualOffsetInput = document.getElementById('manualOffset') as HTMLInputElement;
const detectTapeBtn = document.getElementById('detectTapeBtn') as HTMLButtonElement;
const tapeStatus = document.getElementById('tapeStatus') as HTMLDivElement;

const usb = new BrotherQLUSB();
let activeDevice: any = null;
let canvas: Canvas;
const MM_PER_DOT = 25.4 / 300;

let dotsResolution = { x: 202, y: 566 };
let currentZoom = 1.0;
let lastOrientation = 'vertical';

// V6 GLOBAL DEFAULTS
FabricObject.prototype.originX = 'left';
FabricObject.prototype.originY = 'top';
FabricObject.prototype.transparentCorners = false;
FabricObject.prototype.cornerColor = '#0064e0';
FabricObject.prototype.cornerStyle = 'circle';
FabricObject.prototype.fill = '#000000';
FabricObject.prototype.objectCaching = false;

window.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  setupEventListeners();
});

function initCanvas() {
  console.log('Initializing Fabric v6 Canvas...');
  canvas = new Canvas('labelCanvas', {
    backgroundColor: '#ffffff',
    preserveObjectStacking: true,
  });

  canvas.on('selection:created', (e: any) => onObjectSelected(e.selected || []));
  canvas.on('selection:updated', (e: any) => onObjectSelected(e.selected || []));
  canvas.on('selection:cleared', () => onObjectCleared());

  updateCanvasSize();

  setTimeout(() => canvas.requestRenderAll(), 100);
}

function applyVisualState() {
  if (!canvas) return;

  const physicalWidth = dotsResolution.x * currentZoom;
  const physicalHeight = dotsResolution.y * currentZoom;

  canvas.setDimensions({
    width: Math.round(physicalWidth),
    height: Math.round(physicalHeight)
  });

  canvas.setZoom(currentZoom);

  // Sync UI
  zoomRange.value = currentZoom.toString();
  zoomLevelLabel.textContent = `${Math.round(currentZoom * 100)}%`;

  dimWidthLabel.style.width = physicalWidth + 'px';
  dimWidthLabel.textContent = `${Math.round(dotsResolution.x * MM_PER_DOT)} mm`;
  dimHeightLabel.style.height = physicalHeight + 'px';
  dimHeightLabel.textContent = `${Math.round(dotsResolution.y * MM_PER_DOT)} mm`;

  canvas.calcOffset();
  canvas.requestRenderAll();
}

/**
 * Rotates all objects on the canvas to maintain composition when orientation flips.
 */
function rotateComposition(toHorizontal: boolean) {
  if (!canvas) return;
  const objects = canvas.getObjects();
  if (objects.length === 0) return;

  // Center point of the OLD canvas
  const oldCenter = { x: dotsResolution.x / 2, y: dotsResolution.y / 2 };

  // We flip dotsResolution locally for calculation if it hasn't been updated yet
  // But here we'll assume it's called BEFORE updateCanvasSize changes the resolution
  const newRes = { x: dotsResolution.y, y: dotsResolution.x };
  const newCenter = { x: newRes.x / 2, y: newRes.y / 2 };

  objects.forEach(obj => {
    // 1. Get relative position to center
    const relX = (obj.left || 0) - oldCenter.x;
    const relY = (obj.top || 0) - oldCenter.y;

    // 2. Rotate 90 degrees
    // (x, y) -> (-y, x) for clockwise? 
    // Actually for V -> H (90 deg CW): newX = -relY, newY = relX
    // For H -> V (90 deg CCW): newX = relY, newY = -relX
    let nextX, nextY;
    if (toHorizontal) {
      nextX = -relY;
      nextY = relX;
      obj.set('angle', (obj.angle || 0) + 90);
    } else {
      nextX = relY;
      nextY = -relX;
      obj.set('angle', (obj.angle || 0) - 90);
    }

    // 3. Set new position relative to NEW center
    obj.set({
      left: newCenter.x + nextX,
      top: newCenter.y + nextY
    });
    obj.setCoords();
  });
}

function updateCanvasSize() {
  if (!canvas) return;
  const labelId = labelSelect.value || ALL_LABELS[0].identifier;
  const label = ALL_LABELS.find(l => l.identifier === labelId);
  if (!label) return;

  const currentOrientation = orientationSelect.value;
  const isHorizontal = currentOrientation === 'horizontal';

  // Rotation logic if orientation changed
  if (currentOrientation !== lastOrientation) {
    rotateComposition(isHorizontal);
    lastOrientation = currentOrientation;
  }

  let baseWidth = label.dots_printable[0];
  let baseHeight = label.dots_printable[1];

  const isEndless = label.form_factor === FormFactor.ENDLESS || label.form_factor === FormFactor.PTOUCH_ENDLESS;
  if (isEndless) {
    lengthWrapper.style.display = 'block';
    const mm = parseInt(labelLengthInput.value) || 50;
    baseHeight = Math.round(mm / MM_PER_DOT);
  } else {
    lengthWrapper.style.display = 'none';
  }

  if (isHorizontal) {
    const temp = baseWidth;
    baseWidth = baseHeight;
    baseHeight = temp;
  }

  dotsResolution = { x: baseWidth, y: baseHeight };

  // Auto-fit if huge
  const availableWidth = wrapper.clientWidth - 200;
  if (baseWidth > availableWidth && availableWidth > 100) {
    currentZoom = availableWidth / baseWidth;
  } else {
    currentZoom = 1.0;
  }

  applyVisualState();
}

function setupEventListeners() {
  wrapper.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY;
      const factor = delta > 0 ? 0.9 : 1.1;
      currentZoom *= factor;
      if (currentZoom < 0.1) currentZoom = 0.1;
      if (currentZoom > 5) currentZoom = 5;
      applyVisualState();
    }
  }, { passive: false });

  zoomRange.addEventListener('input', () => {
    currentZoom = parseFloat(zoomRange.value);
    applyVisualState();
  });

  addTextBtn.addEventListener('click', () => {
    const text = new IText('TEXT', {
      left: dotsResolution.x / 2 - 50,
      top: dotsResolution.y / 2 - 30,
      fontFamily: 'Arial',
      fontSize: 60,
      fill: '#000000',
      originX: 'center', // Center for better rotation
      originY: 'center'
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
  });

  addImageBtn.addEventListener('click', () => imageInput.click());

  imageInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (re) => {
      const data = re.target?.result as string;
      FabricImage.fromURL(data).then((img) => {
        const scale = (dotsResolution.x / 2) / img.width;
        img.set({
          scaleX: scale,
          scaleY: scale,
          left: dotsResolution.x / 2,
          top: dotsResolution.y / 2,
          originX: 'center',
          originY: 'center'
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
      });
    };
    reader.readAsDataURL(file);
  });

  deleteBtn.addEventListener('click', () => {
    canvas.remove(...canvas.getActiveObjects());
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Clear Canvas?')) {
      canvas.clear();
      canvas.requestRenderAll();
      updateCanvasSize(); // Reset zoom if needed
    }
  });

  labelSelect.addEventListener('change', () => updateCanvasSize());
  labelLengthInput.addEventListener('input', () => updateCanvasSize());
  orientationSelect.addEventListener('change', () => updateCanvasSize());

  connectBtn.addEventListener('click', handleConnect);
  detectTapeBtn.addEventListener('click', runTapeDetection);
  printBtn.addEventListener('click', handlePrint);

  fontFamilySelect.addEventListener('change', () => updateActiveTextProp('fontFamily', fontFamilySelect.value));
  fontSizeInput.addEventListener('input', () => updateActiveTextProp('fontSize', parseInt(fontSizeInput.value) || 40));
}

function updateActiveTextProp(prop: string, value: any) {
  const active = canvas.getActiveObject();
  if (active instanceof IText) {
    active.set(prop as any, value);
    canvas.requestRenderAll();
  }
}

function onObjectSelected(selected: any[]) {
  deleteBtn.disabled = false;
  const obj = selected[0];
  if (obj instanceof IText) {
    textPropsToolbar.style.display = 'flex';
    fontFamilySelect.value = obj.fontFamily || 'Arial';
    fontSizeInput.value = (obj.fontSize || 40).toString();
  } else {
    textPropsToolbar.style.display = 'none';
  }
}

function onObjectCleared() {
  deleteBtn.disabled = true;
  textPropsToolbar.style.display = 'none';
}

async function handleConnect() {
  try {
    activeDevice = await usb.requestDevice();
    console.log('Connected Device:', activeDevice);
    await usb.open();
    connectionStatus.textContent = `Connected: ${activeDevice.productName}`;
    connectionStatus.className = 'status success';
    document.getElementById('connectWrapper')!.style.display = 'none';
    printControls.style.display = 'flex';

    // BETTER MODEL DETECTION
    // We match by product_id but search for the LAST match or be more specific 
    // because QL-500 is very early in list. QL-800 is 0x209b.
    const model = ALL_MODELS.find(m => m.product_id === activeDevice.productId);
    if (model) {
      modelSelect.value = model.identifier;
    }

    await runTapeDetection();
    updateCanvasSize();
    printBtn.disabled = false;
  } catch (err: any) {
    console.error(err);
  }
}

async function runTapeDetection() {
  if (!activeDevice) return;
  try {
    detectTapeBtn.disabled = true;
    tapeStatus.textContent = 'Detecting...';
    const qlr = new BrotherQLRaster(modelSelect.value);
    qlr.add_invalidate(); await usb.send(qlr.data); qlr.clear();
    qlr.add_initialize(); await usb.send(qlr.data); qlr.clear();
    qlr.add_status_information(); await usb.send(qlr.data); qlr.clear();
    const dataView = await usb.receive(32);
    const data = new Uint8Array(dataView.buffer);
    const matchedLabel = ALL_LABELS.find(l => {
      const isEndless = l.form_factor === FormFactor.ENDLESS || l.form_factor === FormFactor.PTOUCH_ENDLESS;
      return (isEndless ? 0x0A : 0x0B) === data[11] && l.tape_size[0] === data[10] && (isEndless || l.tape_size[1] === data[17]);
    });
    if (matchedLabel) {
      labelSelect.value = matchedLabel.identifier;
      labelSelect.dispatchEvent(new Event('change'));
      tapeStatus.innerHTML = `<span class="success">Label: ${matchedLabel.tape_size[0]}mm</span>`;
    } else {
      tapeStatus.textContent = 'Unknown Tape';
    }
  } catch (err: any) {
    console.error(err);
    tapeStatus.textContent = 'Detection Failed';
  } finally {
    detectTapeBtn.disabled = false;
  }
}

async function handlePrint() {
  if (!canvas || !activeDevice) return;
  printStatus.textContent = 'Printing...';
  printBtn.disabled = true;
  try {
    const labelId = labelSelect.value;
    const label = ALL_LABELS.find(l => l.identifier === labelId)!;
    const isHorizontal = orientationSelect.value === 'horizontal';

    // Export at 1:1
    canvas.setZoom(1);
    canvas.setDimensions(dotsResolution);

    // 1. CAPTURE DATA URL
    const dataURL = canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 });

    // Restore UI zoom
    applyVisualState();

    const img = new Image();
    img.onload = async () => {
      // FIX VERTICAL MIRROR ISSUE
      // If the output is mirrored vertically, we must flip it before conversion.
      const flipCanvas = document.createElement('canvas');
      flipCanvas.width = img.width;
      flipCanvas.height = img.height;
      const ctx = flipCanvas.getContext('2d')!;

      // Apply vertical flip
      ctx.translate(0, img.height);
      ctx.scale(1, -1);
      ctx.drawImage(img, 0, 0);

      const qlr = new BrotherQLRaster(modelSelect.value);
      let rotate: any = rotateSelect.value === 'auto' ? 'auto' : parseInt(rotateSelect.value);
      if (isHorizontal && rotate === 'auto') rotate = 90;

      const data = await convertImage(qlr, flipCanvas, label, {
        cut: cutCheck.checked,
        red: redCheck.checked,
        compress: true,
        rotate: rotate as any,
        dither: ditherSelect.value as any,
        manual_offset: parseInt((document.getElementById('manualOffset') as HTMLInputElement).value || '-25'),
      });
      await usb.send(data);
      printStatus.innerHTML = '<span class="success">Print Success!</span>';
    };
    img.src = dataURL;
  } catch (err: any) {
    console.error(err);
    printStatus.innerHTML = '<span class="error">Print Error</span>';
  } finally {
    printBtn.disabled = false;
  }
}

// Initial Population
ALL_MODELS.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m.identifier; opt.textContent = m.identifier; modelSelect.appendChild(opt);
});
ALL_LABELS.forEach(l => {
  const opt = document.createElement('option');
  opt.value = l.identifier;
  opt.textContent = `${l.identifier} (${l.tape_size[0]}mm${l.tape_size[1] > 0 ? ' x ' + l.tape_size[1] + 'mm' : ' endless'})`;
  labelSelect.appendChild(opt);
});
