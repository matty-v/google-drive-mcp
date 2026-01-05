import { describe, it, expect } from 'vitest';
import { generateSecureToken, hashCodeVerifier } from '../../../src/oauth/helpers.js';

describe('oauth/helpers', () => {
  describe('generateSecureToken', () => {
    it('returns a hex string of default length (64 chars for 32 bytes)', () => {
      const token = generateSecureToken();
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns correct length for custom byte count', () => {
      const token = generateSecureToken(16);
      expect(token).toMatch(/^[a-f0-9]{32}$/);
    });

    it('generates unique tokens each call', () => {
      const token1 = generateSecureToken();
      const token2 = generateSecureToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashCodeVerifier', () => {
    it('produces valid base64url output', () => {
      const hash = hashCodeVerifier('test-verifier');
      // base64url uses only alphanumeric, hyphen, and underscore (no + or /)
      expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('produces consistent hash for same input', () => {
      const hash1 = hashCodeVerifier('same-input');
      const hash2 = hashCodeVerifier('same-input');
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different inputs', () => {
      const hash1 = hashCodeVerifier('input-one');
      const hash2 = hashCodeVerifier('input-two');
      expect(hash1).not.toBe(hash2);
    });

    it('matches expected SHA256 base64url for known input', () => {
      // SHA256 of "test" in base64url
      const hash = hashCodeVerifier('test');
      expect(hash).toBe('n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg');
    });
  });
});
