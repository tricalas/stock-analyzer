'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Activity, Calendar, Play } from 'lucide-react';
import { toast } from 'sonner';

interface TaskProgress {
  task_id: string;
  task_type: string;
  status: string;
  total_items: number;
  current_item: number;
  current_stock_name?: string;
  success_count: number;
  failed_count: number;
  message?: string;
  error_message?: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
}

interface SignalStats {
  total_signals: number;
  positive_returns: number;
  negative_returns: number;
  avg_return: number;
}

interface SignalListResponse {
  total: number;
  analyzed_at?: string;
  stats?: SignalStats;
}

export default function SignalAnalysisPage() {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [showProgress, setShowProgress] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 신호 통계 조회
  const { data: signalData, refetch: refetchSignals } = useQuery<SignalListResponse>({
    queryKey: ['signal-stats'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/signals?limit=1`);
      if (!response.ok) throw new Error('Failed to fetch signals');
      return response.json();
    },
  });

  // 작업 진행 상황 조회
  const { data: progressData } = useQuery<TaskProgress>({
    queryKey: ['signal-task-progress', currentTaskId],
    queryFn: async () => {
      if (!currentTaskId) return null;
      const response = await fetch(`${API_URL}/api/tasks/${currentTaskId}`);
      if (!response.ok) throw new Error('Failed to fetch task progress');
      return response.json();
    },
    enabled: !!currentTaskId && showProgress,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 2000;
    },
  });

  // 진행 상황 완료 처리
  useEffect(() => {
    if (progressData?.status === 'completed') {
      setTimeout(() => {
        refetchSignals();
        setShowProgress(false);
        setCurrentTaskId(null);
        setIsAnalyzing(false);
        toast.success('신호 분석 완료', {
          description: progressData.message || '최신 매매 신호를 확인하세요',
        });
      }, 1000);
    } else if (progressData?.status === 'failed') {
      setShowProgress(false);
      setCurrentTaskId(null);
      setIsAnalyzing(false);
      toast.error('분석 실패', {
        description: progressData.error_message || '잠시 후 다시 시도해주세요',
      });
    }
  }, [progressData?.status, progressData?.message, progressData?.error_message, refetchSignals]);

  // 신호 분석 시작
  const handleStartAnalysis = async (mode: 'all' | 'favorites' = 'all') => {
    try {
      setIsAnalyzing(true);
      const response = await fetch(
        `${API_URL}/api/signals/refresh?mode=${mode}&days=120`,
        { method: 'POST' }
      );

      if (!response.ok) throw new Error('Failed to start analysis');

      const data = await response.json();

      if (data.task_id) {
        setCurrentTaskId(data.task_id);
        setShowProgress(true);
        toast.success('신호 분석을 시작했습니다', {
          description: mode === 'all' ? '모든 종목을 분석합니다' : '관심 종목만 분석합니다',
        });
      }
    } catch (error) {
      console.error('Error starting analysis:', error);
      toast.error('분석 시작 실패');
      setIsAnalyzing(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">신호 분석</h1>
          <p className="text-sm text-muted-foreground mt-1">
            등록된 종목의 매수 신호를 분석합니다.
          </p>
        </div>

        {/* 통계 카드 */}
        {signalData?.stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Activity className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-muted-foreground">총 신호</span>
              </div>
              <p className="text-xl font-bold text-foreground">{signalData.stats.total_signals}개</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">수익 중</span>
              </div>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">{signalData.stats.positive_returns}개</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-red-500 rotate-180" />
                <span className="text-xs text-muted-foreground">손실 중</span>
              </div>
              <p className="text-xl font-bold text-red-600 dark:text-red-400">{signalData.stats.negative_returns}개</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-muted-foreground">마지막 분석</span>
              </div>
              <p className="text-sm font-medium text-foreground">
                {signalData.analyzed_at ? formatDateTime(signalData.analyzed_at) : '-'}
              </p>
            </div>
          </div>
        )}

        {/* 분석 시작 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold text-foreground mb-4">신호 분석 실행</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 전체 분석 */}
            <button
              onClick={() => handleStartAnalysis('all')}
              disabled={isAnalyzing}
              className="flex items-center gap-4 p-4 bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              <div className="p-3 bg-primary/20 rounded-lg">
                <Play className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">전체 종목 분석</h3>
                <p className="text-sm text-muted-foreground">등록된 모든 종목의 신호를 분석합니다</p>
              </div>
            </button>

            {/* 관심 종목만 */}
            <button
              onClick={() => handleStartAnalysis('favorites')}
              disabled={isAnalyzing}
              className="flex items-center gap-4 p-4 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
            >
              <div className="p-3 bg-amber-500/20 rounded-lg">
                <TrendingUp className="w-6 h-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">관심 종목만 분석</h3>
                <p className="text-sm text-muted-foreground">태그가 지정된 종목만 빠르게 분석</p>
              </div>
            </button>
          </div>
        </div>

        {/* 진행 상황 */}
        {showProgress && progressData && (
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <div className="space-y-4">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RefreshCw className="h-5 w-5 text-primary animate-spin" />
                  <div>
                    <h3 className="font-semibold text-foreground">신호 분석 진행 중</h3>
                    <p className="text-sm text-muted-foreground">{progressData.message}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {progressData.current_item} / {progressData.total_items}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round((progressData.current_item / progressData.total_items) * 100)}% 완료
                  </p>
                </div>
              </div>

              {/* 프로그레스 바 */}
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary rounded-full h-2 transition-all duration-300 ease-out"
                  style={{
                    width: `${(progressData.current_item / progressData.total_items) * 100}%`,
                  }}
                />
              </div>

              {/* 현재 종목 */}
              {progressData.current_stock_name && (
                <p className="text-sm text-muted-foreground">
                  현재 분석 중: <span className="font-medium text-foreground">{progressData.current_stock_name}</span>
                </p>
              )}

              {/* 성공/실패 카운트 */}
              <div className="flex gap-4 text-sm">
                <span className="text-green-600 dark:text-green-400">
                  성공: {progressData.success_count}
                </span>
                {progressData.failed_count > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    실패: {progressData.failed_count}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
