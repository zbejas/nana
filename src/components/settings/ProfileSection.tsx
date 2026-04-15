import { useRef, useState, useEffect } from 'react';
import { PencilIcon } from '@heroicons/react/24/outline';
import { pb } from '../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import { EditUserForm } from './admin/EditUserForm';
import { useToasts } from '../../state/hooks';
import { createLogger } from '../../lib/logger';

const log = createLogger('Profile');

interface ProfileSectionProps {
  user: RecordModel;
}

export function ProfileSection({ user }: ProfileSectionProps) {
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToasts();

  // Auto-hide success message after 10 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage(null);
      }, 10000);
      
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const avatarUrl = user.avatar ? pb.files.getURL(user, user.avatar) : null;
  const initials = user.name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';
  const isAdmin = user.admin === true;

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingAvatar(true);
      
      const formData = new FormData();
      formData.append('avatar', file);

      await pb.collection('users').update(user.id, formData);
      
      // Refresh auth to get updated user data
      await pb.collection('users').authRefresh();
    } catch (error) {
      log.error('Failed to upload avatar', error);
      showToast('Failed to upload avatar. Please try again.', 'error');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleEditProfile = async (userData: { name: string; password?: string; oldPassword?: string }) => {
    try {
      setIsUpdating(true);
      
      const updateData: any = {
        name: userData.name,
      };

      // Include password fields if password is being changed
      if (userData.password) {
        updateData.password = userData.password;
        updateData.passwordConfirm = userData.password;
        // Include old password for regular users
        if (userData.oldPassword) {
          updateData.oldPassword = userData.oldPassword;
        }
      }

      await pb.collection('users').update(user.id, updateData);
      
      // If password was changed, re-authenticate with new password
      // Otherwise, just refresh the auth token
      if (userData.password) {
        await pb.collection('users').authWithPassword(user.email, userData.password);
      } else {
        await pb.collection('users').authRefresh();
      }
      
      setIsEditModalOpen(false);
    } catch (error: any) {
      log.error('Failed to update profile', error);
      showToast(error?.message || 'Failed to update profile. Please try again.', 'error');
      throw error;
    } finally {
      setIsUpdating(false);
    }
  };

  const handleRequestEmailChange = async (newEmail: string) => {
    try {
      setIsUpdating(true);
      setSuccessMessage(null);
      setErrorMessage(null);
      
      // Use PocketBase's default requestEmailChange API
      await pb.collection('users').requestEmailChange(newEmail);
      
      setSuccessMessage(`Confirmation email sent to ${newEmail}! Please check your inbox and follow the link to confirm. You'll need your password to complete the change.`);
      setIsEditModalOpen(false);
    } catch (error: any) {
      log.error('Failed to request email change', error);
      const message = error?.message || error?.data?.message || 'Failed to request email change. Please try again.';
      setErrorMessage(message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      {/* Success/Error Messages */}
      {successMessage && (
        <div className="mb-4 p-3 bg-green-500/10 backdrop-blur-sm border border-green-500/20 rounded-lg text-green-400 text-sm">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-500/10 backdrop-blur-sm border border-red-500/20 rounded-lg text-red-400 text-sm">
          {errorMessage}
        </div>
      )}

      <div className="bg-white/5 rounded-lg p-6 border border-white/10 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
              className="hidden"
            />
            
            {/* Avatar with hover overlay */}
            <button
              onClick={handleAvatarClick}
              disabled={uploadingAvatar}
              className="w-16 h-16 rounded-full bg-gray-700/50 backdrop-blur-sm border border-white/10 flex items-center justify-center text-gray-300 font-medium text-xl overflow-hidden relative group cursor-pointer disabled:cursor-wait"
            >
              {avatarUrl ? (
                <img 
                  src={avatarUrl} 
                  alt={user.name || user.email} 
                  className="w-full h-full object-cover"
                />
              ) : (
                initials
              )}
              
              {/* Hover overlay with pencil icon */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {uploadingAvatar ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <PencilIcon className="w-6 h-6 text-white" />
                )}
              </div>
            </button>
            
            <div>
              <h2 className="text-xl font-semibold text-white">{user.name || 'User'}</h2>
              <p className="text-sm text-gray-400">{user.email}</p>
            </div>
          </div>

          {/* Edit Profile Button */}
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors border border-white/10"
            title="Edit Profile"
          >
            <PencilIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditUserForm
        isOpen={isEditModalOpen}
        user={{
          id: user.id,
          name: user.name || '',
          email: user.email || '',
        }}
        onSubmit={handleEditProfile}
        onRequestEmailChange={handleRequestEmailChange}
        onCancel={() => {
          setIsEditModalOpen(false);
          setSuccessMessage(null);
          setErrorMessage(null);
        }}
        isUpdating={isUpdating}
        isSelfService={true}
      />
    </>
  );
}
