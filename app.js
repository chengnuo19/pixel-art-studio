/**
 * Pixel Art Studio - Core Logic (Integrated Kuwahara Cartoonification Filter)
 */

// --- DOM Elements ---
const els = {
  // Overlays
  dropOverlay: document.getElementById('dropOverlay'),
  pixelAnimOverlay: document.getElementById('pixelAnimOverlay'),
  animCanvas: document.getElementById('animCanvas'),
  animProgressBar: document.getElementById('animProgressBar'),
  
  // Header
  btnImport: document.getElementById('btnImport'),
  btnExport: document.getElementById('btnExport'),
  fileInput: document.getElementById('fileInput'),
  dimensionInfo: document.getElementById('dimensionInfo'),
  zoomInfo: document.getElementById('zoomInfo'),
  
  // Tools
  toolbar: document.getElementById('toolbar'),
  toolBtns: document.querySelectorAll('.tool-btn[data-tool]'),
  btnUndo: document.getElementById('btnUndo'),
  btnRedo: document.getElementById('btnRedo'),
  btnGrid: document.getElementById('btnGrid'),
  btnZoomIn: document.getElementById('btnZoomIn'),
  btnZoomOut: document.getElementById('btnZoomOut'),
  btnViewOriginal: document.getElementById('btnViewOriginal'),
  
  // Canvas Area
  canvasWrapper: document.getElementById('canvasWrapper'),
  welcomeScreen: document.getElementById('welcomeScreen'),
  btnWelcomeImport: document.getElementById('btnWelcomeImport'),
  
  mainCanvas: document.getElementById('mainCanvas'),
  gridCanvas: document.getElementById('gridCanvas'),
  cursorCanvas: document.getElementById('cursorCanvas'),
  
  // Settings
  pixelSizeSlider: document.getElementById('pixelSizeSlider'),
  pixelSizeValue: document.getElementById('pixelSizeValue'),
  paletteSelect: document.getElementById('paletteSelect'),
  ditherCheck: document.getElementById('ditherCheck'),
  edgeCheck: document.getElementById('edgeCheck'),
  kuwaharaCheck: document.getElementById('kuwaharaCheck'),
  
  colorPicker: document.getElementById('colorPicker'),
  currentColorPreview: document.getElementById('currentColorPreview'),
  colorHex: document.getElementById('colorHex'),
  brushSizeSlider: document.getElementById('brushSizeSlider'),
  brushSizeValue: document.getElementById('brushSizeValue'),
  
  paletteGrid: document.getElementById('paletteGrid'),
  btnClearPalette: document.getElementById('btnClearPalette'),
  
  exportScaleSlider: document.getElementById('exportScaleSlider'),
  exportScaleValue: document.getElementById('exportScaleValue'),
  btnExportPNG: document.getElementById('btnExportPNG'),
  
  toastContainer: document.getElementById('toastContainer')
};

// --- Preset Palettes ---
const PALETTE_PRESETS = {
  mario: [
    '#000000', '#ffffff', '#ffdbdb', '#fca044', 
    '#8c5b00', '#f8b800', '#00a800', '#0078f8',
    '#e45c10', '#fc9838', '#005800', '#a80020'
  ],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  nes: [
    '#000000', '#ffffff', '#d8d8d8', '#3c3c3c', 
    '#fc4438', '#b81800', '#f0a800', '#fc7460', 
    '#00b800', '#005800', '#00e8d8', '#0078f8', 
    '#0000bc', '#d828b8', '#f878f8', '#f8b800'
  ],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  bw: ['#000000', '#ffffff']
};

// --- Contexts ---
const ctxs = {
  main: els.mainCanvas.getContext('2d', { willReadFrequently: true }),
  grid: els.gridCanvas.getContext('2d'),
  cursor: els.cursorCanvas.getContext('2d'),
  anim: els.animCanvas.getContext('2d')
};

// --- State ---
const state = {
  isImageLoaded: false,
  originalImage: null,
  pixelData: null, // 1D Uint32Array for current pixel colors (AABBGGRR)
  cols: 0,
  rows: 0,
  
  // Settings
  pixelSize: 20, // Rendered size of each grid pixel in workspace (calculated dynamically)
  brushSize: parseInt(els.brushSizeSlider.value, 10),
  currentColor: els.colorPicker.value, // Hex string
  selectedPreset: els.paletteSelect.value, // 'mario', 'auto' etc.
  useDithering: els.ditherCheck.checked,
  useEdgeOutline: els.edgeCheck.checked,
  useKuwahara: els.kuwaharaCheck ? els.kuwaharaCheck.checked : true,
  
  // Tools
  currentTool: 'pencil', // pencil, eraser, fill, eyedropper, move
  previousTool: 'pencil', 
  isDrawing: false,
  showGrid: true,
  isPeekingOriginal: false,
  
  // View transform
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  lastMouseX: 0,
  lastMouseY: 0,
  
  // History
  history: [],
  historyIndex: -1,
  maxHistory: 50,
  
  // Palettes (Auto-extracted or Preset mapped)
  palette: new Set(),
  autoExtractedPaletteList: [] // Median cut results cached
};

// Set default slider display values
els.pixelSizeValue.textContent = `${els.pixelSizeSlider.value}格宽`;

// --- Color Format & Utility Functions ---
function hexToUint32(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (255 << 24) | (b << 16) | (g << 8) | r; // Little endian ABGR
}

