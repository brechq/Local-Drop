function formatHistoryTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (isToday) {
    return `Today at ${timeStr}`;
  }
  return `${date.toLocaleDateString()} ${timeStr}`;
}

class HistoryPage {
  constructor() {
    this.container = document.getElementById('history-container');
    this.emptyState = document.getElementById('history-empty');
    this.btnClear = document.getElementById('btn-clear-history');
    this.trashIcon = document.getElementById('trash-icon');

    this.init();
  }

  init() {
    this.trashIcon.innerHTML = Icons.trash;

    this.btnClear.addEventListener('click', async () => {
      await window.localdrop.clearHistory();
      this.load();
    });
  }

  async load() {
    try {
      const list = await window.localdrop.getHistory();
      this.render(list);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  render(records) {
    this.container.innerHTML = '';

    if (!records || records.length === 0) {
      this.emptyState.style.display = 'block';
      return;
    }

    this.emptyState.style.display = 'none';

    records.forEach(rec => {
      const card = document.createElement('div');
      card.className = 'history-card';

      const isSent = rec.direction === 'sent';
      const iconClass = isSent ? 'sent' : 'received';
      const dirIcon = isSent ? Icons.arrowUp : Icons.arrowDown;
      const dirText = isSent ? `Sent to ${rec.peerName}` : `Received from ${rec.peerName}`;

      const firstFileName = rec.files && rec.files[0] ? rec.files[0].name : 'File transfer';
      const fileCountText = rec.files && rec.files.length > 1 ? ` (+${rec.files.length - 1} more)` : '';

      const isSuccess = rec.status === 'success';
      const badgeClass = isSuccess ? 'badge-success' : 'badge-failed';
      const badgeText = isSuccess ? 'Completed' : 'Failed';

      const savedPath = rec.files && rec.files[0] ? rec.files[0].path : null;

      card.innerHTML = `
        <div class="history-left">
          <div class="history-direction-icon ${iconClass}">
            ${dirIcon}
          </div>
          <div class="history-content">
            <span class="history-filename">${firstFileName}${fileCountText}</span>
            <div class="history-sub">
              <span>${dirText}</span>
              &bull;
              <span>${formatBytes(rec.totalSize)}</span>
              &bull;
              <span>${formatHistoryTime(rec.timestamp)}</span>
            </div>
          </div>
        </div>
        <div class="history-right">
          <span class="badge-status ${badgeClass}">${badgeText}</span>
          ${!isSent && isSuccess && savedPath ? `
            <button class="btn btn-secondary btn-show-folder" style="padding: 4px 8px; font-size: 11px;">
              ${Icons.folder}
              <span>Show</span>
            </button>
          ` : ''}
        </div>
      `;

      if (!isSent && isSuccess && savedPath) {
        const btnShow = card.querySelector('.btn-show-folder');
        if (btnShow) {
          btnShow.addEventListener('click', () => {
            window.localdrop.openDownloadFolder(savedPath);
          });
        }
      }

      this.container.appendChild(card);
    });
  }
}
