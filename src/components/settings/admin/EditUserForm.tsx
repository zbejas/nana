import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { XMarkIcon, ArrowPathIcon, CheckIcon, ShieldCheckIcon, ExclamationTriangleIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { EmailChangeConfirmModal } from '../../modals/EmailChangeConfirmModal';
import { useToasts } from '../../../state/hooks';

interface EditUserFormProps {
  isOpen: boolean;
  user: {
    id: string;
    name: string;
    email: string;
    admin?: boolean;
  };
  onSubmit: (userData: {
    name: string;
    password?: string;
    oldPassword?: string;
    sendPasswordEmail?: boolean;
    admin?: boolean;
  }) => Promise<void>;
  onRequestEmailChange?: (newEmail: string) => Promise<void>;
  onCancel: () => void;
  isUpdating: boolean;
  isSelfService?: boolean; // If true, requires old password for password changes
  isCurrentUserVerified?: boolean;
}

export function EditUserForm({ isOpen, user, onSubmit, onRequestEmailChange, onCancel, isUpdating, isSelfService = false, isCurrentUserVerified = false }: EditUserFormProps) {
  const [formData, setFormData] = useState({
    name: user.name,
    newEmail: user.email,
    oldPassword: '',
    password: '',
    confirmPassword: '',
    sendPasswordEmail: false,
    admin: user.admin || false,
  });
  const [showEmailChangeConfirm, setShowEmailChangeConfirm] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [temporaryPasswordReveal, setTemporaryPasswordReveal] = useState(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { showToast } = useToasts();

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  // Generate random password (12 characters with symbols)
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData((prev) => ({ ...prev, password, confirmPassword: password }));

    if (!showPasswords) {
      setTemporaryPasswordReveal(true);
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
      revealTimeoutRef.current = setTimeout(() => {
        setTemporaryPasswordReveal(false);
      }, 500);
    }
  };

  if (!isOpen) return null;

  const hasEmailChanged = formData.newEmail !== user.email;

  const handleEmailChangeRequest = async () => {
    if (!onRequestEmailChange || !hasEmailChanged) return;
    await onRequestEmailChange(formData.newEmail);
    setShowEmailChangeConfirm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate passwords match if password is being changed
    if (formData.password && formData.password !== formData.confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }
    
    // Validate old password is provided for self-service password changes
    if (isSelfService && formData.password && !formData.oldPassword) {
      showToast('Please enter your current password', 'error');
      return;
    }

    // Prepare update data
    const updateData: { name: string; password?: string; oldPassword?: string; sendPasswordEmail?: boolean; admin?: boolean } = {
      name: formData.name,
    };

    // Only include password if it's being changed
    if (formData.password) {
      updateData.password = formData.password;
      // Include oldPassword for self-service changes
      if (isSelfService) {
        updateData.oldPassword = formData.oldPassword;
      } else {
        // Include sendPasswordEmail only for admin changes
        updateData.sendPasswordEmail = formData.sendPasswordEmail;
      }
    }
    
    // Include admin field only when a verified admin is editing another user
    if (!isSelfService && isCurrentUserVerified) {
      updateData.admin = formData.admin;
    }

    await onSubmit(updateData);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-md flex items-center justify-center z-[10000] p-4">
      <div className="bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Edit User</h2>
          <button
            onClick={onCancel}
            disabled={isUpdating}
            className="text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          <form onSubmit={handleSubmit} id="edit-user-form" className="space-y-4">
            {/* Email Change Section (only for admin editing other users) */}
            {!isSelfService && onRequestEmailChange && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email Address
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={formData.newEmail}
                    onChange={(e) => setFormData({ ...formData, newEmail: e.target.value })}
                    className="flex-1 px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                    placeholder="user@example.com"
                    disabled={isUpdating}
                  />
                  {hasEmailChanged && (
                    <button
                      type="button"
                      onClick={() => setShowEmailChangeConfirm(true)}
                      disabled={isUpdating}
                      className="shrink-0 px-3 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1.5"
                    >
                      <EnvelopeIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  User will receive a confirmation email to verify the new address
                </p>
              </div>
            )}

            {/* Email Change Section (for self-service) */}
            {isSelfService && onRequestEmailChange && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Email Address
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={formData.newEmail}
                    onChange={(e) => setFormData({ ...formData, newEmail: e.target.value })}
                    className="flex-1 px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                    placeholder="user@example.com"
                    disabled={isUpdating}
                  />
                  {hasEmailChanged && (
                    <button
                      type="button"
                      onClick={() => setShowEmailChangeConfirm(true)}
                      disabled={isUpdating}
                      className="shrink-0 px-3 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1.5"
                    >
                      <EnvelopeIcon className="w-4 h-4" />
                      <span className="hidden sm:inline">Send</span>
                    </button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-gray-500">
                  You'll receive a confirmation email with a link. You'll need your password to complete the change.
                </p>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Full Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                placeholder="John Doe"
                required
                autoComplete="off"
                disabled={isUpdating}
              />
            </div>

            {/* Admin Toggle (only for verified admin editing other users) */}
            {!isSelfService && isCurrentUserVerified && (
              <div className="pt-1">
                <div className="flex items-start gap-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
                  <div className="relative flex items-center mt-0.5">
                    <input
                      type="checkbox"
                      id="admin-checkbox"
                      checked={formData.admin}
                      onChange={(e) => setFormData({ ...formData, admin: e.target.checked })}
                      disabled={isUpdating}
                      className="peer w-5 h-5 bg-black/30 border border-purple-500/30 rounded cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/40 checked:bg-purple-600 checked:border-purple-600 transition-all appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <CheckIcon className="w-3.5 h-3.5 text-white absolute left-0.5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label htmlFor="admin-checkbox" className="flex items-center gap-2 text-sm font-medium text-purple-300 cursor-pointer select-none mb-1">
                      <ShieldCheckIcon className="w-4 h-4" />
                      Administrator Privileges
                    </label>
                    <p className="text-xs text-gray-400 leading-relaxed">
                      <ExclamationTriangleIcon className="w-3.5 h-3.5 inline mr-1 text-orange-400" />
                      Admins have full access to manage users, documents, and system settings.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Password Section */}
            <div className="pt-2 border-t border-white/10">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-gray-300">Change Password (Optional)</h4>
                {!isSelfService && (
                  <button
                    type="button"
                    onClick={generatePassword}
                    disabled={isUpdating}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-gray-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Generate random password"
                  >
                    <ArrowPathIcon className="w-3.5 h-3.5" />
                    Generate
                  </button>
                )}
              </div>
              
              <div className="space-y-3">
                {/* Current Password (only for self-service) */}
                {isSelfService && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Current Password
                    </label>
                    <input
                      type={showPasswords ? 'text' : 'password'}
                      value={formData.oldPassword}
                      onChange={(e) => setFormData({ ...formData, oldPassword: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                      placeholder="Enter your current password"
                      required={!!formData.password}
                      autoComplete="current-password"
                      disabled={isUpdating}
                    />
                    <p className="mt-1.5 text-xs text-gray-500">Required to change your password</p>
                  </div>
                )}
                
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-3.5 py-2.5 pr-11 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                      placeholder="Leave blank to keep current password"
                      minLength={8}
                      autoComplete="new-password"
                      disabled={isUpdating}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const nextShow = !showPasswords;
                        setShowPasswords(nextShow);
                        if (nextShow) {
                          setTemporaryPasswordReveal(false);
                          if (revealTimeoutRef.current) {
                            clearTimeout(revealTimeoutRef.current);
                          }
                        }
                      }}
                      disabled={isUpdating}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title={showPasswords ? 'Hide passwords' : 'Show passwords'}
                      aria-label={showPasswords ? 'Hide passwords' : 'Show passwords'}
                    >
                      {showPasswords ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  </div>
                  {formData.password && (
                    <p className="mt-1.5 text-xs text-gray-500">Must be at least 8 characters long</p>
                  )}
                </div>

                {formData.password && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">
                      Confirm New Password
                    </label>
                    <input
                      type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      className="w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                      placeholder="Confirm your new password"
                      required={!!formData.password}
                      minLength={8}
                      autoComplete="new-password"
                      disabled={isUpdating}
                    />
                    {formData.password !== formData.confirmPassword && formData.confirmPassword && (
                      <p className="mt-1.5 text-xs text-red-400">Passwords do not match</p>
                    )}
                  </div>
                )}

                {/* Send Password Email Checkbox (only for admin) */}
                {!isSelfService && (
                  <div className="pt-2">
                    <div className="p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                      <label className="flex items-start gap-3 cursor-pointer group">
                        <div className="relative flex items-center mt-0.5">
                          <input
                            type="checkbox"
                            checked={formData.sendPasswordEmail}
                            onChange={(e) => setFormData({ ...formData, sendPasswordEmail: e.target.checked })}
                            disabled={isUpdating}
                            className="peer w-4 h-4 bg-black/30 border border-blue-500/30 rounded cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 checked:bg-blue-600 checked:border-blue-600 transition-all appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <CheckIcon className="w-3 h-3 text-white absolute left-0.5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-blue-300 group-hover:text-blue-200 transition-colors block mb-1">
                            Send password to user via email
                          </span>
                          <p className="text-xs text-gray-400 leading-relaxed">
                            User will receive an email with their new password
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-white/10 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-user-form"
            disabled={isUpdating || (formData.password !== formData.confirmPassword && !!formData.password)}
            className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isUpdating ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Updating...
              </span>
            ) : (
              'Update User'
            )}
          </button>
        </div>
      </div>

      {/* Email Change Confirmation Modal - Render via portal to avoid clipping */}
      {createPortal(
        <EmailChangeConfirmModal
          isOpen={showEmailChangeConfirm}
          newEmail={formData.newEmail}
          isSelfService={isSelfService}
          isProcessing={isUpdating}
          onConfirm={handleEmailChangeRequest}
          onCancel={() => setShowEmailChangeConfirm(false)}
        />,
        document.body
      )}
    </div>
  );
}
