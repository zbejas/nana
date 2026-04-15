import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export function DocumentLoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-black/40 backdrop-blur-md">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mb-4 mx-auto"></div>
        <p className="text-gray-400">Loading document...</p>
      </div>
    </div>
  );
}

export function DocumentNotFoundState() {
  return (
    <div className="flex flex-col items-center justify-center h-full bg-black/40 backdrop-blur-md p-8">
      <ExclamationTriangleIcon className="w-16 h-16 text-yellow-500 mb-4" />
      <h2 className="text-2xl font-bold text-white mb-2">Document Not Found</h2>
      <p className="text-gray-400 mb-4">The document you're looking for doesn't exist.</p>
      <p className="text-gray-500 text-sm">Redirecting to home...</p>
    </div>
  );
}
