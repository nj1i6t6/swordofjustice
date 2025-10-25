// 初始狀態：直接使用你的座標（A=左半、B=右半）
// 這裡預設 A區=藍、B區=紅；之後在 board.js 可一鍵切換

export function blankState() {
  return { towers: [], flags: [], markers: [], lines: [], shapes: [], texts: [] };
}

export function defaultDeploy(width, height) {
  const s = blankState();

  // 旗
  s.flags = [
    { x: 150,  y: 373, sprite: "flag_blue" },  // 旗 A
    { x: 1125, y: 400, sprite: "flag_red"  },  // 旗 B
  ];

  // 塔
  s.towers = [
    // A 區塔（藍）
    { x: 156, y: 305 , sprite:"tower_blue"},
    { x: 279, y: 164 , sprite:"tower_blue"},
    { x: 504, y: 99  , sprite:"tower_blue"},
    { x: 225, y: 374 , sprite:"tower_blue"},
    { x: 350, y: 379 , sprite:"tower_blue"},
    { x: 514, y: 393 , sprite:"tower_blue"},
    { x: 147, y: 445 , sprite:"tower_blue"},
    { x: 280, y: 576 , sprite:"tower_blue"},
    { x: 491, y: 639 , sprite:"tower_blue"},




    // B 區塔（紅）
    { x: 1053, y: 331 , sprite:"tower_red"},
    { x: 997,  y: 400 , sprite:"tower_red"},
    { x: 1056, y: 473 , sprite:"tower_red"},
    { x: 924,  y: 605 , sprite:"tower_red"},
    { x: 868,  y: 392 , sprite:"tower_red"},
    { x: 936,  y: 179 , sprite:"tower_red"},
    { x: 721,  y: 105 , sprite:"tower_red"},
    { x: 708,  y: 393 , sprite:"tower_red"},
    { x: 716,  y: 642 , sprite:"tower_red"},

  ];

 
  return s;
}
