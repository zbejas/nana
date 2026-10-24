import { useState, useEffect } from 'react';
import { PlusIcon, UserIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../../lib/auth';
import { pb } from '../../../lib/pocketbase';
import { listUsers, createUser, updateUser, deleteUser, requestEmailChange, type User } from '../../../lib/users';
import { CreateUserForm } from './CreateUserForm';
import { EditUserForm } from './EditUserForm';
import { UserListItem } from './UserListItem';
import { Button, ConfirmDialog, EmptyState, SectionHeading, Spinner } from '../../ui';
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

    const { userId } = deleteConfirmDialog;
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
    <div className="space-y-5">
      <div>
        <SectionHeading
          title="User management"
          description="Everyone with access to this workspace, and the role they hold."
          actions={
            <Button
              variant={showCreateUserForm ? 'secondary' : 'primary'}
              icon={showCreateUserForm ? <XMarkIcon /> : <PlusIcon />}
              onClick={() => {
                if (showCreateUserForm) {
                  handleCloseForm();
                } else {
                  setShowCreateUserForm(true);
                }
                setUserError(null);
                setUserSuccess(null);
              }}
            >
              {showCreateUserForm ? 'Close' : 'Create user'}
            </Button>
          }
        />

        {/* Success/Error Messages */}
        {(userError || userSuccess) && (
          <div className="mt-3 space-y-1.5">
            {userError && (
              <p className="text-sm text-danger" role="alert">
                {userError}
              </p>
            )}
            {userSuccess && (
              <p className="text-sm text-sage" role="status">
                {userSuccess}
              </p>
            )}
          </div>
        )}
      </div>

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
        <div className="flex items-center gap-2.5 py-3 text-sm text-ink-secondary">
          <Spinner />
          Loading users...
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          compact
          icon={<UserIcon />}
          title="No users found"
          description="Create a user to give someone access to this workspace."
        />
      ) : (
        <div className="space-y-2">
          {users.map((user) => (
            <div key={user.id}>
              <UserListItem
                user={user}
                isCurrentUser={user.id === currentUser?.id}
                onEdit={handleEditUser}
                onDelete={handleDeleteUser}
              />
              {/* Add divider after current user */}
              {user.id === currentUser?.id && users.length > 1 && (
                <div className="mt-2 border-t border-line" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!deleteConfirmDialog}
        title="Delete user"
        description={`Are you sure you want to delete user "${deleteConfirmDialog?.userName}"? This action cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmDialog(null)}
      />
    </div>
  );
}
