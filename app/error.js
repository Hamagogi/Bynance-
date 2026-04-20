'use client';

export default function GlobalError({ error, reset }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">Something went wrong</h1>
        <p className="mb-4 text-sm text-gray-600">
          {error?.message || 'Unexpected error.'}
        </p>
        <button onClick={() => reset()} className="btn-primary">
          Try again
        </button>
      </div>
    </div>
  );
}
