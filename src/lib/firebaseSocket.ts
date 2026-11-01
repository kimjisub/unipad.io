// The database SDK writes this before every socket attempt and removes it once the socket proves
// healthy. With the record present, its next connection starts on long polling instead.
const SOCKET_FAILURE_KEY = 'firebase:previous_websocket_failure';

function persistentStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Firefox closes a leaving page's sockets while its scripts still run, so the SDK reconnects and
// writes the record even though the socket worked. The next visit would then start on long polling
// and later remove its hidden iframes to move to the socket, and Firefox loses clicks and keys
// around that removal. So a record that appeared after beforeunload is dropped. One that was
// already there stays: without it, a socket that hangs costs the SDK's 30 second wait on every visit.
export function dropSocketFailureRecordedWhileLeaving(): void {
  const storage = persistentStorage();
  if (!storage) return;

  let noRecordBeforeLeaving = false;
  window.addEventListener('beforeunload', () => {
    noRecordBeforeLeaving = storage.getItem(SOCKET_FAILURE_KEY) === null;
  });
  window.addEventListener('pagehide', () => {
    if (noRecordBeforeLeaving) storage.removeItem(SOCKET_FAILURE_KEY);
    noRecordBeforeLeaving = false;
  });
}
