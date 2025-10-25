
import { BG, loadImages, drawTower, drawFlag, drawMarker, hitTest } from "./objects.js";
import { drawArrowLine, drawPolyline, nearestLineIndex } from "./lines.js";
import {
  DEFAULT_STROKE_WIDTH,
  LONG_PRESS_DURATION_MS,
  MIN_SHAPE_SIZE,
  TEXT_LINE_HEIGHT_RATIO,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "./constants.js";
import { defaultDeploy, blankState } from "./state.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const $ = (id) => document.getElementById(id);

const addBlueTower = $("addBlueTower");
const addRedTower = $("addRedTower");
const addBlueFlag = $("addBlueFlag");
const addRedFlag = $("addRedFlag");
const addMarkerBtn = $("addMarker");

const drawLineBtn = $("drawLineBtn");
const freehandBtn = $("freehandBtn");
const drawCircleBtn = $("drawCircleBtn");
const drawRectBtn = $("drawRectBtn");
const textToolBtn = $("textToolBtn");
const arrowType = $("arrowType");
const lineStyleSelect = $("lineStyle");
const lineWidthInput = $("lineWidth");
const lineWidthValue = $("lineWidthValue");
const eraserBtn = $("eraserBtn");
const resetBtn = $("resetBtn");
const savePngBtn = $("savePng");
const saveJsonBtn = $("saveJson");
const loadJsonBtn = $("loadJson");
const loadJsonInput = $("loadJsonInput");
const undoBtn = $("undoBtn");
const redoBtn = $("redoBtn");
const swapColorBtn = $("swapColorBtn");

const markerPalette = $("markerPalette");
const linePalette = $("linePalette");
const textPalette = $("textPalette");

const mapSelect = $("mapSelect");
const uploadMapBtn = $("uploadMapBtn");
const mapUploadInput = $("mapUploadInput");
const deleteMapBtn = $("deleteMapBtn");
const renameMapBtn = $("renameMapBtn");

const saveSlotSelect = $("saveSlotSelect");
const saveSlotSaveBtn = $("saveSlotSave");
const saveSlotLoadBtn = $("saveSlotLoad");
const saveSlotRenameBtn = $("saveSlotRename");
const saveSlotDeleteBtn = $("saveSlotDelete");

let selectedMarkerColor = "#fbbf24";
let selectedLineColor = "#22c55e";
let selectedTextColor = "#ffffff";
let selectedLineWidth = DEFAULT_STROKE_WIDTH;
let selectedLineDash = [];

function bindPalette(container, onChoose, def) {
  if (!container) return;
  const chips = Array.from(container.querySelectorAll(".chip"));
  const setActive = (c) => chips.forEach((b) => b.classList.toggle("active", b.dataset.color === c));
  chips.forEach((b) =>
    b.addEventListener("click", () => {
      const c = b.dataset.color;
      onChoose(c);
      setActive(c);
      draw();
    })
  );
  setActive(def);
}

bindPalette(markerPalette, (c) => (selectedMarkerColor = c), selectedMarkerColor);
bindPalette(linePalette, (c) => (selectedLineColor = c), selectedLineColor);
bindPalette(textPalette, (c) => (selectedTextColor = c), selectedTextColor);

if (lineStyleSelect) {
  lineStyleSelect.addEventListener("change", () => {
    selectedLineDash = lineStyleSelect.value === "dashed" ? [12, 6] : [];
    draw();
  });
}

if (lineWidthInput) {
  selectedLineWidth = Math.max(1, Number(lineWidthInput.value) || DEFAULT_STROKE_WIDTH);
  lineWidthInput.addEventListener("input", () => {
    selectedLineWidth = Math.max(1, Number(lineWidthInput.value) || DEFAULT_STROKE_WIDTH);
    if (lineWidthValue) lineWidthValue.textContent = `${selectedLineWidth}px`;
  });
  if (lineWidthValue) lineWidthValue.textContent = `${selectedLineWidth}px`;
}

const DESIGN = { w: 1280, h: 720 };
let WORLD = { w: 1280, h: 720 };
const VIEW = { baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0 };

function getScale() {
  return VIEW.baseScale * VIEW.zoom;
}

function beginWorld() {
  const scale = getScale();
  ctx.setTransform(scale, 0, 0, scale, -VIEW.offsetX * scale, -VIEW.offsetY * scale);
}

function endWorld() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function getCanvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  };
}

function screenToWorld(e) {
  const { x: cx, y: cy } = getCanvasPoint(e);
  const scale = getScale();
  return {
    x: cx / scale + VIEW.offsetX,
    y: cy / scale + VIEW.offsetY,
  };
}

function clampView() {
  const scale = getScale();
  const viewWidth = canvas.width / scale;
  const viewHeight = canvas.height / scale;
  const minOffsetX = Math.min(0, WORLD.w - viewWidth);
  const maxOffsetX = Math.max(0, WORLD.w - viewWidth);
  const minOffsetY = Math.min(0, WORLD.h - viewHeight);
  const maxOffsetY = Math.max(0, WORLD.h - viewHeight);
  VIEW.offsetX = Math.min(Math.max(VIEW.offsetX, minOffsetX), maxOffsetX);
  VIEW.offsetY = Math.min(Math.max(VIEW.offsetY, minOffsetY), maxOffsetY);
}

