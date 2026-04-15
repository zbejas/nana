import { useState, useEffect } from 'react';
import { PlusIcon, UserIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../../lib/auth';
import { pb } from '../../../lib/pocketbase';
import { listUsers, createUser, updateUser, deleteUser, requestEmailChange, type User } from '../../../lib/users';
import { CreateUserForm } from './CreateUserForm';
import { EditUserForm } from './EditUserForm';
import { UserListItem } from './UserListItem';
import { ConfirmDialog } from '../../modals/ConfirmDialog';
import { createLogger } from '../../../lib/logger';

const log = createLogger('UsersTab');

export function UsersTab() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [isClosingForm, setIsClosingForm] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [updatingUser, setUpdatingUser] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [userSuccess, setUserSuccess] = useState<string | null>(null);
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{ userId: string; userName: string } | null>(null);

  // Build headers with auth token for API requests
  const buildHeaders = (): HeadersInit => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = pb.authStore.token;
    if (token) headers.Authorization = token;
    return headers;
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCloseForm = () => {
    setIsClosingForm(true);
    setTimeout(() => {
      setShowCreateUserForm(false);
      setIsClosingForm(false);
    }, 200); // Match animation duration
  };

  const handleCloseEditModal = () => {
    setEditingUser(null);
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    setUserError(null);
    try {
      const result = await listUsers();
      // Separate current user from other users
      const otherUsers = result.items.filter(u => u.id !== currentUser?.id);
      const sortedUsers = currentUser ? [
        result.items.find(u => u.id === currentUser.id)!,
        ...otherUsers
      ].filter(Boolean) : result.items;
      
      setUsers(sortedUsers);
    } catch (error: any) {
      log.error('Failed to load users', error);
      setUserError('Failed to load users. You may not have permission.');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateUser = async (userData: {
    email: string;
    password: string;
    name: string;
    admin: boolean;
    sendPasswordEmail?: boolean;
  }) => {
    setUserError(null);
    setUserSuccess(null);
    setCreatingUser(true);

    try {
      // Validate form
      if (!userData.email || !userData.password || !userData.name) {
        setUserError('All fields are required');
        return;
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(userData.email)) {
        setUserError('Please enter a valid email address');
        return;
      }

      if (userData.password.length < 8) {
        setUserError('Password must be at least 8 characters');
        return;
      }

      await createUser(userData);
      
      // Send password email if requested
      if (userData.sendPasswordEmail) {
        try {
          const response = await fetch('/pb/api/admin/smtp/send-password', {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
              email: userData.email,
              password: userData.password,
              name: userData.name,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            log.warn('Failed to send password email', errorData);
            setUserSuccess(`User "${userData.name}" created successfully, but failed to send email: ${errorData.error || 'Unknown error'}`);
            handleCloseForm();
            await loadUsers();
            return;
          }
          
          setUserSuccess(`User "${userData.name}" created successfully and password email sent!`);
        } catch (emailError) {
          log.error('Error sending password email', emailError);
          setUserSuccess(`User "${userData.name}" created successfully, but failed to send email`);
        }
      } else {
        setUserSuccess(`User "${userData.name}" created successfully!`);
      }
      
      handleCloseForm();
      await loadUsers();
    } catch (error: any) {
      log.error('Failed to create user', error);
      const errorMessage = error.data?.data?.email?.message || 
                          error.data?.data?.password?.message ||
                          error.data?.message ||
                          error.message || 
                          'Failed to create user';
      setUserError(errorMessage);
    } finally {
      setCreatingUser(false);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    if (userId === currentUser?.id) {
      setUserError('You cannot delete your own account');
      return;
    }

    // Open confirmation dialog
    setDeleteConfirmDialog({ userId, userName });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmDialog) return;

    const { userId, userName } = deleteConfirmDialog;
    setUserError(null);
    setUserSuccess(null);
    setDeleteConfirmDialog(null);

    try {
      await deleteUser(userId);
      setUserSuccess('User deleted successfully');
      loadUsers();
    } catch (error: any) {
      log.error('Failed to delete user', error);
      setUserError('Failed to delete user');
    }
  };

  const handleEditUser = (user: User) => {
    // Close create form if open
    if (showCreateUserForm) {
      setShowCreateUserForm(false);
    }
    setEditingUser(user);
    setUserError(null);
    setUserSuccess(null);
  };

  const handleUpdateUser = async (userData: {
    name: string;
    password?: string;
    sendPasswordEmail?: boolean;
    admin?: boolean;
  }) => {
    if (!editingUser) return;

    setUserError(null);
    setUserSuccess(null);
    setUpdatingUser(true);

    try {
      await updateUser(editingUser.id, userData);
      
      // Send password email if requested and password was changed
      if (userData.password && userData.sendPasswordEmail) {
        try {
          const response = await fetch('/pb/api/admin/smtp/send-password', {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
              email: editingUser.email,
              password: userData.password,
              name: userData.name,
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            log.warn('Failed to send password email', errorData);
            setUserSuccess(`User "${userData.name}" updated successfully, but failed to send email: ${errorData.error || 'Unknown error'}`);
            handleCloseEditModal();
            await loadUsers();
            return;
          }
          
          setUserSuccess(`User "${userData.name}" updated successfully and password email sent!`);
        } catch (emailError) {
          log.error('Error sending password email', emailError);
          setUserSuccess(`User "${userData.name}" updated successfully, but failed to send email`);
        }
      } else {
        setUserSuccess(`User "${userData.name}" updated successfully!`);
      }
      
      handleCloseEditModal();
      await loadUsers();
    } catch (error: any) {
      log.error('Failed to update user', error);
      const errorMessage = error.message || 'Failed to update user';
      setUserError(errorMessage);
    } finally {
      setUpdatingUser(false);
    }
  };

  const handleRequestEmailChange = async (newEmail: string) => {
    if (!editingUser) return;

    setUserError(null);
    setUserSuccess(null);
    setUpdatingUser(true);

    try {
      await requestEmailChange(editingUser.id, newEmail);
      setUserSuccess(`Email change confirmation sent to ${newEmail}. The user must verify the new email address.`);
      handleCloseEditModal();
    } catch (error: any) {
      log.error('Failed to request email change', error);
      const errorMessage = error.message || 'Failed to request email change';
      setUserError(errorMessage);
    } finally {
      setUpdatingUser(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white/5 backdrop-blur-sm rounded-lg p-4 sm:p-6 border border-white/10">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-white">User Management</h2>
          <button
            onClick={() => {
              if (showCreateUserForm) {
                handleCloseForm();
              } else {
                setShowCreateUserForm(true);
              }
              setUserError(null);
              setUserSuccess(null);
            }}
            className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors"
            title="Create User"
          >
            <PlusIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Success/Error Messages */}
        {userError && (
          <div className="mb-4 p-3 bg-red-500/10 backdrop-blur-sm border border-red-500/20 rounded-lg text-red-400 text-sm">
            {userError}
          </div>
        )}
        {userSuccess && (
          <div className="mb-4 p-3 bg-green-500/10 backdrop-blur-sm border border-green-500/20 rounded-lg text-green-400 text-sm">
            {userSuccess}
          </div>
        )}

        {/* Create User Form */}
        {showCreateUserForm && (
          <CreateUserForm
            onSubmit={handleCreateUser}
            onCancel={() => {
              handleCloseForm();
              setUserError(null);
            }}
            isCreating={creatingUser}
            isClosing={isClosingForm}
            isCurrentUserVerified={!!currentUser?.verified}
          />
        )}

        {/* Edit User Form */}
        {editingUser && (
          <EditUserForm
            isOpen={!!editingUser}
            user={editingUser}
            onSubmit={handleUpdateUser}
            onRequestEmailChange={handleRequestEmailChange}
            onCancel={() => {
              handleCloseEditModal();
              setUserError(null);
            }}
            isUpdating={updatingUser}
            isCurrentUserVerified={!!currentUser?.verified}
          />
        )}

        {/* Users List */}
        {loadingUsers ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
            <p className="text-gray-400 text-sm">Loading users...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <UserIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No users found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((user, index) => (
              <div key={user.id}>
                <UserListItem
                  user={user}
                  isCurrentUser={user.id === currentUser?.id}
                  onEdit={handleEditUser}
                  onDelete={handleDeleteUser}
                />
                {/* Add divider after current user */}
                {user.id === currentUser?.id && users.length > 1 && (
                  <div className="my-6 border-t border-white/10"></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteConfirmDialog}
        title="Delete User"
        message={`Are you sure you want to delete user "${deleteConfirmDialog?.userName}"? This action cannot be undone.`}
        onSave={handleConfirmDelete}
        onDiscard={() => {}}
        onCancel={() => setDeleteConfirmDialog(null)}
        saveLabel="Delete"
        discardLabel=""
        cancelLabel="Cancel"
      />
    </div>
  );
}
