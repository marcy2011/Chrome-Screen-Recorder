chrome.runtime.sendMessage({ type: 'offscreenReady' }).catch(() => {});

let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let isRecording = false;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'startRecording') {
    await startRecording(message.streamId);
  } else if (message.type === 'stopRecording') {
    await stopRecording();
  }
});

async function startRecording(streamId) {
  if (isRecording) return;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      audio: false
    });

    recordedChunks = [];

    const preferredMimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    const chosenMimeType = preferredMimeTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: chosenMimeType,
      videoBitsPerSecond: 2500000
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      if (recordedChunks.length === 0) {
        chrome.runtime.sendMessage({ type: 'recordingError', error: 'Empty recording' });
        chrome.runtime.sendMessage({ type: 'recordingStopped' });
        cleanup();
        return;
      }

      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);
      const filename = `recording_${Date.now()}.webm`;

      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = filename;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      setTimeout(() => URL.revokeObjectURL(url), 2000);

      chrome.runtime.sendMessage({ type: 'recordingCompleted', filename: filename });
      chrome.runtime.sendMessage({ type: 'recordingStopped' });
      cleanup();
    };

    mediaRecorder.start(1000);
    isRecording = true;
    chrome.runtime.sendMessage({ type: 'recordingStarted' });

  } catch (err) {
    console.error('getUserMedia error:', err);
    chrome.runtime.sendMessage({ type: 'recordingError', error: err.message });
    chrome.runtime.sendMessage({ type: 'recordingStopped' });
    cleanup();
  }
}

function cleanup() {
  isRecording = false;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  mediaRecorder = null;
  recordedChunks = [];
}

async function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.requestData();
    }
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
    }, 100);
  } else {
    cleanup();
    chrome.runtime.sendMessage({ type: 'recordingStopped' });
  }
}