function uint32ToHex(uint32) {
  const r = uint32 & 0xFF;
  const g = (uint32 >> 8) & 0xFF;
  const b = (uint32 >> 16) & 0xFF;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// Perceptual RGB Distance
function getNearestPresetColor(r, g, b, paletteHexList) {
  let minDistance = Infinity;
  let nearestColor = paletteHexList[0];
  
  for (const hex of paletteHexList) {
    const pr = parseInt(hex.slice(1, 3), 16);
    const pg = parseInt(hex.slice(3, 5), 16);
    const pb = parseInt(hex.slice(5, 7), 16);
    
    const rMean = (r + pr) / 2;
    const dr = r - pr;
    const dg = g - pg;
    const db = b - pb;
    const distance = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
    
    if (distance < minDistance) {
      minDistance = distance;
      nearestColor = hex;
    }
  }
  return nearestColor;
}

// --- Median Cut Color Quantization ---
function extractMedianCutPalette(imageDataBytes, maxColors = 32) {
  const pixels = [];
  for (let i = 0; i < imageDataBytes.length; i += 4) {
    const a = imageDataBytes[i+3];
    if (a < 128) continue; // Skip mostly transparent pixels
    pixels.push({
      r: imageDataBytes[i],
      g: imageDataBytes[i+1],
      b: imageDataBytes[i+2]
    });
  }
  
  if (pixels.length === 0) {
    return ['#ffffff', '#000000'];
  }
  
  let boxes = [pixels];
  
  while (boxes.length < maxColors) {
    let splitIndex = -1;
    let maxRange = -1;
    let maxChannel = 'r';
    
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length <= 1) continue;
      
      let minR = 255, maxR = 0;
      let minG = 255, maxG = 0;
      let minB = 255, maxB = 0;
      
      for (let j = 0; j < box.length; j++) {
        const p = box[j];
        if (p.r < minR) minR = p.r;
        if (p.r > maxR) maxR = p.r;
        if (p.g < minG) minG = p.g;
        if (p.g > maxG) maxG = p.g;
        if (p.b < minB) minB = p.b;
        if (p.b > maxB) maxB = p.b;
      }
      
      const rRange = maxR - minR;
      const gRange = maxG - minG;
      const bRange = maxB - minB;
      const range = Math.max(rRange, gRange, bRange);
      
      if (range > maxRange) {
        maxRange = range;
        splitIndex = i;
        maxChannel = (range === rRange) ? 'r' : (range === gRange ? 'g' : 'b');
      }
    }
    
    if (splitIndex === -1) break;
    
    const boxToSplit = boxes[splitIndex];
    boxToSplit.sort((a, b) => a[maxChannel] - b[maxChannel]);
    
    const median = Math.floor(boxToSplit.length / 2);
    const box1 = boxToSplit.slice(0, median);
    const box2 = boxToSplit.slice(median);
    
    boxes.splice(splitIndex, 1, box1, box2);
  }
  
  const palette = [];
  for (const box of boxes) {
    if (box.length === 0) continue;
    let sumR = 0, sumG = 0, sumB = 0;
    for (const p of box) {
      sumR += p.r;
      sumG += p.g;
      sumB += p.b;
    }
    const r = Math.round(sumR / box.length);
    const g = Math.round(sumG / box.length);
    const b = Math.round(sumB / box.length);
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    palette.push(hex);
  }
  return palette;
}

// --- High Performance Kuwahara Filter (Edge Preserving Cartoon/Vector smoothing) ---
function applyKuwaharaFilter(ctx, width, height, size = 5) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const outputData = new Uint8ClampedArray(data.length);
  
  const radius = Math.floor(size / 2);
  
  // Pre-calculate gray values for rapid variance checking
  const grays = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    grays[i/4] = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000;
  }
  
  const getQuadrantStats = (x1, y1, x2, y2) => {
    let sumR = 0, sumG = 0, sumB = 0;
    let sumGray = 0, sumGraySq = 0;
    let count = 0;
    
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const idx = y * width + x;
        const dIdx = idx * 4;
        
        sumR += data[dIdx];
        sumG += data[dIdx+1];
        sumB += data[dIdx+2];
        
        const g = grays[idx];
        sumGray += g;
        sumGraySq += g * g;
        count++;
      }
    }
    
    const meanR = sumR / count;
    const meanG = sumG / count;
    const meanB = sumB / count;
    const meanGray = sumGray / count;
    const variance = (sumGraySq / count) - (meanGray * meanGray);
    
    return { r: meanR, g: meanG, b: meanB, variance };
  };
  
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      // Calculate statistics for 4 sub-quadrants
      const stats = [
        getQuadrantStats(x - radius, y - radius, x, y),
        getQuadrantStats(x, y - radius, x + radius, y),
        getQuadrantStats(x - radius, y, x, y + radius),
        getQuadrantStats(x, y, x + radius, y + radius)
      ];
      
      // Select the sub-quadrant with the minimum color variance (smooth side)
      let minVar = Infinity;
      let bestQ = stats[0];
      for (const stat of stats) {
        if (stat.variance < minVar) {
          minVar = stat.variance;
          bestQ = stat;
        }
      }
      
      const destIdx = (y * width + x) * 4;
      outputData[destIdx] = bestQ.r;
      outputData[destIdx+1] = bestQ.g;
      outputData[destIdx+2] = bestQ.b;
      outputData[destIdx+3] = data[destIdx+3];
    }
  }
  
  // Fill back boundary margins untouched by the filter
  for (let i = 0; i < data.length; i++) {
    if (outputData[i] === 0 && (i % 4 !== 3)) {
      outputData[i] = data[i];
    } else if (i % 4 === 3 && outputData[i] === 0) {
      outputData[i] = data[i];
    }
  }
  
  imgData.data.set(outputData);
  ctx.putImageData(imgData, 0, 0);
}

