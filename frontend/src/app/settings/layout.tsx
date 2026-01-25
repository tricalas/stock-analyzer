import AppLayout from '@/components/AppLayout';
import SettingsLayout from '@/components/SettingsLayout';
import { Toaster } from '@/components/ui/sonner';

export default function SettingsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppLayout>
      <SettingsLayout>
        {children}
      </SettingsLayout>
      <Toaster position="top-center" />
    </AppLayout>
  );
}
