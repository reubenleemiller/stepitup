const API_BASE = '/.netlify/functions/listResources';
const SUPABASE_PUBLIC_URL = 'https://dvsruqzfdzjyahknixmk.supabase.co/storage/v1/object/public/resources';

const FOLDER_SVG = `<svg class="folder-icon-svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#2c77cc" d="M10 4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h6z" /></svg>`;

const FILE_TYPE_SVGS = {
  pdf: `<svg width="24" height="24" viewBox="0 0 24 24"><path fill="#e53e3e" d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path fill="#fff" d="M14 3.5V9h5.5z"/></svg>`,
  jpg: `<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#3182ce"/><circle cx="12" cy="14" r="4" fill="#fff"/><circle cx="12" cy="14" r="2" fill="#3182ce"/></svg>`,
  jpeg: `<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#3182ce"/><circle cx="12" cy="14" r="4" fill="#fff"/><circle cx="12" cy="14" r="2" fill="#3182ce"/></svg>`,
  png: `<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#48bb78"/><circle cx="12" cy="14" r="4" fill="#fff"/><circle cx="12" cy="14" r="2" fill="#48bb78"/></svg>`,
  docx: `<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#2b6cb0"/><text x="6" y="18" font-size="10" fill="#fff">DOC</text></svg>`,
  default: `<svg width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#a0aec0"/><text x="6" y="18" font-size="10" fill="#fff">FILE</text></svg>`
};

function getFileSVG(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return FILE_TYPE_SVGS[ext] || FILE_TYPE_SVGS.default;
}

async function fetchFolderStructure(prefix = '') {
  const url = prefix ? `${API_BASE}?prefix=${encodeURIComponent(prefix)}` : API_BASE;
  const res = await fetch(url);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Could not parse server response as JSON.');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load folder structure');
  }
  return data;
}

function modalSpinnerHTML() {
  return `
    <div class="modal-spinner">
      <div class="spinner-lds" style="position:relative;height:54px;width:54px;">
        <div></div><div></div><div></div><div></div>
      </div>
      <div style="color:#e2b45a">Loading…</div>
    </div>
  `;
}

let lastFolderModalData = null;

function showModal(html, opts = {}) {
  let modal = document.getElementById('modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal';
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-bg"></div><div class="modal-content"></div>`;
    document.body.appendChild(modal);
    modal.querySelector('.modal-bg').onclick = () => closeModal();
  }
  const content = modal.querySelector('.modal-content');
  content.innerHTML = html;
  modal.classList.add('open');
  setTimeout(() => content.style.opacity = 1, 10);

  if (opts.onClose) {
    const closeBtn = content.querySelector('.modal-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.preventDefault();
        opts.onClose();
      };
    }
  }
}
function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.classList.remove('open');
    setTimeout(() => {
      if (modal) modal.querySelector('.modal-content').innerHTML = '';
    }, 250);
  }
}

function renderModalBreadcrumbs(pathArr) {
  let html = `<nav class="modal-breadcrumbs">`;
  if (!pathArr.length) {
    html += `<span>root</span>`;
  } else {
    html += `<a href="#" data-path="">root</a> / `;
    pathArr.forEach((part, idx) => {
      const isLast = idx === pathArr.length - 1;
      if (isLast) {
        html += `<span>${part}</span>`;
      } else {
        html += `<a href="#" data-path="${pathArr.slice(0, idx + 1).join('/')}">${part}</a> / `;
      }
    });
  }
  html += `</nav>`;
  return html;
}

