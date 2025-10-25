import {
  BG,
  DEFAULT_BG_SRC,
  drawFlag,
  drawMarker,
  drawShape,
  drawTextNote,
  drawTower,
  hitTest,
  loadImages,
} from "./objects.js";
import { drawArrowLine, drawPolyline, nearestLineIndex } from "./lines.js";
import { blankState, defaultDeploy } from "./state.js";
import {
  DEFAULT_STROKE_WIDTH,
  ERASER_HIT_RADIUS,
  LONG_PRESS_DURATION_MS,
  MIN_SHAPE_SIZE,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "./constants.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

// === UI Elements ===
const mapSelect = document.getElementById("mapSelect");
const uploadMapBtn = document.getElementById("uploadMapBtn");
const deleteMapBtn = document.getElementById("deleteMapBtn");
const mapFileInput = document.getElementById("mapFile");

const addBlueTower = document.getElementById("addBlueTower");
const addRedTower = document.getElementById("addRedTower");
const addBlueFlag = document.getElementById("addBlueFlag");
const addRedFlag = document.getElementById("addRedFlag");
const addMarkerBtn = document.getElementById("addMarker");

const markerPalette = document.getElementById("markerPalette");
const linePalette = document.getElementById("linePalette");
const textPalette = document.getElementById("textPalette");

const lineDashSelect = document.getElementById("lineDash");
const lineWidthInput = document.getElementById("lineWidth");
const lineWidthValue = document.getElementById("lineWidthValue");
const arrowType = document.getElementById("arrowType");
const textSizeInput = document.getElementById("textSize");

const drawLineBtn = document.getElementById("drawLineBtn");
const freehandBtn = document.getElementById("freehandBtn");
const circleToolBtn = document.getElementById("circleToolBtn");
const rectToolBtn = document.getElementById("rectToolBtn");
const eraserBtn = document.getElementById("eraserBtn");
const textToolBtn = document.getElementById("textToolBtn");

const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const clearBoardBtn = document.getElementById("clearBoardBtn");
const swapColorBtn = document.getElementById("swapColorBtn");
const resetViewBtn = document.getElementById("resetViewBtn");

const saveJsonBtn = document.getElementById("saveJsonBtn");
const loadJsonBtn = document.getElementById("loadJsonBtn");
const jsonFileInput = document.getElementById("jsonFile");
const savePngBtn = document.getElementById("savePng");

const slotSelect = document.getElementById("slotSelect");
const saveSlotBtn = document.getElementById("saveSlotBtn");
const loadSlotBtn = document.getElementById("loadSlotBtn");
const renameSlotBtn = document.getElementById("renameSlotBtn");
const deleteSlotBtn = document.getElementById("deleteSlotBtn");

const zoomLevel = document.getElementById("zoomLevel");

// === Palettes ===
let selectedMarkerColor = "#fbbf24";
let selectedLineColor = "#22c55e";
let selectedTextColor = "#ffffff";
const dashMap = {
  solid: [],
  dashed: [14, 10],
  dotted: [5, 6],
};
let selectedLineDash = dashMap[lineDashSelect?.value ?? "solid"].slice();
let selectedLineWidth =
  Number(lineWidthInput?.value ?? DEFAULT_STROKE_WIDTH) || DEFAULT_STROKE_WIDTH;

function bindPalette(container, onChoose, initialColor) {
  if (!container) return;
  const chips = Array.from(container.querySelectorAll(".chip"));
  const setActive = (color) =>
    chips.forEach((chip) => chip.classList.toggle("active", chip.dataset.color === color));
  chips.forEach((chip) =>
    chip.addEventListener("click", () => {
      const color = chip.dataset.color;
      onChoose(color);
      setActive(color);
      draw();
    })
  );
  setActive(initialColor);
}

bindPalette(markerPalette, (c) => (selectedMarkerColor = c), selectedMarkerColor);
bindPalette(linePalette, (c) => (selectedLineColor = c), selectedLineColor);
bindPalette(textPalette, (c) => (selectedTextColor = c), selectedTextColor);

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

if (lineDashSelect) {
  lineDashSelect.addEventListener("change", () => {
    selectedLineDash = (dashMap[lineDashSelect.value] ?? []).slice();
    draw();
  });
}

function updateLineWidthDisplay() {
  if (lineWidthValue) lineWidthValue.textContent = `${selectedLineWidth}px`;
}

if (lineWidthInput) {
  updateLineWidthDisplay();
  lineWidthInput.addEventListener("input", () => {
    selectedLineWidth = clampNumber(
      lineWidthInput.value,
      1,
      24,
      DEFAULT_STROKE_WIDTH
    );
    updateLineWidthDisplay();
    draw();
  });
}

function getTextSize() {
  if (!textSizeInput) return 18;
  const value = clampNumber(textSizeInput.value, 12, 60, 18);
  textSizeInput.value = value;
  return value;
}

if (textSizeInput) {
  textSizeInput.addEventListener("input", () => {
    textSizeInput.value = getTextSize();
    draw();
  });
}

// === World/View ===
const DESIGN = { w: 1280, h: 720 };
let WORLD = { w: 1280, h: 720 };
const VIEW = { baseScale: 1, zoom: 1, offsetX: 0, offsetY: 0, minZoom: 0.4, maxZoom: 3 };

let objects = blankState();
let teamSwap = false;
let hasInitialised = false;
let hasAutoDeploy = false;

// Modes & interaction
let mode = "idle"; // idle | drag | drawLine | freehand | eraser | shape:circle | shape:rect | text
let dragTarget = null;
let dragOffset = { x: 0, y: 0 };
let lineStart = null;
let previewLine = null;
let isDrawingFree = false;
let freePoints = [];
let isErasing = false;
let eraserChanged = false;
let shapeStart = null;
let previewShape = null;
let isDragging = false;
let longPressTimer = null;
let didLongPress = false;
let isPanKey = false;
let isPanning = false;
let isMultiTouchPanning = false;
let panLast = { x: 0, y: 0 };

// History
const HISTORY_LIMIT = 80;
let history = [];
let redoStack = [];

function snapshotState() {
  return {
    objects: JSON.parse(JSON.stringify(objects)),
    teamSwap,
    world: { w: WORLD.w, h: WORLD.h },
  };
}

function resetHistory() {
  history = [snapshotState()];
  redoStack = [];
  updateHistoryButtons();
}

function commitChange() {
  history.push(snapshotState());
  if (history.length > HISTORY_LIMIT) history.shift();
  redoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (undoBtn) undoBtn.disabled = history.length <= 1;
  if (redoBtn) redoBtn.disabled = redoStack.length === 0;
}

function loadFromSnapshot(snapshot, { reset = false } = {}) {
  if (!snapshot || !snapshot.objects) return false;
  const clone = JSON.parse(JSON.stringify(snapshot.objects));
  if (snapshot.world && snapshot.world.w && snapshot.world.h) {
    const { w, h } = snapshot.world;
    if (w !== WORLD.w || h !== WORLD.h) {
      scaleObjects(clone, w, h, WORLD.w, WORLD.h);
    }
  }
  objects = clone;
  teamSwap = !!snapshot.teamSwap;
  swapSpritesByRegion();
  draw();
  if (reset) {
    resetHistory();
  } else {
    updateHistoryButtons();
  }
  return true;
}

function getScale() {
  return VIEW.baseScale * VIEW.zoom;
}

function updateZoomIndicator() {
  if (zoomLevel) {
    zoomLevel.textContent = `${Math.round(VIEW.zoom * 100)}%`;
  }
}

function clampAxis(containerSize, contentSize, offset) {
  if (contentSize <= containerSize) {
    return (containerSize - contentSize) / 2;
  }
  const min = containerSize - contentSize;
  const max = 0;
  return Math.min(max, Math.max(min, offset));
}

function clampView() {
  const scale = getScale();
  const contentW = WORLD.w * scale;
  const contentH = WORLD.h * scale;
  VIEW.offsetX = clampAxis(canvas.width, contentW, VIEW.offsetX);
  VIEW.offsetY = clampAxis(canvas.height, contentH, VIEW.offsetY);
}

function centerViewOn(x, y) {
  const scale = getScale();
  VIEW.offsetX = canvas.width / 2 - x * scale;
  VIEW.offsetY = canvas.height / 2 - y * scale;
  clampView();
}

function getViewCenterWorld() {
  const scale = getScale();
  if (!scale) return null;
  const x = (canvas.width / 2 - VIEW.offsetX) / scale;
  const y = (canvas.height / 2 - VIEW.offsetY) / scale;
  return { x, y };
}

function resetView(redraw = true) {
  VIEW.zoom = 1;
  centerViewOn(WORLD.w / 2, WORLD.h / 2);
  updateZoomIndicator();
  if (redraw) draw();
}

function getCanvasPointFromClient({ clientX, clientY }) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

function getCanvasPoint(e) {
  return getCanvasPointFromClient(e);
}

function screenToWorld(e) {
  const { x, y } = getCanvasPoint(e);
  const scale = getScale();
  return {
    x: (x - VIEW.offsetX) / scale,
    y: (y - VIEW.offsetY) / scale,
  };
}

function getTouchCenter(touches) {
  if (!touches || touches.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < touches.length; i++) {
    const touch = touches[i];
    sumX += touch.clientX;
    sumY += touch.clientY;
  }
  return {
    clientX: sumX / touches.length,
    clientY: sumY / touches.length,
  };
}

function beginWorld() {
  const scale = getScale();
  ctx.setTransform(scale, 0, 0, scale, VIEW.offsetX, VIEW.offsetY);
}

function endWorld() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  beginWorld();

  if (BG.complete) {
    ctx.drawImage(BG, 0, 0, WORLD.w, WORLD.h);
  }

  for (const shape of objects.shapes ?? []) {
    drawShape(ctx, shape);
  }

  for (const line of objects.lines ?? []) {
    if (line.kind === "free") {
      drawPolyline(
        ctx,
        line.points || [],
        line.color,
        line.width ?? DEFAULT_STROKE_WIDTH,
        line.dash ?? []
      );
    } else {
      drawArrowLine(
        ctx,
        line.x1,
        line.y1,
        line.x2,
        line.y2,
        line.color,
        line.arrow,
        line.width ?? DEFAULT_STROKE_WIDTH,
        line.dash ?? []
      );
    }
  }

  if (previewShape) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawShape(ctx, previewShape);
    ctx.restore();
  }

  if (previewLine) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawArrowLine(
      ctx,
      previewLine.x1,
      previewLine.y1,
      previewLine.x2,
      previewLine.y2,
      previewLine.color,
      previewLine.arrow,
      previewLine.width,
      previewLine.dash
    );
    ctx.restore();
  }

  if (isDrawingFree && freePoints.length > 1) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    drawPolyline(ctx, freePoints, selectedLineColor, selectedLineWidth, selectedLineDash);
    ctx.restore();
  }

  for (const tower of objects.towers ?? []) {
    drawTower(ctx, tower.x, tower.y, tower.sprite);
  }
  for (const flag of objects.flags ?? []) {
    drawFlag(ctx, flag.x, flag.y, flag.sprite);
  }
  for (const marker of objects.markers ?? []) {
    drawMarker(ctx, marker.x, marker.y, marker.color, marker.text);
  }
  for (const note of objects.texts ?? []) {
    drawTextNote(ctx, note);
  }

  endWorld();
  updateZoomIndicator();
}

