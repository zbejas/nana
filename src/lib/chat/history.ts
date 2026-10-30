import type { ChatConversation } from './types';

export type ConversationGroupLabel = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

export interface ConversationGroup {
  label: ConversationGroupLabel;
  conversations: ChatConversation[];
}

const GROUP_ORDER: ConversationGroupLabel[] = [
  'Today',
  'Yesterday',
  'Previous 7 days',
  'Older',
];

function timestamp(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function groupConversationsByDate(
  conversations: readonly ChatConversation[],
  now: Date = new Date(),
): ConversationGroup[] {
  const today = startOfDay(now);
  const day = 24 * 60 * 60 * 1000;
  const buckets = new Map<ConversationGroupLabel, ChatConversation[]>();

  const sorted = [...conversations].sort(
    (a, b) => timestamp(b.updated || b.created) - timestamp(a.updated || a.created),
  );

  for (const conversation of sorted) {
    const activity = timestamp(conversation.updated || conversation.created);
    const daysAgo = Math.floor((today - startOfDay(new Date(activity || Date.now()))) / day);
    const label: ConversationGroupLabel = daysAgo <= 0
      ? 'Today'
      : daysAgo === 1
        ? 'Yesterday'
        : daysAgo <= 7
          ? 'Previous 7 days'
          : 'Older';
    const bucket = buckets.get(label) ?? [];
    bucket.push(conversation);
    buckets.set(label, bucket);
  }

  return GROUP_ORDER
    .map((label) => ({ label, conversations: buckets.get(label) ?? [] }))
    .filter((group) => group.conversations.length > 0);
}

export function filterConversations(
  conversations: readonly ChatConversation[],
  query: string,
): ChatConversation[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...conversations];
  return conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(needle)
  );
}

export function conversationSubtitle(conversation: ChatConversation): string {
  const value = conversation.updated || conversation.created;
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && date.getDate() === now.getDate()) return `${hours}h ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