function renderFolderList(data, container, onClickFolder) {
  container.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'folder-list-root';
  data.filter(item => item.type === 'folder').forEach(item => {
    const li = document.createElement('li');
    li.className = 'folder-list-folder';
    li.innerHTML = `${FOLDER_SVG}<span class="folder-name">${item.name}</span>`;
    li.onclick = () => onClickFolder(item);
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

function renderFolderModal(path, folders, files) {
  lastFolderModalData = { path, folders, files };
  const pathArr = path ? path.split('/') : [];
  let html = renderModalBreadcrumbs(pathArr);
  html += `<button class="modal-close" type="button">&times;</button>`;
  if (!folders.length && !files.length) {
    html += `<div style="padding:2em;text-align:center;color:#bbb;font-size:1.1em;">(No files or folders in this folder)</div>`;
  } else {
    if (folders.length) {
      html += `<ul class="modal-folder-list">`;
      folders.forEach(folder => {
        html += `<li class="modal-folder-list-folder" data-path="${folder.path}" style="cursor:pointer;">
          ${FOLDER_SVG}<span class="folder-name">${folder.name}</span>
        </li>`;
      });
      html += `</ul>`;
    }
    if (files.length) {
      html += `<ul class="file-list-modal">`;
      files.forEach(file => {
        html += `<li class="file-list-item" data-path="${file.path}">
          <span class="file-svg-icon">${getFileSVG(file.name)}</span>
          <span class="file-name">${file.name}</span>
          <button class="file-preview-btn" data-path="${file.path}">
            <span class="btn-contents">
              <span class="btn-label">Preview</span>
              <span class="btn-spinner" aria-hidden="true"></span>
            </span>
          </button>
          <button class="file-download-btn" data-path="${file.path}" data-filename="${file.name}">
            <span class="btn-contents">
              <span class="btn-label">Download</span>
              <span class="btn-spinner" aria-hidden="true"></span>
            </span>
          </button>
        </li>`;
      });
      html += `</ul>`;
    }
  }
  return html;
}

function renderFilePreviewModal(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let preview = '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
    preview = `<img src="${SUPABASE_PUBLIC_URL}/${encodeURIComponent(file.path)}" style="max-width:90%;max-height:60vh;display:block;margin:1em auto;" />`;
  } else if (ext === 'pdf') {
    preview = `<iframe src="${SUPABASE_PUBLIC_URL}/${encodeURIComponent(file.path)}" style="width:90vw;height:70vh;border:none;"></iframe>`;
  } else {
    preview = `<div style="padding:2em;text-align:center;">No preview available.</div>`;
  }
  return `
    <div class="modal-file-preview-head">
      <span>${getFileSVG(file.name)} ${file.name}</span>
      <button class="modal-close" type="button">&times;</button>
    </div>
    <div class="modal-file-preview-body">
      ${preview}
    </div>
    <button class="file-download-btn" data-path="${file.path}" data-filename="${file.name}">
      <span class="btn-contents">
        <span class="btn-label">Download</span>
        <span class="btn-spinner" aria-hidden="true"></span>
      </span>
    </button>
  `;
}

function showButtonSpinner(btn) {
  btn.disabled = true;
  btn.classList.add('loading');
  btn._spinnerStart = Date.now();
}
function hideButtonSpinner(btn) {
  const min = 1000;
  const elapsed = Date.now() - (btn._spinnerStart || 0);
  function finish() {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn._spinnerStart = undefined;
  }
  if (elapsed < min) setTimeout(finish, min - elapsed);
  else finish();
}

function setupModalButtonDelegation() {
  const modal = document.getElementById('modal');
  if (!modal) return;
  const content = modal.querySelector('.modal-content');
  if (!content) return;

  content.onclick = async function (e) {
    const btn = e.target.closest('.file-preview-btn, .file-download-btn');
    if (!btn) return;

    e.preventDefault();
    if (btn.disabled) return;

    showButtonSpinner(btn);

    if (btn.classList.contains('file-download-btn')) {
      const filePath = btn.getAttribute('data-path');
      const fileName = btn.getAttribute('data-filename');
      const files = lastFolderModalData ? lastFolderModalData.files : [];
      const file = files.find(f => f.path === filePath) || { name: fileName, path: filePath };
      const url = `${SUPABASE_PUBLIC_URL}/${encodeURIComponent(file.path)}`;
      const MIN_SPIN = 1000;
      const spinPromise = new Promise(resolve => setTimeout(resolve, MIN_SPIN));
      try {
        const fetchPromise = fetch(url)
          .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.blob();
          });
        const [blob] = await Promise.all([fetchPromise, spinPromise]);
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          window.URL.revokeObjectURL(link.href);
          link.remove();
        }, 100);
      } catch (error) {
        alert('Failed to download file.');
      }
      hideButtonSpinner(btn);
      return;
    }

    if (btn.classList.contains('file-preview-btn')) {
      const filePath = btn.getAttribute('data-path');
      const files = lastFolderModalData ? lastFolderModalData.files : [];
      const file = files.find(f => f.path === filePath);
      const MIN_SPIN = 1000;
      await new Promise(resolve => setTimeout(resolve, MIN_SPIN));
      hideButtonSpinner(btn);
      if (file) {
        showModal(renderFilePreviewModal(file), {
          onClose: () => {
            if (lastFolderModalData) {
              showModal(
                renderFolderModal(
                  lastFolderModalData.path,
                  lastFolderModalData.folders,
                  lastFolderModalData.files
                ),
                { onClose: closeModal }
              );
              document.querySelectorAll('.modal-folder-list-folder').forEach(li => {
                li.onclick = async (e) => {
                  e.preventDefault();
                  const toPath = li.getAttribute('data-path');
                  if (toPath) {
                    await openFolderModal({ path: toPath, name: toPath.split('/').pop() });
                  }
                };
              });
              document.querySelectorAll('.modal-breadcrumbs a').forEach(a => {
                a.onclick = async (e) => {
                  e.preventDefault();
                  const toPath = a.getAttribute('data-path');
                  if (!toPath) {
                    closeModal();
                    await loadRoot();
                  } else {
                    await openFolderModal({ path: toPath, name: toPath.split('/').pop() });
                  }
                };
              });
              setupModalButtonDelegation();
            } else {
              closeModal();
            }
          }
        });
        setupModalButtonDelegation();
      }
    }
  };
}