function getViewCenterWorld() {
  const scale = getScale();
  const viewWidth = canvas.width / scale;
  const viewHeight = canvas.height / scale;
  const x = VIEW.offsetX + viewWidth / 2;
  const y = VIEW.offsetY + viewHeight / 2;
  return {
    x: Math.min(Math.max(x, 0), WORLD.w),
    y: Math.min(Math.max(y, 0), WORLD.h),
  };
}

let objects = blankState();
let mode = "idle";
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };
let hasMovedDuringDrag = false;

let lineStart = null;
let previewLine = null;

let isDrawingFree = false;
let freePoints = [];

let isErasing = false;
let erasedDuringDrag = false;

let shapeStart = null;
let shapePreview = null;

let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };
let isSpacePanning = false;
let ignoreTouchUntilLift = false;

let teamSwap = false;
let hasInitialisedWorld = false;

let isDragging = false;
let longPressTimer = null;
let didLongPress = false;

const historyStack = [];
const redoStack = [];
const HISTORY_LIMIT = 80;

const SAVE_STORAGE_KEY = "tactic-saves";
const MAP_STORAGE_KEY = "tactic-maps";
const MAP_SELECTED_KEY = "tactic-selected-map";
const DEFAULT_MAP = { id: "default", name: "預設地圖", dataUrl: "static/img/map_clean.jpg", builtin: true };

let saveSlots = [];
let maps = [];
let currentMapId = DEFAULT_MAP.id;
let pendingSnapshot = null;

function cloneState(data) {
  return JSON.parse(JSON.stringify(data));
}

function ensureStateShape(state) {
  const base = blankState();
  return Object.assign(base, state, {
    towers: state?.towers ?? [],
    flags: state?.flags ?? [],
    markers: state?.markers ?? [],
    lines: state?.lines ?? [],
    shapes: state?.shapes ?? [],
    texts: state?.texts ?? [],
  });
}

function createSnapshot() {
  return {
    version: 2,
    teamSwap,
    mapId: currentMapId,
    world: { w: WORLD.w, h: WORLD.h },
    view: { zoom: VIEW.zoom, offsetX: VIEW.offsetX, offsetY: VIEW.offsetY },
    objects: cloneState(objects),
  };
}

