class AudioJoiner {
    constructor() {
        this.sessionId = null;
        this.uploadedFiles = [];
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        this.uploadArea = document.getElementById('upload-area');
        this.fileInput = document.getElementById('file-input');
        this.fileListSection = document.getElementById('file-list-section');
        this.fileList = document.getElementById('file-list');
        this.mergeBtn = document.getElementById('merge-btn');
        this.clearBtn = document.getElementById('clear-btn');
        this.progressSection = document.getElementById('progress-section');
        this.downloadSection = document.getElementById('download-section');
        this.downloadLink = document.getElementById('download-link');
        this.newMergeBtn = document.getElementById('new-merge-btn');
        this.qualitySelect = document.getElementById('quality-select');
        this.fadeInput = document.getElementById('fade-input');
        this.progressFill = document.getElementById('progress-fill');
        this.progressText = document.getElementById('progress-text');
    }

    bindEvents() {
        // File upload events
        this.uploadArea.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        // Drag and drop events
        this.uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.uploadArea.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.uploadArea.addEventListener('drop', (e) => this.handleDrop(e));

        // Button events
        this.mergeBtn.addEventListener('click', () => this.mergeFiles());
        this.clearBtn.addEventListener('click', () => this.clearAll());
        this.newMergeBtn.addEventListener('click', () => this.startNew());
    }

    handleDragOver(e) {
        e.preventDefault();
        this.uploadArea.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        this.uploadArea.classList.remove('dragover');
        this.handleFiles(e.dataTransfer.files);
    }

    async handleFiles(files) {
        if (files.length === 0) return;

        const formData = new FormData();
        for (let file of files) {
            formData.append('files', file);
        }

        try {
            this.showLoading('Uploading files...');
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok) {
                this.sessionId = result.session_id;
                this.uploadedFiles = result.files;
                this.displayFiles();
                this.hideLoading();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.hideLoading();
            this.showError(`Upload failed: ${error.message}`);
        }
    }

    displayFiles() {
        this.fileList.innerHTML = '';

        this.uploadedFiles.forEach((file, index) => {
            const fileItem = this.createFileItem(file, index);
            this.fileList.appendChild(fileItem);
        });

        this.fileListSection.classList.remove('hidden');
        document.getElementById('upload-section').classList.add('hidden');
    }

