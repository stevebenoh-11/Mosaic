import { describe, expect, it } from 'vitest';
import { normalizeUrl } from './createFromMedia';

describe('normalizeUrl', () => {
  it('prepends https:// to a bare host (the main Link-tool bug)', () => {
    expect(normalizeUrl('google.com')).toBe('https://google.com/');
    expect(normalizeUrl('  example.org/path  ')).toBe('https://example.org/path');
  });

  it('keeps an already-valid http(s) URL', () => {
    expect(normalizeUrl('https://example.org/x?y=1')).toBe('https://example.org/x?y=1');
    expect(normalizeUrl('http://localhost.test')).toBe('http://localhost.test/');
  });

  it('rejects non-URL input', () => {
    expect(normalizeUrl('')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
    expect(normalizeUrl('foo')).toBeNull(); // no dot in host
  });

  it('rejects dangerous schemes', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,<script>')).toBeNull();
  });
});
