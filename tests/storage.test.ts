import { describe, it, expect } from 'vitest';
import { guessContentType, buildJobObjectPath } from '../lib/utils';

describe('storage helpers', () => {
  describe('guessContentType', () => {
    it('should return image/jpeg for .jpg files', () => {
      expect(guessContentType('photo.jpg')).toBe('image/jpeg');
      expect(guessContentType('PHOTO.JPG')).toBe('image/jpeg');
    });

    it('should return image/jpeg for .jpeg files', () => {
      expect(guessContentType('photo.jpeg')).toBe('image/jpeg');
    });

    it('should return image/png for .png files', () => {
      expect(guessContentType('image.png')).toBe('image/png');
      expect(guessContentType('IMAGE.PNG')).toBe('image/png');
    });

    it('should return image/webp for .webp files', () => {
      expect(guessContentType('photo.webp')).toBe('image/webp');
    });

    it('should return undefined for unknown extensions', () => {
      expect(guessContentType('file.txt')).toBeUndefined();
      expect(guessContentType('document.pdf')).toBeUndefined();
    });
  });

  describe('buildJobObjectPath', () => {
    it('should build correct path for job and filename', () => {
      expect(buildJobObjectPath('abc123', 'original.jpg')).toBe(
        'jobs/abc123/original.jpg',
      );
    });

    it('should strip leading slashes from filename', () => {
      expect(buildJobObjectPath('abc123', '/original.jpg')).toBe(
        'jobs/abc123/original.jpg',
      );
      expect(buildJobObjectPath('abc123', '///original.jpg')).toBe(
        'jobs/abc123/original.jpg',
      );
    });

    it('should handle different filenames', () => {
      expect(buildJobObjectPath('job-456', 'final.png')).toBe(
        'jobs/job-456/final.png',
      );
      expect(buildJobObjectPath('xyz', 'thumb.webp')).toBe(
        'jobs/xyz/thumb.webp',
      );
    });
  });
});
