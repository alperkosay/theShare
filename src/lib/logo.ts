/**
 * The app mark: a pixel-art "send" arrow pointing right, with a trail of
 * fading pixels behind it, like data streaming out. One source for the
 * in-app logo (components/Logo) and the generated icons (scripts/gen-icons.mjs).
 *
 * Coordinates are cells on a GRID×GRID board drawn inside the icon's safe
 * zone; alpha < 1 marks a trail pixel (faded, and animated in the app).
 */

export const GRID = 12;
/** Board placement in a 100×100 icon: inside the maskable safe zone (central 80%). */
export const BOARD_ORIGIN = 14;
export const CELL = (100 - 2 * BOARD_ORIGIN) / GRID;

export interface LogoPixel {
  col: number;
  row: number;
  alpha: number;
}

const ARROW: Array<[row: number, cols: number[]]> = [
  [2, [7]],
  [3, [7, 8]],
  [4, [7, 8, 9]],
  [5, [4, 5, 6, 7, 8, 9, 10]],
  [6, [4, 5, 6, 7, 8, 9, 10]],
  [7, [7, 8, 9]],
  [8, [7, 8]],
  [9, [7]],
];

/** Trail: closer to the arrow = brighter. */
const TRAIL: LogoPixel[] = [
  { col: 2, row: 5, alpha: 0.75 },
  { col: 0, row: 5, alpha: 0.35 },
  { col: 1, row: 6, alpha: 0.5 },
  { col: 4, row: 3, alpha: 0.55 },
  { col: 1, row: 3, alpha: 0.25 },
  { col: 3, row: 8, alpha: 0.5 },
  { col: 0, row: 8, alpha: 0.2 },
];

/** The art spans columns 0–10; this centres it on the 12-column board. */
const COL_OFFSET = 0.5;

export const LOGO_PIXELS: LogoPixel[] = [
  ...ARROW.flatMap(([row, cols]) => cols.map((col) => ({ col: col + COL_OFFSET, row, alpha: 1 }))),
  ...TRAIL.map((p) => ({ ...p, col: p.col + COL_OFFSET })),
];

/** Pixel position in the 100×100 icon space. */
export const pixelRect = (p: LogoPixel) => ({ x: BOARD_ORIGIN + p.col * CELL, y: BOARD_ORIGIN + p.row * CELL, size: CELL });

/** The static icon as SVG (favicon). */
export function logoSvg(background: string, foreground: string): string {
  const rects = LOGO_PIXELS.map((p) => {
    const { x, y, size } = pixelRect(p);
    const opacity = p.alpha < 1 ? ` fill-opacity="${p.alpha}"` : '';
    return `  <rect x="${x}" y="${y}" width="${size}" height="${size}"${opacity}/>`;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    `  <rect width="100" height="100" rx="24" fill="${background}"/>`,
    `  <g fill="${foreground}" shape-rendering="crispEdges">`,
    ...rects.map((r) => `  ${r}`),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}
