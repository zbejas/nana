import { useEffect, useRef, useState } from 'react';
import { CheckIcon, ShieldCheckIcon, ExclamationTriangleIcon, ArrowPathIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';

interface CreateUserFormProps {
  onSubmit: (userData: {
    email: string;
    password: string;
    name: string;
    admin: boolean;
    sendPasswordEmail?: boolean;
  }) => Promise<void>;
  onCancel: () => void;
  isCreating: boolean;
  isClosing?: boolean;
  isCurrentUserVerified?: boolean;
}

export function CreateUserForm({ onSubmit, onCancel, isCreating, isClosing = false, isCurrentUserVerified = false }: CreateUserFormProps) {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    admin: false,
    sendPasswordEmail: true,
  });
  const [showPasswords, setShowPasswords] = useState(false);
  const [temporaryPasswordReveal, setTemporaryPasswordReveal] = useState(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setFormData((prev) => ({ ...prev, password }));

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
    // Reset form
    setFormData({
      email: '',
      password: '',
      name: '',
      admin: false,
      sendPasswordEmail: true,
    });
    setShowPasswords(false);
    setTemporaryPasswordReveal(false);
  };

  return (
    <div className={`mb-5 overflow-hidden ${isClosing ? 'animate-slideUp' : 'animate-slideDown'}`}>
      <form onSubmit={handleSubmit} className="p-4 sm:p-5 bg-white/[0.015] backdrop-blur-sm rounded-lg border border-white/10">
        <h3 className="text-base sm:text-lg font-semibold text-white mb-4">Create New User</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3.5 py-2.5 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
              placeholder="user@example.com"
              required
              autoComplete="off"
            />
          </div>

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
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-300">
                Password
              </label>
              <button
                type="button"
                onClick={generatePassword}
                disabled={isCreating}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-white/5 hover:bg-white/10 text-gray-300 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Generate random password"
              >
                <ArrowPathIcon className="w-3.5 h-3.5" />
                Generate
              </button>
            </div>
            <div className="relative">
              <input
                type={showPasswords || temporaryPasswordReveal ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3.5 py-2.5 pr-11 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 focus:bg-black/40 transition-all"
                placeholder="Minimum 8 characters"
                required
                minLength={8}
                autoComplete="new-password"
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
                disabled={isCreating}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={showPasswords ? 'Hide password' : 'Show password'}
                aria-label={showPasswords ? 'Hide password' : 'Show password'}
              >
                {showPasswords ? <EyeSlashIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-gray-500">Must be at least 8 characters long</p>
            
            {/* Send Password Email Checkbox */}
            <div className="mt-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center mt-0.5">
                  <input
                    type="checkbox"
                    checked={formData.sendPasswordEmail}
                    onChange={(e) => setFormData({ ...formData, sendPasswordEmail: e.target.checked })}
                    disabled={isCreating}
                    className="peer w-4 h-4 bg-black/30 border border-blue-500/30 rounded cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/40 checked:bg-blue-600 checked:border-blue-600 transition-all appearance-none disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <CheckIcon className="w-3 h-3 text-white absolute left-0.5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-blue-300 group-hover:text-blue-200 transition-colors block mb-1">
                    Send password to user via email
                  </span>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    User will receive an email with their login credentials
                  </p>
                </div>
              </label>
            </div>
          </div>

          {isCurrentUserVerified && (
          <div className="pt-1">
            <div className="flex items-start gap-3 p-3 bg-purple-500/5 border border-purple-500/20 rounded-lg">
              <div className="relative flex items-center mt-0.5">
                <input
                  type="checkbox"
                  id="admin-checkbox"
                  checked={formData.admin}
                  onChange={(e) => setFormData({ ...formData, admin: e.target.checked })}
                  className="peer w-5 h-5 bg-black/30 border border-purple-500/30 rounded cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500/40 checked:bg-purple-600 checked:border-purple-600 transition-all appearance-none"
                />
                <CheckIcon className="w-3.5 h-3.5 text-white absolute left-0.5 pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" />
              </div>
              <div className="flex-1 min-w-0">
                <label htmlFor="admin-checkbox" className="flex items-center gap-2 text-sm font-medium text-purple-300 cursor-pointer select-none mb-1">
                  <ShieldCheckIcon className="w-4 h-4" />
                  Grant Administrator Privileges
                </label>
                <p className="text-xs text-gray-400 leading-relaxed">
                  <ExclamationTriangleIcon className="w-3.5 h-3.5 inline mr-1 text-orange-400" />
                  Admins have full access to manage users, documents, and system settings.
                </p>
              </div>
            </div>
          </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={isCreating}
              className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCreating}
              className="flex-1 px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {isCreating ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Creating...
                </span>
              ) : (
                'Create User'
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