const MODE_BUTTONS = new Map([
  ["drawLine", drawLineBtn],
  ["freehand", freehandBtn],
  ["shape:circle", circleToolBtn],
  ["shape:rect", rectToolBtn],
  ["eraser", eraserBtn],
  ["text", textToolBtn],
]);

function updateCursor() {
  if (isPanning) {
    canvas.style.cursor = "grabbing";
  } else if (isPanKey) {
    canvas.style.cursor = "grab";
  } else if (mode === "text") {
    canvas.style.cursor = "text";
  } else if (mode === "eraser") {
    canvas.style.cursor = "not-allowed";
  } else if (mode === "drawLine" || mode === "freehand" || mode.startsWith("shape")) {
    canvas.style.cursor = "crosshair";
  } else {
    canvas.style.cursor = "default";
  }
}

function setMode(newMode) {
  const target = mode === newMode ? "idle" : newMode;
  mode = target;
  MODE_BUTTONS.forEach((button, key) => {
    if (!button) return;
    button.classList.toggle("active", mode === key);
  });
  if (mode !== "drawLine") {
    lineStart = null;
    previewLine = null;
  }
  if (mode !== "freehand") {
    isDrawingFree = false;
    freePoints = [];
  }
  if (!mode.startsWith("shape")) {
    shapeStart = null;
    previewShape = null;
  }
  if (mode !== "eraser") {
    isErasing = false;
    eraserChanged = false;
  }
  updateCursor();
}

