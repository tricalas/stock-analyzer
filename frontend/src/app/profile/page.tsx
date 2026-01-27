'use client';

import { useState, useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { User, Key, Save, X, Shield, Globe } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTimezone } from '@/hooks/useTimezone';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface TimezoneOption {
  value: string;
  label: string;
}

export default function ProfilePage() {
  const { user, updateTimezone } = useAuth();
  const { formatDate } = useTimezone();
  const [isChangingPin, setIsChangingPin] = useState(false);
  const [isChangingTimezone, setIsChangingTimezone] = useState(false);
  const [timezones, setTimezones] = useState<TimezoneOption[]>([]);
  const [selectedTimezone, setSelectedTimezone] = useState(user?.timezone || 'Asia/Seoul');
  const [isSavingTimezone, setIsSavingTimezone] = useState(false);
  const [pinForm, setPinForm] = useState({
    currentPin: '',
    newPin: '',
    confirmPin: '',
  });

  // Fetch available timezones
  useEffect(() => {
    const fetchTimezones = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/timezones`);
        if (response.ok) {
          const data = await response.json();
          setTimezones(data.timezones);
        }
      } catch (error) {
        console.error('Failed to fetch timezones:', error);
      }
    };
    fetchTimezones();
  }, []);

  // Update selected timezone when user changes
  useEffect(() => {
    if (user?.timezone) {
      setSelectedTimezone(user.timezone);
    }
  }, [user?.timezone]);

  const handleChangeTimezone = async () => {
    if (selectedTimezone === user?.timezone) {
      setIsChangingTimezone(false);
      return;
    }

    setIsSavingTimezone(true);
    try {
      await updateTimezone(selectedTimezone);
      toast.success('시간대가 변경되었습니다.');
      setIsChangingTimezone(false);
    } catch (error) {
      console.error('Error changing timezone:', error);
      toast.error('시간대 변경에 실패했습니다.');
    } finally {
      setIsSavingTimezone(false);
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

  return (
    <AppLayout>
      <Toaster position="top-center" />
      <div className="p-4 lg:p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold">내 프로필</h1>
            <p className="text-sm text-muted-foreground mt-1">
              계정 정보를 확인하고 관리합니다.
            </p>
          </div>

          {/* Profile Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <User className="w-5 h-5 text-primary" />
                내 정보
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* User Info List */}
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">닉네임</span>
                  <span className="font-semibold">{user?.nickname}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">권한</span>
                  {user?.is_admin ? (
                    <Badge variant="secondary" className="gap-1 text-amber-600 dark:text-amber-400">
                      <Shield className="w-3 h-3" />
                      관리자
                    </Badge>
                  ) : (
                    <span className="font-semibold">일반 사용자</span>
                  )}
                </div>
                <Separator />
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">가입일</span>
                  <span className="font-semibold">
                    {user?.created_at ? formatDate(user.created_at) : '-'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Timezone Settings Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe className="w-5 h-5 text-primary" />
                시간대 설정
              </CardTitle>
              <CardDescription>
                앱에 표시되는 시간대를 변경합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isChangingTimezone ? (
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-muted-foreground">현재 시간대: </span>
                    <span className="font-semibold">
                      {timezones.find(tz => tz.value === user?.timezone)?.label || user?.timezone || 'Asia/Seoul'}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setIsChangingTimezone(true)}
                  >
                    변경
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>시간대 선택</Label>
                    <Select
                      value={selectedTimezone}
                      onValueChange={setSelectedTimezone}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="시간대 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {timezones.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>
                            {tz.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleChangeTimezone}
                      disabled={isSavingTimezone}
                      className="flex-1"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {isSavingTimezone ? '저장 중...' : '저장'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsChangingTimezone(false);
                        setSelectedTimezone(user?.timezone || 'Asia/Seoul');
                      }}
                      className="flex-1"
                    >
                      <X className="h-4 w-4 mr-2" />
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* PIN Change Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Key className="w-5 h-5 text-primary" />
                PIN 변경
              </CardTitle>
              <CardDescription>
                로그인에 사용하는 6자리 PIN을 변경합니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!isChangingPin ? (
                <Button
                  onClick={() => setIsChangingPin(true)}
                  className="w-full"
                >
                  <Key className="h-4 w-4 mr-2" />
                  PIN 변경하기
                </Button>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="currentPin">현재 PIN</Label>
                    <Input
                      id="currentPin"
                      type="password"
                      maxLength={6}
                      value={pinForm.currentPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, currentPin: value });
                      }}
                      className="font-mono text-center text-lg"
                      placeholder="현재 PIN 6자리"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="newPin">새 PIN</Label>
                    <Input
                      id="newPin"
                      type="password"
                      maxLength={6}
                      value={pinForm.newPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, newPin: value });
                      }}
                      className="font-mono text-center text-lg"
                      placeholder="새 PIN 6자리"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPin">새 PIN 확인</Label>
                    <Input
                      id="confirmPin"
                      type="password"
                      maxLength={6}
                      value={pinForm.confirmPin}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                        setPinForm({ ...pinForm, confirmPin: value });
                      }}
                      className="font-mono text-center text-lg"
                      placeholder="새 PIN 다시 입력"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={handleChangePin}
                      className="flex-1"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      저장
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsChangingPin(false);
                        setPinForm({ currentPin: '', newPin: '', confirmPin: '' });
                      }}
                      className="flex-1"
                    >
                      <X className="h-4 w-4 mr-2" />
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
