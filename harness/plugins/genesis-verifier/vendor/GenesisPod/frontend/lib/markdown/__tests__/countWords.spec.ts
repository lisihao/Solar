import { countWords } from '../countWords';

describe('countWords', () => {
  it('returns 0 for null/undefined/empty', () => {
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
    expect(countWords('')).toBe(0);
  });

  it('counts each CJK character as 1', () => {
    expect(countWords('你好')).toBe(2);
    expect(countWords('中文字符')).toBe(4);
  });

  it('counts each contiguous Latin word as 1', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('one  two   three')).toBe(3);
  });

  it('mixes CJK and English correctly', () => {
    // 我(1) + use(1) + Python(1) + 编(1) + 程(1) = 5
    expect(countWords('我 use Python 编程')).toBe(5);
  });

  it('ignores punctuation and numbers', () => {
    expect(countWords('123,456.789')).toBe(0);
    expect(countWords('你好！')).toBe(2);
  });

  it('ignores markdown/LaTeX syntax characters but counts embedded letters', () => {
    // T(1) + x(1) + 公(1) + 式(1) = 4
    expect(countWords('$T_{x}$ 公式')).toBe(4);
    // bold(1) + CJK(1) + 中(1) + 文(1) = 4
    expect(countWords('**bold** CJK中文')).toBe(4);
  });
});
