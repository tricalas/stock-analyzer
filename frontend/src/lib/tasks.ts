import { apiFetch, API_BASE_URL } from './http';

export async function waitForTask(taskId: string, signal: AbortSignal) {
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const response = await apiFetch(`${API_BASE_URL}/api/tasks/${taskId}`, { signal });
    if (!response.ok) throw new Error('작업 상태를 확인하지 못했습니다. 설정에서 진행 상황을 확인해주세요.');
    const task = await response.json();
    if (task.status === 'failed' || task.status === 'cancelled') throw new Error(task.error_message || '작업이 중단되었습니다.');
    if (task.status === 'completed') {
      if (task.failed_count > 0) throw new Error(`${task.failed_count}개 종목 업데이트에 실패했습니다. 설정에서 로그를 확인해주세요.`);
      return task;
    }
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, 1500);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
  throw new Error('아직 업데이트 중입니다. 설정에서 진행 상황을 확인해주세요.');
}
