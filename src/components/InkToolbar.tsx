import { ink, useInk, type InkMode } from '../hooks/useInk';
import { INK_COLORS, INK_SIZES, type Surface } from '../lib/ink';
import { Icon, type IconName } from './Icon';

const MODES: Array<[InkMode, IconName, string]> = [
  ['pen', 'pen', 'Kalem'],
  ['marker', 'marker', 'Fosforlu kalem'],
  ['arrow', 'arrowShape', 'Ok'],
  ['line', 'line', 'Çizgi'],
  ['rect', 'rect', 'Dikdörtgen'],
  ['ellipse', 'ellipse', 'Elips'],
  ['laser', 'laser', 'Lazer işaretçi'],
  ['eraser', 'eraser', 'Silgi'],
];

const COLOR_NAMES: Record<string, string> = {
  '#ff3b30': 'Kırmızı',
  '#ff9500': 'Turuncu',
  '#ffcc00': 'Sarı',
  '#34c759': 'Yeşil',
  '#0a84ff': 'Mavi',
  '#af52de': 'Mor',
  '#ffffff': 'Beyaz',
  '#1d1d1f': 'Siyah',
};

/**
 * Tools for drawing on the screen in focus. `compact` (pop-out window) keeps
 * the essentials on one row.
 */
export function InkToolbar({ surface, compact = false }: { surface: Surface; compact?: boolean }) {
  const { mode, color, size, strokes } = useInk();
  const modes = compact ? MODES.filter(([m]) => ['pen', 'arrow', 'rect', 'laser', 'eraser'].includes(m)) : MODES;
  const colors = compact ? INK_COLORS.slice(0, 5) : INK_COLORS;
  const usesColor = mode !== 'laser' && mode !== 'eraser';

  return (
    <div className={`glass ink-tools${compact ? ' compact' : ''}`} role="toolbar" aria-label="Çizim araçları" data-testid="ink-tools">
      <div className="ink-group">
        {modes.map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            className={`ink-btn${mode === id ? ' active' : ''}`}
            onClick={() => ink.setMode(id)}
            aria-pressed={mode === id}
            aria-label={label}
            title={label}
            data-testid={`ink-mode-${id}`}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <span className="ink-sep" aria-hidden="true" />
      <div className={`ink-group colors${usesColor ? '' : ' dim'}`} role="group" aria-label="Renk">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className={`ink-swatch${color === c ? ' active' : ''}`}
            style={{ background: c }}
            onClick={() => ink.setColor(c)}
            aria-pressed={color === c}
            aria-label={COLOR_NAMES[c] ?? c}
            title={COLOR_NAMES[c] ?? c}
          />
        ))}
      </div>
      {!compact && (
        <>
          <span className="ink-sep" aria-hidden="true" />
          <div className={`ink-group${usesColor ? '' : ' dim'}`} role="group" aria-label="Kalınlık">
            {INK_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className={`ink-btn size${size === s ? ' active' : ''}`}
                onClick={() => ink.setSize(s)}
                aria-pressed={size === s}
                aria-label={['İnce', 'Orta', 'Kalın'][s - 1]}
                title={['İnce', 'Orta', 'Kalın'][s - 1]}
              >
                <span className="ink-dot" style={{ width: 3 + s * 3, height: 3 + s * 3 }} />
              </button>
            ))}
          </div>
        </>
      )}
      <span className="ink-sep" aria-hidden="true" />
      <div className="ink-group">
        <button type="button" className="ink-btn" onClick={() => ink.undo()} disabled={!ink.canUndo} aria-label="Geri al (Ctrl+Z)" title="Geri al (Ctrl+Z)" data-testid="ink-undo">
          <Icon name="undo" />
        </button>
        <button
          type="button"
          className="ink-btn"
          onClick={() => ink.clear(surface)}
          disabled={!strokes[surface].length}
          aria-label="Bu ekrandaki tüm çizimleri sil"
          title="Tümünü sil"
          data-testid="ink-clear"
        >
          <Icon name="trash" />
        </button>
        <button type="button" className="ink-btn" onClick={() => ink.setActive(false)} aria-label="Çizimi kapat (Esc)" title="Çizimi kapat (Esc)">
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
