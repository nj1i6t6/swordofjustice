import { BG, loadImages, drawTower, drawFlag, drawMarker, hitTest, applySettings } from "./objects.js";
import { drawArrowLine, drawPolyline, nearestLineIndex } from "./lines.js";
import { defaultDeploy } from "./state.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

// === UI ===
const addBlueTower = document.getElementById("addBlueTower");
const addRedTower  = document.getElementById("addRedTower");
const addBlueFlag  = document.getElementById("addBlueFlag");
const addRedFlag   = document.getElementById("addRedFlag");
const addMarkerBtn = document.getElementById("addMarker");

const drawLineBtn  = document.getElementById("drawLineBtn");
const freehandBtn  = document.getElementById("freehandBtn");
const arrowType    = document.getElementById("arrowType");
const eraserBtn    = document.getElementById("eraserBtn");
const resetBtn     = document.getElementById("resetBtn");
const savePngBtn   = document.getElementById("savePng");
const swapColorBtn = document.getElementById("swapColorBtn");

const markerPalette = document.getElementById("markerPalette");
const linePalette   = document.getElementById("linePalette");

// === 色票 ===
let selectedMarkerColor = "#fbbf24";
let selectedLineColor   = "#22c55e";
function bindPalette(container, onChoose, def){
  if (!container) return;
  const chips = Array.from(container.querySelectorAll(".chip"));
  const setActive = (c)=> chips.forEach(b=>b.classList.toggle("active", b.dataset.color===c));
  chips.forEach(b=>b.addEventListener("click", ()=>{ const c=b.dataset.color; onChoose(c); setActive(c); draw(); }));
  setActive(def);
}
bindPalette(markerPalette, c=>selectedMarkerColor=c, selectedMarkerColor);
bindPalette(linePalette,   c=>selectedLineColor=c,   selectedLineColor);

// === 座標系 ===
const DESIGN = { w: 1280, h: 720 }; // 你記座標用的基準尺寸
let WORLD = { w: 1280, h: 720 };    // 實際底圖尺寸（載入圖後更新）
let VIEW  = { scale: 1 };           // canvas = WORLD * scale（無偏移、無黑邊）

function beginWorld(){ ctx.setTransform(VIEW.scale,0,0,VIEW.scale,0,0); }
function endWorld(){ ctx.setTransform(1,0,0,1,0,0); }

// 螢幕→世界
function screenToWorld(e) {
  const rect = canvas.getBoundingClientRect();

  // 真實滑鼠在 canvas 中的相對位置 (0 ~ 1)
  const px = (e.clientX - rect.left) / rect.width;
  const py = (e.clientY - rect.top) / rect.height;

  // 轉換成世界座標（這樣就不受 DPI、螢幕縮放、scroll、或 CSS 影響）
  const x = px * WORLD.w;
  const y = py * WORLD.h;

  return { x, y };
}





// 設計→世界（載入時一次性換算）
function scaleObjects(obj, fw, fh, tw, th){
  const sx = tw/fw, sy = th/fh;
  for (const t of obj.towers){ t.x*=sx; t.y*=sy; }
  for (const f of obj.flags ){ f.x*=sx; f.y*=sy; }
  for (const m of obj.markers){ m.x*=sx; m.y*=sy; }
  for (const ln of obj.lines){
    if (ln.kind === "free"){ for (const p of ln.points){ p.x*=sx; p.y*=sy; } }
    else { ln.x1*=sx; ln.y1*=sy; ln.x2*=sx; ln.y2*=sy; }
  }
}

// === 狀態 ===
let objects = defaultDeploy(DESIGN.w, DESIGN.h); // 先用設計尺寸建立，再轉到世界
let mode = "idle"; // idle | drag | drawLine | freehand | eraser
let dragTarget = null;
let dragOffset = {x:0, y:0};

// 線條暫態
let lineStart = null;
let previewLine = null;

// 自由畫暫態
let isDrawingFree = false;
let freePoints = [];

// 橡皮擦
let isErasing = false;

// 陣營切換
let teamSwap = false;

// === 載圖與自適應 ===
loadImages();
BG.onload = ()=>{
  WORLD.w = BG.naturalWidth  || BG.width  || 1280;
  WORLD.h = BG.naturalHeight || BG.height || 720;

  // 初始化物件（以設計尺寸建立後轉換到實際地圖大小）
  objects = defaultDeploy(DESIGN.w, DESIGN.h);
  scaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);

  // 先套用塔與旗的正確陣營顏色（左藍右紅）
  swapSpritesByRegion();

  // 再繪製畫面（確保旗塔立即顯示）
  fitCanvas();
  draw();
};

