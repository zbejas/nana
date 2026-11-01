import { describe, expect, test } from 'bun:test';
import { planAiMarkdownApply } from '../../src/components/editor/milkdown/aiEdits';

describe('planAiMarkdownApply', () => {
  test('paints only when a live room already holds the fetched body', () => {
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: true,
      matchesPrevious: false,
    })).toBe('decorate');
  });

  test('waits for a live room that has not delivered the fetched body yet', () => {
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('wait');
    expect(planAiMarkdownApply({
      liveSession: true,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('wait');
  });

  test('honors an explicit decoration-only edit outside a room', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: true,
      matchesPrevious: true,
    })).toBe('decorate');
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('wait');
    expect(planAiMarkdownApply({
      liveSession: false,
      replace: false,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('wait');
  });

  test('replaces an unchanged note that still holds the event body', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: false,
      matchesPrevious: true,
    })).toBe('replace');
  });

  test('paints an already-applied fetched body without replacing it', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: true,
      matchesPrevious: false,
    })).toBe('decorate');
  });

  test('keeps local typing that diverged from the event body', () => {
    expect(planAiMarkdownApply({
      liveSession: false,
      matchesNext: false,
      matchesPrevious: false,
    })).toBe('skip');
  });
});
