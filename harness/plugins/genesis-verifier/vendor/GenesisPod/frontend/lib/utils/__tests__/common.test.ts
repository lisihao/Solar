import { describe, it, expect } from 'vitest';
import { cn, safeString } from '../common';

describe('cn', () => {
  it('should return a single class unchanged', () => {
    expect(cn('foo')).toBe('foo');
  });

  it('should merge multiple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('should handle conditional classes (falsy omitted)', () => {
    expect(cn('base', false && 'skip', 'end')).toBe('base end');
  });

  it('should handle undefined and null inputs', () => {
    expect(cn('a', undefined, null, 'b')).toBe('a b');
  });

  it('should merge conflicting Tailwind classes (last wins)', () => {
    // tailwind-merge ensures p-4 overrides p-2
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('should handle object syntax from clsx', () => {
    expect(cn({ 'text-red-500': true, 'text-blue-500': false })).toBe(
      'text-red-500'
    );
  });

  it('should handle array syntax', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });

  it('should return empty string when no classes provided', () => {
    expect(cn()).toBe('');
  });

  it('should handle Tailwind modifier conflicts', () => {
    // tailwind-merge keeps the last text-* class
    const result = cn('text-sm', 'text-lg');
    expect(result).toBe('text-lg');
  });
});

describe('safeString', () => {
  it('should return empty string for null', () => {
    expect(safeString(null)).toBe('');
  });

  it('should return empty string for undefined', () => {
    expect(safeString(undefined)).toBe('');
  });

  it('should return the string itself for string values', () => {
    expect(safeString('hello')).toBe('hello');
  });

  it('should return empty string for empty string', () => {
    expect(safeString('')).toBe('');
  });

  it('should convert number to string', () => {
    expect(safeString(42)).toBe('42');
    expect(safeString(0)).toBe('0');
    expect(safeString(-3.14)).toBe('-3.14');
  });

  it('should convert boolean true to string', () => {
    expect(safeString(true)).toBe('true');
  });

  it('should convert boolean false to string', () => {
    expect(safeString(false)).toBe('false');
  });

  it('should extract .message from objects', () => {
    expect(safeString({ message: 'error occurred' })).toBe('error occurred');
  });

  it('should prefer .message over other fields', () => {
    expect(safeString({ message: 'msg', content: 'cnt', text: 'txt' })).toBe(
      'msg'
    );
  });

  it('should extract .content when no .message', () => {
    expect(safeString({ content: 'my content' })).toBe('my content');
  });

  it('should extract .text when no .message or .content', () => {
    expect(safeString({ text: 'my text' })).toBe('my text');
  });

  it('should extract .result when no .message, .content, or .text', () => {
    expect(safeString({ result: 'my result' })).toBe('my result');
  });

  it('should skip non-string .message fields and continue to .content', () => {
    expect(safeString({ message: 42, content: 'content here' })).toBe(
      'content here'
    );
  });

  it('should JSON.stringify objects without known text fields', () => {
    const obj = { id: 1, name: 'test' };
    expect(safeString(obj)).toBe(JSON.stringify(obj));
  });

  it('should return [Object] for circular objects that cannot be stringified', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(safeString(circular)).toBe('[Object]');
  });

  it('should handle Error objects via .message field', () => {
    const err = new Error('something broke');
    expect(safeString(err)).toBe('something broke');
  });

  it('should handle arrays by JSON.stringify', () => {
    expect(safeString([1, 2, 3])).toBe('[1,2,3]');
  });

  it('should handle nested objects without text fields via stringify', () => {
    const obj = { nested: { value: true } };
    expect(safeString(obj)).toBe(JSON.stringify(obj));
  });
});