function startPanFromPointer(pointer) {
  isPanning = true;
  panLast = getCanvasPointFromClient(pointer);
  cancelLongPress();
  updateCursor();
}

function updatePanFromPointer(pointer) {
  if (!isPanning) return;
  const current = getCanvasPointFromClient(pointer);
  VIEW.offsetX += current.x - panLast.x;
  VIEW.offsetY += current.y - panLast.y;
  panLast = current;
  clampView();
  draw();
}

function startPan(e) {
  isMultiTouchPanning = false;
  startPanFromPointer(e);
}

function stopPan() {
  if (!isPanning) return;
  isPanning = false;
  isMultiTouchPanning = false;
  updateCursor();
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
}

function scheduleLongPress(list, index) {
  cancelLongPress();
  longPressTimer = setTimeout(() => {
    didLongPress = true;
    list.splice(index, 1);
    draw();
    commitChange();
    mode = "idle";
    dragTarget = null;
    updateCursor();
  }, LONG_PRESS_DURATION_MS);
}

function scaleObjects(obj, fw, fh, tw, th) {
  if (!fw || !fh || !tw || !th) return;
  const scale = Math.min(tw / fw, th / fh);
  if (!Number.isFinite(scale) || scale <= 0) return;
  const offsetX = (tw - fw * scale) / 2;
  const offsetY = (th - fh * scale) / 2;

  const applyPoint = (point) => {
    if (!point) return;
    point.x = point.x * scale + offsetX;
    point.y = point.y * scale + offsetY;
  };

  for (const tower of obj.towers ?? []) {
    applyPoint(tower);
  }
  for (const flag of obj.flags ?? []) {
    applyPoint(flag);
  }
  for (const marker of obj.markers ?? []) {
    applyPoint(marker);
  }
  for (const line of obj.lines ?? []) {
    if (line.kind === "free") {
      for (const point of line.points ?? []) {
        applyPoint(point);
      }
    } else {
      line.x1 = line.x1 * scale + offsetX;
      line.y1 = line.y1 * scale + offsetY;
      line.x2 = line.x2 * scale + offsetX;
      line.y2 = line.y2 * scale + offsetY;
    }
    line.width = (line.width ?? DEFAULT_STROKE_WIDTH) * scale;
  }
  for (const shape of obj.shapes ?? []) {
    applyPoint(shape);
    shape.width = (shape.width ?? 0) * scale;
    shape.height = (shape.height ?? 0) * scale;
    shape.strokeWidth = (shape.strokeWidth ?? DEFAULT_STROKE_WIDTH) * scale;
  }
  for (const text of obj.texts ?? []) {
    applyPoint(text);
    text.fontSize = (text.fontSize ?? 18) * scale;
  }
}

