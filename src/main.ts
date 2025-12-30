import { ALL_MODELS } from './brother-lib/models';
import { ALL_LABELS, FormFactor } from './brother-lib/labels';
import { BrotherQLUSB } from './brother-lib/webusb';
import { BrotherQLRaster } from './brother-lib/raster';
import { convertImage } from './brother-lib/conversion';

const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const connectionStatus = document.getElementById('connectionStatus')!;
const printControls = document.getElementById('printControls')!;
const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
const labelSelect = document.getElementById('labelSelect') as HTMLSelectElement;
const imageInput = document.getElementById('imageInput') as HTMLInputElement;
const preview = document.getElementById('preview') as HTMLCanvasElement;
const printBtn = document.getElementById('printBtn') as HTMLButtonElement;
const printStatus = document.getElementById('printStatus')!;
const cutCheck = document.getElementById('cutCheck') as HTMLInputElement;
const redCheck = document.getElementById('redCheck') as HTMLInputElement;

const usb = new BrotherQLUSB();
let activeDevice: any = null;
let currentImage: HTMLImageElement | null = null;

// Populate selects
ALL_MODELS.forEach(m => {
  const opt = document.createElement('option');
  opt.value = m.identifier;
  opt.textContent = m.identifier;
  modelSelect.appendChild(opt);
});

ALL_LABELS.forEach(l => {
  const opt = document.createElement('option');
  opt.value = l.identifier;
  opt.textContent = `${l.identifier} (${l.tape_size[0]}mm${l.tape_size[1] > 0 ? ' x ' + l.tape_size[1] + 'mm' : ' endless'})`;
  labelSelect.appendChild(opt);
});

// Check for WebUSB support
if (!('usb' in navigator)) {
  connectionStatus.textContent = "Error: Your browser does not support WebUSB. Please use Chrome, Edge, or Opera.";
  connectionStatus.className = 'status error';
  connectBtn.disabled = true;
}

connectBtn.addEventListener('click', async () => {
  try {
    activeDevice = await usb.requestDevice();
    await usb.open();
    connectionStatus.textContent = `Connected to ${activeDevice.productName}`;
    connectionStatus.className = 'status success';
    connectBtn.style.display = 'none';
    printControls.style.display = 'block';

    // Auto-detect model
    const detectedModel = ALL_MODELS.find(m => m.product_id === activeDevice.productId);
    if (detectedModel) {
      modelSelect.value = detectedModel.identifier;
      const modelLabel = document.createElement('div');
      modelLabel.className = 'status success';
      modelLabel.style.fontSize = '12px';
      modelLabel.textContent = `Auto-detected model: ${detectedModel.identifier}`;
      modelSelect.parentElement?.appendChild(modelLabel);
      // Optional: hide select if detected
      // modelSelect.style.display = 'none';
      // modelSelect.parentElement?.querySelector('label')?.insertAdjacentHTML('beforeend', ` (${detectedModel.identifier})`);
    }

    // Auto-detect tape
    await runTapeDetection();

  } catch (err: any) {
    console.error(err);
    connectionStatus.textContent = `Error: ${err.message}`;
    connectionStatus.className = 'status error';
  }
});

imageInput.addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (re) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      updatePreview();
      printBtn.disabled = false;
    };
    img.src = re.target?.result as string;
  };
  reader.readAsDataURL(file);
});

function updatePreview() {
  if (!currentImage) return;
  const ctx = preview.getContext('2d')!;
  preview.width = currentImage.width;
  preview.height = currentImage.height;
  preview.style.display = 'block';
  ctx.drawImage(currentImage, 0, 0);
}

const ditherSelect = document.getElementById('ditherSelect') as HTMLSelectElement;
const rotateSelect = document.getElementById('rotateSelect') as HTMLSelectElement;
const minVisibleInput = document.getElementById('minVisible') as HTMLInputElement;
const maxVisibleInput = document.getElementById('maxVisible') as HTMLInputElement;
const claheAlphaInput = document.getElementById('claheAlpha') as HTMLInputElement;
const claheClipInput = document.getElementById('claheClip') as HTMLInputElement;
const gammaInput = document.getElementById('gammaControl') as HTMLInputElement;
const manualOffsetInput = document.getElementById('manualOffset') as HTMLInputElement;
const detectTapeBtn = document.getElementById('detectTapeBtn') as HTMLButtonElement;
const tapeStatus = document.getElementById('tapeStatus') as HTMLDivElement;
const enableAICheck = document.getElementById('enableAI') as HTMLInputElement;
const aiControlsDiv = document.getElementById('aiControls') as HTMLDivElement;

