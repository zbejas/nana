import { TrashIcon, PencilIcon } from '@heroicons/react/24/outline';
import { pb } from '../../../lib/pocketbase';
import type { User } from '../../../lib/users';

interface UserListItemProps {
  user: User;
  isCurrentUser: boolean;
  onEdit: (user: User) => void;
  onDelete: (userId: string, userName: string) => void;
}

export function UserListItem({ user, isCurrentUser, onEdit, onDelete }: UserListItemProps) {
  const userAvatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;
  const userInitials = user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4 bg-white/5 backdrop-blur-sm rounded-lg border border-white/10 hover:bg-white/10 transition-colors sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3 sm:flex-1">
        {/* Avatar */}
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/5 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-300 font-medium overflow-hidden flex-shrink-0">
          {userAvatarUrl ? (
            <img
              src={userAvatarUrl}
              alt={user.name || user.email}
              className="w-full h-full object-cover"
            />
          ) : (
            userInitials
          )}
        </div>

        {/* User Info */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-white font-medium truncate">
              {user.name || 'Unnamed User'}
            </h3>
            {isCurrentUser && (
              <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded backdrop-blur-sm">
                You
              </span>
            )}
            {user.admin && (
              <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded backdrop-blur-sm">
                Admin
              </span>
            )}
            {user.verified && (
              <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs rounded backdrop-blur-sm">
                OG
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400 break-all sm:truncate">{user.email}</p>
          <p className="text-xs text-gray-500 mt-1">
            Created: {new Date(user.created).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 self-end sm:self-auto">
        {!isCurrentUser && (
          <button
            onClick={() => !user.verified && onEdit(user)}
            disabled={user.verified}
            className={`p-1.5 sm:p-2 bg-blue-500/10 text-blue-400 rounded-lg transition-colors ${user.verified ? 'opacity-30 cursor-not-allowed' : 'hover:bg-blue-500/20 hover:text-blue-300'}`}
            title={user.verified ? "Cannot edit a verified user" : "Edit user"}
          >
            <PencilIcon className="w-4 h-4" />
          </button>
        )}
        {!isCurrentUser && (
          <button
            onClick={() => !user.verified && onDelete(user.id, user.name || user.email)}
            disabled={user.verified}
            className={`p-1.5 sm:p-2 bg-red-500/10 text-red-400 rounded-lg transition-colors ${user.verified ? 'opacity-30 cursor-not-allowed' : 'hover:bg-red-500/20 hover:text-red-300'}`}
            title={user.verified ? "Cannot delete a verified user" : "Delete user"}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
