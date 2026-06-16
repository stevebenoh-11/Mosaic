import { describe, expect, it } from 'vitest';
import { formatColor, hexToRgb } from './color';

describe('hexToRgb', () => {
  it('parses 6-digit and 3-digit hex', () => {
    expect(hexToRgb('#3498DB')).toEqual({ r: 52, g: 152, b: 219 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });
  it('returns null for invalid input', () => {
    expect(hexToRgb('nope')).toBeNull();
  });
});

describe('formatColor', () => {
  it('renders each display format', () => {
    expect(formatColor('#3498DB', 'hex')).toBe('#3498DB');
    expect(formatColor('#3498DB', 'rgb')).toBe('rgb(52, 152, 219)');
    expect(formatColor('#3498DB', 'hsl')).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
    expect(formatColor('#3498DB', 'off')).toBe('');
  });
  it('defaults to hex', () => {
    expect(formatColor('#abcdef')).toBe('#ABCDEF');
  });
});
