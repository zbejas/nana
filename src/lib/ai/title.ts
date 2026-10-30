/**
 * Conversation titles are plain text: no decorative emoji, flags, keycaps, or
 * variation selectors. This is shared by the title generator, title seeds, and
 * the client-side history normalizer so old rows stop showing emoji too.
 */
const EMOJI_PATTERN =
  /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)|[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\uFE0F?\u20E3/gu;

export function stripTitleEmoji(value: string, fallback = 'New chat'): string {
  const stripped = value
    .replace(EMOJI_PATTERN, ' ')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:|·]+|[\s\-–—:|·]+$/g, '')
    .trim();

  return stripped || fallback;
}

/** Clamp persisted/manual titles to the conversation field limit. */
export function cleanChatTitle(value: string, fallback = 'New chat'): string {
  return stripTitleEmoji(value, fallback).slice(0, 120).trim() || fallback;
}
