'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { Plus, Edit2, Trash2, Save, X, Tag as TagIcon, Users, Shield, User, Key, AlertCircle, ThumbsDown, Database, RefreshCw } from 'lucide-react';
import { stockApi, Tag } from '@/lib/api';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useTags } from '@/contexts/TagContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export default function Settings() {
  const { tags, loading: isLoading, refetchTags } = useTags();
  const { user } = useAuth();
  const router = useRouter();
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newTag, setNewTag] = useState({
    name: '',
    display_name: '',
    color: 'primary',
    icon: 'Tag',
    order: 0,
  });
  const [editForm, setEditForm] = useState({
    name: '',
    display_name: '',
    color: 'primary',
    icon: 'Tag',
    order: 0,
  });
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [pinForm, setPinForm] = useState({
    currentPin: '',
    newPin: '',
    confirmPin: '',
  });

  // 히스토리 수집 진행 상황 추적
  const [showHistoryProgress, setShowHistoryProgress] = useState(false);
  const [historyTaskId, setHistoryTaskId] = useState<string | null>(null);

  // API URL
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  // TaskProgress 인터페이스
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

  // HistoryCollectionLog 인터페이스
  interface HistoryCollectionLog {
    id: number;
    task_id: string;
    stock_id: number;
    stock_symbol: string;
    stock_name: string;
    status: string;  // "success", "failed"
    records_saved: number;
    error_message?: string;
    started_at: string;
    completed_at?: string;
  }

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
      return 2000; // 2초마다 갱신
    },
  });

  // 진행 상황 완료 시 자동 숨김
  useEffect(() => {
    if (historyProgress?.status === 'completed' || historyProgress?.status === 'failed') {
      setTimeout(() => {
        setShowHistoryProgress(false);
        setHistoryTaskId(null);
      }, 5000); // 5초 후 자동 숨김
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

      const response = await fetch(`${API_URL}/api/stocks/tagged/collect-history?days=120`, {
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

  // 실패한 로그 개수
  const failedCount = collectionLogs?.filter(log => log.status === 'failed').length || 0;

  const iconOptions = ['Star', 'ThumbsDown', 'ShoppingCart', 'ThumbsUp', 'Eye', 'TrendingUp', 'Tag'];
  const colorOptions = [
    { value: 'primary', label: '파란색' },
    { value: 'gain', label: '초록색' },
    { value: 'loss', label: '빨간색' },
    { value: 'muted', label: '회색' },
  ];

  const handleAddTag = async () => {
    if (!newTag.name || !newTag.display_name) {
      toast.error('태그 이름과 표시 이름을 입력해주세요.');
      return;
    }

    try {
      await stockApi.createTag(newTag);
      toast.success('태그가 추가되었습니다.');
      setIsAdding(false);
      setNewTag({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
      await refetchTags();
    } catch (error) {
      console.error('Error creating tag:', error);
      toast.error('태그 추가에 실패했습니다.');
    }
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewTag({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
  };

  const handleEdit = (tag: Tag) => {
    setEditingTag(tag);
    setEditForm({
      name: tag.name,
      display_name: tag.display_name,
      color: tag.color || 'primary',
      icon: tag.icon || 'Tag',
      order: tag.order || 0,
    });
  };

  const handleUpdateTag = async () => {
    if (!editingTag) return;

    if (!editForm.name || !editForm.display_name) {
      toast.error('태그 이름과 표시 이름을 입력해주세요.');
      return;
    }

    try {
      await stockApi.updateTag(editingTag.id, editForm);
      toast.success('태그가 수정되었습니다.');
      setEditingTag(null);
      await refetchTags();
    } catch (error) {
      console.error('Error updating tag:', error);
      toast.error('태그 수정에 실패했습니다.');
    }
  };

  const handleCancelEdit = () => {
    setEditingTag(null);
    setEditForm({ name: '', display_name: '', color: 'primary', icon: 'Tag', order: 0 });
  };

  const handleDeleteTag = async (tag: Tag) => {
    if (!confirm(`"${tag.display_name}" 태그를 삭제하시겠습니까? 이 태그가 할당된 모든 종목에서 제거됩니다.`)) {
      return;
    }

    try {
      await stockApi.deleteTag(tag.id);
      toast.success('태그가 삭제되었습니다.');
      await refetchTags();
    } catch (error) {
      console.error('Error deleting tag:', error);
      toast.error('태그 삭제에 실패했습니다.');
    }
  };

  const handleChangePin = async () => {
    if (!pinForm.currentPin || !pinForm.newPin || !pinForm.confirmPin) {
      toast.error('모든 필드를 입력해주세요.');
      return;
    }

    if (pinForm.newPin !== pinForm.confirmPin) {
      toast.error('새 PIN이 일치하지 않습니다.');
      return;
    }

    if (pinForm.newPin.length !== 6) {
      toast.error('PIN은 6자리여야 합니다.');
      return;
    }

    try {
      // TODO: PIN 변경 API 호출
      toast.success('PIN이 성공적으로 변경되었습니다.');
      setIsChangingPin(false);
      setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
    } catch (error) {
      console.error('Error changing PIN:', error);
      toast.error('PIN 변경에 실패했습니다.');
    }
  };

  const getColorClass = (color?: string) => {
    switch (color) {
      case 'gain':
        return 'bg-gain text-gain-foreground';
      case 'primary':
        return 'bg-primary text-primary-foreground';
      case 'loss':
        return 'bg-loss text-loss-foreground';
      case 'muted':
        return 'bg-muted text-muted-foreground';
      default:
        return 'bg-primary text-primary-foreground';
    }
  };

  return (
    <AppLayout>
      <div className="p-4 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-foreground">설정</h2>
        </div>

        {/* Admin Section */}
        {user?.is_admin && (
          <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              <h3 className="text-lg font-semibold text-foreground">관리자 메뉴</h3>
            </div>
            <button
              onClick={() => router.push('/settings/users')}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted hover:bg-muted/80 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-foreground" />
                <div className="text-left">
                  <p className="font-medium text-foreground">사용자 관리</p>
                  <p className="text-sm text-muted-foreground">등록된 사용자 확인 및 새 사용자 추가</p>
                </div>
              </div>
              <svg className="w-5 h-5 text-muted-foreground group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* 숨겨진 태그 바로가기 */}
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground mb-3">숨겨진 태그 (사이드바에 표시되지 않음)</p>
              <div className="flex gap-2">
                <button
                  onClick={() => router.push('/tags/error')}
                  className="flex items-center gap-2 px-3 py-2 bg-loss/10 hover:bg-loss/20 text-loss rounded-lg transition-colors"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">에러 종목</span>
                </button>
                <button
                  onClick={() => router.push('/tags/dislike')}
                  className="flex items-center gap-2 px-3 py-2 bg-loss/10 hover:bg-loss/20 text-loss rounded-lg transition-colors"
                >
                  <ThumbsDown className="w-4 h-4" />
                  <span className="text-sm font-medium">제외 종목</span>
                </button>
              </div>
            </div>

            {/* 데이터 수집 현황 */}
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  <p className="text-sm font-medium text-foreground">히스토리 데이터 수집</p>
                </div>
                <button
                  onClick={handleStartHistoryCollection}
                  disabled={showHistoryProgress}
                  className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${showHistoryProgress ? 'animate-spin' : ''}`} />
                  수집 시작
                </button>
              </div>

              {/* 히스토리 수집 진행 상황 */}
              {showHistoryProgress && historyProgress && (
                <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mb-3">
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
                        ✓ 성공: {historyProgress.success_count}
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        ✗ 실패: {historyProgress.failed_count}
                      </span>
                    </div>

                    {/* 완료 또는 에러 메시지 */}
                    {historyProgress.status === 'completed' && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                        ✓ 수집 완료!
                      </p>
                    )}
                    {historyProgress.status === 'failed' && historyProgress.error_message && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        ✗ 에러: {historyProgress.error_message}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 수집 로그 (완료 후) */}
              {historyProgress?.status === 'completed' && collectionLogs && collectionLogs.length > 0 && (
                <div className="mt-3 border border-border rounded-lg p-4">
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

              <p className="text-xs text-muted-foreground">
                종목 리스트에서 히스토리 데이터를 수집하면 진행 상황이 여기에 표시됩니다.
              </p>
            </div>
          </div>
        )}

        {/* User Profile Section */}
        <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <User className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold text-foreground">내 정보</h3>
          </div>

          <div className="space-y-4">
            {/* User Info Display */}
            <div className="space-y-3">
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">닉네임</span>
                <span className="font-semibold text-foreground">{user?.nickname}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">권한</span>
                <span className={`font-semibold ${user?.is_admin ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                  {user?.is_admin ? '관리자' : '일반 사용자'}
                </span>
              </div>
              <div className="flex justify-between py-2 border-b border-border/50">
                <span className="text-muted-foreground">가입일</span>
                <span className="font-semibold text-foreground">
                  {user?.created_at ? new Date(user.created_at).toLocaleDateString('ko-KR') : '-'}
                </span>
              </div>
            </div>

            {/* Change PIN Button */}
            {!isChangingPin ? (
              <button
                onClick={() => setIsChangingPin(true)}
                className="w-full mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Key className="h-4 w-4" />
                PIN 변경
              </button>
            ) : (
              /* PIN Change Form */
              <div className="mt-4 p-4 bg-muted/30 rounded-lg space-y-3">
                <h4 className="font-semibold text-foreground mb-3">PIN 변경</h4>
                <div>
                  <label className="block text-sm font-medium mb-1">현재 PIN</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={pinForm.currentPin}
                    onChange={(e) => setPinForm({ ...pinForm, currentPin: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                    placeholder="현재 PIN 6자리"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">새 PIN</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={pinForm.newPin}
                    onChange={(e) => setPinForm({ ...pinForm, newPin: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                    placeholder="새 PIN 6자리"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">새 PIN 확인</label>
                  <input
                    type="password"
                    maxLength={6}
                    value={pinForm.confirmPin}
                    onChange={(e) => setPinForm({ ...pinForm, confirmPin: e.target.value })}
                    className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                    placeholder="새 PIN 다시 입력"
                  />
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={handleChangePin}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                  >
                    <Save className="h-4 w-4" />
                    저장
                  </button>
                  <button
                    onClick={() => {
                      setIsChangingPin(false);
                      setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                  >
                    <X className="h-4 w-4" />
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tags Section - Admin Only */}
        {user?.is_admin && (
          <>
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">태그 관리</h3>
                <button
                  onClick={() => setIsAdding(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  태그 추가
                </button>
              </div>
            </div>

            {/* Tags List */}
            <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border">
          {isLoading ? (
            <div className="text-center py-24">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
              <p className="mt-4 text-sm text-muted-foreground">Loading tags...</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Add New Tag Form */}
              {isAdding && (
                <div className="p-6 bg-muted/30">
                  <h3 className="text-lg font-semibold mb-4">새 태그 추가</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-2">태그 이름 (영문)</label>
                      <input
                        type="text"
                        value={newTag.name}
                        onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                        placeholder="예: my_tag"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">표시 이름</label>
                      <input
                        type="text"
                        value={newTag.display_name}
                        onChange={(e) => setNewTag({ ...newTag, display_name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                        placeholder="예: 내 태그"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">색상</label>
                      <select
                        value={newTag.color}
                        onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      >
                        {colorOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">아이콘</label>
                      <select
                        value={newTag.icon}
                        onChange={(e) => setNewTag({ ...newTag, icon: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      >
                        {iconOptions.map((icon) => (
                          <option key={icon} value={icon}>{icon}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">순서</label>
                      <input
                        type="number"
                        value={newTag.order}
                        onChange={(e) => setNewTag({ ...newTag, order: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={handleAddTag}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                    >
                      <Save className="h-4 w-4" />
                      저장
                    </button>
                    <button
                      onClick={handleCancelAdd}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                    >
                      <X className="h-4 w-4" />
                      취소
                    </button>
                  </div>
                </div>
              )}

              {/* Tags List */}
              {tags.map((tag) => (
                <div key={tag.id} className="p-6 hover:bg-muted/30 transition-colors">
                  {editingTag?.id === tag.id ? (
                    /* Edit Form */
                    <div>
                      <h3 className="text-lg font-semibold mb-4">태그 수정</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-2">태그 이름 (영문)</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">표시 이름</label>
                          <input
                            type="text"
                            value={editForm.display_name}
                            onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">색상</label>
                          <select
                            value={editForm.color}
                            onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          >
                            {colorOptions.map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">아이콘</label>
                          <select
                            value={editForm.icon}
                            onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          >
                            {iconOptions.map((icon) => (
                              <option key={icon} value={icon}>{icon}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-2">순서</label>
                          <input
                            type="number"
                            value={editForm.order}
                            onChange={(e) => setEditForm({ ...editForm, order: parseInt(e.target.value) })}
                            className="w-full px-3 py-2 border border-border rounded-lg bg-card"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={handleUpdateTag}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
                        >
                          <Save className="h-4 w-4" />
                          저장
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80"
                        >
                          <X className="h-4 w-4" />
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Normal View */
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className={`px-3 py-1.5 rounded-lg font-semibold ${getColorClass(tag.color)}`}>
                          {tag.display_name}
                        </span>
                        <div className="text-sm text-muted-foreground">
                          <span className="font-mono">{tag.name}</span>
                          <span className="mx-2">|</span>
                          <span>아이콘: {tag.icon}</span>
                          <span className="mx-2">|</span>
                          <span>순서: {tag.order}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(tag)}
                          className="p-2 hover:bg-muted rounded-lg transition-colors"
                          title="편집"
                        >
                          <Edit2 className="h-4 w-4 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => handleDeleteTag(tag)}
                          className="p-2 hover:bg-destructive/10 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
            </div>
          </>
        )}
      </div>

      <Toaster position="top-center" />
    </AppLayout>
  );
}
