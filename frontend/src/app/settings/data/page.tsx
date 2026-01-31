'use client';

import { useState, useEffect } from 'react';
import { Database, RefreshCw, Clock, StopCircle, CloudOff, Play, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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
  const [collectionDays, setCollectionDays] = useState('120');
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
      refetchLogs();
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
        days: collectionDays,
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
        <Card className={
          progress.status === 'completed'
            ? 'border-green-500/30 bg-green-500/10'
            : progress.status === 'failed' || progress.status === 'cancelled'
            ? 'border-red-500/30 bg-red-500/10'
            : 'border-primary/30 bg-primary/10'
        }>
          <CardContent className="pt-4">
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
                       progress.status === 'completed' ? '수집 완료' :
                       progress.status === 'cancelled' ? '수집 취소됨' : '수집 실패'}
                    </h4>
                    <p className="text-xs text-muted-foreground">{progress.message}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {progress.status === 'running' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCancel}
                      className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20"
                    >
                      <StopCircle className="w-3 h-3 mr-1" />
                      취소
                    </Button>
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
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                  <CloudOff className="w-3 h-3 mr-1" />
                  브라우저를 닫아도 작업이 계속 실행됩니다
                </Badge>
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
          </CardContent>
        </Card>
      )}

      {/* 실행 카드 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="text-base">히스토리 데이터 수집</CardTitle>
                <CardDescription>
                  {collectionMode === 'all' ? '모든 종목' : '태그된 종목'} · {collectionDays}일
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings2 className="w-4 h-4 mr-1" />
                설정
              </Button>
              <Button onClick={handleStart} disabled={isRunning}>
                {isRunning ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 mr-2" />
                )}
                {isRunning ? '수집 중...' : '수집 시작'}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* 설정 패널 */}
        {showSettings && (
          <CardContent className="pt-0">
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>수집 대상</Label>
                  <Select value={collectionMode} onValueChange={(v) => setCollectionMode(v as 'all' | 'tagged')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">모든 종목</SelectItem>
                      <SelectItem value="tagged">태그된 종목만</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>수집 일수</Label>
                  <Select value={collectionDays} onValueChange={setCollectionDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="60">60일</SelectItem>
                      <SelectItem value="90">90일</SelectItem>
                      <SelectItem value="120">120일 (권장)</SelectItem>
                      <SelectItem value="180">180일</SelectItem>
                      <SelectItem value="365">365일</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 히스토리 */}
      {logs && logs.length > 0 && (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4" />
              수집 기록
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                      {log.success_count}개 성공
                    </Badge>
                    {log.failed_count > 0 && (
                      <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
                        {log.failed_count}개 실패
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs">
                      ({log.total_records_saved.toLocaleString()}건)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
