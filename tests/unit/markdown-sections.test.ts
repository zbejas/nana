import { describe, expect, test } from 'bun:test';
import {
  MarkdownSectionError,
  applySectionEdits,
  parseMarkdownSections,
} from '../../src/lib/markdown/sections';

const note = `# Launch plan

Intro paragraph.

## Goals

- Ship the beta
- Write docs

## Risks

### Schedule

Tight.

\`\`\`md
# Not a heading
\`\`\`

## Next steps

Follow up.`;

describe('parseMarkdownSections', () => {
  test('finds headings outside fenced code blocks', () => {
    const sections = parseMarkdownSections(note);
    expect(sections.map((section) => section.heading)).toEqual([
      'Launch plan',
      'Goals',
      'Risks',
      'Schedule',
      'Next steps',
    ]);
  });

  test('builds heading paths for nested sections', () => {
    const schedule = parseMarkdownSections(note).find((section) => section.heading === 'Schedule');
    expect(schedule?.path).toEqual(['Launch plan', 'Risks']);
    expect(schedule?.level).toBe(3);
  });

  test('keeps a preamble when the note starts with prose', () => {
    const sections = parseMarkdownSections('Loose thought.\n\n# Heading\n\nBody.');
    expect(sections[0].heading).toBeNull();
    expect(sections[0].from).toBe(0);
    expect(sections[1].heading).toBe('Heading');
  });

  test('a peer heading ends the current section', () => {
    const goals = parseMarkdownSections(note).find((section) => section.heading === 'Goals');
    expect(goals).toBeDefined();
    expect(note.slice(goals!.to, goals!.to + 8)).toBe('## Risks');
  });
});

describe('applySectionEdits', () => {
  test('replaces the body but preserves the heading', () => {
    const result = applySectionEdits(note, [
      { op: 'replace_section', heading: 'Goals', markdown: '- Ship the beta\n- Write docs\n- Train the team' },
    ]);
    expect(result.markdown).toContain('## Goals\n\n- Ship the beta\n- Write docs\n- Train the team');
    expect(result.markdown).toContain('## Risks');
    expect(result.changed[0].heading).toBe('Goals');
  });

  test('replaces a nested section by path', () => {
    const result = applySectionEdits(note, [
      { op: 'replace_section', heading: 'Risks > Schedule', markdown: 'Comfortable.' },
    ]);
    expect(result.markdown).toContain('### Schedule\n\nComfortable.');
    expect(result.markdown).not.toContain('Tight.');
  });

  test('inserts after the section body', () => {
    const result = applySectionEdits(note, [
      { op: 'insert_after', heading: 'Risks', markdown: '## Mitigation\n\nCut scope.' },
    ]);
    expect(result.markdown).toContain('```\n\n## Mitigation\n\nCut scope.\n\n## Next steps');
  });

  test('appends to the end of the document', () => {
    const result = applySectionEdits(note, [{ op: 'append', markdown: '## Appendix\n\nExtra.' }]);
    expect(result.markdown.trimEnd().endsWith('## Appendix\n\nExtra.')).toBe(true);
  });

  test('replaces a unique text anchor', () => {
    const result = applySectionEdits(note, [
      { op: 'replace_text', find: 'Follow up.', markdown: 'Follow up next week.' },
    ]);
    expect(result.markdown).toContain('Follow up next week.');
    expect(result.markdown).not.toContain('Follow up.');
  });

  test('rejects a missing anchor without changing the note', () => {
    expect(() =>
      applySectionEdits(note, [{ op: 'replace_section', heading: 'Missing', markdown: 'x' }])
    ).toThrow(MarkdownSectionError);
  });

  test('rejects an ambiguous heading', () => {
    const duplicate = '# Plan\n\nA\n\n# Plan\n\nB';
    expect(() =>
      applySectionEdits(duplicate, [{ op: 'replace_section', heading: 'Plan', markdown: 'C' }])
    ).toThrow(MarkdownSectionError);
  });

  test('rejects ambiguous text anchors', () => {
    expect(() =>
      applySectionEdits('a b a', [{ op: 'replace_text', find: 'a', markdown: 'c' }])
    ).toThrow(MarkdownSectionError);
  });

  test('applies multiple operations and shifts earlier ranges', () => {
    const result = applySectionEdits(note, [
      { op: 'insert_after', heading: 'Goals', markdown: 'A'.repeat(20) },
      { op: 'append', markdown: 'B'.repeat(10) },
    ]);
    expect(result.changed).toHaveLength(2);
    expect(result.changed[0].to).toBeGreaterThan(result.changed[0].from);
    expect(result.markdown).toContain('A'.repeat(20));
    expect(result.markdown).toContain('B'.repeat(10));
  });

  test('appends cleanly to a note with no headings', () => {
    const result = applySectionEdits('Just prose.', [{ op: 'append', markdown: 'More.' }]);
    expect(result.markdown).toBe('Just prose.\n\nMore.\n');
  });

  test('leaves untouched sections byte-identical', () => {
    const result = applySectionEdits(note, [
      { op: 'replace_section', heading: 'Goals', markdown: '- One goal' },
    ]);
    expect(result.markdown).toContain('## Risks\n\n### Schedule\n\nTight.');
    expect(result.markdown).toContain('## Next steps\n\nFollow up.');
  });

  test('names the failing operation and its anchor', () => {
    try {
      applySectionEdits('# Alpha\n\nalpha beta\n\n# Gamma\n\ngamma delta', [
        { op: 'replace_section', heading: 'Alpha', markdown: 'x' },
        { op: 'replace_text', find: 'missing words', markdown: 'y' },
      ]);
      throw new Error('expected the edit to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownSectionError);
      const sectionError = error as MarkdownSectionError;
      expect(sectionError.code).toBe('not_found');
      expect(sectionError.anchor).toBe('missing words');
      expect(sectionError.operationIndex).toBe(1);
      expect(sectionError.operation).toBe('replace_text');
    }
  });
});
