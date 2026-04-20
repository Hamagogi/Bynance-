import './globals.css';

export const metadata = {
  title: 'ContentShift – AI Content Repurposing SaaS',
  description:
    'Turn one piece of content into Instagram, X threads, LinkedIn, YouTube Shorts scripts and newsletters – in seconds.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
