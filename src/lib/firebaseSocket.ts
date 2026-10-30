// The database SDK's own record of a socket that never proved healthy. Firefox leaves it behind
// on every page reload, however long the socket worked.
const SOCKET_FAILURE_KEY = 'firebase:previous_websocket_failure';

// With that record, the SDK starts on long polling and later removes its hidden iframes to switch
// to the socket, and Firefox loses clicks and keys around that removal. Forgetting it once per page
// keeps the fallback: a socket that really fails sets it again and the SDK's next attempt polls.
export function forgetEarlierSocketFailure(): void {
  try {
    window.localStorage.removeItem(SOCKET_FAILURE_KEY);
  } catch {
    // Storage is unavailable, so the SDK keeps its in-memory record instead.
  }
}
