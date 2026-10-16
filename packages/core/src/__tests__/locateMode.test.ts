import { describe, it, expect } from 'vitest';
import { nextLocateMode, locateModeOnUserGesture } from '../locateMode';

describe('nextLocateMode', () => {
  it('off -> follow', () => {
    expect(nextLocateMode('off', { headingSupported: true })).toBe('follow');
    expect(nextLocateMode('off', { headingSupported: false })).toBe('follow');
  });
  it('follow -> compass when heading supported', () => {
    expect(nextLocateMode('follow', { headingSupported: true })).toBe('compass');
  });
  it('follow -> off when heading not supported (skips compass)', () => {
    expect(nextLocateMode('follow', { headingSupported: false })).toBe('off');
  });
  it('compass -> follow', () => {
    expect(nextLocateMode('compass', { headingSupported: true })).toBe('follow');
  });
});

describe('locateModeOnUserGesture', () => {
  it('any mode -> off', () => {
    expect(locateModeOnUserGesture('follow')).toBe('off');
    expect(locateModeOnUserGesture('compass')).toBe('off');
    expect(locateModeOnUserGesture('off')).toBe('off');
  });
});
