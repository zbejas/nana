import { beforeEach, describe, expect, test } from 'bun:test';

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => values.clear(),
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};

const spellcheckEvents: boolean[] = [];
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'window', {
  value: {
    dispatchEvent: (event: Event) => {
      spellcheckEvents.push((event as CustomEvent<boolean>).detail);
      return true;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  configurable: true,
});

const { DEFAULT_SPELLCHECK, getSpellcheck, setSpellcheck } = await import('../../src/lib/settings');

describe('spellcheck preference', () => {
  beforeEach(() => {
    values.clear();
    spellcheckEvents.length = 0;
  });

  test('is off by default', () => {
    expect(DEFAULT_SPELLCHECK).toBe(false);
    expect(getSpellcheck()).toBe(false);
  });

  test('round-trips the preference and notifies listeners', () => {
    setSpellcheck(true);
    expect(getSpellcheck()).toBe(true);
    expect(spellcheckEvents).toEqual([true]);

    setSpellcheck(false);
    expect(getSpellcheck()).toBe(false);
    expect(spellcheckEvents).toEqual([true, false]);
  });

  test('ignores stored values that are not booleans', () => {
    values.set('nana-spellcheck', 'sometimes');
    expect(getSpellcheck()).toBe(false);
  });
});
