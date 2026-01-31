'use client';

import { useRouter } from 'next/navigation';
import { AlertCircle, ThumbsDown, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function HiddenTagsPage() {
  const router = useRouter();

  const hiddenTags = [
    {
      name: '에러 종목',
      description: '데이터 수집 중 에러가 발생한 종목들입니다.',
      href: '/tags/error',
      icon: AlertCircle,
      color: 'text-red-600 dark:text-red-400',
      bgColor: 'bg-red-500/10 hover:bg-red-500/20',
      borderColor: 'border-red-500/20',
    },
    {
      name: '제외 종목',
      description: '분석에서 제외된 종목들입니다.',
      href: '/tags/dislike',
      icon: ThumbsDown,
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-500/10 hover:bg-orange-500/20',
      borderColor: 'border-orange-500/20',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">숨겨진 태그</h1>
        <p className="text-sm text-muted-foreground mt-1">
          사이드바에 표시되지 않는 특수 태그들입니다.
        </p>
      </div>

      {/* 태그 카드 목록 */}
      <div className="space-y-4">
        {hiddenTags.map((tag) => {
          const Icon = tag.icon;
          return (
            <Card
              key={tag.href}
              className={`cursor-pointer transition-colors ${tag.borderColor} ${tag.bgColor}`}
              onClick={() => router.push(tag.href)}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 rounded-lg ${tag.bgColor}`}>
                      <Icon className={`w-6 h-6 ${tag.color}`} />
                    </div>
                    <div>
                      <h3 className={`font-semibold ${tag.color}`}>{tag.name}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{tag.description}</p>
                    </div>
                  </div>
                  <ExternalLink className="w-5 h-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 안내 */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            이 태그들은 시스템에서 자동으로 관리되며, 사이드바에는 표시되지 않습니다.
            관리자만 이 페이지를 통해 접근할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
