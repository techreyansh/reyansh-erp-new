import { inferMediaCategory } from './waMediaService';

describe('inferMediaCategory', () => {
  test('images', () => {
    expect(inferMediaCategory('image/jpeg')).toBe('image');
    expect(inferMediaCategory('image/png')).toBe('image');
  });

  test('videos', () => {
    expect(inferMediaCategory('video/mp4')).toBe('video');
  });

  test('audio', () => {
    expect(inferMediaCategory('audio/ogg')).toBe('audio');
  });

  test('documents (pdf, word, excel)', () => {
    expect(inferMediaCategory('application/pdf')).toBe('document');
    expect(inferMediaCategory('application/msword')).toBe('document');
    expect(inferMediaCategory('application/vnd.ms-excel')).toBe('document');
  });

  test('unknown/missing mime type falls back to other', () => {
    expect(inferMediaCategory('application/octet-stream')).toBe('other');
    expect(inferMediaCategory(null)).toBe('other');
    expect(inferMediaCategory(undefined)).toBe('other');
  });
});
