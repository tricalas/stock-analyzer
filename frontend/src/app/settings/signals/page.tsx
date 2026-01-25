'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp,
  RefreshCw,
  Activity,
  Clock,
  Play,
  StopCircle,
  CloudOff,
  Trash2,
  Zap,
  Target,
  BarChart3
} from 'lucide-react';
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

  // 페이지 로드 시 실행 중인 작업 확인
  useEffect(() => {
    const checkRunningTask = async () => {
      try {
        const response = await fetch(`${API_URL}/api/tasks/latest/signal_analysis`);
        if (response.ok) {
          const task: TaskProgress = await response.json();
          if (task.status === 'running') {
            setCurrentTaskId(task.task_id);
            setShowProgress(true);
            setIsAnalyzing(true);
          }
        }
      } catch (error) {
        console.error('Error checking running task:', error);
      }
    };
    checkRunningTask();
  }, [API_URL]);

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
      return 1000;
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
        toast.success('신호 분석이 완료되었습니다');
      }, 1500);
    } else if (progressData?.status === 'failed') {
      setShowProgress(false);
      setCurrentTaskId(null);
      setIsAnalyzing(false);
      toast.error('분석 실패', { description: progressData.error_message });
    } else if (progressData?.status === 'cancelled') {
      setShowProgress(false);
      setCurrentTaskId(null);
      setIsAnalyzing(false);
      toast.info('분석이 취소되었습니다');
    }
  }, [progressData?.status, progressData?.error_message, refetchSignals]);

  // 작업 취소
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
      if (response.ok) {
        toast.success('작업이 취소되었습니다');
      }
    } catch (error) {
      console.error('Error cancelling task:', error);
      toast.error('작업 취소에 실패했습니다');
    }
  };

  // 신호 삭제
  const handleDeleteSignals = async () => {
    if (!confirm('모든 신호를 삭제하시겠습니까?')) return;
    try {
      setIsDeleting(true);
      const response = await fetch(`${API_URL}/api/signals`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete signals');
      toast.success('모든 신호가 삭제되었습니다');
      refetchSignals();
    } catch (error) {
      console.error('Error deleting signals:', error);
      toast.error('삭제에 실패했습니다');
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
      }
    } catch (error) {
      console.error('Error starting analysis:', error);
      toast.error('분석 시작에 실패했습니다');
      setIsAnalyzing(false);
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const progressPercent = progressData
    ? Math.round((progressData.current_item / progressData.total_items) * 100)
    : 0;

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">신호 분석</h1>
          <p className="text-sm text-muted-foreground mt-1">
            하락 추세선 돌파 패턴을 분석하여 매수 신호를 생성합니다
          </p>
        </div>

        {/* 진행 상황 (최상단 표시) */}
        {showProgress && progressData && (
          <div className={`border rounded-lg p-4 ${
            progressData.status === 'completed'
              ? 'bg-green-500/10 border-green-500/30'
              : progressData.status === 'failed' || progressData.status === 'cancelled'
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-primary/10 border-primary/30'
          }`}>
            <div className="space-y-3">
              {/* 헤더 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {progressData.status === 'running' ? (
                    <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                  ) : progressData.status === 'completed' ? (
                    <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                      <span className="text-white text-[10px]">✓</span>
                    </div>
                  ) : (
                    <StopCircle className="h-4 w-4 text-red-500" />
                  )}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">
                      {progressData.status === 'running' ? '분석 진행 중' :
                       progressData.status === 'completed' ? '분석 완료' : '분석 중단'}
                    </h4>
                    <p className="text-xs text-muted-foreground">{progressData.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
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
                    <p className="text-xs text-muted-foreground">{progressPercent}%</p>
                  </div>
                </div>
              </div>

              {/* 브라우저 독립 실행 안내 */}
              {progressData.status === 'running' && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded w-fit">
                  <CloudOff className="w-3 h-3" />
                  브라우저를 닫아도 작업이 계속 실행됩니다
                </div>
              )}

              {/* 프로그레스 바 */}
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`rounded-full h-2 transition-all duration-300 ease-out ${
                    progressData.status === 'completed' ? 'bg-green-500' :
                    progressData.status === 'failed' || progressData.status === 'cancelled' ? 'bg-red-500' : 'bg-primary'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* 현재 종목 */}
              {progressData.status === 'running' && progressData.current_stock_name && (
                <p className="text-xs text-muted-foreground">
                  분석 중: <span className="font-medium text-foreground">{progressData.current_stock_name}</span>
                </p>
              )}
            </div>
          </div>
        )}

        {/* 분석 실행 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-foreground">신호 분석 실행</h2>
                <p className="text-sm text-muted-foreground">
                  120일간 가격 데이터를 분석하여 매수 신호 생성
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => handleStartAnalysis('tagged')}
              disabled={isAnalyzing}
              className="flex items-center gap-3 p-4 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Target className="w-5 h-5" />
              <div className="text-left">
                <p className="font-medium">관심 종목 분석</p>
                <p className="text-xs opacity-80">태그된 종목만 빠르게</p>
              </div>
              {isAnalyzing && <RefreshCw className="w-4 h-4 ml-auto animate-spin" />}
            </button>

            <button
              onClick={() => handleStartAnalysis('all')}
              disabled={isAnalyzing}
              className="flex items-center gap-3 p-4 bg-muted hover:bg-muted/80 border border-border rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
              <div className="text-left">
                <p className="font-medium text-foreground">전체 종목 분석</p>
                <p className="text-xs text-muted-foreground">모든 종목 대상</p>
              </div>
            </button>
          </div>
        </div>

        {/* 현재 상태 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">현재 신호 현황</h2>
            </div>
            {(signalData?.total ?? 0) > 0 && (
              <button
                onClick={handleDeleteSignals}
                disabled={isDeleting}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {isDeleting ? '삭제 중...' : '전체 삭제'}
              </button>
            )}
          </div>

          {signalData?.stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{signalData.stats.total_signals}</p>
                <p className="text-xs text-muted-foreground">총 신호</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{signalData.stats.positive_returns}</p>
                <p className="text-xs text-muted-foreground">수익 중</p>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{signalData.stats.negative_returns}</p>
                <p className="text-xs text-muted-foreground">손실 중</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {signalData.analyzed_at ? formatDateTime(signalData.analyzed_at) : '-'}
                </p>
                <p className="text-xs text-muted-foreground">마지막 분석</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">분석된 신호가 없습니다</p>
              <p className="text-xs mt-1">위에서 분석을 실행해주세요</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
