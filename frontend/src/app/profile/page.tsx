'use client';

import { useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { User, Key, Save, X, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/contexts/AuthContext';

export default function ProfilePage() {
  const { user } = useAuth();
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [pinForm, setPinForm] = useState({
    currentPin: '',
    newPin: '',
    confirmPin: '',
  });

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

  return (
    <AppLayout>
      <Toaster position="top-center" />
      <div className="p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">내 프로필</h1>
            <p className="text-sm text-muted-foreground mt-1">
              계정 정보를 확인하고 관리합니다.
            </p>
          </div>

          {/* Profile Card */}
          <div className="bg-card shadow-lg rounded-xl overflow-hidden border border-border p-6">
            <div className="flex items-center gap-2 mb-6">
              <User className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-semibold text-foreground">내 정보</h3>
            </div>

            <div className="space-y-4">
              {/* User Info Display */}
              <div className="space-y-3">
                <div className="flex justify-between py-3 border-b border-border/50">
                  <span className="text-muted-foreground">닉네임</span>
                  <span className="font-semibold text-foreground">{user?.nickname}</span>
                </div>
                <div className="flex justify-between py-3 border-b border-border/50">
                  <span className="text-muted-foreground">권한</span>
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${user?.is_admin ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                    {user?.is_admin && <Shield className="w-4 h-4" />}
                    {user?.is_admin ? '관리자' : '일반 사용자'}
                  </span>
                </div>
                <div className="flex justify-between py-3 border-b border-border/50">
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
                  className="w-full mt-6 inline-flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Key className="h-4 w-4" />
                  PIN 변경
                </button>
              ) : (
                /* PIN Change Form */
                <div className="mt-6 p-5 bg-muted/30 rounded-lg space-y-4">
                  <h4 className="font-semibold text-foreground">PIN 변경</h4>
                  <div>
                    <label className="block text-sm font-medium mb-2">현재 PIN</label>
                    <input
                      type="password"
                      maxLength={6}
                      value={pinForm.currentPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, currentPin: value });
                      }}
                      className="w-full px-4 py-2 border border-border rounded-lg bg-card font-mono text-center"
                      placeholder="현재 PIN 6자리"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">새 PIN</label>
                    <input
                      type="password"
                      maxLength={6}
                      value={pinForm.newPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, newPin: value });
                      }}
                      className="w-full px-4 py-2 border border-border rounded-lg bg-card font-mono text-center"
                      placeholder="새 PIN 6자리"
                      inputMode="numeric"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">새 PIN 확인</label>
                    <input
                      type="password"
                      maxLength={6}
                      value={pinForm.confirmPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, confirmPin: value });
                      }}
                      className="w-full px-4 py-2 border border-border rounded-lg bg-card font-mono text-center"
                      placeholder="새 PIN 다시 입력"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
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
        </div>
      </div>
    </AppLayout>
  );
}
