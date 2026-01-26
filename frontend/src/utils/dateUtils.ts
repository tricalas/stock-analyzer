import { formatInTimeZone } from 'date-fns-tz';
import { ko } from 'date-fns/locale';

/**
 * 전체 날짜+시간 포맷 (예: 2024년 1월 15일 오후 3:30)
 */
export function formatDateTime(date: string | Date | null | undefined, timezone: string = 'Asia/Seoul'): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(d, timezone, 'yyyy년 M월 d일 a h:mm', { locale: ko });
  } catch {
    return '-';
  }
}

/**
 * 날짜만 포맷 (예: 2024년 1월 15일)
 */
export function formatDate(date: string | Date | null | undefined, timezone: string = 'Asia/Seoul'): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(d, timezone, 'yyyy년 M월 d일', { locale: ko });
  } catch {
    return '-';
  }
}

/**
 * 짧은 날짜 포맷 (예: 1월 15일)
 */
export function formatShortDate(date: string | Date | null | undefined, timezone: string = 'Asia/Seoul'): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(d, timezone, 'M월 d일', { locale: ko });
  } catch {
    return '-';
  }
}

/**
 * 짧은 날짜+시간 포맷 (예: 1월 15일 오후 3:30)
 */
export function formatShortDateTime(date: string | Date | null | undefined, timezone: string = 'Asia/Seoul'): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(d, timezone, 'M월 d일 a h:mm', { locale: ko });
  } catch {
    return '-';
  }
}

/**
 * 상대 시간 포맷 (예: 3분 전, 1시간 전, 2일 전)
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return '방금 전';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;

    return formatShortDate(d);
  } catch {
    return '-';
  }
}

/**
 * 남은 시간 포맷 (예: 2시간 30분 후)
 */
export function formatTimeUntil(date: string | Date | null | undefined): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = d.getTime() - now.getTime();

    if (diff < 0) return '지난 시간';

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
      return `${hours}시간 ${remainingMinutes}분 후`;
    }
    return `${remainingMinutes}분 후`;
  } catch {
    return '-';
  }
}

/**
 * 테이블용 날짜 포맷 (예: 2024.01.15 15:30)
 */
export function formatTableDateTime(date: string | Date | null | undefined, timezone: string = 'Asia/Seoul'): string {
  if (!date) return '-';
  try {
    const d = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(d, timezone, 'yyyy.MM.dd HH:mm', { locale: ko });
  } catch {
    return '-';
  }
}
