export function classifyNeedRefresh(hasControllerNow: boolean): 'update' | 'offline-ready' {
  return hasControllerNow ? 'update' : 'offline-ready';
}

export function refreshAction(
  hasWaitingWorker: boolean,
  controlledAtRegister: boolean,
): 'skip-waiting' | 'skip-waiting-then-reload' | 'reload' {
  if (!hasWaitingWorker) {
    return 'reload';
  }
  return controlledAtRegister ? 'skip-waiting' : 'skip-waiting-then-reload';
}
