'use client';

import { useState, useEffect } from 'react';
import { Database, RefreshCw, Clock, StopCircle, CloudOff, Play, Settings2 } from 'lucide-react';
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

interface HistoryCollectionSummary {
  task_id: string;
  started_at: string;
  completed_at?: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  total_records_saved: number;
}

export default function HistoryCollectionPage() {
  const { user } = useAuth();
  const { formatTableDateTime } = useTimezone();
  const [showProgress, setShowProgress] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);

  // 설정
  const [collectionDays, setCollectionDays] = useState(120);
  const [collectionMode, setCollectionMode] = useState<'all' | 'tagged'>('all');
  const [showSettings, setShowSettings] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 페이지 로드 시 실행 중인 작업 확인
  useEffect(() => {
    const checkRunningTask = async () => {
      try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        const response = await fetch(`${API_URL}/api/tasks/latest/history_collection`, {
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
    queryKey: ['history-progress', taskId],
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
      if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled') {
        return false;
      }
      return 1000;
    },
  });

  // 히스토리 조회
  const { data: logs, refetch: refetchLogs } = useQuery<HistoryCollectionSummary[]>({
    queryKey: ['history-logs'],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch(`${API_URL}/api/history-logs?limit=20`, {
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
      toast.success('히스토리 수집이 완료되었습니다');
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 5000);
    } else if (progress?.status === 'failed') {
      toast.error('수집 실패', { description: progress.error_message });
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 5000);
    } else if (progress?.status === 'cancelled') {
      toast.info('수집이 취소되었습니다');
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

      const params = new URLSearchParams({
        mode: collectionMode,
        days: collectionDays.toString(),
        workers: '5',
      });

      const response = await fetch(`${API_URL}/api/stocks/collect-history?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to start collection');
      }

      const result = await response.json();
      if (result.task_id) {
        setTaskId(result.task_id);
        setShowProgress(true);
        toast.success('히스토리 수집이 시작되었습니다');
      }
    } catch (error) {
      console.error('Error starting collection:', error);
      toast.error('수집 시작에 실패했습니다');
    }
  };

  // 작업 취소
  const handleCancel = async () => {
    if (!taskId) return;
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/tasks/${taskId}/cancel`, {
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

  const isRunning = showProgress && progress?.status === 'running';
  const progressPercent = progress
    ? Math.round((progress.current_item / Math.max(progress.total_items, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">히스토리 수집</h1>
        <p className="text-sm text-muted-foreground mt-1">
          KIS API에서 종목별 일봉 데이터(OHLCV)를 수집합니다. 스마트 수집으로 중복 API 호출을 최소화합니다.
        </p>
      </div>

      {/* 진행 상황 */}
      {showProgress && progress && (
        <div className={`border rounded-lg p-4 ${
          progress.status === 'completed'
            ? 'bg-green-500/10 border-green-500/30'
            : progress.status === 'failed' || progress.status === 'cancelled'
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
                     progress.status === 'completed' ? '수집 완료' : '수집 중단'}
                  </h4>
                  <p className="text-xs text-muted-foreground">{progress.message}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {progress.status === 'running' && (
                  <button
                    onClick={handleCancel}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded transition-colors"
                  >
                    <StopCircle className="w-3 h-3" />
                    취소
                  </button>
                )}
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {progress.current_item} / {progress.total_items}
                  </p>
                  <p className="text-xs text-muted-foreground">{progressPercent}%</p>
                </div>
              </div>
            </div>

            {progress.status === 'running' && (
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded w-fit">
                <CloudOff className="w-3 h-3" />
                브라우저를 닫아도 작업이 계속 실행됩니다
              </div>
            )}

            {/* 프로그레스 바 */}
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className={`rounded-full h-2 transition-all duration-300 ${
                  progress.status === 'completed' ? 'bg-green-500' :
                  progress.status === 'failed' || progress.status === 'cancelled' ? 'bg-red-500' : 'bg-primary'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {progress.status === 'running' && progress.current_stock_name && (
              <p className="text-xs text-muted-foreground">
                수집 중: <span className="font-medium text-foreground">{progress.current_stock_name}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* 실행 카드 */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-semibold text-foreground">히스토리 데이터 수집</h2>
              <p className="text-sm text-muted-foreground">
                {collectionMode === 'all' ? '모든 종목' : '태그된 종목'} · {collectionDays}일
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <Settings2 className="w-4 h-4" />
              설정
            </button>
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

        {/* 설정 패널 */}
        {showSettings && (
          <div className="bg-muted/30 border border-border rounded-lg p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  수집 대상
                </label>
                <select
                  value={collectionMode}
                  onChange={(e) => setCollectionMode(e.target.value as 'all' | 'tagged')}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="all">모든 종목</option>
                  <option value="tagged">태그된 종목만</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                  수집 일수
                </label>
                <select
                  value={collectionDays}
                  onChange={(e) => setCollectionDays(parseInt(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value={60}>60일</option>
                  <option value={90}>90일</option>
                  <option value={120}>120일 (권장)</option>
                  <option value={180}>180일</option>
                  <option value={365}>365일</option>
                </select>
              </div>
            </div>
          </div>
        )}
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
                key={log.task_id}
                className={`flex items-center justify-between text-sm px-4 py-3 rounded-lg ${
                  log.failed_count === 0
                    ? 'bg-green-500/5'
                    : 'bg-yellow-500/5'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${
                    log.failed_count === 0 ? 'text-green-500' : 'text-yellow-500'
                  }`}>
                    {log.failed_count === 0 ? '✓' : '⚠'}
                  </span>
                  <span className="text-foreground">
                    {formatTableDateTime(log.started_at)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {log.success_count}개 성공
                  </span>
                  {log.failed_count > 0 && (
                    <span className="text-red-600 dark:text-red-400 ml-2">
                      {log.failed_count}개 실패
                    </span>
                  )}
                  <span className="text-muted-foreground ml-2">
                    ({log.total_records_saved.toLocaleString()}건)
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
