import { describe, it, expect } from 'vitest';
import { sanitizeValue, setEnvLine } from '../src/config/settings.js';

// writeConfig touches the real .env, so we test the pure pieces it composes
// (allow-list + enum validation are exercised through these + the route test).
describe('runtime settings — pure logic', () => {
  it('sanitizeValue strips CR/LF so a value cannot inject another env line', () => {
    expect(sanitizeValue('local')).toBe('local');
    expect(sanitizeValue('local\nADMIN_KEY=hacked')).toBe('local ADMIN_KEY=hacked'); // collapsed, not a new line
    expect(sanitizeValue('  spaced  ')).toBe('spaced');
    expect(sanitizeValue(undefined)).toBe('');
    expect(sanitizeValue(null)).toBe('');
  });

  it('setEnvLine replaces an existing key in place', () => {
    const before = 'LLM_BACKEND=mock\nCOMB_RETRIEVAL=keyword\n';
    expect(setEnvLine(before, 'LLM_BACKEND', 'openai')).toBe('LLM_BACKEND=openai\nCOMB_RETRIEVAL=keyword\n');
  });

  it('setEnvLine appends a key that is not present', () => {
    const out = setEnvLine('LLM_BACKEND=mock\n', 'COMB_S3_VECTOR_BUCKET', 'my-bucket');
    expect(out).toContain('LLM_BACKEND=mock');
    expect(out).toMatch(/COMB_S3_VECTOR_BUCKET=my-bucket\n$/);
  });

  it('setEnvLine only touches the targeted key, not similarly-named ones', () => {
    const before = 'OPENAI_API_KEY=secret\nOPENAI_BASE_URL=https://x\n';
    const out = setEnvLine(before, 'OPENAI_API_KEY', 'new');
    expect(out).toContain('OPENAI_API_KEY=new');
    expect(out).toContain('OPENAI_BASE_URL=https://x'); // untouched
  });
});
