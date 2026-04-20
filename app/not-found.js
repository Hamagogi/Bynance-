import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">404 · Not found</h1>
        <p className="mb-4 text-sm text-gray-600">
          The page you’re looking for doesn’t exist.
        </p>
        <Link href="/" className="btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}
