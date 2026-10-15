import { storeDownloadErrorType } from '../../lib/store';

/** Store download failures that have translated text under `play.toast`. */
export type StoreErrorToastKey = 'packNotFound';

/**
 * A store download failure, classified. `message` stays in English so the failure
 * analytics do not split by language; `toastKey`, when present, names the translated
 * text the person sees instead.
 */
export interface StoreErrorDescription {
  message: string;
  toastKey?: StoreErrorToastKey;
}

export function describeStoreError(error: unknown): StoreErrorDescription {
  const raw = error instanceof Error ? error.message : String(error);
  if (/aborted|canceled/i.test(raw)) return { message: 'Download canceled.' };
  if (/HTTP 403|Host not allowed/i.test(raw)) return { message: 'Download source is blocked by server policy.' };
  if (storeDownloadErrorType(error) === 'http_404') return { message: 'Pack not found on server.', toastKey: 'packNotFound' };
  if (/HTTP 5\d\d/i.test(raw)) return { message: 'Store server is temporarily unavailable.' };
  if (/Network error/i.test(raw)) return { message: 'Network error. Please check your connection.' };
  if (/Invalid UniPack|parse/i.test(raw)) return { message: 'Downloaded file is not a valid UniPack.' };
  return { message: raw };
}
