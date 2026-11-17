/**
 * Length in bytes of the body the store download route sends. Next.js (16.4.5 and later)
 * drops `content-length` from route handler responses, so the route repeats the file
 * host's length under this name and the download progress reads it from here.
 */
export const STORE_BODY_LENGTH_HEADER = 'x-content-length';
