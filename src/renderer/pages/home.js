function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

class HomePage {
  constructor() {
    this.selectedFiles = [];
    this.activeShareUrl = '';

    this.dropZone = document.getElementById('drop-zone');
    this.dropIcon = document.getElementById('drop-icon');
    this.dropTitle = document.getElementById('drop-title');

    this.qrMainCard = document.getElementById('qr-main-card');
    this.summaryText = document.getElementById('selected-files-summary');
    this.filesList = document.getElementById('selected-files-list');
    this.btnAddMore = document.getElementById('btn-add-more-files');
    this.btnClearFiles = document.getElementById('btn-clear-files');

    this.mainQrImage = document.getElementById('main-qr-image');
    this.mainShareUrlText = document.getElementById('main-share-url-text');
    this.btnCopyUrl = document.getElementById('btn-copy-main-url');

    this.featuresRow = document.getElementById('features-row');
    this.featIconPhone = document.getElementById('feat-icon-phone');
    this.featIconWifi = document.getElementById('feat-icon-wifi');
    this.featIconPreview = document.getElementById('feat-icon-preview');

    this.init();
  }

  init() {
    this.dropIcon.innerHTML = Icons.upload;
    if (this.featIconPhone) this.featIconPhone.innerHTML = Icons.mobile;
    if (this.featIconWifi) this.featIconWifi.innerHTML = Icons.refresh;
    if (this.featIconPreview) this.featIconPreview.innerHTML = Icons.file;

    // Dropzone click -> file picker
    this.dropZone.addEventListener('click', async () => {
      try {
        const files = await window.localdrop.selectFiles();
        if (files && files.length > 0) {
          await this.addFiles(files);
        }
      } catch (err) {
        console.error('File selection error:', err);
      }
    });

    // Drag & Drop
    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.add('dragover');
    });

    this.dropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('dragover');
    });

    this.dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dropZone.classList.remove('dragover');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files).map(f => ({
          path: f.path,
          name: f.name,
          size: f.size
        }));
        await this.addFiles(files);
      }
    });

    // Add more files button
    if (this.btnAddMore) {
      this.btnAddMore.addEventListener('click', async () => {
        try {
          const files = await window.localdrop.selectFiles();
          if (files && files.length > 0) {
            await this.addFiles(files);
          }
        } catch (err) {
          console.error('File selection error:', err);
        }
      });
    }

    // Clear files button
    if (this.btnClearFiles) {
      this.btnClearFiles.addEventListener('click', async () => {
        await this.clearFiles();
      });
    }

    // Copy URL button
    if (this.btnCopyUrl) {
      this.btnCopyUrl.addEventListener('click', () => {
        if (this.activeShareUrl) {
          navigator.clipboard.writeText(this.activeShareUrl);
          window.app.showToast('Link copied to clipboard!');
        }
      });
    }
  }

  async addFiles(files) {
    for (const f of files) {
      if (!this.selectedFiles.some(existing => existing.path === f.path)) {
        this.selectedFiles.push(f);
      }
    }
    await this.updateShareState();
  }

  async removeFile(index) {
    this.selectedFiles.splice(index, 1);
    if (this.selectedFiles.length === 0) {
      await this.clearFiles();
    } else {
      await this.updateShareState();
    }
  }

  async clearFiles() {
    this.selectedFiles = [];
    await window.localdrop.stopWebShare();
    this.activeShareUrl = '';

    if (this.qrMainCard) this.qrMainCard.style.display = 'none';
    if (this.featuresRow) this.featuresRow.style.display = 'grid';
    if (this.dropTitle) this.dropTitle.textContent = 'Drop files here to share via QR Code';
    this.filesList.innerHTML = '';
  }

  async updateShareState() {
    if (this.selectedFiles.length === 0) {
      await this.clearFiles();
      return;
    }

    // Start or update web share in background
    try {
      const res = await window.localdrop.startWebShare(this.selectedFiles);
      if (res && res.success) {
        this.activeShareUrl = res.url;
        this.mainQrImage.src = res.qrDataUrl;
        this.mainShareUrlText.textContent = res.url;
      }
    } catch (err) {
      console.error('Failed to update web share:', err);
    }

    // Show QR card, hide generic features row
    if (this.qrMainCard) this.qrMainCard.style.display = 'block';
    if (this.featuresRow) this.featuresRow.style.display = 'none';
    if (this.dropTitle) this.dropTitle.textContent = 'Drop more files to add to QR Code share';

    const totalBytes = this.selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
    const count = this.selectedFiles.length;
    this.summaryText.textContent = `${count} ${count === 1 ? 'file' : 'files'} ready to share (${formatBytes(totalBytes)})`;

    this.filesList.innerHTML = '';
    this.selectedFiles.forEach((file, idx) => {
      const li = document.createElement('li');
      li.className = 'file-item';

      li.innerHTML = `
        <div class="file-info">
          <span class="file-icon">${Icons.file}</span>
          <span class="file-name" title="${file.name}">${file.name}</span>
        </div>
        <div class="file-meta">
          <span class="file-size">${formatBytes(file.size)}</span>
          <button class="btn-icon-only btn-remove" data-index="${idx}" title="Remove file">
            ${Icons.close}
          </button>
        </div>
      `;

      li.querySelector('.btn-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.removeFile(idx);
      });

      this.filesList.appendChild(li);
    });
  }

  updatePeers() {
    // Left empty: QR Code is the primary sharing mechanism now
  }
}
