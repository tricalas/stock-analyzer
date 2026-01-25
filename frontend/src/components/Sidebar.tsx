'use client';

import { Home, Star, ThumbsDown, Settings, TrendingUp, ShoppingCart, ThumbsUp, Eye, AlertCircle, Trash2, LogOut, User, Globe, Flag, UserCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import ThemeToggle from './ThemeToggle';
import { useTags } from '@/contexts/TagContext';
import { useAuth } from '@/contexts/AuthContext';

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

  const getTagIcon = (iconName?: string): React.ComponentType<{ className?: string }> => {
    switch (iconName) {
      case 'Star':
        return Star;
      case 'ThumbsDown':
        return ThumbsDown;
      case 'ShoppingCart':
        return ShoppingCart;
      case 'ThumbsUp':
        return ThumbsUp;
      case 'Eye':
        return Eye;
      case 'TrendingUp':
        return TrendingUp;
      case 'AlertCircle':
        return AlertCircle;
      case 'Trash2':
        return Trash2;
      default:
        return Star;
    }
  };

  const baseNavigation: NavItem[] = [
    { name: '미국', href: '/', icon: Globe },
    { name: '한국', href: '/korea', icon: Flag },
    { name: '시그널', href: '/signals', icon: TrendingUp },
  ];

  // 에러, 제외 태그는 사이드바에서 숨김 (설정 페이지에서만 표시)
  const visibleTags = tags.filter(tag => !['error', 'dislike'].includes(tag.name));
  const tagNavigation: NavItem[] = visibleTags.map(tag => ({
    name: tag.display_name,
    href: `/tags/${tag.name}`,
    icon: getTagIcon(tag.icon),
  }));

  // 하단 네비게이션 (프로필은 모든 사용자, 설정은 관리자만)
  const bottomNavigation: NavItem[] = [
    { name: '프로필', href: '/profile', icon: UserCircle },
  ];

  // 관리자인 경우 설정 메뉴 추가
  if (user?.is_admin) {
    bottomNavigation.push({ name: '설정', href: '/settings', icon: Settings });
  }

  const navigation: NavItem[] = [...baseNavigation, ...tagNavigation, ...bottomNavigation];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname?.startsWith(href);
  };

  return (
    <aside className="fixed left-0 top-0 z-30 h-screen w-12 lg:w-40 bg-card border-r border-border flex flex-col transition-all duration-300">
      {/* Logo */}
      <div className="flex items-center justify-center lg:justify-start h-12 px-1.5 lg:px-2.5 bg-card">
        <div className="hidden lg:flex items-center space-x-1.5">
          <div className="bg-primary/10 p-1 rounded-lg">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground">신신투자</span>
        </div>
        <div className="lg:hidden bg-primary/10 p-1 rounded-lg">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-1 lg:px-1.5 py-3 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                group flex items-center px-1.5 lg:px-2.5 py-2 text-xs font-medium rounded-lg
                transition-all duration-200 cursor-pointer
                ${active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }
              `}
            >
              <Icon className={`
                h-3.5 w-3.5 lg:h-4 lg:w-4 flex-shrink-0
                ${active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}
              `} />
              <span className="ml-1.5 lg:ml-2 hidden lg:block">{item.name}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className={`
                  ml-auto hidden lg:block px-1 py-0.5 text-[10px] font-semibold rounded-full
                  ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}
                `}>
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-1.5 lg:p-2 border-t border-border space-y-1.5">
        {/* User Info & Logout */}
        {user && (
          <div className="flex items-center justify-between px-1.5 py-1 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-[10px] text-foreground truncate hidden lg:block">
                {user.nickname}
              </span>
            </div>
            <button
              onClick={logout}
              className="p-1 hover:bg-destructive/10 text-muted-foreground hover:text-destructive rounded transition-colors flex-shrink-0 cursor-pointer"
              title="로그아웃"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-center">
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
