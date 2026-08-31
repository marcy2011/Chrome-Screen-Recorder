let isRecording = false;
let recordingTabId = null;
let offscreenReady = false;
let offscreenReadyResolvers = [];
let pendingStartResolvers = [];
let pendingStopResolvers = [];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'view-recordings',
    title: 'View recordings',
    contexts: ['action']
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'view-recordings') {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 400,
      height: 500
    });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!isRecording) {
    await startRecording(tab);
  } else {
    await stopRecording();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'offscreenReady') {
    offscreenReady = true;
    offscreenReadyResolvers.forEach(resolve => resolve());
    offscreenReadyResolvers = [];
    return false;
  }

  if (message.type === 'recordingStarted') {
    pendingStartResolvers.forEach(r => r({ success: true }));
    pendingStartResolvers = [];
    updateBadge(true);
    if (recordingTabId) {
      injectCursor(recordingTabId);
    }
    return false;
  }

  if (message.type === 'recordingStopped') {
    pendingStopResolvers.forEach(r => r({ success: true }));
    pendingStopResolvers = [];
    if (recordingTabId) {
      removeCursor(recordingTabId);
    }
    isRecording = false;
    recordingTabId = null;
    updateBadge(false);
    return false;
  }

  if (message.type === 'recordingError') {
    pendingStartResolvers.forEach(r => r({ success: false, error: message.error }));
    pendingStartResolvers = [];
    pendingStopResolvers.forEach(r => r({ success: false, error: message.error }));
    pendingStopResolvers = [];
    if (recordingTabId) {
      removeCursor(recordingTabId);
    }
    isRecording = false;
    recordingTabId = null;
    updateBadge(false);
    console.error('Recording error:', message.error);
    return false;
  }

  if (message.type === 'recordingCompleted') {
    chrome.storage.local.get('recordings', (result) => {
      const recordings = result.recordings || [];
      recordings.push({
        filename: message.filename,
        timestamp: Date.now()
      });
      chrome.storage.local.set({ recordings });
    });
    return false;
  }

  return false;
});

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    if (!offscreenReady) {
      await new Promise((resolve) => {
        offscreenReadyResolvers.push(resolve);
        setTimeout(resolve, 3000);
      });
    }
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Tab recording'
  });

  await new Promise((resolve) => {
    if (offscreenReady) {
      resolve();
      return;
    }
    offscreenReadyResolvers.push(resolve);
    setTimeout(resolve, 5000);
  });

  if (!offscreenReady) {
    throw new Error('Offscreen document failed to load');
  }
}

async function startRecording(tab) {
  if (isRecording) return;
  try {
    await ensureOffscreenDocument();
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    const startResult = new Promise((resolve) => {
      pendingStartResolvers.push(resolve);
      setTimeout(() => resolve({ success: false, error: 'Start timeout' }), 8000);
    });

    chrome.runtime.sendMessage({
      type: 'startRecording',
      streamId: streamId
    }).catch(() => {});

    const result = await startResult;
    if (result.success) {
      isRecording = true;
      recordingTabId = tab.id;
      updateBadge(true);
    } else {
      throw new Error(result.error || 'Start failed');
    }
  } catch (err) {
    console.error('Start recording error:', err.message);
    isRecording = false;
    recordingTabId = null;
    updateBadge(false);
  }
}

async function stopRecording() {
  if (!isRecording) return;
  try {
    const stopResult = new Promise((resolve) => {
      pendingStopResolvers.push(resolve);
      setTimeout(() => resolve({ success: true }), 3000);
    });

    chrome.runtime.sendMessage({ type: 'stopRecording' }).catch(() => {});

    await stopResult;
  } catch (err) {
    console.error('Stop recording error:', err.message);
    if (recordingTabId) {
      removeCursor(recordingTabId);
    }
    isRecording = false;
    recordingTabId = null;
    updateBadge(false);
  }
}

async function injectCursor(tabId) {
  try {
    const cursorUrl = chrome.runtime.getURL('cursor.svg');
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (url) => {
        const style = document.createElement('style');
        style.id = 'recording-cursor-style';
        style.textContent = `html, html * { cursor: url("${url}") 2 2, auto !important; }`;
        document.head.appendChild(style);
      },
      args: [cursorUrl]
    });
  } catch (err) {
    console.warn('Cursor injection failed:', err);
  }
}

async function removeCursor(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const style = document.getElementById('recording-cursor-style');
        if (style) style.remove();
      }
    });
  } catch (err) {
    console.warn('Cursor removal failed:', err);
  }
}

function updateBadge(recording) {
  if (recording) {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}