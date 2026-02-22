import { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HR Portal',
  description: 'Internal HR Management System',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
