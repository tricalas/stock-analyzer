export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/$/, '');

/** One transport for authenticated fetch calls, including admin pages. */
export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && token && typeof window !== 'undefined' && !String(input).endsWith('/api/auth/login')) {
    localStorage.removeItem('auth_token');
    window.location.assign('/login');
  }
  return response;
}