const folderTreeDiv = document.getElementById('folder-tree');

async function loadRoot() {
  // Use the same spinner as the modal!
  folderTreeDiv.innerHTML = `
    <div class="modal-spinner" style="min-height:180px;">
      <div class="spinner-lds" style="position:relative;height:54px;width:54px;">
        <div></div><div></div><div></div><div></div>
      </div>
      <div style="color:#e2b45a">Loading…</div>
    </div>
  `;
  try {
    const structure = await fetchFolderStructure('');
    renderFolderList(structure, folderTreeDiv, openFolderModal);
  } catch (err) {
    folderTreeDiv.innerHTML = `<div style="color:red;padding:2em;text-align:center;">${err.message}</div>`;
  }
}

async function openFolderModal(folder) {
  showModal(modalSpinnerHTML());
  const path = folder.path;
  let files = [], folders = [];
  const MIN_SPIN = 1000;
  const spinPromise = new Promise(resolve => setTimeout(resolve, MIN_SPIN));
  let structure = [];
  try {
    structure = await fetchFolderStructure(path);
    folders = structure.filter(item => item.type === 'folder');
    files = structure.filter(
      item =>
        item.type === 'file' &&
        !/^\.*emptyfolderplaceholder(\..*)?$/i.test(item.name) &&
        !item.name.startsWith('.')
    );
  } catch (err) {
    showModal(`<div style="color:red;padding:2em;text-align:center;">${err.message}</div>`);
    return;
  }
  await spinPromise;
  showModal(renderFolderModal(path, folders, files), { onClose: closeModal });
  document.querySelectorAll('.modal-folder-list-folder').forEach(li => {
    li.onclick = async (e) => {
      e.preventDefault();
      const toPath = li.getAttribute('data-path');
      if (toPath) {
        await openFolderModal({ path: toPath, name: toPath.split('/').pop() });
      }
    };
  });
  document.querySelectorAll('.modal-breadcrumbs a').forEach(a => {
    a.onclick = async (e) => {
      e.preventDefault();
      const toPath = a.getAttribute('data-path');
      if (!toPath) {
        closeModal();
        await loadRoot();
      } else {
        await openFolderModal({ path: toPath, name: toPath.split('/').pop() });
      }
    };
  });
  setupModalButtonDelegation();
}

// Expose these for other scripts (like newsletter-gate.js)
window.loadRoot = loadRoot;
window.closeModal = closeModal;