import { inspectAudio } from './audioInspection';
import type { InspectionRequest, InspectionResponse } from './audioInspectionWorker';
import { releaseArrayBuffer } from './bufferLifetime';

self.onmessage = ({ data: { id, bytes } }: MessageEvent<InspectionRequest>) => {
  let response: InspectionResponse;
  try {
    response = { id, inspection: inspectAudio(bytes) };
  } catch {
    response = { id, inspection: null };
  } finally {
    // The page keeps its own bytes; a copy left for collection would overlap the first decode.
    releaseArrayBuffer(bytes);
  }
  self.postMessage(response);
};
