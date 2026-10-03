import { describe, expect, it } from 'vitest';
import { devModeFrom } from '../../src/app/dev';

/**
 * The developer-mode switch, which is a URL parameter and nothing else.
 *
 * These cases are the whole contract of `?dev`: it is on when the parameter is
 * there, off when it is not, and it can be written off EXPLICITLY -- a link that
 * says "not in dev mode" is as useful as one that says it is, and neither should
 * require the reader to know that absence means off.
 */
describe('developer mode from the URL', () => {
  it('is off when the parameter is absent', () => {
    expect(devModeFrom('')).toBe(false);
    expect(devModeFrom('?level=12')).toBe(false);
    expect(devModeFrom('?developer=1')).toBe(false);
  });

  it('is on for a bare parameter or any truthy value', () => {
    expect(devModeFrom('?dev')).toBe(true);
    expect(devModeFrom('?dev=')).toBe(true);
    expect(devModeFrom('?dev=1')).toBe(true);
    expect(devModeFrom('?dev=true')).toBe(true);
    expect(devModeFrom('?a=1&dev=2&b=3')).toBe(true);
  });

  it('is off for a value that says so', () => {
    expect(devModeFrom('?dev=0')).toBe(false);
    expect(devModeFrom('?dev=false')).toBe(false);
    expect(devModeFrom('?dev=FALSE')).toBe(false);
  });
});
