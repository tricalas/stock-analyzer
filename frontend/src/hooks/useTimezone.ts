import { useAuth } from '@/contexts/AuthContext';
import {
  formatDateTime as formatDateTimeUtil,
  formatDate as formatDateUtil,
  formatShortDate as formatShortDateUtil,
  formatShortDateTime as formatShortDateTimeUtil,
  formatRelativeTime as formatRelativeTimeUtil,
  formatTimeUntil as formatTimeUntilUtil,
  formatTableDateTime as formatTableDateTimeUtil,
} from '@/utils/dateUtils';

export function useTimezone() {
  const { user } = useAuth();
  const timezone = user?.timezone || 'Asia/Seoul';

  return {
    timezone,
    formatDateTime: (date: string | Date | null | undefined) => formatDateTimeUtil(date, timezone),
    formatDate: (date: string | Date | null | undefined) => formatDateUtil(date, timezone),
    formatShortDate: (date: string | Date | null | undefined) => formatShortDateUtil(date, timezone),
    formatShortDateTime: (date: string | Date | null | undefined) => formatShortDateTimeUtil(date, timezone),
    formatRelativeTime: formatRelativeTimeUtil,
    formatTimeUntil: formatTimeUntilUtil,
    formatTableDateTime: (date: string | Date | null | undefined) => formatTableDateTimeUtil(date, timezone),
  };
}