// --- Initialization ---
function init() {
  setupEventListeners();
  updateUIState();
  resizeCanvases(1, 1);
  
  // Set default state based on loaded preset
  if (state.selectedPreset === 'mario') {
    state.useDithering = false;
    els.ditherCheck.checked = false;
    state.useEdgeOutline = true;
    els.edgeCheck.checked = true;
    state.useKuwahara = true;
    els.kuwaharaCheck.checked = true;
  }
}

// --- Real-Time Execution Manager (Throttling / RequestAnimationFrame) ---
let renderInProgress = false;
let nextRenderRequested = false;

function triggerRealTimePixelation(isSilent = true) {
  if (!state.isImageLoaded || !state.originalImage) return;
  
  if (renderInProgress) {
    nextRenderRequested = true;
    return;
  }
  
  renderInProgress = true;
  requestAnimationFrame(async () => {
    const targetW = parseInt(els.pixelSizeSlider.value, 10);
    await pixelateImage(state.originalImage, targetW, isSilent);
    renderInProgress = false;
    
    if (nextRenderRequested) {
      nextRenderRequested = false;
      triggerRealTimePixelation(true);
    }
  });
}

function setupEventListeners() {
  // Import
  els.btnImport.addEventListener('click', () => els.fileInput.click());
  els.btnWelcomeImport.addEventListener('click', () => els.fileInput.click());
  els.fileInput.addEventListener('change', handleFileUpload);
  
  // Drag & Drop
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.dropOverlay.classList.add('active');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.clientX === 0 && e.clientY === 0) { 
      els.dropOverlay.classList.remove('active');
    }
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    els.dropOverlay.classList.remove('active');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
  
  // Tools
  els.toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.toolBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentTool = btn.dataset.tool;
      state.previousTool = state.currentTool;
      updateCursor();
    });
  });
  
  els.btnUndo.addEventListener('click', undo);
  els.btnRedo.addEventListener('click', redo);
  els.btnGrid.addEventListener('click', () => {
    state.showGrid = !state.showGrid;
    els.btnGrid.classList.toggle('active', state.showGrid);
    drawGrid();
  });
  
  els.btnZoomIn.addEventListener('click', () => setZoom(state.zoom * 1.4));
  els.btnZoomOut.addEventListener('click', () => setZoom(state.zoom / 1.4));
  
  // View Original (Peeking)
  const startPeek = () => {
    if (!state.isImageLoaded || !state.originalImage) return;
    state.isPeekingOriginal = true;
    ctxs.main.clearRect(0, 0, els.mainCanvas.width, els.mainCanvas.height);
    ctxs.main.drawImage(state.originalImage, 0, 0, els.mainCanvas.width, els.mainCanvas.height);
  };
  const endPeek = () => {
    if (!state.isImageLoaded || !state.isPeekingOriginal) return;
    state.isPeekingOriginal = false;
    renderMainCanvas();
  };
  els.btnViewOriginal.addEventListener('mousedown', startPeek);
  els.btnViewOriginal.addEventListener('mouseup', endPeek);
  els.btnViewOriginal.addEventListener('mouseleave', endPeek);
  els.btnViewOriginal.addEventListener('touchstart', (e) => { e.preventDefault(); startPeek(); });
  els.btnViewOriginal.addEventListener('touchend', endPeek);

  // Canvas Mouse Interaction
  els.canvasWrapper.addEventListener('mousedown', handlePointerDown);
  window.addEventListener('mousemove', handlePointerMove);
  window.addEventListener('mouseup', handlePointerUp);
  els.canvasWrapper.addEventListener('wheel', handleWheel, { passive: false });
  els.canvasWrapper.addEventListener('contextmenu', e => e.preventDefault());
  
  // Mobile Touch Interaction
  els.canvasWrapper.addEventListener('touchstart', handleTouchStart, { passive: false });
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('touchend', handlePointerUp);
  
  // --- Real-Time Conversion Listeners ---
  els.pixelSizeSlider.addEventListener('input', (e) => {
    const targetW = parseInt(e.target.value, 10);
    els.pixelSizeValue.textContent = `${targetW}格宽`;
    triggerRealTimePixelation(true); // Instant rendering during slider drag!
  });
  
  els.paletteSelect.addEventListener('change', (e) => {
    state.selectedPreset = e.target.value;
    
    // Auto-toggles optimal game sprite defaults
    if (state.selectedPreset === 'mario') {
      state.useDithering = false;
      els.ditherCheck.checked = false;
      state.useEdgeOutline = true;
      els.edgeCheck.checked = true;
      state.useKuwahara = true;
      els.kuwaharaCheck.checked = true;
    } else if (state.selectedPreset === 'gameboy') {
      state.useDithering = true;
      els.ditherCheck.checked = true;
      state.useEdgeOutline = false;
      els.edgeCheck.checked = false;
      state.useKuwahara = false;
      els.kuwaharaCheck.checked = false;
    }
    
    triggerRealTimePixelation(true); // Mapped preset updates instantly
  });
  
  els.ditherCheck.addEventListener('change', (e) => {
    state.useDithering = e.target.checked;
    triggerRealTimePixelation(true); // Dithering changes instantly
  });
  
  els.edgeCheck.addEventListener('change', (e) => {
    state.useEdgeOutline = e.target.checked;
    triggerRealTimePixelation(true); // Edge outlining changes instantly
  });
  
  els.kuwaharaCheck.addEventListener('change', (e) => {
    state.useKuwahara = e.target.checked;
    triggerRealTimePixelation(true); // Kuwahara changes instantly
  });
  
  // Brush & Color Settings
  els.brushSizeSlider.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value, 10);
    els.brushSizeValue.textContent = state.brushSize;
    updateCursor();
  });
  
  els.colorPicker.addEventListener('input', (e) => {
    setColor(e.target.value);
  });
  
  els.btnClearPalette.addEventListener('click', () => {
    state.palette.clear();
    renderPalette();
  });
  
  els.exportScaleSlider.addEventListener('input', (e) => {
    els.exportScaleValue.textContent = `${e.target.value}x`;
  });
  els.btnExport.addEventListener('click', exportPNG);
  els.btnExportPNG.addEventListener('click', exportPNG);
  
  // Keyboard Shortcuts & Spacebar Dragging
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
}

