'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, User as UserIcon } from 'lucide-react';
import { userApi } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface User {
  id: number;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  last_login: string | null;
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newUser, setNewUser] = useState({ nickname: '', pin: '' });

  useEffect(() => {
    if (currentUser?.is_admin) {
      fetchUsers();
    }
  }, [currentUser]);

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const data = await userApi.getAllUsers();
      setUsers(data.users);
    } catch (error: any) {
      toast.error(error.message || '사용자 목록을 불러오는데 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async () => {
    if (!newUser.nickname.trim() || newUser.pin.length !== 6) {
      toast.error('닉네임과 6자리 PIN을 입력해주세요.');
      return;
    }

    try {
      await userApi.createUser(newUser.nickname.trim(), newUser.pin);
      toast.success('사용자가 생성되었습니다!');
      setNewUser({ nickname: '', pin: '' });
      setIsAdding(false);
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '사용자 생성에 실패했습니다.');
    }
  };

  const handleDeleteUser = async (userId: number, nickname: string) => {
    if (!confirm(`정말 "${nickname}" 사용자를 삭제하시겠습니까?`)) {
      return;
    }

    try {
      await userApi.deleteUser(userId);
      toast.success('사용자가 삭제되었습니다.');
      fetchUsers();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '사용자 삭제에 실패했습니다.');
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">사용자 관리</h1>
            <p className="text-sm text-muted-foreground mt-1">
              등록된 사용자를 관리하고 새 사용자를 추가할 수 있습니다.
            </p>
          </div>
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            새 사용자
          </button>
        </div>

        {/* Add User Form */}
        {isAdding && (
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">새 사용자 추가</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  닉네임
                </label>
                <input
                  type="text"
                  value={newUser.nickname}
                  onChange={(e) => setNewUser({ ...newUser, nickname: e.target.value })}
                  placeholder="사용자 닉네임"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                  maxLength={50}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  PIN (6자리)
                </label>
                <input
                  type="password"
                  value={newUser.pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setNewUser({ ...newUser, pin: value });
                  }}
                  placeholder="••••••"
                  className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground font-mono text-center"
                  maxLength={6}
                  inputMode="numeric"
                />
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {newUser.pin.length}/6
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleAddUser}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                추가
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewUser({ nickname: '', pin: '' });
                }}
                className="px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* Users Table */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-muted">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  닉네임
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  권한
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  생성일
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  마지막 로그인
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  작업
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    로딩 중...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    등록된 사용자가 없습니다.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <UserIcon className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{user.nickname}</span>
                        {user.id === currentUser?.id && (
                          <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                            나
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.is_admin ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-xs font-medium">
                          <Shield className="w-3 h-3" />
                          관리자
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">일반</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {formatDate(user.last_login)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDeleteUser(user.id, user.nickname)}
                        disabled={user.id === currentUser?.id}
                        className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title={user.id === currentUser?.id ? '자신은 삭제할 수 없습니다' : '사용자 삭제'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            <strong>안내:</strong> 관리자만 새로운 사용자를 생성할 수 있습니다. 사용자는 닉네임과 6자리 PIN으로 로그인할 수 있습니다.
          </p>
        </div>
      </div>
    </div>
  );
}
