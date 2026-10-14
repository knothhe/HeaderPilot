import { describe, expect, it } from 'vitest';
import { activeProfile, createDefaultState, createHeader, createProfile } from '../lib/model';
import { buildRules } from '../lib/rules';

function configured() {
  const state = createDefaultState();
  state.enabled = true;
  activeProfile(state).headers.push({ ...createHeader(), name: 'Authorization', value: 'Bearer test' });
  return state;
}

describe('Chrome declarative header rules', () => {
  it('sets a header to add it or replace its existing value', () => {
    const rules = buildRules(configured());
    expect(rules).toHaveLength(1);
    expect(rules[0]!.action).toEqual({
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'authorization', operation: 'set', value: 'Bearer test' }],
    });
    expect(rules[0]!.condition.resourceTypes).toEqual(expect.arrayContaining(['main_frame', 'xmlhttprequest']));
  });

  it('clears all rules while globally paused', () => {
    const state = configured();
    state.enabled = false;
    expect(buildRules(state)).toEqual([]);
  });

  it('clears rules when the active profile is empty', () => {
    const state = configured();
    activeProfile(state).headers = [];
    expect(buildRules(state)).toEqual([]);
  });

  it('omits individual disabled headers', () => {
    const state = configured();
    activeProfile(state).headers[0]!.enabled = false;
    expect(buildRules(state)).toEqual([]);
  });

  it('only applies the selected profile', () => {
    const state = configured();
    const other = createProfile('Staging');
    other.headers.push({ ...createHeader(), name: 'X-Environment', value: 'staging' });
    state.profiles.push(other);
    state.activeProfileId = other.id;
    expect(buildRules(state)[0]!.action.requestHeaders).toEqual([
      { header: 'x-environment', operation: 'set', value: 'staging' },
    ]);
  });

  it('places response operations in responseHeaders and omits remove values', () => {
    const state = configured();
    activeProfile(state).headers.push({ ...createHeader(), name: 'X-Frame-Options', operation: 'remove', target: 'response' });
    expect(buildRules(state)[0]!.action.responseHeaders).toEqual([
      { header: 'x-frame-options', operation: 'remove' },
    ]);
  });

  it('preserves empty values for set operations', () => {
    const state = configured();
    activeProfile(state).headers[0]!.value = '';
    expect(buildRules(state)[0]!.action.requestHeaders?.[0]).toEqual({ header: 'authorization', operation: 'set', value: '' });
  });

  it('applies a trimmed Chrome URL filter', () => {
    const state = configured();
    activeProfile(state).urlFilter = ' ||api.example.com^ ';
    expect(buildRules(state)[0]!.condition.urlFilter).toBe('||api.example.com^');
  });

  it('omits the URL condition for the all-sites profile', () => {
    expect(buildRules(configured())[0]!.condition).not.toHaveProperty('urlFilter');
  });
});
