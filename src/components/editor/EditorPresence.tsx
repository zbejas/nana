import { Avatar } from '../ui';
import { shareUserAvatarUrl } from '../sharing/share-users';
import type { Collaborator } from '../../lib/collaboration/types';

interface EditorPresenceProps {
    collaborators: Collaborator[];
    className?: string;
}

/** Quiet header signal that another person is in this note right now. */
export function EditorPresence({ collaborators, className }: EditorPresenceProps) {
    const people = new Map<string, Collaborator>();
    for (const collaborator of collaborators) {
        if (!people.has(collaborator.userId)) people.set(collaborator.userId, collaborator);
    }
    const list = [...people.values()];
    if (list.length === 0) return null;

    const label = list.length === 1
        ? `${list[0]!.name} is editing`
        : `${list.length} people are editing`;

    return (
        <span
            className={`flex shrink-0 items-center gap-2 ${className ?? ''}`}
            title={label}
            aria-label={label}
        >
            <span className="flex -space-x-1.5" aria-hidden="true">
                {list.slice(0, 3).map((person) => (
                    <Avatar
                        key={person.userId}
                        src={shareUserAvatarUrl({ id: person.userId, avatar: person.avatar })}
                        name={person.name}
                        size="sm"
                        className="h-6 w-6 border-2 border-canvas text-[9px]"
                    />
                ))}
            </span>
            <span className="hidden items-center gap-1.5 text-[11.5px] text-ink-muted lg:flex">
                <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: list[0]!.color }}
                    aria-hidden="true"
                />
                {list.length === 1 ? `${list[0]!.name} is editing` : `${list.length} editing`}
            </span>
        </span>
    );
}
