import { PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { pb } from '../../../lib/pocketbase';
import type { User } from '../../../lib/users';
import { Avatar, Badge, Card, IconButton } from '../../ui';

interface UserListItemProps {
  user: User;
  isCurrentUser: boolean;
  onEdit: (user: User) => void;
  onDelete: (userId: string, userName: string) => void;
}

export function UserListItem({ user, isCurrentUser, onEdit, onDelete }: UserListItemProps) {
  const userAvatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;

  return (
    <Card
      interactive
      className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4"
    >
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        <Avatar src={userAvatarUrl} name={user.name || user.email} />

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-ink">{user.name || 'Unnamed User'}</h3>
            {isCurrentUser && <Badge tone="outline">You</Badge>}
            <Badge tone={user.admin ? 'ember' : 'neutral'}>{user.admin ? 'Admin' : 'Member'}</Badge>
            {user.verified && <Badge tone="sage">Verified</Badge>}
          </div>
          <p className="break-all text-sm text-ink-secondary sm:truncate">{user.email}</p>
          <p className="mt-1 text-xs text-ink-muted">
            Created {new Date(user.created).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 self-end sm:self-auto">
        {!isCurrentUser && (
          <IconButton
            label={user.verified ? 'Cannot edit a verified user' : 'Edit user'}
            size="sm"
            onClick={() => !user.verified && onEdit(user)}
            disabled={user.verified}
          >
            <PencilIcon />
          </IconButton>
        )}
        {!isCurrentUser && (
          <IconButton
            label={user.verified ? 'Cannot delete a verified user' : 'Delete user'}
            variant="danger"
            size="sm"
            onClick={() => !user.verified && onDelete(user.id, user.name || user.email)}
            disabled={user.verified}
          >
            <TrashIcon />
          </IconButton>
        )}
      </div>
    </Card>
  );
}