window.addEventListener("resize", fitCanvas);

// 讓 canvas 直接等比縮放到能容納 WORLD 的大小（無黑邊、不置中）
function fitCanvas(){
  const rect = canvas.parentElement.getBoundingClientRect();
  const s = Math.min(rect.width / WORLD.w, rect.height / WORLD.h);
  canvas.width  = Math.round(WORLD.w * s);
  canvas.height = Math.round(WORLD.h * s);
  VIEW.scale = s;
  draw();
}

// === 陣營切換以「世界中線」為界 ===
function swapSpritesByRegion(){
  const mid = WORLD.w / 2;
  for (const t of objects.towers){
    const left = t.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    t.sprite = color === "blue" ? "tower_blue" : "tower_red";
  }
  for (const f of objects.flags){
    const left = f.x < mid;
    const color = (left ^ teamSwap) ? "blue" : "red";
    f.sprite = color === "blue" ? "flag_blue" : "flag_red";
  }
}

// === 畫面 ===
function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  beginWorld();
  // 背景
  if (BG.complete) ctx.drawImage(BG, 0, 0, WORLD.w, WORLD.h);

  // 已完成的線
  for (const ln of objects.lines){
    if (ln.kind === "free") drawPolyline(ctx, ln.points, ln.color);
    else drawArrowLine(ctx, ln.x1, ln.y1, ln.x2, ln.y2, ln.color, ln.arrow);
  }

  // 預覽：直線 / 自由畫
  if (previewLine){
    ctx.globalAlpha = 0.9;
    drawArrowLine(ctx, previewLine.x1, previewLine.y1, previewLine.x2, previewLine.y2, previewLine.color, previewLine.arrow);
    ctx.globalAlpha = 1.0;
  }
  if (isDrawingFree && freePoints.length > 1){
    ctx.globalAlpha = 0.9;
    drawPolyline(ctx, freePoints, selectedLineColor);
    ctx.globalAlpha = 1.0;
  }

  // 物件
  for (const t of objects.towers) drawTower(ctx, t.x, t.y, t.sprite);
  for (const f of objects.flags)  drawFlag(ctx,  f.x, f.y, f.sprite);
  for (const m of objects.markers)drawMarker(ctx, m.x, m.y, m.color, m.text);

  endWorld();
}

// === 模式切換 ===
function setMode(m, btn){
  const newMode = (mode === m) ? "idle" : m;
  mode = newMode;
  [drawLineBtn, freehandBtn, eraserBtn].forEach(b=>b?.classList.remove("active"));
  if (mode !== "idle" && btn) btn.classList.add("active");

  if (mode !== "drawLine"){ lineStart = null; previewLine = null; }
  if (mode !== "freehand"){ isDrawingFree = false; freePoints = []; }
  if (mode !== "eraser"){ isErasing = false; }
}

// === 物件新增 ===
addBlueTower.onclick = ()=>{ objects.towers.push({ x: 150, y: 150, sprite: "tower_blue" }); draw(); };
addRedTower.onclick  = ()=>{ objects.towers.push({ x: 220, y: 150, sprite: "tower_red"  }); draw(); };
addBlueFlag.onclick  = ()=>{ objects.flags .push({ x: 150, y: 220, sprite: "flag_blue" }); draw(); };
addRedFlag.onclick   = ()=>{ objects.flags .push({ x: 220, y: 220, sprite: "flag_red"  }); draw(); };
addMarkerBtn.onclick = ()=>{ objects.markers.push({ x: 180, y: 260, color: selectedMarkerColor, text: "1" }); draw(); };

// === 模式按鈕 ===
drawLineBtn.onclick  = ()=> setMode("drawLine", drawLineBtn);
freehandBtn.onclick  = ()=> setMode("freehand", freehandBtn);
eraserBtn.onclick    = ()=> setMode("eraser", eraserBtn);
swapColorBtn && (swapColorBtn.onclick = ()=>{ teamSwap = !teamSwap; swapSpritesByRegion(); draw(); });

resetBtn.onclick = ()=>{
  // 重新依 DESIGN 產生→轉到 WORLD，確保與你記的座標一致
  objects = defaultDeploy(DESIGN.w, DESIGN.h);
  scaleObjects(objects, DESIGN.w, DESIGN.h, WORLD.w, WORLD.h);
  if (teamSwap) swapSpritesByRegion();
  setMode("idle");
  draw();
};

