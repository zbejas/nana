import { EnvelopeIcon } from '@heroicons/react/24/outline';

interface EmailChangeConfirmModalProps {
  isOpen: boolean;
  newEmail: string;
  isSelfService: boolean;
  isProcessing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function EmailChangeConfirmModal({
  isOpen,
  newEmail,
  isSelfService,
  isProcessing,
  onConfirm,
  onCancel,
}: EmailChangeConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-4">
      <div className="bg-black/95 backdrop-blur-sm border border-white/10 rounded-lg w-full max-w-md shadow-2xl">
        <div className="p-4 sm:p-5 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white">Confirm Email Change Request</h3>
        </div>
        <div className="p-4 sm:p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
              <EnvelopeIcon className="w-5 h-5 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-300 mb-2">
                Send email change confirmation to:
              </p>
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <p className="text-blue-300 font-medium break-all">{newEmail}</p>
              </div>
            </div>
          </div>
          <p className="text-sm text-gray-400">
            {isSelfService 
              ? "You'll receive a confirmation email with a link. You'll need to enter your password when confirming the change."
              : "The user will receive a confirmation email and will need to verify the new email address by clicking the link."}
          </p>
        </div>
        <div className="p-4 sm:p-5 border-t border-white/10 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isProcessing}
            className="flex-1 px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          >
            {isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                Sending...
              </span>
            ) : (
              'Send Confirmation'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
