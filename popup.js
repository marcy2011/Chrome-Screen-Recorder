document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('recordings-list');
  const result = await chrome.storage.local.get('recordings');
  const recordings = result.recordings || [];
  if (recordings.length === 0) {
    list.innerHTML = '<li class="empty">No recordings</li>';
  } else {
    list.innerHTML = recordings.map((item) => 
      `<li>${item.filename} - ${new Date(item.timestamp).toLocaleString()}</li>`
    ).join('');
  }
});