function swapSpritesByRegion() {
  const mid = WORLD.w / 2;
  for (const t of objects.towers ?? []) {
    const left = t.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    t.sprite = color === "blue" ? "tower_blue" : "tower_red";
  }
  for (const f of objects.flags ?? []) {
    const left = f.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    f.sprite = color === "blue" ? "flag_blue" : "flag_red";
  }
}

function fitCanvas(redraw = true) {
  const rect = canvas.parentElement?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.max(240, rect.width);
  const height = Math.max(200, rect.height);
  const center = getViewCenterWorld();
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  VIEW.baseScale = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h) || 1;
  if (center) {
    centerViewOn(center.x, center.y);
  } else {
    centerViewOn(WORLD.w / 2, WORLD.h / 2);
  }
  if (redraw) draw();
}

function pickList(hit) {
  if (!hit) return null;
  if (hit.type === "tower") return objects.towers;
  if (hit.type === "flag") return objects.flags;
  if (hit.type === "marker") return objects.markers;
  if (hit.type === "shape") return objects.shapes;
  if (hit.type === "text") return objects.texts;
  return null;
}

function addTower(sprite) {
  const center = getViewCenterWorld();
  const position = center ?? {
    x: WORLD.w * 0.2 + Math.random() * 40,
    y: WORLD.h * 0.3 + Math.random() * 40,
  };
  objects.towers.push({ x: position.x, y: position.y, sprite });
  draw();
  commitChange();
}

function addFlag(sprite) {
  const center = getViewCenterWorld();
  const position = center ?? {
    x: WORLD.w * 0.2 + Math.random() * 40,
    y: WORLD.h * 0.4 + Math.random() * 40,
  };
  objects.flags.push({ x: position.x, y: position.y, sprite });
  draw();
  commitChange();
}

function addMarker() {
  const center = getViewCenterWorld();
  const position = center ?? { x: WORLD.w / 2, y: WORLD.h / 2 };
  objects.markers.push({
    x: position.x,
    y: position.y,
    color: selectedMarkerColor,
    text: "1",
  });
  draw();
  commitChange();
}

function createTextAt(x, y, existing) {
  const defaultValue = existing?.text ?? "";
  const value = prompt("輸入文字內容：", defaultValue);
  if (value === null) return false;
  const text = value.trim();
  if (!text) {
    if (existing) {
      existing.text = "";
      draw();
      commitChange();
    }
    return false;
  }
  if (existing) {
    existing.text = text;
    draw();
    commitChange();
    return true;
  }
  objects.texts.push({
    x,
    y,
    text,
    color: selectedTextColor,
    fontSize: getTextSize(),
    align: "left",
  });
  draw();
  commitChange();
  return true;
}

function promptMarkerText(marker) {
  const value = prompt("輸入標記內容：", marker.text ?? "");
  if (value === null) return false;
  marker.text = value;
  draw();
  commitChange();
  return true;
}

function undo() {
  if (history.length <= 1) return;
  const current = history.pop();
  redoStack.push(current);
  const previous = history[history.length - 1];
  loadFromSnapshot(previous);
}

function redo() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  history.push(next);
  loadFromSnapshot(next);
}

function handlePanKey(e) {
  if (e.code === "Space") {
    if (e.type === "keydown") {
      if (!isPanKey) {
        isPanKey = true;
        updateCursor();
      }
      e.preventDefault();
    } else if (e.type === "keyup") {
      isPanKey = false;
      stopPan();
      updateCursor();
    }
  }
}

