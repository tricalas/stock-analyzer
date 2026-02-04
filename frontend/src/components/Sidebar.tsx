'use client';

import { useState } from 'react';
import { Star, ThumbsDown, Settings, TrendingUp, ShoppingCart, ThumbsUp, Eye, AlertCircle, Trash2, LogOut, User, Globe, UserCircle, Menu, Moon, Sun, Target } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useTags } from '@/contexts/TagContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

interface SidebarProps {
  favoriteCount?: number;
  dislikeCount?: number;
}

export default function Sidebar({ favoriteCount = 0, dislikeCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const { tags } = useTags();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);

  const getTagIcon = (iconName?: string): React.ComponentType<{ className?: string }> => {
    switch (iconName) {
      case 'Star': return Star;
      case 'ThumbsDown': return ThumbsDown;
      case 'ShoppingCart': return ShoppingCart;
      case 'ThumbsUp': return ThumbsUp;
      case 'Eye': return Eye;
      case 'TrendingUp': return TrendingUp;
      case 'AlertCircle': return AlertCircle;
      case 'Trash2': return Trash2;
      default: return Star;
    }
  };

  const baseNavigation: NavItem[] = [
    { name: '종목', href: '/', icon: Globe },
    { name: '90일', href: '/ma90', icon: Target },
    { name: '시그널', href: '/signals', icon: TrendingUp },
  ];

  const visibleTags = tags.filter(tag => !['error', 'dislike'].includes(tag.name));
  const tagNavigation: NavItem[] = visibleTags.map(tag => ({
    name: tag.display_name,
    href: `/tags/${tag.name}`,
    icon: getTagIcon(tag.icon),
  }));

  const bottomNavigation: NavItem[] = [
    { name: '프로필', href: '/profile', icon: UserCircle },
  ];

  if (user?.is_admin) {
    bottomNavigation.push({ name: '설정', href: '/settings', icon: Settings });
  }

  const navigation: NavItem[] = [...baseNavigation, ...tagNavigation];

  // 모바일 하단 네비게이션 (5개)
  const mobileBottomNav: NavItem[] = [
    { name: '종목', href: '/', icon: Globe },
    { name: '90일', href: '/ma90', icon: Target },
    { name: '시그널', href: '/signals', icon: TrendingUp },
    ...(visibleTags.length > 0 ? [{
      name: visibleTags[0].display_name,
      href: `/tags/${visibleTags[0].name}`,
      icon: getTagIcon(visibleTags[0].icon),
    }] : []),
    { name: '프로필', href: '/profile', icon: UserCircle },
  ].slice(0, 4);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname?.startsWith(href);
  };

  const NavLink = ({ item, onClick }: { item: NavItem; onClick?: () => void }) => {
    const active = isActive(item.href);
    const Icon = item.icon;

    return (
      <Link
        href={item.href}
        onClick={onClick}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.name}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-semibold",
            active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
          )}>
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  const SidebarContent = ({ onNavClick }: { onNavClick?: () => void }) => (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <TrendingUp className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="text-lg font-bold">신신투자</span>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <div className="space-y-1">
          {navigation.map((item) => (
            <NavLink key={item.href} item={item} onClick={onNavClick} />
          ))}
        </div>

        <Separator className="my-4" />

        <div className="space-y-1">
          {bottomNavigation.map((item) => (
            <NavLink key={item.href} item={item} onClick={onNavClick} />
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-4 space-y-3">
        {/* Theme Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">테마</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-8 w-8 p-0"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">테마 변경</span>
          </Button>
        </div>

        {/* User Info */}
        {user && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                {user.nickname.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.nickname}</p>
              <p className="text-xs text-muted-foreground">
                {user.is_admin ? '관리자' : '사용자'}
              </p>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={logout}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>로그아웃</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-56 border-r bg-card lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile Header */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center gap-4 border-b bg-card px-4 lg:hidden">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">메뉴 열기</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
            <SidebarContent onNavClick={() => setIsOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <TrendingUp className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="font-bold">신신투자</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>
        </div>
      </header>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t bg-card lg:hidden safe-area-inset-bottom">
        <div className="flex h-16 items-center justify-around px-2">
          {mobileBottomNav.map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 min-w-[64px] transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "text-primary")} />
                <span className="text-[10px] font-medium">{item.name}</span>
              </Link>
            );
          })}
          {/* More menu button */}
          <Sheet>
            <SheetTrigger asChild>
              <button className="flex flex-col items-center justify-center gap-1 rounded-lg px-3 py-2 min-w-[64px] text-muted-foreground transition-colors">
                <Menu className="h-5 w-5" />
                <span className="text-[10px] font-medium">더보기</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto max-h-[80vh]">
              <SheetHeader>
                <SheetTitle>메뉴</SheetTitle>
              </SheetHeader>
              <ScrollArea className="mt-4 max-h-[60vh]">
                <div className="grid grid-cols-4 gap-4 pb-4">
                  {[...navigation, ...bottomNavigation].map((item) => {
                    const active = isActive(item.href);
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 rounded-xl p-4 transition-colors",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="h-6 w-6" />
                        <span className="text-xs font-medium text-center">{item.name}</span>
                      </Link>
                    );
                  })}
                </div>
              </ScrollArea>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </>
  );
}