// --- File Handling ---
function handleFileUpload(e) {
  if (e.target.files && e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择有效的图片文件', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;
      state.isImageLoaded = true;
      els.welcomeScreen.style.display = 'none';
      els.canvasWrapper.style.display = 'block';
      updateUIState();
      
      // Perform initial pixelation with retro step animation
      const targetW = parseInt(els.pixelSizeSlider.value, 10);
      pixelateImage(img, targetW, false);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Core Image Conversion & Rendering Pipeline ---
async function pixelateImage(img, targetWidth, isSilent = false) {
  state.cols = targetWidth;
  state.rows = Math.round((img.height / img.width) * targetWidth) || 1;
  
  // Compute comfortable rendering pixelSize so grid occupies optimal workspace canvas size
  state.pixelSize = Math.max(2, Math.floor(640 / state.cols));
  const pSize = state.pixelSize;
  
  // If not silent, perform retro stepping animation (only on first load)
  if (!isSilent) {
    centerCanvas();
    resizeCanvases(state.cols * pSize, state.rows * pSize);
    
    els.pixelAnimOverlay.classList.remove('hidden');
    els.animCanvas.width = img.width;
    els.animCanvas.height = img.height;
    ctxs.anim.drawImage(img, 0, 0);
    
    // Animate resolutions dropping down
    const steps = [
      Math.max(8, Math.floor(targetWidth / 4)), 
      Math.max(16, Math.floor(targetWidth / 2)), 
      targetWidth
    ];
    
    for (let i = 0; i < steps.length; i++) {
      const tempCols = steps[i];
      const tempRows = Math.round((img.height / img.width) * tempCols) || 1;
      
      const offCanvas = document.createElement('canvas');
      offCanvas.width = tempCols;
      offCanvas.height = tempRows;
      const offCtx = offCanvas.getContext('2d');
      offCtx.drawImage(img, 0, 0, tempCols, tempRows);
      
      ctxs.anim.imageSmoothingEnabled = false;
      ctxs.anim.clearRect(0, 0, els.animCanvas.width, els.animCanvas.height);
      ctxs.anim.drawImage(offCanvas, 0, 0, tempCols, tempRows, 0, 0, els.animCanvas.width, els.animCanvas.height);
      
      els.animProgressBar.style.width = `${((i + 1) / steps.length) * 100}%`;
      await new Promise(r => setTimeout(r, 80));
    }
  } else {
    // Silent mode (real-time dragging): just keep canvases resized in place
    if (els.mainCanvas.width !== state.cols * pSize || els.mainCanvas.height !== state.rows * pSize) {
      resizeCanvases(state.cols * pSize, state.rows * pSize);
    }
  }
  
  // --- High-Quality Pipeline Integration with Kuwahara Cartoonification ---
  // Create a 3x resolution intermediate canvas for edge-preserving cartoon smoothing
  const tempCols = state.cols * 3;
  const tempRows = state.rows * 3;
  
  const midCanvas = document.createElement('canvas');
  midCanvas.width = tempCols;
  midCanvas.height = tempRows;
  const midCtx = midCanvas.getContext('2d', { willReadFrequently: true });
  midCtx.drawImage(img, 0, 0, tempCols, tempRows);
  
  if (state.useKuwahara) {
    // Apply 5x5 Kuwahara filtering on intermediate size to clean out details into solid colors
    applyKuwaharaFilter(midCtx, tempCols, tempRows, 5);
  }
  
  // Downscale the cleaned cartoon intermediate canvas to final target resolution
  const offCanvas = document.createElement('canvas');
  offCanvas.width = state.cols;
  offCanvas.height = state.rows;
  const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
  offCtx.drawImage(midCanvas, 0, 0, state.cols, state.rows);
  
  const rawImgData = offCtx.getImageData(0, 0, state.cols, state.rows);
  const data = rawImgData.data;
  
  // --- High Contrast & Saturation Color Booster for Retro Game Aesthetics ---
  const isMarioMode = state.selectedPreset === 'mario';
  const isNESMode = state.selectedPreset === 'nes';
  
  if (isMarioMode || isNESMode) {
    const contrast = 35; // Lowered to keep fair skins bright and prevent shadow smudging
    const saturation = 1.2; // Optimized from 1.65 to keep fair skins pale and gorgeous instead of dark orange
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] < 10) continue; // skip transparent
      
      // 1. Contrast
      let r = factor * (data[i] - 128) + 128;
      let g = factor * (data[i+1] - 128) + 128;
      let b = factor * (data[i+2] - 128) + 128;
      
      // 2. Saturation
      const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
      
      data[i] = Math.max(0, Math.min(255, r));
      data[i+1] = Math.max(0, Math.min(255, g));
      data[i+2] = Math.max(0, Math.min(255, b));
    }
  }
  
  // --- High-Fidelity Median Cut palette extraction ---
  state.autoExtractedPaletteList = extractMedianCutPalette(data, 32);
  
  // Map colors onto the target preset palette
  let targetPalette = null;
  if (state.selectedPreset === 'auto') {
    targetPalette = state.autoExtractedPaletteList;
  } else {
    targetPalette = PALETTE_PRESETS[state.selectedPreset];
  }
  
  // Floyd-Steinberg Color Dithering
  if (state.useDithering && targetPalette) {
    const errorBufferR = new Float32Array(data.length / 4);
    const errorBufferG = new Float32Array(data.length / 4);
    const errorBufferB = new Float32Array(data.length / 4);
    
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const idx = (y * state.cols + x) * 4;
        
        let r = data[idx] + errorBufferR[y * state.cols + x];
        let g = data[idx+1] + errorBufferG[y * state.cols + x];
        let b = data[idx+2] + errorBufferB[y * state.cols + x];
        
        r = Math.max(0, Math.min(255, r));
        g = Math.max(0, Math.min(255, g));
        b = Math.max(0, Math.min(255, b));
        
        const nearestHex = getNearestPresetColor(r, g, b, targetPalette);
        const nr = parseInt(nearestHex.slice(1, 3), 16);
        const ng = parseInt(nearestHex.slice(3, 5), 16);
        const nb = parseInt(nearestHex.slice(5, 7), 16);
        
        data[idx] = nr;
        data[idx+1] = ng;
        data[idx+2] = nb;
        
        const errR = r - nr;
        const errG = g - ng;
        const errB = b - nb;
        
        const distribute = (dx, dy, factor) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < state.cols && ny >= 0 && ny < state.rows) {
            const nIdx = ny * state.cols + nx;
            errorBufferR[nIdx] += errR * factor;
            errorBufferG[nIdx] += errG * factor;
            errorBufferB[nIdx] += errB * factor;
          }
        };
        
        distribute(1, 0, 7 / 16);
        distribute(-1, 1, 3 / 16);
        distribute(0, 1, 5 / 16);
        distribute(1, 1, 1 / 16);
      }
    }
  } else if (targetPalette) {
    // Fast color quantization mapping (No Dithering)
    for (let i = 0; i < data.length; i += 4) {
      const nearestHex = getNearestPresetColor(data[i], data[i+1], data[i+2], targetPalette);
      data[i] = parseInt(nearestHex.slice(1, 3), 16);
      data[i+1] = parseInt(nearestHex.slice(3, 5), 16);
      data[i+2] = parseInt(nearestHex.slice(5, 7), 16);
    }
  }
  
  // Edge detection outline wrapping (Smart Pixel Art Outliner)
  if (state.useEdgeOutline) {
    const tempPixels = new Uint8ClampedArray(data);
    
    const getAlpha = (x, y) => {
      if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return 0;
      return tempPixels[(y * state.cols + x) * 4 + 3];
    };
    
    const getGray = (x, y) => {
      if (x < 0 || x >= state.cols || y < 0 || y >= state.rows) return -1;
      const idx = (y * state.cols + x) * 4;
      if (tempPixels[idx + 3] < 128) return -1; // Treat transparent pixels as sentinel -1
      return (tempPixels[idx] + tempPixels[idx+1] + tempPixels[idx+2]) / 3;
    };
    
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const idx = (y * state.cols + x) * 4;
        const alpha = tempPixels[idx + 3];
        
        if (alpha < 128) continue; // Skip transparent pixels
        
        // 1. Check Outer Boundary (touches transparent background or canvas edge)
        let isOuterBoundary = false;
        if (getAlpha(x-1, y) < 128 || getAlpha(x+1, y) < 128 ||
            getAlpha(x, y-1) < 128 || getAlpha(x, y+1) < 128) {
          isOuterBoundary = true;
        }
        
        if (isOuterBoundary) {
          data[idx] = 0;
          data[idx+1] = 0;
          data[idx+2] = 0;
          data[idx+3] = 255; // Solid black outline
          continue;
        }
        
        // 2. Check Inner Edge using High-Threshold Sobel Filter
        const currGray = (tempPixels[idx] + tempPixels[idx+1] + tempPixels[idx+2]) / 3;
        
        const getGraySafe = (nx, ny) => {
          const g = getGray(nx, ny);
          return g === -1 ? currGray : g; // Fall back to current pixel gray to avoid false edges against background
        };
        
        const gx = -getGraySafe(x-1, y-1) + getGraySafe(x+1, y-1) 
                   -2 * getGraySafe(x-1, y) + 2 * getGraySafe(x+1, y)
                   -getGraySafe(x-1, y+1) + getGraySafe(x+1, y+1);
                   
        const gy = -getGraySafe(x-1, y-1) - 2 * getGraySafe(x, y-1) - getGraySafe(x+1, y-1)
                   + getGraySafe(x-1, y+1) + 2 * getGraySafe(x, y+1) + getGraySafe(x+1, y+1);
                   
        const mag = Math.sqrt(gx * gx + gy * gy);
        const innerThreshold = 105; // Much higher threshold so soft gradients are not blacked out
        
        if (mag > innerThreshold) {
          data[idx] = 0;
          data[idx+1] = 0;
          data[idx+2] = 0;
          data[idx+3] = 255;
        }
      }
    }
  }
  
  state.pixelData = new Uint32Array(rawImgData.data.buffer);
  
  // Update UI palette
  updatePaletteFromSource(targetPalette);
  
  // Reset and save initial undo history
  state.history = [];
  state.historyIndex = -1;
  saveHistory();
  
  renderMainCanvas();
  drawGrid();
  
  if (!isSilent) {
    setTimeout(() => {
      els.pixelAnimOverlay.classList.add('hidden');
      els.animProgressBar.style.width = '0%';
    }, 200);
    showToast(`图片像素化成功 (${state.cols}x${state.rows})`);
  }
}