savePngBtn.onclick = ()=>{
  const a = document.createElement("a");
  a.download = "board.png";
  a.href = canvas.toDataURL("image/png");
  a.click();
};

// === 互動事件 ===

// mousedown：左鍵開始對應模式；點到物件才進入拖曳
canvas.addEventListener("mousedown", (e)=>{
  const { x, y } = screenToWorld(e);

  if (e.button !== 0) return; // 只處理左鍵

  if (mode === "drawLine"){
    if (!lineStart){ lineStart = { x, y }; previewLine = null; }
    return;
  }
  if (mode === "freehand"){
    isDrawingFree = true;
    freePoints = [{ x, y }];
    draw();
    return;
  }
  if (mode === "eraser"){
    isErasing = true;
    const idx = nearestLineIndex(objects.lines, x, y);
    if (idx >= 0){ objects.lines.splice(idx, 1); draw(); }
    return;
  }

  // 拖曳僅在點到物件時啟動
  const hit = hitTest(objects, x, y);
  if (hit){
    dragTarget = hit;
    const list = pickList(hit);
    const obj = list[hit.idx];
    dragOffset.x = x - obj.x;
    dragOffset.y = y - obj.y;
    mode = "drag";
  } else {
    mode = "idle";
  }
});

// mousemove：依模式即時更新
canvas.addEventListener("mousemove", (e)=>{
  const { x, y } = screenToWorld(e);

  if (mode === "eraser" && isErasing){
    const idx = nearestLineIndex(objects.lines, x, y);
    if (idx >= 0){ objects.lines.splice(idx, 1); draw(); }
    return;
  }

  if (mode === "drawLine" && lineStart){
    previewLine = { x1: lineStart.x, y1: lineStart.y, x2: x, y2: y, color: selectedLineColor, arrow: arrowType.value };
    draw();
    return;
  }

  if (mode === "freehand" && isDrawingFree){
    freePoints.push({ x, y });
    draw();
    return;
  }

  if (mode === "drag" && dragTarget){
    const list = pickList(dragTarget);
    const obj = list[dragTarget.idx];
    obj.x = x - dragOffset.x;
    obj.y = y - dragOffset.y;
    draw();
    return;
  }
});

// mouseup：收尾各模式
canvas.addEventListener("mouseup", (e)=>{
  const { x, y } = screenToWorld(e);

  if (mode === "drawLine" && lineStart){
    objects.lines.push({ x1: lineStart.x, y1: lineStart.y, x2: x, y2: y, color: selectedLineColor, arrow: arrowType.value });
    lineStart = null;
    previewLine = null;
    draw();
    return;
  }

  if (mode === "freehand" && isDrawingFree){
    if (freePoints.length > 1) objects.lines.push({ kind: "free", points: freePoints.slice(), color: selectedLineColor });
    isDrawingFree = false;
    freePoints = [];
    draw();
    return;
  }

  if (mode === "eraser" && isErasing){
    isErasing = false;
    return;
  }

  if (mode === "drag"){
    mode = "idle";
    dragTarget = null;
    return;
  }
});

// 滑出畫布時，結束拖曳／自由畫／橡皮擦預防卡住
canvas.addEventListener("mouseleave", ()=>{
  if (mode === "drag"){ mode = "idle"; dragTarget = null; }
  if (mode === "freehand"){ isDrawingFree = false; freePoints = []; }
  if (mode === "eraser"){ isErasing = false; }
  previewLine = null;
});

// 右鍵刪除
canvas.addEventListener("contextmenu", (e)=>{
  e.preventDefault();
  const { x, y } = screenToWorld(e);
  const hit = hitTest(objects, x, y);
  if (hit){
    const list = pickList(hit);
    list.splice(hit.idx, 1);
    draw();
  }
});

// 雙擊改標記文字
canvas.addEventListener("dblclick", (e)=>{
  const { x, y } = screenToWorld(e);
  const hit = hitTest(objects, x, y);
  if (hit && hit.type === "marker"){
    const m = objects.markers[hit.idx];
    const t = prompt("輸入標記數字：", m.text ?? "");
    if (t !== null){ m.text = t; draw(); }
  }
});

// 小工具
function pickList(hit){
  if (hit.type === "tower") return objects.towers;
  if (hit.type === "flag")  return objects.flags;
  return objects.markers;
}
