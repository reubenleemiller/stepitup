(function(){
  function $(sel, root){ return (root||document).querySelector(sel); }
  function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
  function formatSize(bytes){ if(bytes===0) return '0 B'; const k=1024,sizes=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(k)); return (bytes/Math.pow(k,i)).toFixed(2)+' '+sizes[i]; }

  class ResourcesUploader{
    constructor(){
      this.queue = [];
      this.concurrent = 3;
      this.active = 0;
      this.mounted = false;
      document.addEventListener('DOMContentLoaded', ()=> this.mount());
    }

    mount(){
      if(this.mounted) return; this.mounted = true;
      this.section = document.getElementById('resources-upload-section');
      if(!this.section) return;
      this.bucketSelect = $('#bucket-select', this.section);
      this.gradeSelect = $('#grade-folder-select', this.section);
      this.fileInput = $('#resources-file-input', this.section);
      this.queueList = $('#upload-queue', this.section);
      this.startBtn = $('#start-upload-btn', this.section);
      this.clearBtn = $('#clear-queue-btn', this.section);
      this.summary = $('#upload-summary', this.section);

      this.fileInput.addEventListener('change', (e)=> this.addFiles(e.target.files));
      this.startBtn.addEventListener('click', ()=> this.startUploads());
      this.clearBtn.addEventListener('click', ()=> this.clearQueue());
      this.section.addEventListener('dragover', (e)=>{ e.preventDefault(); this.section.classList.add('dragging'); });
      this.section.addEventListener('dragleave', (e)=>{ e.preventDefault(); this.section.classList.remove('dragging'); });
      this.section.addEventListener('drop', (e)=>{ e.preventDefault(); this.section.classList.remove('dragging'); this.addFiles(e.dataTransfer.files); });
      this.updateSummary();
    }

    addFiles(fileList){
      const grade = this.gradeSelect.value;
      const files = Array.from(fileList||[]);
      files.forEach(file=>{
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const item = { id, file, status:'queued', progress:0, grade };
        this.queue.push(item);
        this.renderItem(item);
      });
      this.updateSummary();
    }

    renderItem(item){
      const li = document.createElement('div');
      li.className = 'upload-queue-item';
      li.dataset.id = item.id;
      li.innerHTML = `
        <div class="item-left">
          <div class="file-icon"><i class="fas fa-file"></i></div>
          <div class="file-meta">
            <div class="file-name" title="${item.file.name}">${item.file.name}</div>
            <div class="file-sub">${formatSize(item.file.size)} • ${item.grade}</div>
          </div>
        </div>
        <div class="item-right">
          <div class="file-status status-queued">Queued</div>
          <button type="button" class="remove-item-btn" aria-label="Remove">✕</button>
        </div>
        <div class="progress-track"><div class="progress-value" style="width:0%"></div></div>
      `;
      this.queueList.appendChild(li);
      $('.remove-item-btn', li).addEventListener('click', ()=> this.removeItem(item.id));
    }

    removeItem(id){
      const idx = this.queue.findIndex(x=>x.id===id);
      if(idx>=0){
        const [item] = this.queue.splice(idx,1);
        const el = this.queueList.querySelector(`[data-id="${id}"]`);
        if(el) el.remove();
      }
      this.updateSummary();
    }

    clearQueue(){
      this.queue = [];
      this.queueList.innerHTML = '';
      this.updateSummary();
    }

    updateSummary(){
      const total = this.queue.length;
      const uploading = this.queue.filter(x=>x.status==='uploading').length;
      const done = this.queue.filter(x=>x.status==='done').length;
      const failed = this.queue.filter(x=>x.status==='error').length;
      this.summary.textContent = `${done}/${total} completed • ${failed} failed`;
      this.startBtn.disabled = total===0 || uploading>0 && this.active>=this.concurrent;
      this.clearBtn.disabled = total===0 || uploading>0;
    }

    startUploads(){
      const toStart = this.queue.filter(x=>x.status==='queued');
      if(!toStart.length) return;
      this.active = 0;
      for(let i=0;i<Math.min(this.concurrent, toStart.length); i++){
        this.kick();
      }
    }

    kick(){
      if(this.active>=this.concurrent) return;
      const next = this.queue.find(x=>x.status==='queued');
      if(!next){ this.updateSummary(); return; }
      this.uploadItem(next);
    }

    uploadItem(item){
      item.status = 'uploading';
      this.active++;
      const row = this.queueList.querySelector(`[data-id="${item.id}"]`);
      const statusEl = $('.file-status', row);
      row.classList.add('is-uploading');
      statusEl.className = 'file-status status-uploading';
      statusEl.textContent = 'Uploading...';

      const fd = new FormData();
      fd.append('bucket', (this.bucketSelect && this.bucketSelect.value) || 'resources');
      fd.append('grade', item.grade);
      fd.append('file', item.file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', (typeof functionsUrl==='function'? functionsUrl('upload-resources') : '/.netlify/functions/upload-resources'));
      const token = localStorage.getItem('admin_token');
      if(token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e)=>{
        if(!e.lengthComputable) return;
        const pct = Math.round((e.loaded/e.total)*100);
        item.progress = pct;
        $('.progress-value', row).style.width = pct+'%';
      };

      xhr.onerror = ()=>{
        item.status = 'error';
        this.active = Math.max(0, this.active-1);
        row.classList.remove('is-uploading');
        statusEl.className = 'file-status status-error';
        statusEl.textContent = 'Failed';
        this.kick();
        this.updateSummary();
      };

      xhr.onload = ()=>{
        this.active = Math.max(0, this.active-1);
        try{
          const res = JSON.parse(xhr.responseText||'{}');
          if(xhr.status>=200 && xhr.status<300 && res && res.success){
            item.status = 'done';
            $('.progress-value', row).style.width = '100%';
            row.classList.remove('is-uploading');
            statusEl.className = 'file-status status-done';
            statusEl.textContent = 'Completed';
          } else {
            item.status = 'error';
            row.classList.remove('is-uploading');
            statusEl.className = 'file-status status-error';
            statusEl.textContent = 'Failed';
          }
        }catch(_){
          item.status = 'error';
          row.classList.remove('is-uploading');
          statusEl.className = 'file-status status-error';
          statusEl.textContent = 'Failed';
        }
        this.kick();
        this.updateSummary();
      };

      xhr.send(fd);
      this.updateSummary();
    }
  }

  // Initialize when script loads
  window.__resourcesUploader = new ResourcesUploader();
})();