function onWheel(e) {
  e.preventDefault();
  const delta = e.deltaY;
  const factor = delta < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
  const newZoom = clampNumber(VIEW.zoom * factor, VIEW.minZoom, VIEW.maxZoom, VIEW.zoom);
  const prevZoom = VIEW.zoom;
  if (Math.abs(newZoom - prevZoom) < 0.001) return;
  const canvasPoint = getCanvasPoint(e);
  const scale = getScale();
  const worldX = (canvasPoint.x - VIEW.offsetX) / scale;
  const worldY = (canvasPoint.y - VIEW.offsetY) / scale;
  VIEW.zoom = newZoom;
  const newScale = getScale();
  VIEW.offsetX = canvasPoint.x - worldX * newScale;
  VIEW.offsetY = canvasPoint.y - worldY * newScale;
  clampView();
  updateCursor();
  draw();
}

function onPointerDown(e) {
  if (e.button === 2) return; // handled via contextmenu
  const button = e.button ?? 0;
  if (button === 1 || isPanKey) {
    startPan(e);
    return;
  }
  if (button !== 0) return;

  const point = screenToWorld(e);
  isDragging = false;
  didLongPress = false;
  cancelLongPress();

  if (mode.startsWith("shape")) {
    const type = mode === "shape:circle" ? "circle" : "rect";
    shapeStart = { x: point.x, y: point.y, type };
    previewShape = {
      type,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
      color: selectedLineColor,
      strokeWidth: selectedLineWidth,
      dash: selectedLineDash.slice(),
    };
    return;
  }

  if (mode === "text") {
    createTextAt(point.x, point.y);
    return;
  }

  if (mode === "drawLine") {
    if (!lineStart) {
      lineStart = { x: point.x, y: point.y };
      previewLine = null;
    }
    return;
  }

  if (mode === "freehand") {
    isDrawingFree = true;
    freePoints = [{ x: point.x, y: point.y }];
    draw();
    return;
  }

  if (mode === "eraser") {
    isErasing = true;
    eraserChanged = false;
    const idx = nearestLineIndex(
      objects.lines,
      point.x,
      point.y,
      ERASER_HIT_RADIUS
    );
    if (idx >= 0) {
      objects.lines.splice(idx, 1);
      eraserChanged = true;
      draw();
    }
    return;
  }

  const hit = hitTest(ctx, objects, point.x, point.y);
  if (hit) {
    const list = pickList(hit);
    if (!list) return;
    dragTarget = { type: hit.type, idx: hit.idx };
    const obj = list[hit.idx];
    dragOffset.x = point.x - (obj.x ?? point.x);
    dragOffset.y = point.y - (obj.y ?? point.y);
    mode = "drag";
    scheduleLongPress(list, hit.idx);
  } else {
    mode = "idle";
  }
  updateCursor();
}

function onPointerMove(e) {
  if (isPanning) {
    updatePanFromPointer(e);
    return;
  }

  const point = screenToWorld(e);

  if (mode === "eraser" && isErasing) {
    const idx = nearestLineIndex(
      objects.lines,
      point.x,
      point.y,
      ERASER_HIT_RADIUS
    );
    if (idx >= 0) {
      objects.lines.splice(idx, 1);
      eraserChanged = true;
      draw();
    }
    return;
  }

  if (shapeStart && previewShape) {
    const left = Math.min(shapeStart.x, point.x);
    const top = Math.min(shapeStart.y, point.y);
    const width = Math.abs(point.x - shapeStart.x);
    const height = Math.abs(point.y - shapeStart.y);
    previewShape = {
      type: shapeStart.type,
      x: left + width / 2,
      y: top + height / 2,
      width,
      height,
      color: selectedLineColor,
      strokeWidth: selectedLineWidth,
      dash: selectedLineDash.slice(),
    };
    draw();
    return;
  }

  if (mode === "drawLine" && lineStart) {
    previewLine = {
      x1: lineStart.x,
      y1: lineStart.y,
      x2: point.x,
      y2: point.y,
      color: selectedLineColor,
      arrow: arrowType?.value ?? "none",
      width: selectedLineWidth,
      dash: selectedLineDash.slice(),
    };
    draw();
    return;
  }

  if (mode === "freehand" && isDrawingFree) {
    freePoints.push({ x: point.x, y: point.y });
    draw();
    return;
  }

  if (mode === "drag" && dragTarget) {
    const list = pickList(dragTarget);
    if (!list) return;
    cancelLongPress();
    const obj = list[dragTarget.idx];
    obj.x = point.x - dragOffset.x;
    obj.y = point.y - dragOffset.y;
    isDragging = true;
    draw();
  }
}

