'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Clock, StopCircle, CloudOff, Play } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useTimezone } from '@/hooks/useTimezone';

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

interface StockCrawlLog {
  id: number;
  task_id: string;
  status: string;
  market: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  started_at: string;
  completed_at?: string;
}

export default function StockCrawlPage() {
  const { user } = useAuth();
  const { formatTableDateTime } = useTimezone();
  const [showProgress, setShowProgress] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 페이지 로드 시 실행 중인 작업 확인
  useEffect(() => {
    const checkRunningTask = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        const response = await fetch(`${API_URL}/api/tasks/latest/stock_crawl`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (response.ok) {
          const task: TaskProgress = await response.json();
          if (task.status === 'running') {
            setTaskId(task.task_id);
            setShowProgress(true);
          }
        }
      } catch (error) {
        console.error('Error checking running task:', error);
      }
    };

    checkRunningTask();
  }, [API_URL]);

  // 진행 상황 조회
  const { data: progress } = useQuery<TaskProgress>({
    queryKey: ['crawl-progress', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const token = localStorage.getItem('auth_token');
      if (!token) return null;

      const response = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Failed to fetch task progress');
      return response.json();
    },
    enabled: !!taskId && showProgress,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 1000;
    },
  });

  // 히스토리 조회
  const { data: logs, refetch: refetchLogs } = useQuery<StockCrawlLog[]>({
    queryKey: ['crawl-logs'],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch(`${API_URL}/api/crawl/logs?limit=20`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user?.is_admin,
  });

  // 완료 시 처리
  useEffect(() => {
    if (progress?.status === 'completed') {
      refetchLogs();
      toast.success('종목 수집이 완료되었습니다');
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 3000);
    } else if (progress?.status === 'failed') {
      toast.error('수집 실패', { description: progress.error_message });
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 3000);
    }
  }, [progress?.status, progress?.error_message, refetchLogs]);

  // 수집 시작
  const handleStart = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      const response = await fetch(`${API_URL}/api/crawl/stocks?market=US`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 429) {
          const data = await response.json();
          toast.error(data.detail || '쿨타임입니다. 잠시 후 다시 시도해주세요.');
          return;
        }
        throw new Error('Failed to start crawl');
      }

      const result = await response.json();
      if (result.task_id) {
        setTaskId(result.task_id);
        setShowProgress(true);
        toast.success('종목 수집이 시작되었습니다');
      }
    } catch (error) {
      console.error('Error starting crawl:', error);
      toast.error('수집 시작에 실패했습니다');
    }
  };

  const isRunning = showProgress && progress?.status === 'running';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">종목 수집</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Naver Finance에서 NASDAQ/NYSE 종목의 현재가, 등락률, 시가총액을 수집합니다.
        </p>
      </div>

      {/* 진행 상황 */}
      {showProgress && progress && (
        <div className={`border rounded-lg p-4 ${
          progress.status === 'completed'
            ? 'bg-green-500/10 border-green-500/30'
            : progress.status === 'failed'
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-primary/10 border-primary/30'
        }`}>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {progress.status === 'running' ? (
                  <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                ) : progress.status === 'completed' ? (
                  <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                    <span className="text-white text-[10px]">✓</span>
                  </div>
                ) : (
                  <StopCircle className="h-4 w-4 text-red-500" />
                )}
                <div>
                  <h4 className="text-sm font-semibold text-foreground">
                    {progress.status === 'running' ? '수집 진행 중' :
                     progress.status === 'completed' ? '수집 완료' : '수집 실패'}
                  </h4>
                  <p className="text-xs text-muted-foreground">{progress.message}</p>
                </div>
              </div>
              {progress.status === 'completed' && (
                <div className="text-right text-sm">
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {progress.success_count}개 성공
                  </span>
                  {progress.failed_count > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-2">
                      {progress.failed_count}개 실패
                    </span>
                  )}
                </div>
              )}
            </div>

            {progress.status === 'running' && (
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded w-fit">
                <CloudOff className="w-3 h-3" />
                브라우저를 닫아도 작업이 계속 실행됩니다
              </div>
            )}
          </div>
        </div>
      )}

      {/* 실행 카드 */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-foreground">주식 목록 업데이트</h2>
              <p className="text-sm text-muted-foreground">
                약 20초 소요 · 10분 쿨타임
              </p>
            </div>
          </div>
          <button
            onClick={handleStart}
            disabled={isRunning}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {isRunning ? '수집 중...' : '수집 시작'}
          </button>
        </div>
      </div>

      {/* 히스토리 */}
      {logs && logs.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            수집 기록
          </h3>
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`flex items-center justify-between text-sm px-4 py-3 rounded-lg ${
                  log.status === 'completed'
                    ? 'bg-green-500/5'
                    : log.status === 'running'
                    ? 'bg-blue-500/5'
                    : 'bg-red-500/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${
                    log.status === 'completed' ? 'text-green-500' :
                    log.status === 'running' ? 'text-blue-500' : 'text-red-500'
                  }`}>
                    {log.status === 'completed' ? '✓' : log.status === 'running' ? '⟳' : '✗'}
                  </span>
                  <span className="text-foreground">
                    {formatTableDateTime(log.started_at)}
                  </span>
                </div>
                <div>
                  {log.status === 'completed' ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">
                      {log.success_count}개 종목
                    </span>
                  ) : log.status === 'running' ? (
                    <span className="text-blue-500">진행 중...</span>
                  ) : (
                    <span className="text-red-500">실패</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