// --- Canvas Coordinate & Zoom Operations ---
function resizeCanvases(width, height) {
  [els.mainCanvas, els.gridCanvas, els.cursorCanvas].forEach(canvas => {
    canvas.width = width;
    canvas.height = height;
  });
  els.dimensionInfo.textContent = `${state.cols} × ${state.rows}`;
}

function centerCanvas() {
  const container = els.canvasWrapper.parentElement;
  const targetW = state.cols * state.pixelSize;
  const targetH = state.rows * state.pixelSize;
  
  const padding = 30;
  const scaleX = (container.clientWidth - padding * 2) / targetW;
  const scaleY = (container.clientHeight - padding * 2) / targetH;
  
  state.zoom = Math.min(scaleX, scaleY, 2.5);
  state.panX = (container.clientWidth - targetW * state.zoom) / 2;
  state.panY = (container.clientHeight - targetH * state.zoom) / 2;
  
  applyTransform();
}

function applyTransform() {
  els.canvasWrapper.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  els.zoomInfo.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(newZoom, mouseX = null, mouseY = null) {
  const oldZoom = state.zoom;
  state.zoom = Math.max(0.15, Math.min(newZoom, 35));
  
  if (mouseX !== null && mouseY !== null) {
    const container = els.canvasWrapper.parentElement;
    const rect = container.getBoundingClientRect();
    const ex = mouseX - rect.left;
    const ey = mouseY - rect.top;
    state.panX = ex - (ex - state.panX) * (state.zoom / oldZoom);
    state.panY = ey - (ey - state.panY) * (state.zoom / oldZoom);
  } else {
    const container = els.canvasWrapper.parentElement;
    const cx = container.clientWidth / 2;
    const cy = container.clientHeight / 2;
    state.panX = cx - (cx - state.panX) * (state.zoom / oldZoom);
    state.panY = cy - (cy - state.panY) * (state.zoom / oldZoom);
  }
  applyTransform();
  drawGrid(); 
  updateCursor();
}

function renderMainCanvas() {
  if (!state.pixelData) return;
  
  const imgData = ctxs.main.createImageData(state.cols * state.pixelSize, state.rows * state.pixelSize);
  const data32 = new Uint32Array(imgData.data.buffer);
  const pSize = state.pixelSize;
  
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const color = state.pixelData[y * state.cols + x];
      for (let py = 0; py < pSize; py++) {
        for (let px = 0; px < pSize; px++) {
          const destIdx = ((y * pSize + py) * (state.cols * pSize)) + (x * pSize + px);
          data32[destIdx] = color;
        }
      }
    }
  }
  ctxs.main.putImageData(imgData, 0, 0);
}

