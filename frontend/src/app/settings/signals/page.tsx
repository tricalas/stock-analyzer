'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, RefreshCw, StopCircle, CloudOff, Target, BarChart3, Trash2, Activity, LineChart } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const { user } = useAuth();
  const { formatTableDateTime } = useTimezone();

  // 추세선 분석 상태
  const [showProgress, setShowProgress] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<'all' | 'tagged'>('tagged');
  const [isDeleting, setIsDeleting] = useState(false);

  // MA 분석 상태
  const [showMAProgress, setShowMAProgress] = useState(false);
  const [maTaskId, setMATaskId] = useState<string | null>(null);
  const [maAnalysisMode, setMAAnalysisMode] = useState<'all' | 'tagged'>('tagged');
  const [isDeletingMA, setIsDeletingMA] = useState(false);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // 페이지 로드 시 실행 중인 작업 확인
  useEffect(() => {
    const checkRunningTask = async () => {
      try {
        // 추세선 분석 작업 확인
        const response = await fetch(`${API_URL}/api/tasks/latest/signal_analysis`);
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

      try {
        // MA 분석 작업 확인
        const maResponse = await fetch(`${API_URL}/api/tasks/latest/ma_signal_analysis`);
        if (maResponse.ok) {
          const maTask: TaskProgress = await maResponse.json();
          if (maTask.status === 'running') {
            setMATaskId(maTask.task_id);
            setShowMAProgress(true);
          }
        }
      } catch (error) {
        console.error('Error checking MA running task:', error);
      }
    };

    checkRunningTask();
  }, [API_URL]);

  // 진행 상황 조회
  const { data: progress } = useQuery<TaskProgress>({
    queryKey: ['signal-progress', taskId],
    queryFn: async () => {
      if (!taskId) return null;
      const response = await fetch(`${API_URL}/api/tasks/${taskId}`);
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

  // 시그널 통계 조회
  const { data: signalData, refetch: refetchSignals } = useQuery<SignalListResponse>({
    queryKey: ['signal-stats'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/signals?limit=1`);
      if (!response.ok) throw new Error('Failed to fetch signals');
      return response.json();
    },
  });

  // MA 진행 상황 조회
  const { data: maProgress } = useQuery<TaskProgress>({
    queryKey: ['ma-signal-progress', maTaskId],
    queryFn: async () => {
      if (!maTaskId) return null;
      const response = await fetch(`${API_URL}/api/tasks/${maTaskId}`);
      if (!response.ok) throw new Error('Failed to fetch MA task progress');
      return response.json();
    },
    enabled: !!maTaskId && showMAProgress,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled') {
        return false;
      }
      return 1000;
    },
  });

  // MA 시그널 통계 조회
  const { data: maSignalData, refetch: refetchMASignals } = useQuery<SignalListResponse>({
    queryKey: ['ma-signal-stats'],
    queryFn: async () => {
      const response = await fetch(`${API_URL}/api/signals/ma?limit=1`);
      if (!response.ok) throw new Error('Failed to fetch MA signals');
      return response.json();
    },
  });

  // 완료 시 처리
  useEffect(() => {
    if (progress?.status === 'completed') {
      refetchSignals();
      toast.success('시그널 분석이 완료되었습니다');
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 3000);
    } else if (progress?.status === 'failed') {
      toast.error('분석 실패', { description: progress.error_message });
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 3000);
    } else if (progress?.status === 'cancelled') {
      toast.info('분석이 취소되었습니다');
      setTimeout(() => {
        setShowProgress(false);
        setTaskId(null);
      }, 3000);
    }
  }, [progress?.status, progress?.error_message, refetchSignals]);

  // MA 완료 시 처리
  useEffect(() => {
    if (maProgress?.status === 'completed') {
      refetchMASignals();
      toast.success('MA 시그널 분석이 완료되었습니다');
      setTimeout(() => {
        setShowMAProgress(false);
        setMATaskId(null);
      }, 3000);
    } else if (maProgress?.status === 'failed') {
      toast.error('MA 분석 실패', { description: maProgress.error_message });
      setTimeout(() => {
        setShowMAProgress(false);
        setMATaskId(null);
      }, 3000);
    } else if (maProgress?.status === 'cancelled') {
      toast.info('MA 분석이 취소되었습니다');
      setTimeout(() => {
        setShowMAProgress(false);
        setMATaskId(null);
      }, 3000);
    }
  }, [maProgress?.status, maProgress?.error_message, refetchMASignals]);

  // 분석 시작
  const handleStart = async (mode: 'all' | 'tagged') => {
    try {
      setAnalysisMode(mode);
      const response = await fetch(
        `${API_URL}/api/signals/refresh?mode=${mode}&days=120&force_full=true`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Failed to start analysis');
      const data = await response.json();
      if (data.task_id) {
        setTaskId(data.task_id);
        setShowProgress(true);
        toast.success('시그널 분석이 시작되었습니다');
      }
    } catch (error) {
      console.error('Error starting analysis:', error);
      toast.error('분석 시작에 실패했습니다');
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

  // 시그널 삭제
  const handleDelete = async () => {
    if (!confirm('모든 시그널을 삭제하시겠습니까?')) return;
    try {
      setIsDeleting(true);
      const response = await fetch(`${API_URL}/api/signals`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete signals');
      toast.success('모든 시그널이 삭제되었습니다');
      refetchSignals();
    } catch (error) {
      console.error('Error deleting signals:', error);
      toast.error('삭제에 실패했습니다');
    } finally {
      setIsDeleting(false);
    }
  };

  // MA 분석 시작
  const handleMAStart = async (mode: 'all' | 'tagged') => {
    try {
      setMAAnalysisMode(mode);
      const response = await fetch(
        `${API_URL}/api/signals/ma/refresh?mode=${mode}&days=150&force_full=true`,
        { method: 'POST' }
      );
      if (!response.ok) throw new Error('Failed to start MA analysis');
      const data = await response.json();
      if (data.task_id) {
        setMATaskId(data.task_id);
        setShowMAProgress(true);
        toast.success('MA 시그널 분석이 시작되었습니다');
      }
    } catch (error) {
      console.error('Error starting MA analysis:', error);
      toast.error('MA 분석 시작에 실패했습니다');
    }
  };

  // MA 작업 취소
  const handleMACancel = async () => {
    if (!maTaskId) return;
    try {
      const token = localStorage.getItem('auth_token');
      const response = await fetch(`${API_URL}/api/tasks/${maTaskId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        toast.success('MA 작업이 취소되었습니다');
      }
    } catch (error) {
      console.error('Error cancelling MA task:', error);
      toast.error('MA 작업 취소에 실패했습니다');
    }
  };

  // MA 시그널 삭제
  const handleMADelete = async () => {
    if (!confirm('모든 MA 시그널을 삭제하시겠습니까?')) return;
    try {
      setIsDeletingMA(true);
      const response = await fetch(`${API_URL}/api/signals/ma`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete MA signals');
      toast.success('모든 MA 시그널이 삭제되었습니다');
      refetchMASignals();
    } catch (error) {
      console.error('Error deleting MA signals:', error);
      toast.error('MA 삭제에 실패했습니다');
    } finally {
      setIsDeletingMA(false);
    }
  };

  const isRunning = showProgress && progress?.status === 'running';
  const progressPercent = progress
    ? Math.round((progress.current_item / Math.max(progress.total_items, 1)) * 100)
    : 0;

  const isMARunning = showMAProgress && maProgress?.status === 'running';
  const maProgressPercent = maProgress
    ? Math.round((maProgress.current_item / Math.max(maProgress.total_items, 1)) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">시그널 분석</h1>
        <p className="text-sm text-muted-foreground mt-1">
          가격 데이터를 분석하여 매수/매도 시그널을 생성합니다.
        </p>
      </div>

      <Tabs defaultValue="ma" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ma" className="flex items-center gap-2">
            <LineChart className="w-4 h-4" />
            MA 시그널
          </TabsTrigger>
          <TabsTrigger value="trendline" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            추세선 시그널
          </TabsTrigger>
        </TabsList>

        {/* MA 시그널 탭 */}
        <TabsContent value="ma" className="space-y-6 mt-6">
          {/* MA 진행 상황 */}
          {showMAProgress && maProgress && (
            <Card className={
              maProgress.status === 'completed'
                ? 'border-green-500/30 bg-green-500/10'
                : maProgress.status === 'failed' || maProgress.status === 'cancelled'
                ? 'border-red-500/30 bg-red-500/10'
                : 'border-primary/30 bg-primary/10'
            }>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {maProgress.status === 'running' ? (
                        <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                      ) : maProgress.status === 'completed' ? (
                        <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                          <span className="text-white text-[10px]">✓</span>
                        </div>
                      ) : (
                        <StopCircle className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {maProgress.status === 'running' ? 'MA 분석 진행 중' :
                           maProgress.status === 'completed' ? 'MA 분석 완료' :
                           maProgress.status === 'cancelled' ? 'MA 분석 취소됨' : 'MA 분석 실패'}
                        </h4>
                        <p className="text-xs text-muted-foreground">{maProgress.message}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {maProgress.status === 'running' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleMACancel}
                          className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/20"
                        >
                          <StopCircle className="w-3 h-3 mr-1" />
                          취소
                        </Button>
                      )}
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">
                          {maProgress.current_item} / {maProgress.total_items}
                        </p>
                        <p className="text-xs text-muted-foreground">{maProgressPercent}%</p>
                      </div>
                    </div>
                  </div>

                  {maProgress.status === 'running' && (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                      <CloudOff className="w-3 h-3 mr-1" />
                      브라우저를 닫아도 작업이 계속 실행됩니다
                    </Badge>
                  )}

                  {/* 프로그레스 바 */}
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className={`rounded-full h-2 transition-all duration-300 ${
                        maProgress.status === 'completed' ? 'bg-green-500' :
                        maProgress.status === 'failed' || maProgress.status === 'cancelled' ? 'bg-red-500' : 'bg-primary'
                      }`}
                      style={{ width: `${maProgressPercent}%` }}
                    />
                  </div>

                  {maProgress.status === 'running' && maProgress.current_stock_name && (
                    <p className="text-xs text-muted-foreground">
                      분석 중: <span className="font-medium text-foreground">{maProgress.current_stock_name}</span>
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* MA 실행 카드 */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3">
                <LineChart className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle className="text-base">MA 시그널 분석 실행</CardTitle>
                  <CardDescription>이동평균 기반 시그널 (골든크로스, 지지/저항, 돌파, 배열)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Button
                  onClick={() => handleMAStart('tagged')}
                  disabled={isMARunning}
                  className="h-auto py-4 flex-col items-start gap-1"
                >
                  <div className="flex items-center gap-2 w-full">
                    <Target className="w-5 h-5" />
                    <span className="font-medium">관심 종목 분석</span>
                    {isMARunning && maAnalysisMode === 'tagged' && (
                      <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
                    )}
                  </div>
                  <span className="text-xs opacity-80 pl-7">태그된 종목만 빠르게</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={() => handleMAStart('all')}
                  disabled={isMARunning}
                  className="h-auto py-4 flex-col items-start gap-1"
                >
                  <div className="flex items-center gap-2 w-full">
                    <BarChart3 className="w-5 h-5" />
                    <span className="font-medium">전체 종목 분석</span>
                    {isMARunning && maAnalysisMode === 'all' && (
                      <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
                    )}
                  </div>
                  <span className="text-xs opacity-80 pl-7">모든 종목 대상</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* MA 현재 상태 카드 */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4" />
                  MA 시그널 현황
                </CardTitle>
                {(maSignalData?.total ?? 0) > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleMADelete}
                    disabled={isDeletingMA}
                    className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    {isDeletingMA ? '삭제 중...' : '전체 삭제'}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {maSignalData?.stats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-muted/50 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-foreground">{maSignalData.stats.total_signals}</p>
                    <p className="text-xs text-muted-foreground mt-1">총 시그널</p>
                  </div>
                  <div className="bg-green-500/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">{maSignalData.stats.positive_returns}</p>
                    <p className="text-xs text-muted-foreground mt-1">수익 중</p>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-4 text-center">
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">{maSignalData.stats.negative_returns}</p>
                    <p className="text-xs text-muted-foreground mt-1">손실 중</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {maSignalData.analyzed_at ? formatTableDateTime(maSignalData.analyzed_at) : '-'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">마지막 분석</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <LineChart className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">분석된 MA 시그널이 없습니다</p>
                  <p className="text-xs mt-1">위에서 분석을 실행해주세요</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 추세선 시그널 탭 */}
        <TabsContent value="trendline" className="space-y-6 mt-6">

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
                      {progress.status === 'running' ? '분석 진행 중' :
                       progress.status === 'completed' ? '분석 완료' :
                       progress.status === 'cancelled' ? '분석 취소됨' : '분석 실패'}
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
                  분석 중: <span className="font-medium text-foreground">{progress.current_stock_name}</span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 실행 카드 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-primary" />
            <div>
              <CardTitle className="text-base">시그널 분석 실행</CardTitle>
              <CardDescription>히스토리 데이터 기반 매수 시그널 생성</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button
              onClick={() => handleStart('tagged')}
              disabled={isRunning}
              className="h-auto py-4 flex-col items-start gap-1"
            >
              <div className="flex items-center gap-2 w-full">
                <Target className="w-5 h-5" />
                <span className="font-medium">관심 종목 분석</span>
                {isRunning && analysisMode === 'tagged' && (
                  <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
                )}
              </div>
              <span className="text-xs opacity-80 pl-7">태그된 종목만 빠르게</span>
            </Button>

            <Button
              variant="outline"
              onClick={() => handleStart('all')}
              disabled={isRunning}
              className="h-auto py-4 flex-col items-start gap-1"
            >
              <div className="flex items-center gap-2 w-full">
                <BarChart3 className="w-5 h-5" />
                <span className="font-medium">전체 종목 분석</span>
                {isRunning && analysisMode === 'all' && (
                  <RefreshCw className="w-4 h-4 ml-auto animate-spin" />
                )}
              </div>
              <span className="text-xs opacity-80 pl-7">모든 종목 대상</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 현재 상태 카드 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              현재 시그널 현황
            </CardTitle>
            {(signalData?.total ?? 0) > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                className="h-7 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-3 h-3 mr-1" />
                {isDeleting ? '삭제 중...' : '전체 삭제'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {signalData?.stats ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{signalData.stats.total_signals}</p>
                <p className="text-xs text-muted-foreground mt-1">총 시그널</p>
              </div>
              <div className="bg-green-500/10 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{signalData.stats.positive_returns}</p>
                <p className="text-xs text-muted-foreground mt-1">수익 중</p>
              </div>
              <div className="bg-red-500/10 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">{signalData.stats.negative_returns}</p>
                <p className="text-xs text-muted-foreground mt-1">손실 중</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4 text-center">
                <p className="text-sm font-medium text-foreground">
                  {signalData.analyzed_at ? formatTableDateTime(signalData.analyzed_at) : '-'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">마지막 분석</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">분석된 시그널이 없습니다</p>
              <p className="text-xs mt-1">위에서 분석을 실행해주세요</p>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
