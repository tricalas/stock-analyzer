'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, RefreshCw, Activity, Calendar, Play, StopCircle, CloudOff, Trash2 } from 'lucide-react';
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
  const [isDeleting, setIsDeleting] = useState(false);
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
      if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled') {
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
    } else if (progressData?.status === 'cancelled') {
      setShowProgress(false);
      setCurrentTaskId(null);
      setIsAnalyzing(false);
      toast.info('분석 취소됨', {
        description: '사용자에 의해 작업이 취소되었습니다',
      });
    }
  }, [progressData?.status, progressData?.message, progressData?.error_message, refetchSignals]);

  // 작업 취소 함수
  const handleCancelTask = async () => {
    if (!currentTaskId) return;

    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/tasks/${currentTaskId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to cancel task');
      }

      const result = await response.json();
      if (result.success) {
        toast.success('작업이 취소되었습니다.');
      } else {
        toast.info(result.message);
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      toast.error('작업 취소에 실패했습니다.');
    }
  };

  // 신호 삭제
  const handleDeleteSignals = async () => {
    if (!confirm('모든 신호를 삭제하시겠습니까?')) return;

    try {
      setIsDeleting(true);
      const response = await fetch(`${API_URL}/api/signals`, { method: 'DELETE' });

      if (!response.ok) throw new Error('Failed to delete signals');

      const data = await response.json();
      toast.success('신호 삭제 완료', {
        description: data.message || '모든 신호가 삭제되었습니다',
      });
      refetchSignals();
    } catch (error) {
      console.error('Error deleting signals:', error);
      toast.error('삭제 실패', {
        description: '잠시 후 다시 시도해주세요',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // 신호 분석 시작
  const handleStartAnalysis = async (mode: 'all' | 'tagged' = 'all') => {
    try {
      setIsAnalyzing(true);
      const response = await fetch(
        `${API_URL}/api/signals/refresh?mode=${mode}&days=120&force_full=true`,
        { method: 'POST' }
      );

      if (!response.ok) throw new Error('Failed to start analysis');

      const data = await response.json();

      if (data.task_id) {
        setCurrentTaskId(data.task_id);
        setShowProgress(true);
        toast.success('신호 분석을 시작했습니다', {
          description: mode === 'all' ? '모든 종목을 분석합니다' : '태그된 종목만 분석합니다',
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
              onClick={() => handleStartAnalysis('tagged')}
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

        {/* 신호 삭제 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="font-semibold text-foreground mb-4">신호 삭제</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">
                저장된 모든 매매 신호를 삭제합니다.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                현재 {signalData?.total || 0}개의 신호가 저장되어 있습니다.
              </p>
            </div>
            <button
              onClick={handleDeleteSignals}
              disabled={isDeleting || !signalData?.total}
              className="flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" />
              {isDeleting ? '삭제 중...' : '전체 삭제'}
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
                <div className="flex items-center gap-3">
                  {/* 취소 버튼 */}
                  {progressData.status === 'running' && (
                    <button
                      onClick={handleCancelTask}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded transition-colors"
                    >
                      <StopCircle className="w-3 h-3" />
                      취소
                    </button>
                  )}
                  <div className="text-right">
                    <p className="text-sm font-medium text-foreground">
                      {progressData.current_item} / {progressData.total_items}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round((progressData.current_item / progressData.total_items) * 100)}% 완료
                    </p>
                  </div>
                </div>
              </div>

              {/* 브라우저 독립 실행 안내 */}
              {progressData.status === 'running' && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
                  <CloudOff className="w-3 h-3" />
                  브라우저를 닫아도 작업이 계속 실행됩니다
                </div>
              )}

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
