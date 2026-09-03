import { describe, expect, it } from 'vitest';

describe('application test environment', () => {
  it('provides a browser document', () => {
    expect(document).toBeDefined();
  });
});