// Smart Grid: fades out gridlines when zoomed out to prevent grid visual noise
function drawGrid() {
  ctxs.grid.clearRect(0, 0, els.gridCanvas.width, els.gridCanvas.height);
  if (!state.showGrid || !state.isImageLoaded) return;
  
  let gridOpacity = 0.15;
  if (state.zoom < 3) {
    gridOpacity = 0; 
  } else if (state.zoom < 6) {
    gridOpacity = 0.05; 
  } else if (state.zoom < 10) {
    gridOpacity = 0.1;
  }
  
  if (gridOpacity === 0) return;
  
  const pSize = state.pixelSize;
  ctxs.grid.beginPath();
  ctxs.grid.strokeStyle = `rgba(255, 255, 255, ${gridOpacity})`;
  ctxs.grid.lineWidth = 1 / state.zoom;
  
  for (let x = 0; x <= els.gridCanvas.width; x += pSize) {
    ctxs.grid.moveTo(x, 0);
    ctxs.grid.lineTo(x, els.gridCanvas.height);
  }
  for (let y = 0; y <= els.gridCanvas.height; y += pSize) {
    ctxs.grid.moveTo(0, y);
    ctxs.grid.lineTo(els.gridCanvas.width, y);
  }
  ctxs.grid.stroke();
}

function drawCursor(px, py) {
  ctxs.cursor.clearRect(0, 0, els.cursorCanvas.width, els.cursorCanvas.height);
  if (!state.isImageLoaded || px < 0 || py < 0 || px >= state.cols || py >= state.rows) return;
  if (state.currentTool === 'move') return;
  
  const pSize = state.pixelSize;
  const bSize = state.brushSize;
  
  ctxs.cursor.strokeStyle = 'rgba(0, 240, 255, 0.9)';
  ctxs.cursor.lineWidth = Math.max(1, 2 / state.zoom);
  ctxs.cursor.strokeRect(px * pSize, py * pSize, pSize * bSize, pSize * bSize);
}

// --- Interaction Handlers ---
function getCanvasCoords(clientX, clientY) {
  const rect = els.canvasWrapper.getBoundingClientRect();
  const rawX = (clientX - rect.left) / state.zoom;
  const rawY = (clientY - rect.top) / state.zoom;
  
  const px = Math.floor(rawX / state.pixelSize);
  const py = Math.floor(rawY / state.pixelSize);
  
  return { px, py, rawX, rawY };
}

function handlePointerDown(e) {
  if (!state.isImageLoaded || state.isPeekingOriginal) return;
  
  // Right click, Middle click, Spacebar-drag, or Move tool launches panning
  if (e.button === 2 || e.button === 1 || state.currentTool === 'move') {
    state.isPanning = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    els.canvasWrapper.style.cursor = 'grabbing';
    return;
  }
  
  if (e.button !== 0) return;
  
  state.isDrawing = true;
  const { px, py } = getCanvasCoords(e.clientX, e.clientY);
  useTool(px, py);
}

