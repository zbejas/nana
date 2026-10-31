import { describe, expect, test } from 'bun:test';
import {
  attachmentModelWarning,
  classifyChatFile,
  formatChatFileSize,
} from '../../src/lib/chat/attachments';
import type { AIChatModelOption } from '../../src/lib/ai/types';

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

const model: AIChatModelOption = {
  id: 'work:gpt',
  label: 'GPT',
  model: 'gpt',
  provider: 'Work',
  providerKind: 'openai',
  local: false,
  contextWindow: null,
  maxOutputTokens: null,
  vision: false,
  files: false,
  tools: true,
  reasoning: false,
};

describe('chat attachment helpers', () => {
  test('classifies supported images, PDFs, and text', () => {
    expect(classifyChatFile(file('chart.png', 'image/png'))).toBe('image');
    expect(classifyChatFile(file('photo.jpg', 'image/jpeg'))).toBe('image');
    expect(classifyChatFile(file('report.pdf', 'application/pdf'))).toBe('pdf');
    expect(classifyChatFile(file('notes.txt', 'text/plain'))).toBe('text');
    expect(classifyChatFile(file('README.md', ''))).toBe('text');
  });

  test('rejects unsupported files', () => {
    expect(classifyChatFile(file('vector.svg', 'image/svg+xml'))).toBeNull();
    expect(classifyChatFile(file('archive.zip', 'application/zip'))).toBeNull();
    expect(classifyChatFile(file('photo.png', 'image/pngx'))).toBeNull();
  });

  test('formats sizes for chips', () => {
    expect(formatChatFileSize(0)).toBe('0 B');
    expect(formatChatFileSize(512)).toBe('512 B');
    expect(formatChatFileSize(2048)).toBe('2 KB');
    expect(formatChatFileSize(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  test('warns when a model cannot read an image', () => {
    expect(attachmentModelWarning('image', model)).toContain('cannot read images');
    expect(attachmentModelWarning('text', model)).toBeNull();
    expect(attachmentModelWarning('image', { ...model, vision: true })).toBeNull();
  });
});
