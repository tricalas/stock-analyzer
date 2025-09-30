'use client';

import React, { useState, useEffect } from 'react';
import { Clock, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { stockApi } from '@/lib/api';

interface ScheduleJob {
  id: string;
  name: string;
  next_run_time: string | null;
  trigger: string;
}

interface SchedulerData {
  running: boolean;
  jobs: ScheduleJob[];
  message: string;
}

const ScheduleStatus = React.memo(() => {
  const [schedulerData, setSchedulerData] = useState<SchedulerData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSchedulerStatus = async () => {
    try {
      const data = await stockApi.getSchedulerStatus();
      setSchedulerData(data);
    } catch (error) {
      console.error('Failed to fetch scheduler status:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedulerStatus();
    // 30초마다 스케줄러 상태 업데이트
    const interval = setInterval(fetchSchedulerStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // 컴포넌트 마운트 시 로컬 스토리지에서 마지막 업데이트 시간 가져오기
    const stored = localStorage.getItem('lastStockUpdate');
    if (stored) {
      setLastUpdated(stored);
    }

    // storage 이벤트 리스너 추가 (다른 탭에서 업데이트 시 동기화)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'lastStockUpdate' && e.newValue) {
        setLastUpdated(e.newValue);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '-';

    try {
      const date = new Date(dateString);
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Seoul'
      });
    } catch {
      return '-';
    }
  };

  const formatNextRunTime = (dateString: string | null) => {
    if (!dateString) return '-';

    try {
      const date = new Date(dateString);
      const now = new Date();
      const diff = date.getTime() - now.getTime();

      if (diff < 0) return '지난 시간';

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

      if (hours > 0) {
        return `${hours}시간 ${minutes}분 후`;
      } else {
        return `${minutes}분 후`;
      }
    } catch {
      return '-';
    }
  };

  if (loading) {
    return (
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="animate-pulse flex space-x-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border-b shadow-sm">
      <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0">
          {/* 스케줄러 상태 */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              {schedulerData?.running ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
              <span className="text-sm font-medium text-gray-900">
                자동 크롤링: {schedulerData?.running ? '활성' : '비활성'}
              </span>
            </div>

            {/* 다음 실행 시간 */}
            {schedulerData?.jobs && schedulerData.jobs.length > 0 && (
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-gray-600">
                  다음 실행: {formatNextRunTime(schedulerData.jobs[0].next_run_time)}
                </span>
              </div>
            )}
          </div>

          {/* 마지막 업데이트 시간 */}
          <div className="flex items-center space-x-2">
            <Calendar className="h-4 w-4 text-gray-500" />
            <span className="text-sm text-gray-600">
              마지막 업데이트: {lastUpdated ? formatTime(lastUpdated) : '없음'}
            </span>
          </div>
        </div>

        {/* 스케줄 상세 정보 */}
        {schedulerData?.jobs && schedulerData.jobs.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <div className="flex flex-wrap gap-4 text-xs text-gray-500">
              {schedulerData.jobs.map((job) => (
                <div key={job.id} className="flex items-center space-x-1">
                  <span className="font-medium">
                    {job.id === 'daily_stock_crawl' ? '오전 9:01' : '오후 4:00'}
                  </span>
                  <span>•</span>
                  <span>{job.next_run_time ? formatTime(job.next_run_time) : '-'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ScheduleStatus.displayName = 'ScheduleStatus';

export default ScheduleStatus;