function handlePointerMove(e) {
  if (!state.isImageLoaded || state.isPeekingOriginal) return;
  
  if (state.isPanning) {
    const dx = e.clientX - state.lastMouseX;
    const dy = e.clientY - state.lastMouseY;
    state.panX += dx;
    state.panY += dy;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    applyTransform();
    return;
  }
  
  const { px, py } = getCanvasCoords(e.clientX, e.clientY);
  drawCursor(px, py);
  
  if (state.isDrawing) {
    useTool(px, py);
  }
}

function handlePointerUp() {
  if (state.isPanning) {
    state.isPanning = false;
    updateCursor();
  }
  if (state.isDrawing) {
    state.isDrawing = false;
    saveHistory();
  }
}

function handleWheel(e) {
  e.preventDefault();
  if (e.ctrlKey) {
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setZoom(state.zoom * zoomFactor, e.clientX, e.clientY);
  } else {
    state.panX -= e.deltaX;
    state.panY -= e.deltaY;
    applyTransform();
  }
}

// Touch Mobile Support
let initialPinchDist = 0;
let initialZoom = 1;

function handleTouchStart(e) {
  if (!state.isImageLoaded || state.isPeekingOriginal) return;
  
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    if (state.currentTool === 'move') {
      state.isPanning = true;
      state.lastMouseX = touch.clientX;
      state.lastMouseY = touch.clientY;
    } else {
      state.isDrawing = true;
      const { px, py } = getCanvasCoords(touch.clientX, touch.clientY);
      useTool(px, py);
    }
  } else if (e.touches.length === 2) {
    e.preventDefault();
    state.isDrawing = false;
    state.isPanning = false;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    initialPinchDist = Math.sqrt(dx * dx + dy * dy);
    initialZoom = state.zoom;
  }
}

function handleTouchMove(e) {
  if (!state.isImageLoaded || state.isPeekingOriginal) return;
  e.preventDefault();
  
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    if (state.isPanning) {
      const dx = touch.clientX - state.lastMouseX;
      const dy = touch.clientY - state.lastMouseY;
      state.panX += dx;
      state.panY += dy;
      state.lastMouseX = touch.clientX;
      state.lastMouseY = touch.clientY;
      applyTransform();
    } else if (state.isDrawing) {
      const { px, py } = getCanvasCoords(touch.clientX, touch.clientY);
      useTool(px, py);
    }
  } else if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    setZoom(initialZoom * (dist / initialPinchDist), centerX, centerY);
  }
}

// Shortcuts & Spacebar hold-to-pan key hooks
function handleKeyDown(e) {
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) { e.preventDefault(); redo(); return; }
  
  if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    if (state.currentTool !== 'move') {
      state.previousTool = state.currentTool;
      selectTool('move');
    }
    return;
  }
  
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  
  switch(e.key.toLowerCase()) {
    case 'b': selectTool('pencil'); break;
    case 'e': selectTool('eraser'); break;
    case 'g': selectTool('fill'); break;
    case 'i': selectTool('eyedropper'); break;
    case 'v': selectTool('move'); break;
    case 'h': els.btnGrid.click(); break;
    case '+': case '=': els.btnZoomIn.click(); break;
    case '-': case '_': els.btnZoomOut.click(); break;
  }
}

function handleKeyUp(e) {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
    e.preventDefault();
    selectTool(state.previousTool);
  }
}

function selectTool(toolName) {
  const btn = document.querySelector(`.tool-btn[data-tool="${toolName}"]`);
  if (btn) btn.click();
}

function updateCursor() {
  if (!state.isImageLoaded) return;
  els.canvasWrapper.style.cursor = state.currentTool === 'move' ? 
    (state.isPanning ? 'grabbing' : 'grab') : 'crosshair';
}

// --- High-Performance Scanline Flood Fill ---
function floodFillScanline(startX, startY, targetColor, replacementColor) {
  const cols = state.cols;
  const rows = state.rows;
  const data = state.pixelData;
  
  if (targetColor === replacementColor) return;
  
  const stackX = new Int32Array(cols * rows);
  const stackY = new Int32Array(cols * rows);
  let stackPtr = 0;
  
  const push = (x, y) => {
    stackX[stackPtr] = x;
    stackY[stackPtr] = y;
    stackPtr++;
  };
  
  const pop = () => {
    stackPtr--;
    return { x: stackX[stackPtr], y: stackY[stackPtr] };
  };
  
  push(startX, startY);
  
  while (stackPtr > 0) {
    const { x, y } = pop();
    let lx = x;
    
    while (lx >= 0 && data[y * cols + lx] === targetColor) {
      data[y * cols + lx] = replacementColor;
      lx--;
    }
    
    let rx = x + 1;
    while (rx < cols && data[y * cols + rx] === targetColor) {
      data[y * cols + rx] = replacementColor;
      rx++;
    }
    
    scanSegment(lx + 1, rx - 1, y - 1, targetColor);
    scanSegment(lx + 1, rx - 1, y + 1, targetColor);
  }
  
  function scanSegment(left, right, y, tColor) {
    if (y < 0 || y >= rows) return;
    let added = false;
    
    for (let x = left; x <= right; x++) {
      if (data[y * cols + x] !== tColor) {
        added = false;
      } else if (!added) {
        push(x, y);
        added = true;
      }
    }
  }
}

