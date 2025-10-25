// ====== objects.js ======
import {
  DEFAULT_STROKE_WIDTH,
  TEXT_HITBOX_HEIGHT_RATIO,
  TEXT_LINE_HEIGHT_RATIO,
} from "./constants.js";

export const SPRITES = {
  tower_blue: new Image(),
  tower_red:  new Image(),
  flag_blue:  new Image(),
  flag_red:   new Image(),
};
export const BG = new Image();
export const DEFAULT_BG_SRC = "static/img/map_clean.jpg";

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
// 瀏覽器是從 index.html 的位置來解析 .src 路徑
// 因此路徑必須是 'static/img/...'
export function loadImages() {
  SPRITES.tower_blue.src = "static/img/tower_blue.png";
  SPRITES.tower_red.src  = "static/img/tower_red.png";
  SPRITES.flag_blue.src  = "static/img/flag_blue.png";
  SPRITES.flag_red.src   = "static/img/flag_red.png";
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

export function drawShape(ctx, shape) {
  const {
    type,
    x,
    y,
    width,
    height,
    color,
    strokeWidth = DEFAULT_STROKE_WIDTH,
    dash = [],
  } = shape;
  if (!width || !height) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.setLineDash(dash);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (type === "circle") {
    const rx = Math.abs(width) / 2;
    const ry = Math.abs(height) / 2;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const w = Math.abs(width);
    const h = Math.abs(height);
    ctx.strokeRect(x - w / 2, y - h / 2, w, h);
  }
  ctx.restore();
}

function getNoteFont(fontSize) {
  return `600 ${fontSize}px system-ui, sans-serif`;
}

export function drawTextNote(ctx, note) {
  const { x, y, text = "", color = "#ffffff", fontSize = 18, align = "left" } = note;
  ctx.save();
  ctx.fillStyle = color;
  const font = getNoteFont(fontSize);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  const padding = 4;
  if (note.background) {
    const metrics = ctx.measureText(text);
    const lineHeight = fontSize * TEXT_LINE_HEIGHT_RATIO;
    const w = metrics.width + padding * 2;
    const h = lineHeight + padding * 2;
    const drawX = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
    ctx.fillStyle = note.background;
    ctx.globalAlpha = 0.2;
    ctx.fillRect(drawX, y - padding, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}


// === 命中測試 ===
// 讓塔與旗整張繪製矩形都可被拖曳／右鍵刪除
export function hitTest(ctx, objects, x, y) {
  const markers = objects.markers ?? [];
  const flags = objects.flags ?? [];
  const towers = objects.towers ?? [];
  const shapes = objects.shapes ?? [];
  const texts = objects.texts ?? [];

  const prevFont = ctx.font;
  try {
    for (let i = texts.length - 1; i >= 0; i--) {
      const note = texts[i];
      const fontSize = note.fontSize ?? 18;
      const content = note.text ?? "";
      ctx.font = getNoteFont(fontSize);
      const width = Math.max(ctx.measureText(content).width, 1);
      const height = fontSize * TEXT_HITBOX_HEIGHT_RATIO;
      let left;
      if (note.align === "center") {
        left = note.x - width / 2;
      } else if (note.align === "right") {
        left = note.x - width;
      } else {
        left = note.x;
      }
      const top = note.y;
      if (x >= left && x <= left + width && y >= top && y <= top + height) {
        return { type: "text", idx: i };
      }
    }
  } finally {
    ctx.font = prevFont;
  }

  // 標記（修正命中偏移）
  for (let i = markers.length - 1; i >= 0; i--) {
    const m = markers[i];
    const r = 18; // 命中半徑，可調整（建議略大於繪製半徑）

    // 🔹 若畫面上實際命中點偏上，可將 hitbox 向下平移幾個像素
    const offsetY = 5; // ↓ 正值代表向下修正命中區域
    const dx = m.x - x;
    const dy = (m.y + offsetY) - y; // 加上 offset 修正整個 hit 區域
    
    if (dx * dx + dy * dy <= r * r) {
      return { type: "marker", idx: i };
    }
  }



  // 形狀
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    const w = Math.abs(s.width ?? 0);
    const h = Math.abs(s.height ?? 0);
    if (!w || !h) continue;
    if (s.type === "circle") {
      const rx = w / 2;
      const ry = h / 2;
      const dx = (x - s.x) / rx;
      const dy = (y - s.y) / ry;
      if (dx * dx + dy * dy <= 1.1) {
        return { type: "shape", idx: i };
      }
    } else {
      const left = s.x - w / 2;
      const top = s.y - h / 2;
      if (x >= left && x <= left + w && y >= top && y <= top + h) {
        return { type: "shape", idx: i };
      }
    }
  }

  // 旗
  for (let i = flags.length - 1; i >= 0; i--) {
    const f = flags[i];
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



// 塔
  for (let i = towers.length - 1; i >= 0; i--) {
    const t = towers[i];
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
