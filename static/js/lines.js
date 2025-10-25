// 畫線與箭頭、線段距離、擦除（支援自由曲線 polyline）
import {
  ARROW_HEAD_SIZE_MULTIPLIER,
  DEFAULT_STROKE_WIDTH,
  MIN_ARROW_HEAD_SIZE,
} from "./constants.js";

export function drawArrowLine(
  ctx,
  x1,
  y1,
  x2,
  y2,
  color,
  arrow,
  width = DEFAULT_STROKE_WIDTH,
  dash = []
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  const head = (fx, fy, tx, ty) => {
    const angle = Math.atan2(ty - fy, tx - fx);
    const arrowSize = Math.max(
      MIN_ARROW_HEAD_SIZE,
      (width ?? DEFAULT_STROKE_WIDTH) * ARROW_HEAD_SIZE_MULTIPLIER
    );
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(
      tx - arrowSize * Math.cos(angle - Math.PI / 6),
      ty - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      tx - arrowSize * Math.cos(angle + Math.PI / 6),
      ty - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  if (arrow === "right" || arrow === "both") head(x1, y1, x2, y2);
  if (arrow === "left" || arrow === "both") head(x2, y2, x1, y1);

  ctx.restore();
}

export function drawPolyline(
  ctx,
  points,
  color,
  width = DEFAULT_STROKE_WIDTH,
  dash = []
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

// 點到線段距離
export function pointToSegDist(px,py, x1,y1,x2,y2) {
  const A = px - x1, B = py - y1, C = x2 - x1, D = y2 - y1;
  const dot = A*C + B*D, len = C*C + D*D;
  let t = len ? (dot/len) : -1;
  t = Math.max(0, Math.min(1, t));
  const nx = x1 + C*t, ny = y1 + D*t;
  const dx = px - nx, dy = py - ny;
  return Math.sqrt(dx*dx + dy*dy);
}

export function pointToPolylineDist(px,py, points) {
  let best = Infinity;
  for (let i=0;i<points.length-1;i++) {
    const p1 = points[i], p2 = points[i+1];
    const d = pointToSegDist(px,py, p1.x,p1.y, p2.x,p2.y);
    if (d < best) best = d;
  }
  return best;
}

export function nearestLineIndex(lines, x, y, threshold = 8) {
  let best = -1, bestD = Infinity;
  lines.forEach((ln, i) => {
    let d;
    if (ln.kind === "free") {
      d = pointToPolylineDist(x,y, ln.points || []);
    } else {
      d = pointToSegDist(x,y, ln.x1,ln.y1, ln.x2,ln.y2);
    }
    const reach = Math.max(
      threshold,
      (ln.width ?? DEFAULT_STROKE_WIDTH) * 1.2
    );
    if (d <= reach && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
