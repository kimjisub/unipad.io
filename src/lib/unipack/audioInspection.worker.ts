import { inspectAudio } from './audioInspection';
import type { InspectionRequest, InspectionResponse } from './audioInspectionWorker';

self.onmessage = ({ data: { id, bytes } }: MessageEvent<InspectionRequest>) => {
  let response: InspectionResponse;
  try {
    response = { id, inspection: inspectAudio(bytes) };
  } catch {
    response = { id, inspection: null };
  }
  self.postMessage(response);
};
