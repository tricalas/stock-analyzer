'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Users, Tag, Database, EyeOff, Shield, TrendingUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

const adminMenuItems = [
  { name: '신호 분석', href: '/settings/signals', icon: TrendingUp },
  { name: '데이터 수집', href: '/settings/data', icon: Database },
  { name: '태그 관리', href: '/settings/tags', icon: Tag },
  { name: '사용자 관리', href: '/settings/users', icon: Users },
  { name: '숨겨진 태그', href: '/settings/hidden-tags', icon: EyeOff },
];

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user && !user.is_admin) {
      toast.error('관리자만 접근할 수 있습니다.');
      router.push('/');
    }
  }, [user, loading, router]);

  // 로딩 중이거나 비관리자인 경우 아무것도 렌더링하지 않음
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user?.is_admin) {
    return null;
  }

  const isActive = (href: string) => {
    return pathname === href || pathname?.startsWith(href + '/');
  };

  return (
    <div className="flex h-full min-h-[calc(100vh-3.5rem)] p-4 gap-4">
      {/* Admin Sidebar - Floating Menu */}
      <aside className="w-40 flex-shrink-0 hidden md:block">
        <div className="bg-card border border-border rounded-xl shadow-lg overflow-hidden sticky top-4">
          <div className="px-3 pt-3 pb-3">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <h2 className="font-semibold text-xs text-amber-600 dark:text-amber-400">관리자</h2>
            </div>
          </div>
          <nav className="px-1.5 pb-2 space-y-0.5">
            {adminMenuItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium
                    transition-all duration-200
                    ${active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }
                  `}
                >
                  <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-primary-foreground' : ''}`} />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Mobile Menu */}
      <div className="md:hidden w-full border-b border-border bg-card p-2 flex gap-1 overflow-x-auto absolute top-0 left-0 right-0 z-10">
        {adminMenuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap
                transition-colors duration-200
                ${active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              `}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-primary-foreground' : ''}`} />
              <span className="hidden sm:inline">{item.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Main Content */}
      <main className="flex-1 overflow-auto md:pt-0 pt-14 bg-card border border-border rounded-xl shadow-lg">
        {children}
      </main>
    </div>
  );
}
