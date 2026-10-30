import { editorViewCtx, type Editor } from '@milkdown/kit/core';
import { replaceEditorMarkdown } from './createEditor';

export interface AiChangedSection {
  heading?: string;
  path?: string[];
  from?: number;
  to?: number;
}

const HEADING_SELECTOR = 'h1,h2,h3,h4,h5,h6';
const EDIT_CLASS = 'nana-ai-edited';
const BADGE_ATTR = 'data-nana-ai-heading';

function headingText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function headingKeys(element: Element): string[] {
  const text = headingText(element);
  const keys = [text];
  const trail: string[] = [];
  let current: Element | null = element;
  while (current) {
    if (current.matches?.(HEADING_SELECTOR)) {
      trail.unshift(headingText(current));
    }
    current = current.previousElementSibling;
  }
  if (trail.length > 1) {
    keys.push(trail.join(' > '));
    keys.push(trail.join(' / '));
  }
  return keys;
}

function levelOf(element: Element): number {
  return Number(element.tagName.slice(1)) || 6;
}

function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll(`.${EDIT_CLASS}`).forEach((element) => {
    element.classList.remove(EDIT_CLASS);
    element.removeAttribute(BADGE_ATTR);
  });
}

/**
 * Reveals the sections changed by an AI edit. The Markdown is applied in one
 * transaction so the document stays consistent; the visual layer then marks
 * exactly the changed section ranges, scrolls the first one into view, and
 * fades the wash after ~2.4s. Reduced-motion users get the mark without the
 * animation.
 */
export function revealAiSections(root: HTMLElement, sections: AiChangedSection[]): void {
  if (typeof window === 'undefined' || sections.length === 0) return;
  clearHighlights(root);

  const headings = Array.from(root.querySelectorAll<HTMLElement>(HEADING_SELECTOR));
  const marked: HTMLElement[] = [];

  for (const section of sections) {
    if (!section.heading) continue;
    const wanted = section.heading.replace(/\s+/g, ' ').trim().toLowerCase();
    const path = section.path?.join(' > ').replace(/\s+/g, ' ').trim().toLowerCase();
    const heading = headings.find((candidate) => {
      const keys = headingKeys(candidate);
      return keys.includes(wanted) || (path ? keys.includes(path) : false);
    });
    if (!heading) continue;

    const level = levelOf(heading);
    heading.classList.add(EDIT_CLASS);
    heading.setAttribute(BADGE_ATTR, 'true');
    marked.push(heading);

    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (sibling.matches(HEADING_SELECTOR) && levelOf(sibling) <= level) break;
      sibling.classList.add(EDIT_CLASS);
      marked.push(sibling as HTMLElement);
      sibling = sibling.nextElementSibling;
    }
  }

  if (marked.length === 0) {
    // Append edits may not have a new heading; mark the last block so the
    // change is still visible.
    const last = root.lastElementChild as HTMLElement | null;
    if (last) {
      last.classList.add(EDIT_CLASS);
      marked.push(last);
    }
  }

  marked[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  window.setTimeout(() => {
    for (const element of marked) {
      element.classList.remove(EDIT_CLASS);
      element.removeAttribute(BADGE_ATTR);
    }
  }, 2600);
}

/**
 * Replaces the editor document with the AI-applied Markdown and animates the
 * changed sections. Call this from the chat edit event when the open note is
 * the edit target; ordinary external value sync should keep using the
 * controlled `value` path.
 */
export function applyAiMarkdown(
  editor: Editor,
  markdown: string,
  sections: AiChangedSection[]
): void {
  editor.action((ctx) => replaceEditorMarkdown(ctx, markdown));
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  window.requestAnimationFrame(() => revealAiSections(view.dom as HTMLElement, sections));
}