// --- Tools Actions ---
function useTool(x, y) {
  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return;
  
  const bSize = state.brushSize;
  let modified = false;
  
  if (state.currentTool === 'pencil') {
    const color32 = hexToUint32(state.currentColor);
    for (let by = 0; by < bSize; by++) {
      for (let bx = 0; bx < bSize; bx++) {
        if (x + bx < state.cols && y + by < state.rows) {
          const idx = (y + by) * state.cols + (x + bx);
          if (state.pixelData[idx] !== color32) {
            state.pixelData[idx] = color32;
            modified = true;
          }
        }
      }
    }
  } else if (state.currentTool === 'eraser') {
    const color32 = 0; // alpha 0 transparent pixel
    for (let by = 0; by < bSize; by++) {
      for (let bx = 0; bx < bSize; bx++) {
        if (x + bx < state.cols && y + by < state.rows) {
          const idx = (y + by) * state.cols + (x + bx);
          if (state.pixelData[idx] !== color32) {
            state.pixelData[idx] = color32;
            modified = true;
          }
        }
      }
    }
  } else if (state.currentTool === 'fill') {
    const targetColor = state.pixelData[y * state.cols + x];
    const replacementColor = hexToUint32(state.currentColor);
    
    if (targetColor !== replacementColor) {
      floodFillScanline(x, y, targetColor, replacementColor);
      modified = true;
    }
    state.isDrawing = false; 
  } else if (state.currentTool === 'eyedropper') {
    const color32 = state.pixelData[y * state.cols + x];
    if ((color32 >>> 24) !== 0) { // Ignore transparent pixels
      setColor(uint32ToHex(color32));
    }
    state.isDrawing = false;
  }
  
  if (modified) {
    renderMainCanvas();
    if (state.currentTool === 'pencil' || state.currentTool === 'fill') {
      addColorToPalette(state.currentColor);
    }
  }
}

// --- History Systems ---
function saveHistory() {
  if (!state.pixelData) return;
  
  if (state.historyIndex < state.history.length - 1) {
    state.history = state.history.slice(0, state.historyIndex + 1);
  }
  
  const snapshot = new Uint32Array(state.pixelData);
  state.history.push(snapshot);
  
  if (state.history.length > state.maxHistory) {
    state.history.shift();
  } else {
    state.historyIndex++;
  }
  
  updateUIState();
}

function undo() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    state.pixelData = new Uint32Array(state.history[state.historyIndex]);
    renderMainCanvas();
    updateUIState();
  }
}

// --- Color Palette Management ---
function setColor(hex) {
  state.currentColor = hex;
  els.colorPicker.value = hex;
  els.currentColorPreview.style.backgroundColor = hex;
  els.colorHex.textContent = hex.toUpperCase();
}

function updatePaletteFromSource(paletteHexList) {
  state.palette.clear();
  
  // Load the matched palette list into the UI
  paletteHexList.forEach(hex => state.palette.add(hex));
  
  // Set current color to first color in the palette if current color is missing
  if (paletteHexList.length > 0 && !state.palette.has(state.currentColor)) {
    setColor(paletteHexList[0]);
  }
  
  renderPalette();
}

function addColorToPalette(hex) {
  if (!state.palette.has(hex)) {
    state.palette.add(hex);
    renderPalette();
  }
}

function renderPalette() {
  els.paletteGrid.innerHTML = '';
  
  if (state.palette.size === 0) {
    els.paletteGrid.innerHTML = '<div class="palette-empty">暂无颜色</div>';
    return;
  }
  
  state.palette.forEach(hex => {
    const div = document.createElement('div');
    div.className = 'palette-color';
    div.style.backgroundColor = hex;
    if (hex.toUpperCase() === state.currentColor.toUpperCase()) {
      div.classList.add('active');
    }
    div.title = hex.toUpperCase();
    div.addEventListener('click', () => {
      setColor(hex);
      renderPalette(); 
    });
    els.paletteGrid.appendChild(div);
  });
}

function redo() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    state.pixelData = new Uint32Array(state.history[state.historyIndex]);
    renderMainCanvas();
    updateUIState();
  }
}

// --- High Quality PNG Exporter ---
function exportPNG() {
  if (!state.isImageLoaded) return;
  
  const scale = parseInt(els.exportScaleSlider.value, 10);
  const targetW = state.cols * scale;
  const targetH = state.rows * scale;
  
  const expCanvas = document.createElement('canvas');
  expCanvas.width = targetW;
  expCanvas.height = targetH;
  const expCtx = expCanvas.getContext('2d');
  
  const imgData = expCtx.createImageData(targetW, targetH);
  const data32 = new Uint32Array(imgData.data.buffer);
  
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      const color = state.pixelData[y * state.cols + x];
      if ((color >>> 24) === 0) continue; // Skip fully transparent pixels
      
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const destIdx = ((y * scale + sy) * targetW) + (x * scale + sx);
          data32[destIdx] = color;
        }
      }
    }
  }
  expCtx.putImageData(imgData, 0, 0);
  
  const link = document.createElement('a');
  link.download = `pixel-art-${targetW}x${targetH}.png`;
  link.href = expCanvas.toDataURL('image/png');
  link.click();
  
  showToast('高清像素画导出成功！', 'success');
}

// --- UI Toggle States ---
function updateUIState() {
  const loaded = state.isImageLoaded;
  els.btnExport.disabled = !loaded;
  els.btnExportPNG.disabled = !loaded;
  
  els.btnUndo.disabled = state.historyIndex <= 0;
  els.btnRedo.disabled = state.historyIndex >= state.history.length - 1;
}

function showToast(msg, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  els.toastContainer.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// --- App Run ---
init();