function pushHistory({ replace = false } = {}) {
  const snapshot = createSnapshot();
  if (replace) {
    historyStack.length = 0;
  }
  historyStack.push(snapshot);
  if (historyStack.length > HISTORY_LIMIT) historyStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (undoBtn) undoBtn.disabled = historyStack.length <= 1;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function undo() {
  if (historyStack.length <= 1) return;
  const current = historyStack.pop();
  redoStack.push(current);
  const previous = historyStack[historyStack.length - 1];
  applySnapshot(previous, { replaceHistory: false });
  updateHistoryButtons();
}

function redo() {
  if (!redoStack.length) return;
  const snapshot = redoStack.pop();
  historyStack.push(snapshot);
  applySnapshot(snapshot, { replaceHistory: false });
  updateHistoryButtons();
}

function rescaleObjects(obj, fromW, fromH, toW, toH) {
  if (!fromW || !fromH || !toW || !toH) return;
  const scale = Math.min(toW / fromW, toH / fromH);
  if (!Number.isFinite(scale) || scale <= 0) return;
  const offsetX = (toW - fromW * scale) / 2;
  const offsetY = (toH - fromH * scale) / 2;

  const scaleX = (x) => x * scale + offsetX;
  const scaleY = (y) => y * scale + offsetY;
  const scaleLength = (value, fallback = 0) => (value ?? fallback) * scale;

  obj.towers?.forEach((t) => {
    t.x = scaleX(t.x);
    t.y = scaleY(t.y);
  });

  obj.flags?.forEach((f) => {
    f.x = scaleX(f.x);
    f.y = scaleY(f.y);
  });

  obj.markers?.forEach((m) => {
    m.x = scaleX(m.x);
    m.y = scaleY(m.y);
  });

  obj.lines?.forEach((ln) => {
    if (ln.kind === "free") {
      ln.points?.forEach((p) => {
        p.x = scaleX(p.x);
        p.y = scaleY(p.y);
      });
    } else {
      ln.x1 = scaleX(ln.x1);
      ln.y1 = scaleY(ln.y1);
      ln.x2 = scaleX(ln.x2);
      ln.y2 = scaleY(ln.y2);
    }
    ln.lineWidth = scaleLength(ln.lineWidth, DEFAULT_STROKE_WIDTH);
    if (Array.isArray(ln.dash)) ln.dash = ln.dash.map((d) => d * scale);
  });

  obj.shapes?.forEach((s) => {
    s.x = scaleX(s.x);
    s.y = scaleY(s.y);
    if (s.kind === "circle") {
      s.r = scaleLength(s.r);
    } else if (s.kind === "rect") {
      s.w = scaleLength(s.w);
      s.h = scaleLength(s.h);
    }
    s.lineWidth = scaleLength(s.lineWidth, DEFAULT_STROKE_WIDTH);
    if (Array.isArray(s.dash)) s.dash = s.dash.map((d) => d * scale);
  });

  obj.texts?.forEach((t) => {
    t.x = scaleX(t.x);
    t.y = scaleY(t.y);
    t.size = scaleLength(t.size, 20);
    if (t.padding != null) t.padding *= scale;
    else t.padding = 6 * scale;
    if (t.width != null) t.width *= scale;
    if (t.height != null) t.height *= scale;
  });
}

function swapSpritesByRegion() {
  const mid = WORLD.w / 2;
  for (const t of objects.towers) {
    const left = t.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    t.sprite = color === "blue" ? "tower_blue" : "tower_red";
  }
  for (const f of objects.flags) {
    const left = f.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    f.sprite = color === "blue" ? "flag_blue" : "flag_red";
  }
}

function drawShape(shape, alpha = 1) {
  if (!shape) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = shape.color || selectedLineColor;
  ctx.lineWidth = shape.lineWidth || selectedLineWidth;
  ctx.setLineDash(shape.dash || []);
  if (shape.fillColor) ctx.fillStyle = shape.fillColor;
  if (shape.kind === "circle") {
    ctx.beginPath();
    ctx.arc(shape.x, shape.y, Math.max(1, shape.r || 0), 0, Math.PI * 2);
    if (shape.fillColor) ctx.fill();
    ctx.stroke();
  } else if (shape.kind === "rect") {
    const w = Math.abs(shape.w || 0);
    const h = Math.abs(shape.h || 0);
    ctx.beginPath();
    ctx.rect(shape.x - w / 2, shape.y - h / 2, w, h);
    if (shape.fillColor) ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function updateTextMetrics(text) {
  const size = text.size || 20;
  ctx.save();
  ctx.font = `${text.weight || "600"} ${size}px system-ui, sans-serif`;
  const metrics = ctx.measureText(text.text || "");
  text.width = metrics.width;
  text.height = size * TEXT_LINE_HEIGHT_RATIO;
  ctx.restore();
}

function drawTextLabel(text) {
  if (!text) return;
  updateTextMetrics(text);
  ctx.save();
  const size = text.size || 20;
  ctx.font = `${text.weight || "600"} ${size}px system-ui, sans-serif`;
  ctx.fillStyle = text.color || "#ffffff";
  ctx.textAlign = text.align || "left";
  ctx.textBaseline = text.baseline || "top";
  if (text.background) {
    const padding = text.padding ?? 6;
    let left = text.x;
    if (ctx.textAlign === "center") left = text.x - text.width / 2;
    if (ctx.textAlign === "right") left = text.x - text.width;
    const top = text.y;
    ctx.fillStyle = text.background;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(left - padding, top - padding, text.width + padding * 2, text.height + padding * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = text.color || "#ffffff";
  }
  ctx.fillText(text.text || "", text.x, text.y);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  beginWorld();
  if (BG.complete) ctx.drawImage(BG, 0, 0, WORLD.w, WORLD.h);

  for (const ln of objects.lines) {
    const opts = { lineWidth: ln.lineWidth || DEFAULT_STROKE_WIDTH, dash: ln.dash || [] };
    if (ln.kind === "free") drawPolyline(ctx, ln.points, ln.color, opts);
    else drawArrowLine(ctx, ln.x1, ln.y1, ln.x2, ln.y2, ln.color, ln.arrow, opts);
  }

  if (previewLine) {
    const opts = { lineWidth: previewLine.lineWidth || selectedLineWidth, dash: previewLine.dash || selectedLineDash };
    ctx.globalAlpha = 0.85;
    drawArrowLine(ctx, previewLine.x1, previewLine.y1, previewLine.x2, previewLine.y2, previewLine.color, previewLine.arrow, opts);
    ctx.globalAlpha = 1;
  }

  if (isDrawingFree && freePoints.length > 1) {
    ctx.globalAlpha = 0.85;
    drawPolyline(ctx, freePoints, selectedLineColor, { lineWidth: selectedLineWidth, dash: selectedLineDash });
    ctx.globalAlpha = 1;
  }

  if (shapePreview) drawShape(shapePreview, 0.6);

  for (const shape of objects.shapes) drawShape(shape);
  for (const t of objects.towers) drawTower(ctx, t.x, t.y, t.sprite);
  for (const f of objects.flags) drawFlag(ctx, f.x, f.y, f.sprite);
  for (const m of objects.markers) drawMarker(ctx, m.x, m.y, m.color, m.text);
  for (const txt of objects.texts) drawTextLabel(txt);

  endWorld();
}

const toolButtons = {
  drawLine: drawLineBtn,
  freehand: freehandBtn,
  drawCircle: drawCircleBtn,
  drawRect: drawRectBtn,
  text: textToolBtn,
  eraser: eraserBtn,
};

function setMode(nextMode, btn) {
  const toggleMode = mode === nextMode ? "idle" : nextMode;
  mode = toggleMode;
  Object.entries(toolButtons).forEach(([key, button]) => {
    if (!button) return;
    button.classList.toggle("active", mode === key);
  });
  if (btn && mode === "idle") btn.classList.remove("active");

  if (mode !== "drawLine") {
    lineStart = null;
    previewLine = null;
  }
  if (mode !== "freehand") {
    isDrawingFree = false;
    freePoints = [];
  }
  if (mode !== "eraser") {
    isErasing = false;
    erasedDuringDrag = false;
  }
  if (mode !== "drawCircle" && mode !== "drawRect") {
    shapeStart = null;
    shapePreview = null;
  }
}

function recordAndDraw(action) {
  action();
  draw();
  pushHistory();
}

function placeTower(sprite) {
  const center = getViewCenterWorld();
  objects.towers.push({ x: center.x, y: center.y, sprite });
}

function placeFlag(sprite) {
  const center = getViewCenterWorld();
  objects.flags.push({ x: center.x, y: center.y, sprite });
}

function placeMarker() {
  const center = getViewCenterWorld();
  objects.markers.push({ x: center.x, y: center.y, color: selectedMarkerColor, text: "1" });
}

addBlueTower?.addEventListener("click", () => recordAndDraw(() => placeTower("tower_blue")));
addRedTower?.addEventListener("click", () => recordAndDraw(() => placeTower("tower_red")));
addBlueFlag?.addEventListener("click", () => recordAndDraw(() => placeFlag("flag_blue")));
addRedFlag?.addEventListener("click", () => recordAndDraw(() => placeFlag("flag_red")));
addMarkerBtn?.addEventListener("click", () => recordAndDraw(() => placeMarker()));

drawLineBtn?.addEventListener("click", () => setMode("drawLine", drawLineBtn));
freehandBtn?.addEventListener("click", () => setMode("freehand", freehandBtn));
drawCircleBtn?.addEventListener("click", () => setMode("drawCircle", drawCircleBtn));
drawRectBtn?.addEventListener("click", () => setMode("drawRect", drawRectBtn));
textToolBtn?.addEventListener("click", () => setMode("text", textToolBtn));
eraserBtn?.addEventListener("click", () => setMode("eraser", eraserBtn));

swapColorBtn?.addEventListener("click", () => {
  teamSwap = !teamSwap;
  swapSpritesByRegion();
  draw();
  pushHistory();
});

resetBtn?.addEventListener("click", () => {
  if (!confirm("確定要全部重置嗎？")) return;
  objects = defaultDeploy(DESIGN.w, DESIGN.h);
  rescaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
  teamSwap = false;
  VIEW.zoom = 1;
  VIEW.offsetX = 0;
  VIEW.offsetY = 0;
  swapSpritesByRegion();
  draw();
  pushHistory();
});

savePngBtn?.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = "tactic-board.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
});

function downloadJSON(filename, dataStr) {
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

saveJsonBtn?.addEventListener("click", () => {
  const data = JSON.stringify(createSnapshot(), null, 2);
  downloadJSON(`tactic-${Date.now()}.json`, data);
});

loadJsonBtn?.addEventListener("click", () => loadJsonInput?.click());

loadJsonInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const json = JSON.parse(reader.result);
      applySnapshot(json, { replaceHistory: true });
    } catch (err) {
      console.error(err);
      alert("讀取戰術檔案失敗，請確認格式是否正確。");
    }
  };
  reader.readAsText(file);
  event.target.value = "";
});