function onPointerUp(e) {
  if (isPanning) {
    stopPan();
    return;
  }

  const point = screenToWorld(e);
  cancelLongPress();

  if (didLongPress) {
    didLongPress = false;
    mode = "idle";
    dragTarget = null;
    updateCursor();
    return;
  }

  if (shapeStart && previewShape) {
    if (
      previewShape.width > MIN_SHAPE_SIZE &&
      previewShape.height > MIN_SHAPE_SIZE
    ) {
      objects.shapes.push({
        type: previewShape.type,
        x: previewShape.x,
        y: previewShape.y,
        width: previewShape.width,
        height: previewShape.height,
        color: previewShape.color,
        strokeWidth: previewShape.strokeWidth,
        dash: previewShape.dash.slice(),
      });
      draw();
      commitChange();
    }
    shapeStart = null;
    previewShape = null;
    return;
  }

  if (mode === "drawLine" && lineStart) {
    objects.lines.push({
      x1: lineStart.x,
      y1: lineStart.y,
      x2: point.x,
      y2: point.y,
      color: selectedLineColor,
      arrow: arrowType?.value ?? "none",
      width: selectedLineWidth,
      dash: selectedLineDash.slice(),
    });
    lineStart = null;
    previewLine = null;
    draw();
    commitChange();
    return;
  }

  if (mode === "freehand" && isDrawingFree) {
    if (freePoints.length > 1) {
      objects.lines.push({
        kind: "free",
        points: freePoints.slice(),
        color: selectedLineColor,
        width: selectedLineWidth,
        dash: selectedLineDash.slice(),
      });
      draw();
      commitChange();
    }
    isDrawingFree = false;
    freePoints = [];
    return;
  }

  if (mode === "eraser" && isErasing) {
    if (eraserChanged) {
      commitChange();
    }
    isErasing = false;
    eraserChanged = false;
    return;
  }

  if (mode === "drag" && dragTarget) {
    const list = pickList(dragTarget);
    if (list) {
      if (!isDragging) {
        const obj = list[dragTarget.idx];
        if (dragTarget.type === "marker") {
          promptMarkerText(obj);
        } else if (dragTarget.type === "text") {
          createTextAt(obj.x, obj.y, obj);
        }
      } else {
        commitChange();
      }
    }
    mode = "idle";
    dragTarget = null;
    isDragging = false;
    updateCursor();
    return;
  }

  if (mode === "idle") {
    const hit = hitTest(ctx, objects, point.x, point.y);
    if (hit && hit.type === "text") {
      const list = pickList(hit);
      createTextAt(point.x, point.y, list?.[hit.idx]);
    }
  }
}

function onMouseLeave() {
  if (mode === "drag") {
    mode = "idle";
    dragTarget = null;
  }
  if (mode === "freehand") {
    isDrawingFree = false;
    freePoints = [];
  }
  if (mode === "eraser") {
    isErasing = false;
    eraserChanged = false;
  }
  shapeStart = null;
  previewShape = null;
  cancelLongPress();
  stopPan();
  previewLine = null;
  isDragging = false;
  updateCursor();
}

// *** 修正：加入 handleSingleTouchUp ***
function handleSingleTouchUp(e) {
  if (e.changedTouches.length > 0) {
    onPointerUp(e.changedTouches[0]);
  }
}

canvas.addEventListener("mousedown", onPointerDown);
canvas.addEventListener("mousemove", onPointerMove);
canvas.addEventListener("mouseup", onPointerUp);
canvas.addEventListener("mouseleave", onMouseLeave);
canvas.addEventListener("wheel", onWheel, { passive: false });

canvas.addEventListener(
  "touchstart",
  (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      const center = getTouchCenter(e.touches);
      if (center) {
        isMultiTouchPanning = true;
        startPanFromPointer(center);
      }
      return;
    }
    if (e.touches.length > 0) onPointerDown(e.touches[0]);
  },
  { passive: false }
);
canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    if (e.touches.length >= 2) {
      const center = getTouchCenter(e.touches);
      if (center) {
        if (!isPanning) {
          isMultiTouchPanning = true;
          startPanFromPointer(center);
        } else {
          updatePanFromPointer(center);
        }
      }
      return;
    }
    if (isMultiTouchPanning) {
      stopPan();
      return;
    }
    if (e.touches.length > 0) onPointerMove(e.touches[0]);
  },
  { passive: false }
);

// *** 修正：更新 touchend ***
canvas.addEventListener(
  "touchend",
  (e) => {
    e.preventDefault();
    if (isMultiTouchPanning) {
      if (e.touches.length >= 2) {
        const center = getTouchCenter(e.touches);
        if (center) updatePanFromPointer(center);
      } else {
        stopPan();
      }
      return;
    }
    handleSingleTouchUp(e);
  },
  { passive: false }
);

// *** 修正：更新 touchcancel ***
canvas.addEventListener(
  "touchcancel",
  (e) => {
    e.preventDefault();
    if (isMultiTouchPanning) {
      stopPan();
      return;
    }
    handleSingleTouchUp(e);
  },
  { passive: false }
);

canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const point = screenToWorld(e);
  const hit = hitTest(ctx, objects, point.x, point.y);
  if (!hit) return;
  const list = pickList(hit);
  if (!list) return;
  list.splice(hit.idx, 1);
  draw();
  commitChange();
});

