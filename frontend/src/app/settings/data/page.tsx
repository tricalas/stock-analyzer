'use client';

import { useState, useEffect } from 'react';
import { Database, RefreshCw, X, Settings2, Zap, Clock, SkipForward, TrendingUp, Download, StopCircle, CloudOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';

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

interface HistoryCollectionLog {
  id: number;
  task_id: string;
  stock_id: number;
  stock_symbol: string;
  stock_name: string;
  status: string;
  records_saved: number;
  error_message?: string;
  started_at: string;
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

interface CollectionResult {
  success: boolean;
  message: string;
  task_id: string;
  days: number;
  mode: string;
  workers: number;
}

export default function DataCollectionPage() {
  const { user } = useAuth();
  const [showHistoryProgress, setShowHistoryProgress] = useState(false);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null);

  // 수집 설정
  const [collectionDays, setCollectionDays] = useState(120);
  const [collectionMode, setCollectionMode] = useState<'all' | 'tagged'>('all');
  const [workerCount, setWorkerCount] = useState(5);
  const [showSettings, setShowSettings] = useState(false);

  // 수집 결과 통계
  const [collectionStats, setCollectionStats] = useState<{
    skipped: number;
    incremental: number;
    full_collected: number;
    total_records: number;
    workers: number;
  } | null>(null);

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
            setHistoryTaskId(task.task_id);
            setShowHistoryProgress(true);
          }
        }
      } catch (error) {
        console.error('Error checking running task:', error);
      }
    };

    checkRunningTask();
  }, [API_URL]);

  // 히스토리 수집 진행 상황 조회
  const { data: historyProgress } = useQuery<TaskProgress>({
    queryKey: ['history-progress', historyTaskId],
    queryFn: async () => {
      if (!historyTaskId) return null;
      const token = localStorage.getItem('auth_token');
      if (!token) return null;

      const response = await fetch(`${API_URL}/api/tasks/${historyTaskId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error('Failed to fetch task progress');
      return response.json();
    },
    enabled: !!historyTaskId && showHistoryProgress,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'completed' || data?.status === 'failed' || data?.status === 'cancelled') {
        return false;
      }
      return 1000; // 1초마다 업데이트
    },
  });

  // 진행 상황 완료 시 자동 숨김
  useEffect(() => {
    if (historyProgress?.status === 'completed' || historyProgress?.status === 'failed' || historyProgress?.status === 'cancelled') {
      setTimeout(() => {
        setShowHistoryProgress(false);
        setHistoryTaskId(null);
      }, 10000); // 10초 후 숨김
    }
  }, [historyProgress?.status]);

  // 히스토리 수집 시작 함수
  const handleStartHistoryCollection = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      const params = new URLSearchParams({
        mode: collectionMode,
        days: collectionDays.toString(),
        workers: workerCount.toString(),
      });

      const response = await fetch(`${API_URL}/api/stocks/collect-history?${params}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          toast.error('인증이 만료되었습니다. 다시 로그인해주세요.');
          return;
        }
        throw new Error('Failed to start history collection');
      }

      const result: CollectionResult = await response.json();

      if (result.task_id) {
        setHistoryTaskId(result.task_id);
        setShowHistoryProgress(true);
        setCollectionStats(null);
        toast.success(result.message || '히스토리 수집이 시작되었습니다.');
      }
    } catch (error) {
      console.error('Error starting history collection:', error);
      toast.error('히스토리 수집 시작에 실패했습니다.');
    }
  };

  // 수집 로그 조회 (작업 완료 시)
  const { data: collectionLogs } = useQuery<HistoryCollectionLog[]>({
    queryKey: ['collection-logs', historyTaskId],
    queryFn: async () => {
      if (!historyTaskId) return [];
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch(`${API_URL}/api/tasks/${historyTaskId}/logs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!historyTaskId && historyProgress?.status === 'completed',
  });

  // 이전 수집 히스토리 목록 조회
  const { data: historySummaries, refetch: refetchHistorySummaries } = useQuery<HistoryCollectionSummary[]>({
    queryKey: ['history-summaries'],
    queryFn: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch(`${API_URL}/api/history-logs?limit=20`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user?.is_admin,
  });

  // 선택한 히스토리의 상세 로그 조회
  const { data: selectedHistoryLogs } = useQuery<HistoryCollectionLog[]>({
    queryKey: ['selected-history-logs', selectedHistoryTaskId],
    queryFn: async () => {
      if (!selectedHistoryTaskId) return [];
      const token = localStorage.getItem('auth_token');
      if (!token) return [];

      const response = await fetch(`${API_URL}/api/tasks/${selectedHistoryTaskId}/logs`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!selectedHistoryTaskId,
  });

  // 수집 완료 시 히스토리 목록 새로고침
  useEffect(() => {
    if (historyProgress?.status === 'completed') {
      refetchHistorySummaries();

      // 메시지에서 통계 파싱 시도
      const message = historyProgress.message || '';
      const skippedMatch = message.match(/스킵[:\s]*(\d+)/);
      const incMatch = message.match(/증분[:\s]*(\d+)/);
      const fullMatch = message.match(/전체[:\s]*(\d+)/);
      const recordsMatch = message.match(/(\d+)개 레코드/);

      if (skippedMatch || incMatch || fullMatch) {
        setCollectionStats({
          skipped: skippedMatch ? parseInt(skippedMatch[1]) : 0,
          incremental: incMatch ? parseInt(incMatch[1]) : 0,
          full_collected: fullMatch ? parseInt(fullMatch[1]) : 0,
          total_records: recordsMatch ? parseInt(recordsMatch[1]) : 0,
          workers: workerCount,
        });
      }
    }
  }, [historyProgress?.status, historyProgress?.message, refetchHistorySummaries, workerCount]);

  // 실패한 종목 재시도 함수
  const handleRetryFailed = async () => {
    if (!historyTaskId) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks/${historyTaskId}/retry-failed?days=${collectionDays}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          toast.error('인증이 만료되었습니다. 다시 로그인해주세요.');
          return;
        }
        throw new Error('Failed to retry');
      }

      const result = await response.json();

      if (result.success && result.task_id) {
        setHistoryTaskId(result.task_id);
        setShowHistoryProgress(true);
        toast.success(result.message || '실패 종목 재시도가 시작되었습니다.');
      } else {
        toast.info(result.message || '재시도할 실패 종목이 없습니다.');
      }
    } catch (error) {
      console.error('Error retrying failed stocks:', error);
      toast.error('재시도 시작에 실패했습니다.');
    }
  };

  const failedCount = collectionLogs?.filter(log => log.status === 'failed').length || 0;

  // 작업 취소 함수
  const handleCancelTask = async () => {
    if (!historyTaskId) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks/${historyTaskId}/cancel`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
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

  // 진행률 계산
  const progressPercent = historyProgress
    ? Math.round((historyProgress.current_item / historyProgress.total_items) * 100)
    : 0;

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">데이터 수집</h1>
          <p className="text-sm text-muted-foreground mt-1">
            종목 히스토리 데이터를 수집하고 관리합니다. 하이브리드 전략으로 효율적으로 수집합니다.
          </p>
        </div>

        {/* 하이브리드 전략 설명 */}
        <div className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-500" />
            하이브리드 수집 전략
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="flex items-start gap-2">
              <SkipForward className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-green-600 dark:text-green-400">스킵</span>
                <p className="text-muted-foreground">이미 최신 데이터가 있으면 API 호출 없이 건너뜀</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <TrendingUp className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-blue-600 dark:text-blue-400">증분 수집</span>
                <p className="text-muted-foreground">빠진 날짜만 추가 수집 (효율적)</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Download className="w-4 h-4 text-purple-500 mt-0.5 flex-shrink-0" />
              <div>
                <span className="font-medium text-purple-600 dark:text-purple-400">전체 수집</span>
                <p className="text-muted-foreground">데이터 없거나 부족하면 전체 수집</p>
              </div>
            </div>
          </div>
        </div>

        {/* 수집 시작 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-foreground">히스토리 데이터 수집</h2>
                <p className="text-sm text-muted-foreground">
                  {collectionMode === 'all' ? '모든 종목' : '태그된 종목'}의 {collectionDays}일간 데이터를 {workerCount}개 워커로 병렬 수집
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
                onClick={handleStartHistoryCollection}
                disabled={showHistoryProgress && historyProgress?.status === 'running'}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${showHistoryProgress && historyProgress?.status === 'running' ? 'animate-spin' : ''}`} />
                수집 시작
              </button>
            </div>
          </div>

          {/* 설정 패널 */}
          {showSettings && (
            <div className="bg-muted/30 border border-border rounded-lg p-4 mb-4 space-y-4">
              <h4 className="text-sm font-semibold text-foreground">수집 설정</h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 수집 모드 */}
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

                {/* 수집 일수 */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    수집 일수
                  </label>
                  <select
                    value={collectionDays}
                    onChange={(e) => setCollectionDays(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value={30}>30일</option>
                    <option value={60}>60일</option>
                    <option value={90}>90일</option>
                    <option value={120}>120일 (권장)</option>
                    <option value={180}>180일</option>
                    <option value={365}>365일</option>
                  </select>
                </div>

                {/* 워커 수 */}
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    병렬 워커 수
                  </label>
                  <select
                    value={workerCount}
                    onChange={(e) => setWorkerCount(parseInt(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value={1}>1개 (느림)</option>
                    <option value={3}>3개</option>
                    <option value={5}>5개 (권장)</option>
                    <option value={10}>10개 (빠름)</option>
                    <option value={15}>15개</option>
                    <option value={20}>20개 (최대)</option>
                  </select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    워커가 많을수록 빠르지만 API 제한에 주의
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 히스토리 수집 진행 상황 */}
          {showHistoryProgress && historyProgress && (
            <div className={`border rounded-lg p-4 mb-4 ${
              historyProgress.status === 'completed'
                ? 'bg-green-500/10 border-green-500/30'
                : historyProgress.status === 'failed' || historyProgress.status === 'cancelled'
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-primary/10 border-primary/30'
            }`}>
              <div className="space-y-3">
                {/* 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {historyProgress.status === 'running' ? (
                      <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                    ) : historyProgress.status === 'completed' ? (
                      <div className="h-4 w-4 rounded-full bg-green-500 flex items-center justify-center">
                        <span className="text-white text-[10px]">✓</span>
                      </div>
                    ) : historyProgress.status === 'cancelled' ? (
                      <div className="h-4 w-4 rounded-full bg-orange-500 flex items-center justify-center">
                        <StopCircle className="w-3 h-3 text-white" />
                      </div>
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-red-500 flex items-center justify-center">
                        <span className="text-white text-[10px]">!</span>
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {historyProgress.status === 'running' ? '수집 진행 중' :
                         historyProgress.status === 'completed' ? '수집 완료' :
                         historyProgress.status === 'cancelled' ? '수집 취소됨' : '수집 실패'}
                      </h4>
                      <p className="text-xs text-muted-foreground">{historyProgress.message}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* 취소 버튼 */}
                    {historyProgress.status === 'running' && (
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
                        {historyProgress.current_item.toLocaleString()} / {historyProgress.total_items.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {progressPercent}% 완료
                      </p>
                    </div>
                  </div>
                </div>

                {/* 브라우저 독립 실행 안내 */}
                {historyProgress.status === 'running' && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-1 rounded">
                    <CloudOff className="w-3 h-3" />
                    브라우저를 닫아도 작업이 계속 실행됩니다
                  </div>
                )}

                {/* 프로그레스 바 */}
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div
                    className={`rounded-full h-2.5 transition-all duration-300 ease-out ${
                      historyProgress.status === 'completed' ? 'bg-green-500' :
                      historyProgress.status === 'failed' ? 'bg-red-500' : 'bg-primary'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* 현재 종목 */}
                {historyProgress.status === 'running' && historyProgress.current_stock_name && (
                  <p className="text-xs text-muted-foreground">
                    현재 처리 중: <span className="font-medium text-foreground">{historyProgress.current_stock_name}</span>
                  </p>
                )}

                {/* 성공/실패 카운트 */}
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    성공: {historyProgress.success_count.toLocaleString()}
                  </span>
                  <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                    실패: {historyProgress.failed_count}
                  </span>
                </div>

                {/* 완료 시 통계 */}
                {historyProgress.status === 'completed' && collectionStats && (
                  <div className="pt-2 border-t border-border/50">
                    <h5 className="text-xs font-semibold text-foreground mb-2">하이브리드 전략 결과</h5>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="bg-green-500/10 rounded px-2 py-1.5 text-center">
                        <p className="text-lg font-bold text-green-600 dark:text-green-400">
                          {collectionStats.skipped.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">스킵 (최신)</p>
                      </div>
                      <div className="bg-blue-500/10 rounded px-2 py-1.5 text-center">
                        <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                          {collectionStats.incremental.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">증분 수집</p>
                      </div>
                      <div className="bg-purple-500/10 rounded px-2 py-1.5 text-center">
                        <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                          {collectionStats.full_collected.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">전체 수집</p>
                      </div>
                      <div className="bg-muted rounded px-2 py-1.5 text-center">
                        <p className="text-lg font-bold text-foreground">
                          {collectionStats.total_records.toLocaleString()}
                        </p>
                        <p className="text-[10px] text-muted-foreground">저장된 레코드</p>
                      </div>
                    </div>
                    {collectionStats.skipped > 0 && (
                      <p className="text-[10px] text-green-600 dark:text-green-400 mt-2">
                        💡 {collectionStats.skipped}개 종목은 이미 최신 상태여서 API 호출을 절약했습니다!
                      </p>
                    )}
                  </div>
                )}

                {/* 에러 메시지 */}
                {historyProgress.status === 'failed' && historyProgress.error_message && (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    에러: {historyProgress.error_message}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* 수집 로그 (완료 후) */}
          {historyProgress?.status === 'completed' && collectionLogs && collectionLogs.length > 0 && (
            <div className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-foreground">수집 결과 상세</h4>
                {failedCount > 0 && (
                  <button
                    onClick={handleRetryFailed}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    실패 {failedCount}개 재시도
                  </button>
                )}
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1.5">
                {collectionLogs.slice(0, 50).map((log) => (
                  <div
                    key={log.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                      log.status === 'success'
                        ? 'bg-green-500/5 border border-green-500/20'
                        : 'bg-red-500/5 border border-red-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className={log.status === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {log.status === 'success' ? '✓' : '✗'}
                      </span>
                      <span className="font-medium text-foreground truncate">
                        {log.stock_name}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {log.stock_symbol}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      {log.status === 'success' ? (
                        <span className="text-green-600 dark:text-green-400">
                          {log.records_saved}건
                        </span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 truncate max-w-[150px]" title={log.error_message}>
                          {log.error_message || '실패'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {collectionLogs.length > 50 && (
                  <p className="text-[10px] text-muted-foreground text-center pt-2">
                    외 {collectionLogs.length - 50}개 항목
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 이전 수집 히스토리 목록 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">이전 수집 기록</h2>
          </div>
          {(!historySummaries || historySummaries.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4">수집 기록이 없습니다.</p>
          ) : (
            <>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {historySummaries.map((summary) => (
                  <button
                    key={summary.task_id}
                    onClick={() => setSelectedHistoryTaskId(
                      selectedHistoryTaskId === summary.task_id ? null : summary.task_id
                    )}
                    className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                      selectedHistoryTaskId === summary.task_id
                        ? 'bg-primary/10 border-primary/50'
                        : 'bg-muted/30 border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {new Date(summary.started_at).toLocaleString('ko-KR', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-green-600 dark:text-green-400">
                          성공 {summary.success_count}
                        </span>
                        {summary.failed_count > 0 && (
                          <span className="text-red-600 dark:text-red-400">
                            실패 {summary.failed_count}
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          ({summary.total_records_saved.toLocaleString()}건)
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* 선택한 히스토리의 상세 로그 */}
              {selectedHistoryTaskId && selectedHistoryLogs && selectedHistoryLogs.length > 0 && (
                <div className="mt-4 border border-border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="text-sm font-semibold text-foreground">상세 로그</h5>
                    <button
                      onClick={() => setSelectedHistoryTaskId(null)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5">
                    {selectedHistoryLogs.slice(0, 50).map((log) => (
                      <div
                        key={log.id}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs ${
                          log.status === 'success'
                            ? 'bg-green-500/5'
                            : 'bg-red-500/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span className={log.status === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {log.status === 'success' ? '✓' : '✗'}
                          </span>
                          <span className="font-medium text-foreground truncate">
                            {log.stock_name}
                          </span>
                        </div>
                        <span className={`text-[10px] ${log.status === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {log.status === 'success' ? `${log.records_saved}건` : (log.error_message || '실패')}
                        </span>
                      </div>
                    ))}
                    {selectedHistoryLogs.length > 50 && (
                      <p className="text-[10px] text-muted-foreground text-center pt-2">
                        외 {selectedHistoryLogs.length - 50}개 항목
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
