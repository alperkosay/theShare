import type { CSSProperties } from 'react';
import { LOGO_PIXELS, pixelRect } from '../lib/logo';

/**
 * The app mark, inline so it follows the theme (tile = ink, pixels = on-ink)
 * and the trail pixels can "flow" toward the arrow.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect className="logo-tile" width="100" height="100" rx="24" />
      <g className="logo-pixels" shapeRendering="crispEdges">
        {LOGO_PIXELS.map((p) => {
          const { x, y, size: s } = pixelRect(p);
          const trail = p.alpha < 1;
          const style = trail ? ({ '--a': p.alpha, '--c': p.col } as CSSProperties) : undefined;
          return <rect key={`${p.col}-${p.row}`} x={x} y={y} width={s} height={s} className={trail ? 'trail' : undefined} style={style} />;
        })}
      </g>
    </svg>
  );
}