enableAICheck.addEventListener('change', () => {
  aiControlsDiv.style.opacity = enableAICheck.checked ? '1' : '0.4';
  aiControlsDiv.style.pointerEvents = enableAICheck.checked ? 'auto' : 'none';
});

printBtn.addEventListener('click', async () => {
  if (!currentImage || !activeDevice) return;

  printStatus.textContent = 'Generating raster data...';
  printStatus.className = 'status';
  printBtn.disabled = true;

  try {
    const modelId = modelSelect.value;
    const labelId = labelSelect.value;
    const label = ALL_LABELS.find(l => l.identifier === labelId)!;

    const qlr = new BrotherQLRaster(modelId);

    const rotateVal = rotateSelect.value;
    const rotate = rotateVal === 'auto' ? 'auto' : parseInt(rotateVal);

    const useAI = enableAICheck.checked;

    const data = await convertImage(qlr, currentImage, label, {
      cut: cutCheck.checked,
      red: redCheck.checked,
      compress: true,
      rotate: rotate as any,
      dither: ditherSelect.value as any,
      min_visible: useAI ? parseInt(minVisibleInput.value) : undefined,
      max_visible: useAI ? parseInt(maxVisibleInput.value) : undefined,
      clahe_alpha: useAI ? parseFloat(claheAlphaInput.value) : undefined,
      clahe_limit: useAI ? parseFloat(claheClipInput.value) : undefined,
      gamma: useAI ? parseFloat(gammaInput.value) : undefined,
      manual_offset: parseInt(manualOffsetInput.value || '-25'),
    });

    printStatus.textContent = `Sending ${data.length} bytes to printer...`;
    await usb.send(data);
    printStatus.textContent = 'Print job sent successfully!';
    printStatus.className = 'status success';
  } catch (err: any) {
    console.error(err);
    printStatus.textContent = `Error: ${err.message}`;
    printStatus.className = 'status error';
  } finally {
    printBtn.disabled = false;
  }
});

detectTapeBtn.addEventListener('click', async () => {
  await runTapeDetection();
});

async function runTapeDetection() {
  if (!activeDevice) {
    alert('Please connect to a printer first.');
    return;
  }

  try {
    detectTapeBtn.disabled = true;
    tapeStatus.textContent = 'Detecting tape...';
    tapeStatus.style.color = '#666';

    const qlr = new BrotherQLRaster(modelSelect.value);

    // Sequence: Invalidate -> Initialize -> Status Request
    qlr.add_invalidate();
    await usb.send(qlr.data);
    qlr.clear();

    qlr.add_initialize();
    await usb.send(qlr.data);
    qlr.clear();

    qlr.add_status_information();
    await usb.send(qlr.data);
    qlr.clear();

    // Read 32 bytes status
    const dataView = await usb.receive(32);
    const data = new Uint8Array(dataView.buffer);

    // Parse bytes (0-indexed)
    // 10: Media width (mm)
    // 11: Media type (0x0A = Endless, 0x0B = Die-cut)
    // 17: Media length (mm)
    const mediaWidth = data[10];
    const mediaType = data[11];
    const mediaLength = data[17];

    console.log('Detected Media:', { mediaWidth, mediaType, mediaLength });

    // Find matching label
    const matchedLabel = ALL_LABELS.find(l => {
      const isEndless = l.form_factor === FormFactor.ENDLESS || l.form_factor === FormFactor.PTOUCH_ENDLESS;
      const targetType = isEndless ? 0x0A : 0x0B;

      if (targetType !== mediaType) return false;
      if (l.tape_size[0] !== mediaWidth) return false;
      if (!isEndless && l.tape_size[1] !== mediaLength) return false;

      return true;
    });

    if (matchedLabel) {
      labelSelect.value = matchedLabel.identifier;
      labelSelect.dispatchEvent(new Event('change'));
      tapeStatus.textContent = `Detected: ${matchedLabel.tape_size[0]}mm ${matchedLabel.tape_size[1] > 0 ? 'x' + matchedLabel.tape_size[1] + 'mm' : 'Endless'}`;
      tapeStatus.style.color = '#28a745'; // Success green
    } else {
      tapeStatus.textContent = `Tape detected (${mediaWidth}mm) but no matching label definition.`;
      tapeStatus.style.color = '#856404'; // Warning brown
    }

  } catch (err: any) {
    console.error(err);
    tapeStatus.textContent = `Detection failed: ${err.message}`;
    tapeStatus.style.color = '#dc3545'; // Error red
  } finally {
    detectTapeBtn.disabled = false;
  }
}