undoBtn?.addEventListener("click", undo);
redoBtn?.addEventListener("click", redo);

function getTouchCenter(touches) {
  const t1 = touches[0];
  const t2 = touches[1];
  return {
    clientX: (t1.clientX + t2.clientX) / 2,
    clientY: (t1.clientY + t2.clientY) / 2,
  };
}

function startPanFromPointer(pointer) {
  isPanning = true;
  const { x, y } = getCanvasPoint(pointer);
  panStart = { x, y };
  panOrigin = { x: VIEW.offsetX, y: VIEW.offsetY };
  canvas.classList.add("panning");
}

function updatePanFromPointer(pointer) {
  if (!isPanning) return;
  const { x, y } = getCanvasPoint(pointer);
  const dx = (x - panStart.x) / getScale();
  const dy = (y - panStart.y) / getScale();
  VIEW.offsetX = panOrigin.x - dx;
  VIEW.offsetY = panOrigin.y - dy;
  clampView();
  draw();
}

function endPan() {
  if (!isPanning) return;
  isPanning = false;
  canvas.classList.remove("panning");
  clampView();
}

function createTextObject(x, y, text) {
  return {
    x,
    y,
    text,
    color: selectedTextColor,
    size: 20,
    align: "left",
    baseline: "top",
    padding: 6,
  };
}

