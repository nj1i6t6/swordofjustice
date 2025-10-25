// ====== objects.js ======

export const SPRITES = {
  tower_blue: new Image(),
  tower_red:  new Image(),
  flag_blue:  new Image(),
  flag_red:   new Image(),
};
export const BG = new Image();

// === 尺寸設定 ===
export const SETTINGS = {
  towerSize: 40,
  flagSize:  40,
  offset: {
    towerX: 15,
    towerY: 0,
    flagX:  0,
    flagY:  0,
  },
};

export function applySettings(partial) {
  if (!partial) return;
  Object.assign(SETTINGS, partial);
  if (partial.offset) Object.assign(SETTINGS.offset, partial.offset);
}

// === 載入圖片 ===
// [修正]
// 原路徑: /static/img/...
// 新路徑: ../img/... (因為 objects.js 在 js 資料夾, 需要先 ../ 回到 static 層, 再進入 img 層)
export function loadImages() {
  BG.src = "../img/map_clean.jpg";
  SPRITES.tower_blue.src = "../img/tower_blue.png";
  SPRITES.tower_red.src  = "../img/tower_red.png";
  SPRITES.flag_blue.src  = "../img/flag_blue.png";
  SPRITES.flag_red.src   = "../img/flag_red.png";
}

// === 繪製 ===
export function drawTower(ctx, x, y, spriteKey) {
  const img = SPRITES[spriteKey] || SPRITES.tower_blue;
  const w = SETTINGS.towerSize, h = SETTINGS.towerSize;
  const ox = SETTINGS.offset.towerX, oy = SETTINGS.offset.towerY;
  ctx.drawImage(img, x - w / 2 + ox, y - h / 2 + oy, w, h);
}

export function drawFlag(ctx, x, y, spriteKey) {
  const img = SPRITES[spriteKey] || SPRITES.flag_blue;
  const w = SETTINGS.flagSize, h = SETTINGS.flagSize * 0.85;
  const ox = SETTINGS.offset.flagX, oy = SETTINGS.offset.flagY;
  ctx.drawImage(img, x - w / 2 + ox, y - h / 2 + oy, w, h);
}

export function drawMarker(ctx, x, y, color, text) {
  const r = 14; // 🔹 標記半徑（原本是20，改小）
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = "#0b1220";
  ctx.lineWidth = 1.1;  
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#0b1220";
  ctx.font = "bold 12px system-ui, sans-serif"; // 🔹 字體跟著縮小
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text ?? "", x, y);
  ctx.restore();
}


// === 命中測試 ===
// 讓塔與旗整張繪製矩形都可被拖曳／右鍵刪除
export function hitTest(objects, x, y) {
// 1️⃣ 先測標記（修正命中偏移）
  for (let i = objects.markers.length - 1; i >= 0; i--) {
    const m = objects.markers[i];
    const r = 18; // 命中半徑，可調整（建議略大於繪製半徑）
    
    // 🔹 若畫面上實際命中點偏上，可將 hitbox 向下平移幾個像素
    const offsetY = 5; // ↓ 正值代表向下修正命中區域
    const dx = m.x - x;
    const dy = (m.y + offsetY) - y; // 加上 offset 修正整個 hit 區域
    
    if (dx * dx + dy * dy <= r * r) {
      return { type: "marker", idx: i };
    }
  }



// 2️⃣ 旗
  for (let i = objects.flags.length - 1; i >= 0; i--) {
    const f = objects.flags[i];
    const w = SETTINGS.flagSize;  // 寬度
    const h = SETTINGS.flagSize * 1.1;  // 高度（旗子的高度小於寬度）
    const ox = SETTINGS.offset.flagX;
    const oy = SETTINGS.offset.flagY +SETTINGS.flagSize * 0.3;
    const left = f.x - w / 2 + ox;
    const top = f.y - h / 2 + oy;
    if (x >= left && x <= left + w && y >= top && y <= top + h) {
      return { type: "flag", idx: i };
    }
  }



// 3️⃣ 塔
  for (let i = objects.towers.length - 1; i >= 0; i--) {
    const t = objects.towers[i];
    const w = SETTINGS.towerSize * 0.9;   // 寬略小一點
    const h = SETTINGS.towerSize * 1.1;   // 高度與實際塔身相符
    const ox = SETTINGS.offset.towerX;
    const oy = SETTINGS.offset.towerY + SETTINGS.towerSize * 0.3; // 下移 hitbox 位置
    const left = t.x - w / 2 + ox;
    const top = t.y - h / 2 + oy;
    if (x >= left && x <= left + w && y >= top && y <= top + h) {
      return { type: "tower", idx: i };
    }
  }


  return null;
}