    createFileItem(file, index) {
        const div = document.createElement('div');
        div.className = 'file-item';
        div.draggable = true;
        div.dataset.filename = file.filename;
        div.dataset.index = index;

        div.innerHTML = `
            <div class="drag-handle">
                <i class="fas fa-grip-vertical"></i>
            </div>
            <div class="file-icon">
                <i class="fas fa-music"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${file.filename}</div>
                <div class="file-details">${file.size} • ${file.duration}</div>
            </div>
            <div class="file-actions">
                <button class="remove-file" onclick="audioJoiner.removeFile('${file.filename}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;

        // Add drag events
        div.addEventListener('dragstart', (e) => this.handleDragStart(e));
        div.addEventListener('dragend', (e) => this.handleDragEnd(e));
        div.addEventListener('dragover', (e) => this.handleItemDragOver(e));
        div.addEventListener('drop', (e) => this.handleItemDrop(e));

        return div;
    }

    handleDragStart(e) {
        e.dataTransfer.setData('text/plain', e.target.dataset.filename);
        e.target.classList.add('dragging');
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
    }

    handleItemDragOver(e) {
        e.preventDefault();
    }

    handleItemDrop(e) {
        e.preventDefault();
        const draggedFilename = e.dataTransfer.getData('text/plain');
        const targetFilename = e.target.closest('.file-item').dataset.filename;

        if (draggedFilename !== targetFilename) {
            this.reorderFiles(draggedFilename, targetFilename);
        }
    }

    reorderFiles(draggedFilename, targetFilename) {
        const draggedIndex = this.uploadedFiles.findIndex(f => f.filename === draggedFilename);
        const targetIndex = this.uploadedFiles.findIndex(f => f.filename === targetFilename);

        // Reorder array
        const draggedFile = this.uploadedFiles.splice(draggedIndex, 1)[0];
        this.uploadedFiles.splice(targetIndex, 0, draggedFile);

        // Refresh display
        this.displayFiles();
    }

    removeFile(filename) {
        this.uploadedFiles = this.uploadedFiles.filter(f => f.filename !== filename);

        if (this.uploadedFiles.length === 0) {
            this.clearAll();
        } else {
            this.displayFiles();
        }
    }

    async mergeFiles() {
        if (this.uploadedFiles.length < 2) {
            this.showError('At least 2 files are required for merging');
            return;
        }

        try {
            this.showProgress();

            const fileOrder = this.uploadedFiles.map(f => f.filename);
            const quality = this.qualitySelect.value;
            const fadeDuration = parseFloat(this.fadeInput.value);

            console.log('Starting merge with:', { fileOrder, quality, fadeDuration });

            const response = await fetch('/merge', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    session_id: this.sessionId,
                    file_order: fileOrder,
                    quality: quality,
                    fade_duration: fadeDuration
                })
            });

            const result = await response.json();
            console.log('Merge result:', result);

            if (response.ok && result.success) {
                this.showDownload(result.download_url, result.file_size);
            } else {
                throw new Error(result.error || 'Merge failed');
            }
        } catch (error) {
            console.error('Merge error:', error);
            this.hideProgress();
            this.showError(`Merge failed: ${error.message}`);
        }
    }

    showDownload(downloadUrl, fileSize = '') {
        this.hideProgress();

        // Set download link
        this.downloadLink.href = downloadUrl;
        this.downloadLink.onclick = () => {
            // Auto cleanup after download starts
            setTimeout(() => {
                if (this.sessionId) {
                    fetch(`/cleanup/${this.sessionId}`)
                        .then(response => response.json())
                        .then(result => {
                            console.log('Cleanup result:', result);
                        })
                        .catch(error => {
                            console.log('Cleanup error:', error);
                        });
                }
            }, 2000); // Wait 2 seconds before cleanup
        };

        // Update file size display if provided
        if (fileSize) {
            const sizeElement = document.querySelector('.file-size-display');
            if (sizeElement) {
                sizeElement.textContent = `File size: ${fileSize}`;
            }
        }

        this.downloadSection.classList.remove('hidden');

        // Auto-scroll to download section
        this.downloadSection.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    showError(message) {
        // Better error display
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.innerHTML = `
        <div style="background: #dc3545; color: white; padding: 15px; border-radius: 8px; margin: 20px 0; text-align: center;">
            <i class="fas fa-exclamation-triangle"></i>
            <strong>Error:</strong> ${message}
            <button onclick="this.parentElement.parentElement.remove()" style="float: right; background: none; border: none; color: white; font-size: 18px; cursor: pointer;">×</button>
        </div>
    `;

        // Show error at the top of the container
        const container = document.querySelector('.container main');
        container.insertBefore(errorDiv, container.firstChild);

        // Auto remove after 10 seconds
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.remove();
            }
        }, 10000);
    }


    showProgress() {
        this.fileListSection.classList.add('hidden');
        this.progressSection.classList.remove('hidden');

        // Simulate progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 100) progress = 100;

            this.progressFill.style.width = progress + '%';

            if (progress < 30) {
                this.progressText.textContent = 'Converting audio files...';
            } else if (progress < 70) {
                this.progressText.textContent = 'Merging audio tracks...';
            } else if (progress < 95) {
                this.progressText.textContent = 'Finalizing output...';
            } else {
                this.progressText.textContent = 'Almost done...';
                clearInterval(interval);
            }
        }, 200);

        this.progressInterval = interval;
    }

    hideProgress() {
        if (this.progressInterval) {
            clearInterval(this.progressInterval);
        }
        this.progressSection.classList.add('hidden');
    }

    showDownload(downloadUrl) {
        this.hideProgress();
        this.downloadLink.href = downloadUrl;
        this.downloadSection.classList.remove('hidden');
    }

    showLoading(message) {
        this.progressText.textContent = message;
        this.progressSection.classList.remove('hidden');
    }

    hideLoading() {
        this.progressSection.classList.add('hidden');
    }

    showError(message) {
        alert(message); // You can implement a better error display
    }

    clearAll() {
        this.uploadedFiles = [];
        this.sessionId = null;
        this.fileListSection.classList.add('hidden');
        this.progressSection.classList.add('hidden');
        this.downloadSection.classList.add('hidden');
        document.getElementById('upload-section').classList.remove('hidden');
        this.fileInput.value = '';
    }

    startNew() {
        this.clearAll();
    }
}

// Initialize the application
const audioJoiner = new AudioJoiner();
