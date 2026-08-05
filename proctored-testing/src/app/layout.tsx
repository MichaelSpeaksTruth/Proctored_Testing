import type { Metadata } from 'next';
import ShootingStars from '@/components/ShootingStars';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'AeroSoc BIT Mesra | Online Testing Platform',
  description:
    'Official online examination portal for AeroSoc — Aerospace Society of BIT Mesra. Secure, proctored, and fully encrypted.',
  keywords: ['AeroSoc', 'BIT Mesra', 'Online Exam', 'Proctored Test', 'Aerospace Society'],
  icons: {
    icon: '/aerosoc_logo.jpg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ShootingStars />
        <div className="page-wrapper">{children}</div>
      </body>
    </html>
  );
}
