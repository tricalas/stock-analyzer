'use client';

import { useState, useEffect } from 'react';
import { Database, RefreshCw, X } from 'lucide-react';
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

export default function DataCollectionPage() {
  const { user } = useAuth();
  const [showHistoryProgress, setShowHistoryProgress] = useState(false);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);
  const [selectedHistoryTaskId, setSelectedHistoryTaskId] = useState<string | null>(null);

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
      if (data?.status === 'completed' || data?.status === 'failed') {
        return false;
      }
      return 2000;
    },
  });

  // 진행 상황 완료 시 자동 숨김
  useEffect(() => {
    if (historyProgress?.status === 'completed' || historyProgress?.status === 'failed') {
      setTimeout(() => {
        setShowHistoryProgress(false);
        setHistoryTaskId(null);
      }, 5000);
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

      const response = await fetch(`${API_URL}/api/stocks/collect-history?mode=all&days=120`, {
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

      const result = await response.json();

      if (result.task_id) {
        setHistoryTaskId(result.task_id);
        setShowHistoryProgress(true);
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
    }
  }, [historyProgress?.status, refetchHistorySummaries]);

  // 실패한 종목 재시도 함수
  const handleRetryFailed = async () => {
    if (!historyTaskId) return;

    try {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        toast.error('로그인이 필요합니다.');
        return;
      }

      const response = await fetch(`${API_URL}/api/tasks/${historyTaskId}/retry-failed?days=120`, {
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

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">데이터 수집</h1>
          <p className="text-sm text-muted-foreground mt-1">
            종목 히스토리 데이터를 수집하고 관리합니다.
          </p>
        </div>

        {/* 수집 시작 카드 */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-primary" />
              <div>
                <h2 className="font-semibold text-foreground">히스토리 데이터 수집</h2>
                <p className="text-sm text-muted-foreground">모든 종목의 120일간 히스토리 데이터를 수집합니다.</p>
              </div>
            </div>
            <button
              onClick={handleStartHistoryCollection}
              disabled={showHistoryProgress}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${showHistoryProgress ? 'animate-spin' : ''}`} />
              수집 시작
            </button>
          </div>

          {/* 히스토리 수집 진행 상황 */}
          {showHistoryProgress && historyProgress && (
            <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-4">
              <div className="space-y-3">
                {/* 헤더 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">수집 진행 중</h4>
                      <p className="text-xs text-muted-foreground">{historyProgress.message}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-foreground">
                      {historyProgress.current_item} / {historyProgress.total_items}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {Math.round((historyProgress.current_item / historyProgress.total_items) * 100)}% 완료
                    </p>
                  </div>
                </div>

                {/* 프로그레스 바 */}
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary rounded-full h-2 transition-all duration-300 ease-out"
                    style={{
                      width: `${(historyProgress.current_item / historyProgress.total_items) * 100}%`,
                    }}
                  />
                </div>

                {/* 현재 종목 */}
                {historyProgress.current_stock_name && (
                  <p className="text-xs text-muted-foreground">
                    현재 수집 중: <span className="font-medium text-foreground">{historyProgress.current_stock_name}</span>
                  </p>
                )}

                {/* 성공/실패 카운트 */}
                <div className="flex gap-3 text-xs">
                  <span className="text-green-600 dark:text-green-400">
                    성공: {historyProgress.success_count}
                  </span>
                  <span className="text-red-600 dark:text-red-400">
                    실패: {historyProgress.failed_count}
                  </span>
                </div>

                {/* 완료 또는 에러 메시지 */}
                {historyProgress.status === 'completed' && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                    수집 완료!
                  </p>
                )}
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
                <h4 className="text-sm font-semibold text-foreground">수집 결과</h4>
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
          <h2 className="text-lg font-semibold text-foreground mb-4">이전 수집 기록</h2>
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
