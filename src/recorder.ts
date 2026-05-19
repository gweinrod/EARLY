/** Cross-platform MediaRecorder setup (iOS Safari requires audio/mp4). */

let activeMimeType = '';

export function getRecordingMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

export function createMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = getRecordingMimeType();
  activeMimeType = mimeType;
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
}

export function getActiveRecordingMimeType(): string {
  return activeMimeType || getRecordingMimeType() || 'audio/webm';
}

export function buildRecordingBlob(chunks: Blob[]): Blob {
  const type = getActiveRecordingMimeType();
  return new Blob(chunks, { type: type || 'audio/ogg' });
}
