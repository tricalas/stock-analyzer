'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Shield, User as UserIcon, Loader2 } from 'lucide-react';
import { userApi } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTimezone } from '@/hooks/useTimezone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface User {
  id: number;
  nickname: string;
  is_admin: boolean;
  created_at: string;
  last_login: string | null;
}

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { formatTableDateTime } = useTimezone();
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
    return formatTableDateTime(dateString);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">사용자 관리</h1>
          <p className="text-sm text-muted-foreground mt-1">
            등록된 사용자를 관리하고 새 사용자를 추가할 수 있습니다.
          </p>
        </div>
        <Button onClick={() => setIsAdding(true)}>
          <Plus className="w-4 h-4 mr-2" />
          새 사용자
        </Button>
      </div>

      {/* Add User Form */}
      {isAdding && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-lg font-semibold mb-4">새 사용자 추가</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>닉네임</Label>
                <Input
                  value={newUser.nickname}
                  onChange={(e) => setNewUser({ ...newUser, nickname: e.target.value })}
                  placeholder="사용자 닉네임"
                  maxLength={50}
                />
              </div>
              <div className="space-y-2">
                <Label>PIN (6자리)</Label>
                <Input
                  type="password"
                  value={newUser.pin}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setNewUser({ ...newUser, pin: value });
                  }}
                  placeholder="••••••"
                  className="font-mono text-center"
                  maxLength={6}
                  inputMode="numeric"
                />
                <p className="text-xs text-muted-foreground text-center">
                  {newUser.pin.length}/6
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={handleAddUser}>
                추가
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsAdding(false);
                  setNewUser({ nickname: '', pin: '' });
                }}
              >
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Users Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
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
                  <td colSpan={5} className="px-6 py-8 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      <span className="text-muted-foreground">로딩 중...</span>
                    </div>
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
                        <span className="font-medium">{user.nickname}</span>
                        {user.id === currentUser?.id && (
                          <Badge variant="secondary" className="text-xs">나</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {user.is_admin ? (
                        <Badge className="bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/30">
                          <Shield className="w-3 h-3 mr-1" />
                          관리자
                        </Badge>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteUser(user.id, user.nickname)}
                        disabled={user.id === currentUser?.id}
                        className="text-destructive hover:text-destructive"
                        title={user.id === currentUser?.id ? '자신은 삭제할 수 없습니다' : '사용자 삭제'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Info Box */}
      <Card className="bg-blue-500/10 border-blue-500/20">
        <CardContent className="py-4">
          <p className="text-sm text-blue-600 dark:text-blue-400">
            <strong>안내:</strong> 관리자만 새로운 사용자를 생성할 수 있습니다. 사용자는 닉네임과 6자리 PIN으로 로그인할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