function editText(textObj) {
  if (!textObj) return;
  const value = prompt("輸入文字：", textObj.text ?? "");
  if (value !== null) {
    textObj.text = value;
    textObj.color = textObj.color || selectedTextColor;
    draw();
    pushHistory();
  }
}

function pickList(hit) {
  if (hit.type === "tower") return objects.towers;
  if (hit.type === "flag") return objects.flags;
  if (hit.type === "marker") return objects.markers;
  if (hit.type === "shape") return objects.shapes;
  if (hit.type === "text") return objects.texts;
  return null;
}

function onPointerDown(e) {
  const button = e.button ?? 0;
  if (button === 2) return;
  const isMiddle = button === 1;
  if (isSpacePanning || isMiddle) {
    startPanFromPointer(e);
    return;
  }

  const { x, y } = screenToWorld(e);
  isDragging = false;
  hasMovedDuringDrag = false;
  didLongPress = false;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  if (mode === "drawLine") {
    lineStart = { x, y };
    previewLine = null;
    return;
  }

  if (mode === "freehand") {
    isDrawingFree = true;
    freePoints = [{ x, y }];
    draw();
    return;
  }

  if (mode === "eraser") {
    isErasing = true;
    erasedDuringDrag = false;
    const idx = nearestLineIndex(objects.lines, x, y);
    if (idx >= 0) {
      objects.lines.splice(idx, 1);
      erasedDuringDrag = true;
      draw();
    }
    return;
  }

  if (mode === "drawCircle" || mode === "drawRect") {
    shapeStart = { x, y };
    if (mode === "drawCircle") {
      shapePreview = {
        kind: "circle",
        x,
        y,
        r: 0,
        color: selectedLineColor,
        lineWidth: selectedLineWidth,
        dash: selectedLineDash.slice(),
      };
    } else {
      shapePreview = {
        kind: "rect",
        x,
        y,
        w: 0,
        h: 0,
        color: selectedLineColor,
        lineWidth: selectedLineWidth,
        dash: selectedLineDash.slice(),
      };
    }
    draw();
    return;
  }

  if (mode === "text") {
    const input = prompt("輸入文字：", "");
    if (input !== null) {
      const content = input.trim();
      if (content) {
        const textObj = createTextObject(x, y, content);
        objects.texts.push(textObj);
        draw();
        pushHistory();
      }
    }
    return;
  }

  const hit = hitTest(ctx, objects, x, y);
  if (hit) {
    dragTarget = hit;
    const list = pickList(hit);
    const obj = list?.[hit.idx];
    if (!obj) return;
    dragOffset.x = x - obj.x;
    dragOffset.y = y - obj.y;
    mode = "drag";
    longPressTimer = setTimeout(() => {
      didLongPress = true;
      longPressTimer = null;
      const list = pickList(hit);
      if (!list) return;
      list.splice(hit.idx, 1);
      draw();
      pushHistory();
      mode = "idle";
      dragTarget = null;
    }, LONG_PRESS_DURATION_MS);
  } else {
    mode = "idle";
  }
}

function onPointerMove(e) {
  if (isPanning) {
    updatePanFromPointer(e);
    return;
  }

  const { x, y } = screenToWorld(e);

  if (mode === "eraser" && isErasing) {
    const idx = nearestLineIndex(objects.lines, x, y);
    if (idx >= 0) {
      objects.lines.splice(idx, 1);
      erasedDuringDrag = true;
      draw();
    }
    return;
  }

  if (mode === "drawLine" && lineStart) {
    previewLine = {
      x1: lineStart.x,
      y1: lineStart.y,
      x2: x,
      y2: y,
      color: selectedLineColor,
      arrow: arrowType?.value || "none",
      lineWidth: selectedLineWidth,
      dash: selectedLineDash.slice(),
    };
    draw();
    return;
  }

  if (mode === "freehand" && isDrawingFree) {
    freePoints.push({ x, y });
    draw();
    return;
  }

  if (mode === "drawCircle" && shapePreview) {
    const dx = x - shapeStart.x;
    const dy = y - shapeStart.y;
    shapePreview.x = shapeStart.x;
    shapePreview.y = shapeStart.y;
    shapePreview.r = Math.sqrt(dx * dx + dy * dy);
    draw();
    return;
  }

  if (mode === "drawRect" && shapePreview) {
    const w = x - shapeStart.x;
    const h = y - shapeStart.y;
    shapePreview.x = shapeStart.x + w / 2;
    shapePreview.y = shapeStart.y + h / 2;
    shapePreview.w = Math.abs(w);
    shapePreview.h = Math.abs(h);
    draw();
    return;
  }

  if (mode === "drag" && dragTarget) {
    isDragging = true;
    hasMovedDuringDrag = true;
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    const list = pickList(dragTarget);
    const obj = list?.[dragTarget.idx];
    if (obj) {
      obj.x = x - dragOffset.x;
      obj.y = y - dragOffset.y;
      draw();
    }
    return;
  }
}