canvas.addEventListener("dblclick", (e) => {
  e.preventDefault();
  const point = screenToWorld(e);
  const hit = hitTest(ctx, objects, point.x, point.y);
  if (!hit) return;
  const list = pickList(hit);
  if (!list) return;
  const item = list[hit.idx];
  if (hit.type === "marker") {
    promptMarkerText(item);
  } else if (hit.type === "text") {
    createTextAt(item.x, item.y, item);
  }
});

window.addEventListener("resize", () => fitCanvas());
document.addEventListener("keydown", handlePanKey, { passive: false });
document.addEventListener("keyup", handlePanKey);

// Mode buttons
if (drawLineBtn) drawLineBtn.addEventListener("click", () => setMode("drawLine"));
if (freehandBtn) freehandBtn.addEventListener("click", () => setMode("freehand"));
if (circleToolBtn) circleToolBtn.addEventListener("click", () => setMode("shape:circle"));
if (rectToolBtn) rectToolBtn.addEventListener("click", () => setMode("shape:rect"));
if (eraserBtn) eraserBtn.addEventListener("click", () => setMode("eraser"));
if (textToolBtn) textToolBtn.addEventListener("click", () => setMode("text"));

// Object buttons
addBlueTower?.addEventListener("click", () => addTower("tower_blue"));
addRedTower?.addEventListener("click", () => addTower("tower_red"));
addBlueFlag?.addEventListener("click", () => addFlag("flag_blue"));
addRedFlag?.addEventListener("click", () => addFlag("flag_red"));
addMarkerBtn?.addEventListener("click", addMarker);

undoBtn?.addEventListener("click", undo);
redoBtn?.addEventListener("click", redo);

clearBoardBtn?.addEventListener("click", () => {
  if (!confirm("確定要清空畫布嗎？")) return;
  objects = blankState();
  teamSwap = false;
  hasAutoDeploy = false;
  draw();
  commitChange();
});

swapColorBtn?.addEventListener("click", () => {
  if (!hasAutoDeploy) {
    objects = defaultDeploy(DESIGN.w, DESIGN.h);
    scaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
    teamSwap = false;
    hasAutoDeploy = true;
  } else {
    teamSwap = !teamSwap;
    swapSpritesByRegion();
  }
  draw();
  commitChange();
});

resetViewBtn?.addEventListener("click", () => {
  resetView();
});

savePngBtn?.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = "tactic-board.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
});

saveJsonBtn?.addEventListener("click", () => {
  const data = JSON.stringify(snapshotState(), null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tactic-board.json";
  a.click();
  URL.revokeObjectURL(url);
});

loadJsonBtn?.addEventListener("click", () => jsonFileInput?.click());

jsonFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const snapshot = data.objects ? data : { objects: data };
      if (loadFromSnapshot(snapshot, { reset: true })) {
        hasAutoDeploy = false;
      }
    } catch (err) {
      alert("載入 JSON 失敗，請確認檔案格式。");
      console.error(err);
    }
  };
  reader.readAsText(file);
  jsonFileInput.value = "";
});

// === Save Slots ===
const SLOT_KEY = "tactic.slots.v1";
const DEFAULT_SLOTS = [
  { id: "slot1", name: "存檔 1", data: null },
  { id: "slot2", name: "存檔 2", data: null },
  { id: "slot3", name: "存檔 3", data: null },
];

let slots = loadSlots();

function loadSlots() {
  try {
    const stored = JSON.parse(localStorage.getItem(SLOT_KEY) || "null");
    if (!Array.isArray(stored)) return DEFAULT_SLOTS.map((s) => ({ ...s }));
    return DEFAULT_SLOTS.map((slot) => {
      const found = stored.find((s) => s.id === slot.id);
      return found ? { ...slot, ...found } : { ...slot };
    });
  } catch (err) {
    console.warn("無法讀取存檔插槽：", err);
    return DEFAULT_SLOTS.map((s) => ({ ...s }));
  }
}

function persistSlots() {
  const toSave = slots.map(({ id, name, data }) => ({ id, name, data }));
  localStorage.setItem(SLOT_KEY, JSON.stringify(toSave));
}

function renderSlots() {
  if (!slotSelect) return;
  slotSelect.innerHTML = "";
  for (const slot of slots) {
    const option = document.createElement("option");
    option.value = slot.id;
    option.textContent = slot.data ? `${slot.name} ✓` : slot.name;
    slotSelect.appendChild(option);
  }
  updateSlotButtons();
}

function getSelectedSlot() {
  if (!slotSelect) return null;
  return slots.find((slot) => slot.id === slotSelect.value) ?? slots[0];
}

function updateSlotButtons() {
  const slot = getSelectedSlot();
  const hasData = !!slot?.data;
  if (loadSlotBtn) loadSlotBtn.disabled = !hasData;
  if (deleteSlotBtn) deleteSlotBtn.disabled = !hasData;
}

slotSelect?.addEventListener("change", updateSlotButtons);

saveSlotBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot) return;
  slot.data = snapshotState();
  persistSlots();
  renderSlots();
});

loadSlotBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot?.data) return;
  loadFromSnapshot(slot.data, { reset: true });
});

renameSlotBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot) return;
  const name = prompt("輸入新的存檔名稱：", slot.name);
  if (!name) return;
  slot.name = name.trim() || slot.name;
  persistSlots();
  renderSlots();
});

deleteSlotBtn?.addEventListener("click", () => {
  const slot = getSelectedSlot();
  if (!slot?.data) return;
  if (!confirm(`刪除「${slot.name}」的存檔？`)) return;
  slot.data = null;
  persistSlots();
  renderSlots();
});

renderSlots();

// === Maps ===
const MAPS_KEY = "tactic.maps.v1";
const MAP_CURRENT_KEY = "tactic.maps.current";
const DEFAULT_MAP = { id: "default", name: "預設地圖", src: DEFAULT_BG_SRC, builtIn: true };
let maps = [DEFAULT_MAP];
let currentMapId = DEFAULT_MAP.id;

function loadMaps() {
  try {
    const stored = JSON.parse(localStorage.getItem(MAPS_KEY) || "null");
    if (Array.isArray(stored)) {
      maps = [DEFAULT_MAP, ...stored.filter((m) => m && m.src)];
    }
  } catch (err) {
    console.warn("讀取地圖列表失敗：", err);
    maps = [DEFAULT_MAP];
  }
  const savedId = localStorage.getItem(MAP_CURRENT_KEY);
  if (savedId && maps.some((m) => m.id === savedId)) {
    currentMapId = savedId;
  } else {
    currentMapId = DEFAULT_MAP.id;
  }
}

function saveMaps() {
  const userMaps = maps.filter((m) => !m.builtIn);
  localStorage.setItem(MAPS_KEY, JSON.stringify(userMaps));
}

// *** 修正：強化 generateMapId ***
function generateMapId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `map-${crypto.randomUUID()}`;
  }
  let random = "";
  for (let i = 0; i < 4; i++) {
    random += Math.random().toString(36).slice(2, 6);
  }
  return `map-${Date.now().toString(36)}-${random}`;
}

function renderMaps() {
  if (!mapSelect) return;
  mapSelect.innerHTML = "";
  for (const map of maps) {
    const option = document.createElement("option");
    option.value = map.id;
    option.textContent = map.name;
    mapSelect.appendChild(option);
  }
  mapSelect.value = currentMapId;
  updateMapButtons();
}

function updateMapButtons() {
  const map = maps.find((m) => m.id === currentMapId) ?? DEFAULT_MAP;
  if (deleteMapBtn) deleteMapBtn.disabled = !!map.builtIn;
}

function setCurrentMap(id) {
  const map = maps.find((m) => m.id === id) ?? DEFAULT_MAP;
  currentMapId = map.id;
  if (mapSelect) mapSelect.value = currentMapId;
  updateMapButtons();
  if (BG.src !== map.src) {
    BG.src = map.src;
  } else if (BG.complete) {
    BG.dispatchEvent(new Event("load"));
  }
  localStorage.setItem(MAP_CURRENT_KEY, currentMapId);
}

mapSelect?.addEventListener("change", () => {
  setCurrentMap(mapSelect.value);
});

uploadMapBtn?.addEventListener("click", () => mapFileInput?.click());

mapFileInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const name = prompt("輸入地圖名稱：", file.name.replace(/\.[^.]+$/, "")) || "自訂地圖";
    const id = generateMapId();
    maps.push({ id, name, src: reader.result, builtIn: false });
    saveMaps();
    renderMaps();
    setCurrentMap(id);
  };
  reader.readAsDataURL(file);
  mapFileInput.value = "";
});

deleteMapBtn?.addEventListener("click", () => {
  const map = maps.find((m) => m.id === currentMapId);
  if (!map || map.builtIn) return;
  if (!confirm(`刪除地圖「${map.name}」？`)) return;
  maps = maps.filter((m) => m.id !== map.id);
  saveMaps();
  const next = maps.length > 0 ? maps[0] : DEFAULT_MAP;
  renderMaps();
  setCurrentMap(next.id);
});

// === Initialization ===
loadImages();
loadMaps();
renderMaps();
setCurrentMap(currentMapId);

BG.onload = () => {
  const prev = { ...WORLD };
  WORLD.w = BG.naturalWidth || BG.width || WORLD.w;
  WORLD.h = BG.naturalHeight || BG.height || WORLD.h;

  if (!hasInitialised) {
    objects = defaultDeploy(DESIGN.w, DESIGN.h);
    scaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
    hasInitialised = true;
    hasAutoDeploy = true;
  } else {
    scaleObjects(objects, prev.w, prev.h, WORLD.w, WORLD.h);
  }

  swapSpritesByRegion();
  fitCanvas(false);
  resetView(false);
  draw();
  resetHistory();
  updateCursor();
};

fitCanvas(false);
draw();
updateCursor();
updateHistoryButtons();
