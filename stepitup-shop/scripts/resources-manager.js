(function(){
  function $(s,r){return (r||document).querySelector(s);} function $all(s,r){return Array.from((r||document).querySelectorAll(s));}
  function functionsUrl(endpoint){
  try{ if(window.__FUNCTIONS_ORIGIN__){ const o=String(window.__FUNCTIONS_ORIGIN__).replace(/\/$/,''); return `${o}/.netlify/functions/${String(endpoint).replace(/^\/+/, '')}`; }
  }catch(_){}
  const {origin,protocol,hostname,port}=window.location;
  const base = origin || `${protocol}//${hostname}${port?':'+port:''}`;
  return `${base}/.netlify/functions/${String(endpoint).replace(/^\/+/, '')}`;
}

  class ResourcesManager{
    constructor(){ document.addEventListener('DOMContentLoaded', ()=> this.mount()); }
    mount(){
      this.section = document.getElementById('free-resources-section'); if(!this.section) return;
      this.gradeSelect = $('#free-grade-filter', this.section);
      this.refreshBtn = $('#free-refresh-btn', this.section);
      this.list = $('#free-resources-list', this.section);
      this.bulkDeleteBtn = $('#free-bulk-delete-btn', this.section);
      this.selectAllCb = $('#free-select-all', this.section);

      // Modal refs
      this.deleteModal = document.getElementById('free-delete-modal');
      this.deleteList = document.getElementById('free-delete-list');
      this.deleteCancel = document.getElementById('free-delete-cancel');
      this.deleteConfirm = document.getElementById('free-delete-confirm');
      this.deleteTargets = [];

      this.refreshBtn.addEventListener('click', ()=> this.load());
      this.gradeSelect.addEventListener('change', ()=> this.load());
      this.bulkDeleteBtn.addEventListener('click', ()=> this.bulkDelete());
      this.selectAllCb.addEventListener('change', ()=> {
        const checked = this.selectAllCb.checked; $all('.free-item-cb', this.list).forEach(cb=> cb.checked = checked);
        this.updateBulkState();
      });
      this.list.addEventListener('change', (e)=>{ if(e.target.matches('.free-item-cb')) this.updateBulkState(); });
      // Load immediately after successful admin auth
      window.addEventListener('admin-auth-success', ()=> this.load());

      // Modal handlers
      if(this.deleteCancel){ this.deleteCancel.addEventListener('click', ()=> this.closeDeleteModal()); }
      if(this.deleteModal){ this.deleteModal.addEventListener('click', (e)=>{ if(e.target===this.deleteModal) this.closeDeleteModal(); }); }
      if(this.deleteConfirm){ this.deleteConfirm.addEventListener('click', ()=> this.confirmDelete()); }

      // Wait for auth to avoid unauthorized flash
      const token = localStorage.getItem('admin_token');
      if (token) {
        this.load();
      } else {
        this.list.innerHTML = '<div class="products-loading"><div class="products-spinner"></div><p>Loading resources...</p></div>';
        let tries = 0; const t = setInterval(()=>{
          const tok = localStorage.getItem('admin_token');
          if(tok){ clearInterval(t); this.load(); }
          else if(++tries>150){ clearInterval(t); this.list.innerHTML = '<div class="no-products-message"><p>Please sign in to view resources.</p></div>'; }
        }, 200);
      }
    }

    async load(){
      this.list.innerHTML = '<div class="products-loading"><div class="products-spinner"></div><p>Loading resources...</p></div>';
      try{
        const u = new URL(functionsUrl('list-resources'));
        const grade = this.gradeSelect.value || 'All';
        u.searchParams.set('grade', grade);
        const res = await fetch(u.toString(), { headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')||''}` } });
        const data = await res.json();
        if(res.status === 401){ this.list.innerHTML = '<div class="no-products-message"><p>Please sign in to view resources.</p></div>'; return; }
        if(!res.ok || !data || !data.success){ throw new Error((data && data.error) || 'Failed to load'); }
        this.render(data.files||[], grade);
      }catch(err){ this.list.innerHTML = `<div class="no-products-message"><p>No files found.</p></div>`; }
    }

    render(files, grade){
      if(!files.length){ this.list.innerHTML = '<div class="no-products-message"><p>No files found.</p></div>'; this.updateBulkState(); return; }
      const rows = files.map(f=> `
        <div class="free-file-row">
          <div class="free-file-left">
            <input type="checkbox" class="free-item-cb" data-path="${f.path}">
            <i class="fas fa-file"></i>
            <div class="free-file-meta">
              <div class="free-file-name" title="${f.name}">${f.name}</div>
              <div class="free-file-sub">${grade==='All' ? (f.path.split('/')[0]+' • ') : ''}${f.path}</div>
            </div>
          </div>
          <div class="free-file-actions">
            <button type="button" class="control-btn free-delete-btn" data-path="${f.path}"><i class="fas fa-trash"></i> Delete</button>
          </div>
        </div>`).join('');
      this.list.innerHTML = rows;
      $all('.free-delete-btn', this.list).forEach(btn=> btn.addEventListener('click', (e)=> this.deleteOne(e.currentTarget.dataset.path)));
      this.updateBulkState();
    }

    updateBulkState(){
      const anyChecked = $all('.free-item-cb', this.list).some(cb=> cb.checked);
      this.bulkDeleteBtn.disabled = !anyChecked;
    }

    deleteOne(path){ this.openDeleteModal([path]); }

    bulkDelete(){
      const paths = $all('.free-item-cb', this.list).filter(cb=> cb.checked).map(cb=> cb.dataset.path);
      if(!paths.length) return; this.openDeleteModal(paths);
    }

    openDeleteModal(paths){
      this.deleteTargets = paths.slice();
      if(this.deleteList){
        this.deleteList.innerHTML = paths.slice(0,10).map(p=> `<div>• ${p}</div>`).join('') + (paths.length>10? `<div>…and ${paths.length-10} more</div>` : '');
      }
      this.setDeleteLoading(false);
      if(this.deleteModal){ this.deleteModal.classList.add('show'); document.body.style.overflow = 'hidden'; }
    }

    closeDeleteModal(){ if(this.deleteModal){ this.deleteModal.classList.remove('show'); document.body.style.overflow=''; } this.deleteTargets = []; this.setDeleteLoading(false); }

    setDeleteLoading(loading){
      if(!this.deleteConfirm) return;
      const text = this.deleteConfirm.querySelector('.btn-text');
      const spin = this.deleteConfirm.querySelector('.btn-spinner');
      this.deleteConfirm.disabled = loading;
      
      // Add/remove loading class for CSS styling
      if(loading) {
        this.deleteConfirm.classList.add('loading');
      } else {
        this.deleteConfirm.classList.remove('loading');
      }
      
      if(text) text.style.display = loading ? 'none' : 'inline-flex';
      if(spin) spin.style.display = loading ? 'inline-flex' : 'none';
    }

    async confirmDelete(){
      if(!this.deleteTargets.length) { this.closeDeleteModal(); return; }
      this.setDeleteLoading(true);
      try{ await this.performDelete(this.deleteTargets); this.closeDeleteModal(); }
      catch(err){ alert(err.message || 'Delete failed'); this.setDeleteLoading(false); }
    }

    async performDelete(paths){
      const res = await fetch(functionsUrl('delete-resources'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('admin_token')||''}` },
        body: JSON.stringify({ paths })
      });
      const data = await res.json();
      if(!res.ok || !data || !data.success){ throw new Error((data && data.error) || 'Delete failed'); }
      await this.load();
    }
  }

  window.__resourcesManager = new ResourcesManager();
})();