function onPointerUp(e) {
  if (isPanning) {
    endPan();
    return;
  }

  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  if (didLongPress) {
    didLongPress = false;
    return;
  }

  const { x, y } = screenToWorld(e);

  if (mode === "drawLine" && lineStart) {
    objects.lines.push({
      x1: lineStart.x,
      y1: lineStart.y,
      x2: x,
      y2: y,
      color: selectedLineColor,
      arrow: arrowType?.value || "none",
      lineWidth: selectedLineWidth,
      dash: selectedLineDash.slice(),
    });
    lineStart = null;
    previewLine = null;
    draw();
    pushHistory();
    return;
  }

  if (mode === "drawCircle" && shapePreview) {
    if ((shapePreview.r || 0) >= MIN_SHAPE_SIZE) {
      objects.shapes.push({ ...shapePreview, dash: shapePreview.dash?.slice() || [], lineWidth: shapePreview.lineWidth });
      draw();
      pushHistory();
    }
    shapePreview = null;
    return;
  }

  if (mode === "drawRect" && shapePreview) {
    if ((shapePreview.w || 0) >= MIN_SHAPE_SIZE && (shapePreview.h || 0) >= MIN_SHAPE_SIZE) {
      objects.shapes.push({ ...shapePreview, dash: shapePreview.dash?.slice() || [], lineWidth: shapePreview.lineWidth });
      draw();
      pushHistory();
    }
    shapePreview = null;
    return;
  }

  if (mode === "freehand" && isDrawingFree) {
    if (freePoints.length > 1) {
      objects.lines.push({ kind: "free", points: freePoints.slice(), color: selectedLineColor, dash: selectedLineDash.slice(), lineWidth: selectedLineWidth });
      pushHistory();
    }
    isDrawingFree = false;
    freePoints = [];
    draw();
    return;
  }

  if (mode === "eraser" && isErasing) {
    isErasing = false;
    if (erasedDuringDrag) {
      pushHistory();
      erasedDuringDrag = false;
    }
    return;
  }

  if (mode === "drag") {
    if (!isDragging && dragTarget) {
      if (dragTarget.type === "marker") {
        const m = objects.markers[dragTarget.idx];
        const t = prompt("輸入標記文字：", m.text ?? "");
        if (t !== null) {
          m.text = t;
          draw();
          pushHistory();
        }
      } else if (dragTarget.type === "text") {
        editText(objects.texts[dragTarget.idx]);
      }
    } else if (hasMovedDuringDrag) {
      pushHistory();
    }
    mode = "idle";
    dragTarget = null;
    isDragging = false;
    hasMovedDuringDrag = false;
    return;
  }
}

canvas.addEventListener("mousedown", onPointerDown);
canvas.addEventListener("mousemove", onPointerMove);
canvas.addEventListener("mouseup", onPointerUp);
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const worldPoint = screenToWorld(e);
  const oldZoom = VIEW.zoom;
  const zoomFactor = e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
  const newZoom = Math.min(5, Math.max(0.5, oldZoom * zoomFactor));
  if (Math.abs(newZoom - oldZoom) < 0.001) return;
  VIEW.zoom = newZoom;
  const scale = getScale();
  const { x: cx, y: cy } = getCanvasPoint(e);
  VIEW.offsetX = worldPoint.x - cx / scale;
  VIEW.offsetY = worldPoint.y - cy / scale;
  clampView();
  draw();
}, { passive: false });

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  if (e.touches.length >= 2) {
    ignoreTouchUntilLift = true;
    startPanFromPointer(getTouchCenter(e.touches));
    return;
  }
  if (ignoreTouchUntilLift) return;
  if (e.touches.length > 0) onPointerDown(e.touches[0]);
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!isPanning && ignoreTouchUntilLift) return;
  if (isPanning) {
    if (e.touches.length >= 2) {
      updatePanFromPointer(getTouchCenter(e.touches));
    } else {
      endPan();
    }
    return;
  }
  if (e.touches.length > 0) onPointerMove(e.touches[0]);
}, { passive: false });

canvas.addEventListener("touchend", (e) => {
  e.preventDefault();
  const wasPanning = isPanning;
  if (wasPanning) {
    endPan();
    if (e.touches.length === 0) ignoreTouchUntilLift = false;
    return;
  }
  if (ignoreTouchUntilLift) {
    if (e.touches.length === 0) ignoreTouchUntilLift = false;
    return;
  }
  if (e.changedTouches.length > 0) onPointerUp(e.changedTouches[0]);
}, { passive: false });

canvas.addEventListener("touchcancel", (e) => {
  e.preventDefault();
  if (isPanning) endPan();
  ignoreTouchUntilLift = false;
}, { passive: false });

canvas.addEventListener("mouseleave", () => {
  if (mode === "drag") {
    mode = "idle";
    dragTarget = null;
    isDragging = false;
    hasMovedDuringDrag = false;
  }
  if (mode === "freehand") {
    isDrawingFree = false;
    freePoints = [];
  }
  if (mode === "eraser") {
    if (erasedDuringDrag) pushHistory();
    isErasing = false;
    erasedDuringDrag = false;
  }
  previewLine = null;
  shapePreview = null;
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  endPan();
});

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const { x, y } = screenToWorld(e);
  const hit = hitTest(ctx, objects, x, y);
  if (hit) {
    const list = pickList(hit);
    if (list) {
      list.splice(hit.idx, 1);
      draw();
      pushHistory();
    }
  }
});

