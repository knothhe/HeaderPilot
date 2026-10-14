import { describe, expect, it } from 'vitest';
import { activeProfile, createDefaultState, createHeader, createProfile, validateState } from '../lib/model';

function withHeader() {
  const state = createDefaultState();
  activeProfile(state).headers.push({ ...createHeader(), name: 'X-Environment', value: 'development' });
  return state;
}

describe('configuration validation', () => {
  it('starts paused with an empty default profile', () => {
    const state = createDefaultState();
    expect(state.enabled).toBe(false);
    expect(activeProfile(state).headers).toEqual([]);
    expect(() => validateState(state)).not.toThrow();
  });

  it.each(['X-Token', 'Authorization', 'x-api-key', 'Sec-CH-UA', 'x_test'])('accepts valid header name %s', (name) => {
    const state = withHeader();
    activeProfile(state).headers[0]!.name = name;
    expect(() => validateState(state)).not.toThrow();
  });

  it.each(['', 'X Bad', 'X:Bad', '头部', 'X\r\nInjected'])('rejects invalid header name %s', (name) => {
    const state = withHeader();
    activeProfile(state).headers[0]!.name = name;
    expect(() => validateState(state)).toThrow('无效 Header');
  });

  it.each(['hello\r\nInjected: yes', 'hello\nworld', '\0', '中文', '\x7f'])('rejects invalid header value %s', (value) => {
    const state = withHeader();
    activeProfile(state).headers[0]!.value = value;
    expect(() => validateState(state)).toThrow('无效 Header');
  });

  it('accepts an empty value and horizontal tabs', () => {
    const state = withHeader();
    activeProfile(state).headers[0]!.value = '';
    expect(() => validateState(state)).not.toThrow();
    activeProfile(state).headers[0]!.value = 'a\tb';
    expect(() => validateState(state)).not.toThrow();
  });

  it('rejects case-insensitive duplicates in the same direction', () => {
    const state = withHeader();
    activeProfile(state).headers.push({ ...createHeader(), name: 'x-environment' });
    expect(() => validateState(state)).toThrow('重复');
  });

  it('allows request and response headers to share a name', () => {
    const state = withHeader();
    activeProfile(state).headers.push({ ...createHeader(), name: 'x-environment', target: 'response' });
    expect(() => validateState(state)).not.toThrow();
  });

  it('ignores disabled headers when detecting active name conflicts', () => {
    const state = withHeader();
    activeProfile(state).headers.push({ ...createHeader(), name: 'x-environment', enabled: false });
    expect(() => validateState(state)).not.toThrow();
  });

  it('rejects duplicate profile names after trimming and case normalization', () => {
    const state = withHeader();
    state.profiles.push(createProfile(' default '));
    expect(() => validateState(state)).toThrow('不能重复');
  });

  it('rejects a missing active profile', () => {
    const state = withHeader();
    state.activeProfileId = 'missing';
    expect(() => validateState(state)).toThrow('不存在');
  });

  it.each([null, {}, { version: 2 }, { version: 1, profiles: [] }])('rejects corrupt stored data', (value) => {
    expect(() => validateState(value)).toThrow();
  });
});
