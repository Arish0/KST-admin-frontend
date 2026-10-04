// Re-encode selected product videos from a canvas stream. Canvas streams contain
// video frames only, so the uploaded file has no audio track.
const videoPreviewUrls = new WeakMap();
let preparingVideo = false;

function videoStatus(form, message, isError = false) {
  const input = form.querySelector('input[name="videoFile"]');
  if (!input) return;
  let status = form.querySelector('#video-upload-status');
  if (!status) {
    status = document.createElement('p');
    status.id = 'video-upload-status';
    status.className = 'notice wide';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    input.closest('label').after(status);
  }
  status.classList.toggle('error', isError);
  status.textContent = message;
}

function supportedRecordingType() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
  return [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp8',
    'video/webm'
  ].find(type => MediaRecorder.isTypeSupported(type)) || '';
}

async function silentVideoFile(file, report) {
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose a video up to 25 MB.');
  const recordingType = supportedRecordingType();
  if (!recordingType) throw new Error('This browser cannot prepare a silent video. Try the latest Chrome, Edge, or Safari.');
  const sourceUrl = URL.createObjectURL(file);
  const source = document.createElement('video');
  source.src = sourceUrl;
  source.muted = true;
  source.playsInline = true;
  source.preload = 'auto';
  let stream;
  let timer;
  let watchdog;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('The selected video could not be read.')), 20000);
      source.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
      source.onerror = () => { clearTimeout(timeout); reject(new Error('The selected video cannot play in this browser. Choose an H.264 MP4 or a supported WebM file.')); };
      source.load();
    });
    if (!Number.isFinite(source.duration) || source.duration <= 0 || !source.videoWidth || !source.videoHeight) {
      throw new Error('The selected video has no usable duration or video frames.');
    }
    const scale = Math.min(1, 1280 / Math.max(source.videoWidth, source.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.floor(source.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(source.videoHeight * scale / 2) * 2);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('This browser cannot process the selected video.');
    stream = canvas.captureStream(24);
    if (stream.getAudioTracks().length || !stream.getVideoTracks().length) throw new Error('Could not create a video-only recording.');
    const bitrate = Math.min(2500000, Math.max(250000, Math.floor(22 * 1024 * 1024 * 8 / source.duration)));
    const recorder = new MediaRecorder(stream, { mimeType: recordingType, videoBitsPerSecond: bitrate });
    const chunks = [];
    const blob = await new Promise((resolve, reject) => {
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        if (recorder.state !== 'inactive') recorder.stop();
        reject(error);
      };
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => fail(new Error('The browser could not make a silent copy of this video.'));
      recorder.onstop = () => {
        if (!settled) { settled = true; resolve(new Blob(chunks, { type: recordingType.split(';')[0] })); }
      };
      source.onended = () => {
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        if (recorder.state !== 'inactive') recorder.stop();
      };
      const draw = () => {
        if (source.readyState < 2) return;
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        report(`Removing sound: ${Math.min(99, Math.round(source.currentTime / source.duration * 100))}% — keep this page open.`);
      };
      draw();
      recorder.start(1000);
      timer = setInterval(draw, 1000 / 24);
      watchdog = setTimeout(() => fail(new Error('Video processing timed out. Try a shorter clip.')), source.duration * 1000 + 30000);
      source.play().catch(() => fail(new Error('The selected video could not play for sound removal. Try an H.264 MP4.')));
    });
    if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error('The silent video is too large. Use a shorter clip (up to 25 MB).');
    const extension = blob.type === 'video/mp4' ? 'mp4' : 'webm';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-silent.${extension}`, { type: blob.type });
  } finally {
    clearInterval(timer);
    clearTimeout(watchdog);
    source.pause();
    source.removeAttribute('src');
    source.load();
    stream?.getTracks().forEach(track => track.stop());
    URL.revokeObjectURL(sourceUrl);
  }
}

document.addEventListener('change', event => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.name !== 'videoFile') return;
  const form = input.form;
  if (!form) return;
  const previousUrl = videoPreviewUrls.get(form);
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  form.querySelector('#selected-video-preview')?.remove();
  const file = input.files?.[0];
  if (!file) { videoStatus(form, 'The current video will stay until you choose a replacement.'); return; }
  videoStatus(form, `${file.name} selected. Save to remove its sound and replace the current video.`);
  const previewUrl = URL.createObjectURL(file);
  videoPreviewUrls.set(form, previewUrl);
  const preview = document.createElement('video');
  preview.id = 'selected-video-preview';
  preview.className = 'admin-video-preview';
  preview.controls = true;
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = 'metadata';
  preview.src = previewUrl;
  form.querySelector('#video-upload-status').after(preview);
});

document.querySelector('#editor')?.addEventListener('close', event => {
  const form = event.target.querySelector('#edit-form');
  const previewUrl = form && videoPreviewUrls.get(form);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'edit-form') return;
  const input = form.querySelector('input[name="videoFile"]');
  const file = input?.files?.[0];
  if (!file || !file.size) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (preparingVideo) return;
  preparingVideo = true;
  const button = form.querySelector('button[type="submit"],button:not([type])');
  if (button) button.disabled = true;
  try {
    videoStatus(form, 'Preparing a silent copy of the video — keep this page open.');
    const silentFile = await silentVideoFile(file, message => videoStatus(form, message));
    if (!form.isConnected || !form.closest('dialog')?.open) return;
    videoStatus(form, 'Uploading the silent video to Pinata…');
    const url = await uploadImage(silentFile);
    if (!form.isConnected || !form.closest('dialog')?.open) return;
    form.querySelector('input[name="video"]').value = url;
    form.querySelector('select[name="videoType"]').value = silentFile.type;
    input.value = '';
    videoStatus(form, 'Silent video uploaded. Saving the product…');
    if (button) button.disabled = false;
    form.requestSubmit();
  } catch (error) {
    videoStatus(form, error.message || 'The video could not be updated.', true);
    form.querySelector('#video-upload-status')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (button) button.disabled = false;
  } finally {
    preparingVideo = false;
  }
}, true);

// Previously uploaded clips may still contain audio. Never play their sound.
document.addEventListener('play', event => {
  if (event.target instanceof HTMLVideoElement) event.target.muted = true;
}, true);
document.addEventListener('volumechange', event => {
  if (event.target instanceof HTMLVideoElement && !event.target.muted) event.target.muted = true;
}, true);