canvas.addEventListener("dblclick", (e) => {
  e.preventDefault();
  const { x, y } = screenToWorld(e);
  const hit = hitTest(ctx, objects, x, y);
  if (hit) {
    if (hit.type === "marker") {
      const m = objects.markers[hit.idx];
      const t = prompt("輸入標記文字：", m.text ?? "");
      if (t !== null) {
        m.text = t;
        draw();
        pushHistory();
      }
    } else if (hit.type === "text") {
      editText(objects.texts[hit.idx]);
    }
  }
});

document.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (e.code === "Space" && !isSpacePanning) {
    isSpacePanning = true;
    canvas.classList.add("panning");
    e.preventDefault();
  }
});

document.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    isSpacePanning = false;
    if (!isPanning) canvas.classList.remove("panning");
  }
});

function loadSavesFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_STORAGE_KEY));
    if (Array.isArray(raw)) return raw;
  } catch (err) {
    console.warn(err);
  }
  return [];
}

function persistSaves() {
  try {
    localStorage.setItem(SAVE_STORAGE_KEY, JSON.stringify(saveSlots));
  } catch (err) {
    console.warn(err);
  }
}

function refreshSaveSlotOptions() {
  if (!saveSlotSelect) return;
  saveSlotSelect.innerHTML = "";
  saveSlots.forEach((slot) => {
    const option = document.createElement("option");
    option.value = slot.id;
    option.textContent = slot.data ? slot.name : `${slot.name}（空）`;
    saveSlotSelect.appendChild(option);
  });
  updateSlotButtons();
}

function updateSlotButtons() {
  const slot = getSelectedSlot();
  const hasData = !!(slot && slot.data);
  if (saveSlotLoadBtn) saveSlotLoadBtn.disabled = !hasData;
  if (saveSlotDeleteBtn) saveSlotDeleteBtn.disabled = !hasData;
}

function getSelectedSlot() {
  const id = saveSlotSelect?.value || saveSlots[0]?.id;
  return saveSlots.find((slot) => slot.id === id) || saveSlots[0];
}

saveSlotSelect?.addEventListener("change", updateSlotButtons);

saveSlotSaveBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot) return;
  slot.data = createSnapshot();
  persistSaves();
  refreshSaveSlotOptions();
});

saveSlotLoadBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot?.data) return;
  applySnapshot(slot.data, { replaceHistory: true });
});

saveSlotRenameBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot) return;
  const name = prompt("存檔名稱：", slot.name);
  if (name && name.trim()) {
    slot.name = name.trim();
    persistSaves();
    refreshSaveSlotOptions();
  }
});

saveSlotDeleteBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot?.data) return;
  if (!confirm(`刪除「${slot.name}」的戰術？`)) return;
  slot.data = null;
  persistSaves();
  refreshSaveSlotOptions();
});

function loadMapsFromStorage() {
  try {
    const raw = JSON.parse(localStorage.getItem(MAP_STORAGE_KEY));
    if (Array.isArray(raw)) {
      return raw.filter((m) => m?.id && m?.dataUrl).map((m) => ({ id: m.id, name: m.name || "自訂地圖", dataUrl: m.dataUrl, builtin: false }));
    }
  } catch (err) {
    console.warn(err);
  }
  return [];
}

function saveMapsToStorage() {
  try {
    const custom = maps.filter((m) => !m.builtin).map((m) => ({ id: m.id, name: m.name, dataUrl: m.dataUrl }));
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(custom));
  } catch (err) {
    console.warn(err);
  }
}

function generateMapId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `map-${crypto.randomUUID()}`;
  }
  const random = Math.floor(Math.random() * 1_000_000);
  return `map-${Date.now()}-${random}`;
}

function refreshMapOptions() {
  if (!mapSelect) return;
  mapSelect.innerHTML = "";
  maps.forEach((map) => {
    const option = document.createElement("option");
    option.value = map.id;
    option.textContent = map.name;
    mapSelect.appendChild(option);
  });
  mapSelect.value = currentMapId;
  updateMapButtons();
}

function updateMapButtons() {
  const map = maps.find((m) => m.id === currentMapId);
  const isBuiltin = !!map?.builtin;
  if (deleteMapBtn) deleteMapBtn.disabled = isBuiltin;
  if (renameMapBtn) renameMapBtn.disabled = isBuiltin;
}

function setMap(id) {
  const map = maps.find((m) => m.id === id) || DEFAULT_MAP;
  currentMapId = map.id;
  if (mapSelect) mapSelect.value = map.id;
  updateMapButtons();
  try {
    localStorage.setItem(MAP_SELECTED_KEY, currentMapId);
  } catch (err) {
    console.warn(err);
  }
  BG.src = map.dataUrl;
}

