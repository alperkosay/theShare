import { describe, expect, it } from 'vitest';
import { containRect, hitStroke, MAX_POINTS, parseStroke, roundCoord, type Stroke } from '../../src/lib/ink';
import { parseControl } from '../../src/lib/transfer/protocol';

const pen: Stroke = { id: 'a1', tool: 'pen', color: '#ff3b30', size: 2, pts: [0.1, 0.1, 0.5, 0.5] };

describe('parseStroke', () => {
  it('accepts paths and two-point shapes', () => {
    expect(parseStroke(pen)).toEqual(pen);
    expect(parseStroke({ ...pen, tool: 'arrow' })).toEqual({ ...pen, tool: 'arrow' });
    expect(parseStroke({ ...pen, pts: [0.5, 0.5] })).not.toBeNull();
  });

  it('rejects malformed or oversized strokes', () => {
    const bad = [
      null,
      { ...pen, id: 'has space' },
      { ...pen, tool: 'text' },
      { ...pen, color: 'red' },
      { ...pen, color: '#fff' },
      { ...pen, size: 4 },
      { ...pen, pts: [0.1] },
      { ...pen, pts: [0.1, 'x'] },
      { ...pen, pts: [0.1, 5] },
      { ...pen, pts: [0.1, Number.NaN] },
      { ...pen, tool: 'rect', pts: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] },
      { ...pen, pts: Array(MAX_POINTS * 2 + 2).fill(0.5) },
    ];
    for (const s of bad) expect(parseStroke(s), JSON.stringify(s)?.slice(0, 80)).toBeNull();
  });

  it('travels inside ink control messages, with the target screen', () => {
    expect(parseControl(JSON.stringify({ t: 'ink', on: 'yours', op: 'put', stroke: pen }))).toEqual({ t: 'ink', on: 'yours', op: 'put', stroke: pen });
    expect(parseControl('{"t":"ink","on":"mine","op":"del","id":"a1"}')).toEqual({ t: 'ink', on: 'mine', op: 'del', id: 'a1' });
    expect(parseControl('{"t":"ink","on":"mine","op":"clear"}')).toEqual({ t: 'ink', on: 'mine', op: 'clear' });
    expect(parseControl('{"t":"point","on":"yours","x":0.25,"y":0.75}')).toEqual({ t: 'point', on: 'yours', x: 0.25, y: 0.75 });
    for (const text of [
      '{"t":"ink","on":"both","op":"clear"}',
      '{"t":"ink","on":"mine","op":"put","stroke":{}}',
      '{"t":"ink","on":"mine","op":"burn"}',
      '{"t":"point","on":"mine","x":9,"y":0}',
    ]) {
      expect(parseControl(text), text).toBeNull();
    }
  });
});

describe('geometry', () => {
  it('places the picture like object-fit: contain', () => {
    expect(containRect(1000, 500, 16 / 10)).toEqual({ x: 100, y: 0, w: 800, h: 500 });
    expect(containRect(800, 800, 2)).toEqual({ x: 0, y: 200, w: 800, h: 400 });
  });

  it('rounds coordinates to four decimals', () => {
    expect(roundCoord(0.123456)).toBe(0.1235);
  });

  it('finds the topmost stroke near a point, on paths and shape outlines', () => {
    const rect: Stroke = { ...pen, id: 'r', tool: 'rect', pts: [0.6, 0.6, 0.9, 0.9] };
    const strokes = [pen, rect];
    expect(hitStroke(strokes, 0.3, 0.3, 0.01)?.id).toBe('a1');
    expect(hitStroke(strokes, 0.6, 0.75, 0.01)?.id).toBe('r');
    // Inside the rectangle but away from its edges: not a hit.
    expect(hitStroke(strokes, 0.75, 0.75, 0.01)).toBeNull();
    expect(hitStroke(strokes, 0.1, 0.9, 0.01)).toBeNull();
  });
});
