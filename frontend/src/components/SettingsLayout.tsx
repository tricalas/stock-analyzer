'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Users, Tag, Database, EyeOff, Shield, TrendingUp, Trash2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

const adminMenuItems = [
  { name: '시그널 분석', href: '/settings/signals', icon: TrendingUp },
  { name: '종목 수집', href: '/settings/crawl', icon: RefreshCw },
  { name: '히스토리 수집', href: '/settings/data', icon: Database },
  { name: '데이터 없음', href: '/settings/no-history', icon: Trash2 },
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
      </div>
    );
  }

  if (!user?.is_admin) {
    return null;
  }

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + '/');

  return (
    <div className="flex flex-col lg:flex-row h-full min-h-[calc(100vh-3.5rem)] lg:p-4 gap-4">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-48 flex-shrink-0">
        <Card className="sticky top-4">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 px-2 py-2 mb-2">
              <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="font-semibold text-sm text-amber-600 dark:text-amber-400">관리자</span>
            </div>
            <nav className="space-y-1">
              {adminMenuItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </CardContent>
        </Card>
      </aside>

      {/* Mobile Tab Navigation */}
      <div className="lg:hidden sticky top-0 z-10 bg-background border-b">
        <ScrollArea className="w-full">
          <div className="flex">
            {adminMenuItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-4 py-3 min-w-[72px] text-center border-b-2 transition-colors",
                    active
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium whitespace-nowrap">{item.name}</span>
                </Link>
              );
            })}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>

      {/* Main Content */}
      <main className="flex-1 lg:overflow-auto">
        <Card className="h-full rounded-none lg:rounded-xl border-0 lg:border">
          <CardContent className="p-4 lg:p-6">
            {children}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