mapSelect?.addEventListener("change", (e) => setMap(e.target.value));

uploadMapBtn?.addEventListener("click", () => mapUploadInput?.click());

mapUploadInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result;
    if (typeof dataUrl !== "string") return;
    const id = generateMapId();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    maps.push({ id, name: baseName || `自訂地圖 ${maps.length}`, dataUrl, builtin: false });
    saveMapsToStorage();
    refreshMapOptions();
    setMap(id);
  };
  reader.readAsDataURL(file);
  event.target.value = "";
});

renameMapBtn?.addEventListener("click", () => {
  const map = maps.find((m) => m.id === currentMapId);
  if (!map || map.builtin) return;
  const name = prompt("地圖名稱：", map.name);
  if (name && name.trim()) {
    map.name = name.trim();
    saveMapsToStorage();
    refreshMapOptions();
  }
});

deleteMapBtn?.addEventListener("click", () => {
  const map = maps.find((m) => m.id === currentMapId);
  if (!map || map.builtin) return;
  if (!confirm(`刪除地圖「${map.name}」？`)) return;
  maps = maps.filter((m) => m.id !== map.id);
  saveMapsToStorage();
  const next = maps.length > 0 ? maps[0] : DEFAULT_MAP;
  currentMapId = next.id;
  refreshMapOptions();
  setMap(currentMapId);
});

function applyViewFromSnapshot(view) {
  if (!view) return;
  VIEW.zoom = Math.min(5, Math.max(0.5, view.zoom ?? VIEW.zoom));
  VIEW.offsetX = view.offsetX ?? VIEW.offsetX;
  VIEW.offsetY = view.offsetY ?? VIEW.offsetY;
  clampView();
}

function applySnapshotImmediate(snapshot, { replaceHistory = false } = {}) {
  teamSwap = !!snapshot.teamSwap;
  objects = ensureStateShape(cloneState(snapshot.objects || blankState()));
  if (snapshot.world && snapshot.world.w && snapshot.world.h) {
    rescaleObjects(objects, snapshot.world.w, snapshot.world.h, WORLD.w, WORLD.h);
  } else {
    rescaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
  }
  applyViewFromSnapshot(snapshot.view);
  swapSpritesByRegion();
  draw();
  if (replaceHistory) pushHistory({ replace: true });
}

function applySnapshot(snapshot, { replaceHistory = false } = {}) {
  if (!snapshot) return;
  if (snapshot.mapId && snapshot.mapId !== currentMapId) {
    pendingSnapshot = { snapshot, replaceHistory };
    setMap(snapshot.mapId);
    return;
  }
  applySnapshotImmediate(snapshot, { replaceHistory });
}

BG.onload = () => {
  const prevWorld = { ...WORLD };
  WORLD.w = BG.naturalWidth || BG.width || 1280;
  WORLD.h = BG.naturalHeight || BG.height || 720;
  clampView();
  if (pendingSnapshot) {
    const { snapshot, replaceHistory } = pendingSnapshot;
    pendingSnapshot = null;
    applySnapshotImmediate(snapshot, { replaceHistory });
    fitCanvas();
    return;
  }
  if (!hasInitialisedWorld) {
    objects = defaultDeploy(DESIGN.w, DESIGN.h);
    rescaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
    hasInitialisedWorld = true;
    VIEW.zoom = 1;
    VIEW.offsetX = 0;
    VIEW.offsetY = 0;
    swapSpritesByRegion();
    fitCanvas();
    draw();
    pushHistory({ replace: true });
  } else {
    rescaleObjects(objects, prevWorld.w, prevWorld.h, WORLD.w, WORLD.h);
    swapSpritesByRegion();
    fitCanvas();
    draw();
    pushHistory();
  }
};

function fitCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  const s = Math.min(rect.width / WORLD.w, rect.height / WORLD.h);
  canvas.width = Math.round(WORLD.w * s);
  canvas.height = Math.round(WORLD.h * s);
  VIEW.baseScale = s;
  clampView();
  draw();
}

window.addEventListener("resize", fitCanvas);

function initSaveSlots() {
  const stored = loadSavesFromStorage();
  const defaults = [
    { id: "slot1", name: "存檔 1", data: null },
    { id: "slot2", name: "存檔 2", data: null },
    { id: "slot3", name: "存檔 3", data: null },
  ];
  saveSlots = defaults.map((slot) => stored.find((s) => s.id === slot.id) || slot);
  refreshSaveSlotOptions();
}

function initMaps() {
  maps = [DEFAULT_MAP, ...loadMapsFromStorage()];
  try {
    const storedId = localStorage.getItem(MAP_SELECTED_KEY);
    if (storedId && maps.some((m) => m.id === storedId)) currentMapId = storedId;
  } catch (err) {
    console.warn(err);
  }
  refreshMapOptions();
  setMap(currentMapId);
}

initSaveSlots();
loadImages();
initMaps();
updateHistoryButtons();
