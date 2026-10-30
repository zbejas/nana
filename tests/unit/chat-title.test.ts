import { describe, expect, test } from 'bun:test';
import { cleanChatTitle, stripTitleEmoji } from '../../src/lib/ai/title';

describe('chat title cleanup', () => {
  test('removes leading and embedded emoji', () => {
    expect(stripTitleEmoji('🗑️ Delete Unsaved Probe Note')).toBe('Delete Unsaved Probe Note');
    expect(stripTitleEmoji('Delete 🗑️ Unsaved Note')).toBe('Delete Unsaved Note');
    expect(stripTitleEmoji('🚀 Launch plan 🎉')).toBe('Launch plan');
  });

  test('removes flags, keycaps, and joined emoji', () => {
    expect(stripTitleEmoji('🇯🇵 Trip planning')).toBe('Trip planning');
    expect(stripTitleEmoji('1️⃣ First step')).toBe('First step');
    expect(stripTitleEmoji('🏳️‍🌈 Pride notes')).toBe('Pride notes');
  });

  test('preserves ordinary numbers, punctuation, and words', () => {
    expect(stripTitleEmoji('2026 Q4 plan')).toBe('2026 Q4 plan');
    expect(stripTitleEmoji('C++ performance notes')).toBe('C++ performance notes');
  });

  test('falls back when the title is only decoration', () => {
    expect(stripTitleEmoji('🗑️')).toBe('New chat');
    expect(stripTitleEmoji('  —  ')).toBe('New chat');
    expect(cleanChatTitle('', 'Untitled chat')).toBe('Untitled chat');
  });

  test('clamps clean titles to the persisted field limit', () => {
    expect(cleanChatTitle('🗑️ ' + 'a'.repeat(200)).length).toBe(120);
  });
});
