import type { Metadata } from 'next';
import ShootingStars from '@/components/ShootingStars';
import GlobalErrorHandler from '@/components/GlobalErrorHandler';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'AeroSoc BIT Mesra | Online Testing Platform',
  description:
    'Official online examination portal for AeroSoc - Aerospace Society of BIT Mesra. Secure, proctored, and fully encrypted.',
  keywords: ['AeroSoc', 'BIT Mesra', 'Online Exam', 'Proctored Test', 'Aerospace Society'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Critical: without this, Android Chrome renders at ~980px and scales down */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        {/* Android Chrome toolbar colour matching the dark theme */}
        <meta name="theme-color" content="#050508" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <GlobalErrorHandler />
        <ShootingStars />
        <div className="page-wrapper">{children}</div>
      </body>
    </html>
  );
}
