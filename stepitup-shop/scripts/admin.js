/**
 * Admin Panel Management System
 * Handles authentication, file uploads, product creation, and editing
 */

// Resolve Netlify Functions base origin. Prefer same-origin to avoid CORS; allow override via window.__FUNCTIONS_ORIGIN__
const FUNCTIONS_ORIGIN = (() => {
  try {
    if (window.__FUNCTIONS_ORIGIN__) return String(window.__FUNCTIONS_ORIGIN__).replace(/\/$/, '');
  } catch (_) {}
  const { origin, protocol, hostname, port } = window.location;
  return origin || `${protocol}//${hostname}${port ? ':' + port : ''}`;
})();

function functionsUrl(endpoint) {
  const name = String(endpoint || '').replace(/^\/?\.netlify\/functions\/?/, '').replace(/^\//, '');
  return `${FUNCTIONS_ORIGIN}/.netlify/functions/${name}`;
}

class AdminManager {
  constructor() {
    this.isAuthenticated = false;
    this.isSubmitting = false;
    this.uploadedFiles = {
      product: null,
      preview: null,
      'resource-images': []
    };
    this.products = [];
    this.currentEditingProduct = null;
    this.sessionCheckInterval = null;
    this.sessionCleanupInterval = null;
    this.supabaseClient = null;
    this.realtimeChannel = null;
    this.init();
    this.setupCrossTabAuth();
  }

  /**
   * Initialize the admin panel
   */
  init() {
    this.setupSupabaseClient();
    this.setupEventListeners();
    this.setupFileUploads();
    this.checkAuthStatus();
  }

  /**
   * Check if user is already authenticated
   */
  checkAuthStatus() {
    const token = localStorage.getItem('admin_token');
    const expiry = localStorage.getItem('admin_token_expiry');
    const sessionExpiresAt = localStorage.getItem('admin_session_expires_at');

    // Use database session expiry if available, otherwise fall back to JWT expiry
    const effectiveExpiry = sessionExpiresAt ? new Date(sessionExpiresAt).getTime() : parseInt(expiry);

    if (token && effectiveExpiry && !isNaN(effectiveExpiry) && new Date().getTime() < effectiveExpiry) {
      this.isAuthenticated = true;
      this.showAdminPanel();
      this.loadProducts();
      this.loadAdminLogs();
      this.startSessionMonitoring();
      this.setupRealtimeSubscription();
    } else {
      this.clearAuthData();
      this.showLoginModal();
    }
  }

  /**
   * Start monitoring session expiry for auto-logout
   */
  startSessionMonitoring() {
    // Clear any existing interval
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }

    // Set up periodic cleanup of expired sessions (every 10 minutes)
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
    }
    this.sessionCleanupInterval = setInterval(async () => {
      try {
        const response = await fetch(functionsUrl('admin-logs'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
          },
          body: JSON.stringify({
            type: 'sessions',
            action: 'cleanup_expired'
          })
        });
        
        if (response.ok) {
          const result = await response.json();
          if (result.expired_sessions_marked > 0) {
            console.log(`Cleaned up ${result.expired_sessions_marked} expired sessions`);
          }
        }
      } catch (error) {
        console.warn('Failed to cleanup expired sessions:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes

    // Check session more frequently (every 1 second) for immediate logout response
    this.sessionCheckInterval = setInterval(async () => {
      const token = localStorage.getItem('admin_token');
      const expiry = localStorage.getItem('admin_token_expiry');
      const sessionExpiresAt = localStorage.getItem('admin_session_expires_at');

      // Robustly parse sessionExpiresAt (ISO string or timestamp)
      let effectiveExpiry = null;
      if (sessionExpiresAt) {
        // Try to parse as ISO string or timestamp
        const parsed = Date.parse(sessionExpiresAt);
        if (!isNaN(parsed)) {
          effectiveExpiry = parsed;
        }
      }
      if (!effectiveExpiry && expiry) {
        const parsed = parseInt(expiry);
        if (!isNaN(parsed)) {
          effectiveExpiry = parsed;
        }
      }

      // Check effective expiry
      if (!effectiveExpiry || isNaN(effectiveExpiry) || new Date().getTime() >= effectiveExpiry) {
        console.log('Session expired based on effective expiry time');
        this.handleSessionExpiry();
        return;
      }

      // Validate token with server more frequently (every 30 seconds) for immediate response to DB changes
      const lastValidated = localStorage.getItem('admin_token_last_validated');
      const now = new Date().getTime();
      const thirtySeconds = 30 * 1000;
      
      if (!lastValidated || (now - parseInt(lastValidated)) > thirtySeconds) {
        try {
          const response = await fetch(functionsUrl('admin-auth'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'validate' })
          });

          if (!response.ok) {
            console.log('Server-side token validation failed');
            this.handleSessionExpiry();
            return;
          }

          // Update our stored expiry if the server provides updated information
          const result = await response.json();
          if (result.expiresAt) {
            // Update both JWT expiry and session expiry to keep them in sync
            localStorage.setItem('admin_token_expiry', result.expiresAt.toString());
            localStorage.setItem('admin_session_expires_at', new Date(result.expiresAt).toISOString());
          }

          localStorage.setItem('admin_token_last_validated', now.toString());
        } catch (error) {
          console.warn('Failed to validate token with server:', error);
          // Don't logout on network errors, just log the issue
        }
      }
    }, 1000);
  }

  /**
   * Handle session expiry by auto-logging out
   */
  async handleSessionExpiry() {
    console.log('Session expired, logging out automatically');
    
    // Mark current session as inactive in database before clearing local data
    try {
      const sessionToken = localStorage.getItem('admin_session_token');
      const sessionId = localStorage.getItem('admin_session_id');
      
      if (sessionToken || sessionId) {
        // Make a quick call to mark session as inactive
        await fetch(functionsUrl('admin-logs'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
          },
          body: JSON.stringify({
            type: 'sessions',
            action: 'mark_inactive',
            session_token: sessionToken,
            session_id: sessionId
          })
        });
      }
    } catch (error) {
      console.warn('Failed to mark session as inactive:', error);
      // Continue with logout even if this fails
    }
    
    this.clearAuthData();
    this.isAuthenticated = false;
    
    // Clear the monitoring interval
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }

    // Clear the cleanup interval
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }

    // Cleanup realtime subscription
    this.cleanupRealtimeSubscription();

    // Show login modal with expiry message
    this.showLoginModal();
    this.hideAdminPanel();
    
    // Show a notification about session expiry
    this.showLoginError('Your session has expired. Please log in again.');
  }

  /**
   * Setup Supabase client for realtime functionality
   */
  setupSupabaseClient() {
    // Only set up if Supabase is available and we don't have a client yet
    if (typeof window.supabase !== 'undefined' && !this.supabaseClient) {
      this.supabaseClient = window.supabase;
    }
  }

  /**
   * Setup cross-tab authentication synchronization
   */
  setupCrossTabAuth() {
    // Listen for localStorage changes to sync authentication across tabs
    window.addEventListener('storage', (e) => {
      if (e.key === 'admin_token' || e.key === 'admin_token_expiry') {
        // Token was changed in another tab
        if (e.newValue === null) {
          // Token was removed - logout
          if (this.isAuthenticated) {
            this.handleLogout();
          }
        } else {
          // Token was added/updated - check if we should login
          if (!this.isAuthenticated) {
            this.checkAuthStatus();
          }
        }
      }
    });

    // Also listen for custom events for immediate cross-tab sync
    window.addEventListener('admin-logout', () => {
      if (this.isAuthenticated) {
        this.handleLogout();
      }
    });

    window.addEventListener('admin-login', () => {
      if (!this.isAuthenticated) {
        this.checkAuthStatus();
      }
    });

    // Use BroadcastChannel for better cross-tab communication if available
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('admin-auth');
      channel.addEventListener('message', (e) => {
        if (e.data.type === 'login' && !this.isAuthenticated) {
          this.checkAuthStatus();
        } else if (e.data.type === 'logout' && this.isAuthenticated) {
          this.handleLogout();
        }
      });
    }
  }

  /**
   * Setup realtime subscription for admin sessions
   */
  setupRealtimeSubscription() {
    // Don't set up realtime if no Supabase client is available
    if (!this.supabaseClient || this.realtimeChannel) return;

    try {
      // Check if the supabase client has the channel method
      if (typeof this.supabaseClient.channel !== 'function') {
        // Silently skip realtime setup if not supported
        return;
      }

      this.realtimeChannel = this.supabaseClient
        .channel('admin_sessions_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'admin_sessions'
          },
          (payload) => {
            console.log('Admin sessions table changed:', payload);
            
            // Check if this change affects the current user's session
            const currentUsername = localStorage.getItem('admin_username');
            if (currentUsername && payload.new) {
              // If the session was updated and belongs to current user
              if (payload.new.username === currentUsername) {
                console.log('Current user session changed:', payload.new);
                
                // Check if session was marked inactive or expired
                if (!payload.new.is_active || new Date(payload.new.expires_at) <= new Date()) {
                  console.log('Current session marked as expired/inactive, logging out immediately');
                  this.handleSessionExpiry();
                  return;
                }
                
                // Update local session expiry if it was changed
                if (payload.new.expires_at) {
                  const newExpiry = new Date(payload.new.expires_at).getTime();
                  localStorage.setItem('admin_session_expires_at', payload.new.expires_at);
                  localStorage.setItem('admin_token_expiry', newExpiry.toString());
                  console.log('Updated session expiry to:', payload.new.expires_at);
                }
              }
            }
            
            // Reload sessions table when any change occurs
            this.loadAdminSessions();
          }
        )
        .subscribe();
    } catch (error) {
      console.warn('Failed to setup realtime subscription:', error);
    }
  }

  /**
   * Cleanup realtime subscription
   */
  cleanupRealtimeSubscription() {
    if (this.realtimeChannel && this.supabaseClient) {
      try {
        if (typeof this.supabaseClient.removeChannel === 'function') {
          this.supabaseClient.removeChannel(this.realtimeChannel);
        } else if (typeof this.realtimeChannel.unsubscribe === 'function') {
          this.realtimeChannel.unsubscribe();
        }
      } catch (error) {
        console.warn('Failed to cleanup realtime subscription:', error);
      }
      this.realtimeChannel = null;
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', this.handleLogin.bind(this));
    }

    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', this.handleLogout.bind(this));
    }

    // Product form
    const productForm = document.getElementById('product-form');
    if (productForm) {
      // Remove any existing listeners to prevent duplicates
      productForm.removeEventListener('submit', this.handleProductSubmission);
      // Add the event listener
      productForm.addEventListener('submit', this.handleProductSubmission.bind(this));
    }

    // Price input formatting
    const priceInput = document.getElementById('product-price');
    if (priceInput) {
      priceInput.addEventListener('input', this.formatPriceInput.bind(this));
    }

    // Refresh products button
    const refreshBtn = document.getElementById('refresh-products');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', this.loadProducts.bind(this));
    }

    // Product search
    const searchInput = document.getElementById('product-search');
    if (searchInput) {
      searchInput.addEventListener('input', this.filterProducts.bind(this));
    }

    // Form validation
    this.setupFormValidation();

    // Text formatting toolbar
    this.setupFormattingToolbar();

    // Admin logs controls
    this.setupAdminLogsControls();

    const reviewsRefresh = document.getElementById('reviews-refresh-btn');
    if (reviewsRefresh) {
      reviewsRefresh.addEventListener('click', async () => {
        reviewsRefresh.classList.add('loading');
        reviewsRefresh.disabled = true;
        try { await this.loadAdminReviews(); } finally {
          reviewsRefresh.disabled = false;
          reviewsRefresh.classList.remove('loading');
        }
      });
    }
  }

  /**
   * Setup file upload functionality
   */
  setupFileUploads() {
    const dropZones = document.querySelectorAll('.file-drop-zone');
    
    dropZones.forEach(dropZone => {
      const uploadType = dropZone.dataset.uploadType;
      const fileInput = dropZone.querySelector('input[type="file"]');
      const browseLink = dropZone.querySelector('.browse-link');

      // Drag and drop events
      dropZone.addEventListener('dragover', this.handleDragOver.bind(this));
      dropZone.addEventListener('dragleave', this.handleDragLeave.bind(this));
      dropZone.addEventListener('drop', (e) => this.handleFileDrop(e, uploadType));

      // File input change
      fileInput.addEventListener('change', (e) => this.handleFileSelect(e, uploadType));

      // Browse link click
      if (browseLink) {
        browseLink.addEventListener('click', () => fileInput.click());
      }
    });
  }

  /**
   * Setup form validation
   */
  setupFormValidation() {
    const requiredFields = document.querySelectorAll('input[required], select[required]');
    
    requiredFields.forEach(field => {
      field.addEventListener('blur', () => this.validateField(field));
      field.addEventListener('input', () => this.clearFieldError(field));
    });
  }

  /**
   * Handle user login
   */
  async handleLogin(e) {
    e.preventDefault();

    const loginBtn = document.querySelector('.login-btn');
    const btnText = loginBtn.querySelector('.btn-text');
    const btnSpinner = loginBtn.querySelector('.btn-spinner');
    const errorDiv = document.getElementById('login-error');

    try {
      // Show loading state
      loginBtn.classList.add('loading');
      loginBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'flex';
      this.hideLoginError();

      const formData = new FormData(e.target);
      const credentials = {
        username: formData.get('username'),
        password: formData.get('password')
      };

      const response = await fetch(functionsUrl('admin-auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed');
      }

      // Store auth data - use server-provided session expiry or fallback to 1 hour
      let expiryTime;
      if (result.sessionExpiresAt) {
        // Use the actual session expiry from the server
        expiryTime = new Date(result.sessionExpiresAt).getTime();
      } else {
        // Fallback to 1 hour if no session expiry provided
        expiryTime = new Date().getTime() + (1 * 60 * 60 * 1000);
      }
      
      localStorage.setItem('admin_token', result.token);
      localStorage.setItem('admin_token_expiry', expiryTime.toString());
      localStorage.setItem('admin_username', credentials.username);

      this.isAuthenticated = true;

      try { window.dispatchEvent(new CustomEvent('admin-auth-success', { detail: { username: credentials.username } })); } catch(_) {}
      
      // Notify other tabs about login
      try { 
        window.dispatchEvent(new CustomEvent('admin-login')); 
        // Also use BroadcastChannel for better cross-tab communication
        if (typeof BroadcastChannel !== 'undefined') {
          const channel = new BroadcastChannel('admin-auth');
          channel.postMessage({ type: 'login', username: credentials.username });
          channel.close();
        }
      } catch(_) {}

      // Store session info if provided
      if (result.sessionToken) localStorage.setItem('admin_session_token', result.sessionToken);
      if (result.sessionId) localStorage.setItem('admin_session_id', String(result.sessionId));
      if (result.sessionExpiresAt) localStorage.setItem('admin_session_expires_at', result.sessionExpiresAt);

      // Success animation and transition
      setTimeout(() => {
        this.hideLoginModal();
        this.showAdminPanel();
        this.loadProducts();
        this.loadAdminLogs();
        this.startSessionMonitoring();
        this.setupRealtimeSubscription();
      }, 500);

    } catch (error) {
      console.error('Login error:', error);
      this.showLoginError(error.message);
    } finally {
      // Reset button state
      loginBtn.classList.remove('loading');
      loginBtn.disabled = false;
      btnText.style.display = 'flex';
      btnSpinner.style.display = 'none';
    }
  }

  /**
   * Handle user logout
   */
  handleLogout() {
    this.clearAuthData();
    this.isAuthenticated = false;
    
    // Notify other tabs about logout
    try { 
      window.dispatchEvent(new CustomEvent('admin-logout')); 
      // Also use BroadcastChannel for better cross-tab communication
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('admin-auth');
        channel.postMessage({ type: 'logout' });
        channel.close();
      }
    } catch(_) {}
    
    // Clear session monitoring
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
      this.sessionCheckInterval = null;
    }
    
    // Clear the cleanup interval
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval);
      this.sessionCleanupInterval = null;
    }
    
    // Cleanup realtime subscription
    this.cleanupRealtimeSubscription();
    
    this.resetForm();
    this.showLoginModal();
    this.hideAdminPanel();
  }

  /**
   * Clear authentication data
   */
  clearAuthData() {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_token_expiry');
    localStorage.removeItem('admin_session_token');
    localStorage.removeItem('admin_session_id');
    localStorage.removeItem('admin_session_expires_at');
    localStorage.removeItem('admin_token_last_validated');
    localStorage.removeItem('admin_username');
  }

  /**
   * Show/hide login modal
   */
  showLoginModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  hideLoginModal() {
    const modal = document.getElementById('login-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  /**
   * Show/hide admin panel
   */
  showAdminPanel() {
    const panel = document.getElementById('admin-panel');
    panel.classList.add('show');
  }

  hideAdminPanel() {
    const panel = document.getElementById('admin-panel');
    panel.classList.remove('show');
  }

  /**
   * Handle login errors
   */
  showLoginError(message) {
    const errorDiv = document.getElementById('login-error');
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
  }

  hideLoginError() {
    const errorDiv = document.getElementById('login-error');
    errorDiv.classList.remove('show');
  }

  /**
   * Format price input
   */
  formatPriceInput(e) {
    let value = e.target.value;
    
    // Remove any non-numeric characters except decimal point
    value = value.replace(/[^0-9.]/g, '');
    
    // Ensure only one decimal point
    const parts = value.split('.');
    if (parts.length > 2) {
      value = parts[0] + '.' + parts.slice(1).join('');
    }
    
    // Limit decimal places to 2
    if (parts[1] && parts[1].length > 2) {
      value = parts[0] + '.' + parts[1].substring(0, 2);
    }
    
    e.target.value = value;
  }

  /**
   * File drag and drop handlers
   */
  handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
  }

  handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
  }

  handleFileDrop(e, uploadType) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      if (uploadType === 'resource-images') {
        Array.from(files).forEach(file => {
          this.processFile(file, uploadType);
        });
      } else {
        this.processFile(files[0], uploadType);
      }
    }
  }

  handleFileSelect(e, uploadType) {
    const files = e.target.files;
    if (files.length > 0) {
      if (uploadType === 'resource-images') {
        Array.from(files).forEach(file => {
          this.processFile(file, uploadType);
        });
      } else {
        this.processFile(files[0], uploadType);
      }
    }
  }

  /**
   * Process selected file
   */
  processFile(file, uploadType) {
    // Validate file
    if (!this.validateFile(file, uploadType)) {
      return;
    }

    // Store file reference
    if (uploadType === 'resource-images') {
      if (!this.uploadedFiles[uploadType]) {
        this.uploadedFiles[uploadType] = [];
      }
      const exists = this.uploadedFiles[uploadType].some(f => f && f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
      if (!exists) this.uploadedFiles[uploadType].push(file);
    } else {
      this.uploadedFiles[uploadType] = file;
    }

    // Update UI
    this.updateFileUI(file, uploadType);
    
    // Simulate upload progress (actual upload happens on form submit)
    this.simulateUploadProgress(uploadType);
  }

  /**
   * Validate file
   */
  validateFile(file, uploadType) {
    const maxSizes = {
      product: 50 * 1024 * 1024, // 50MB
      preview: 10 * 1024 * 1024, // 10MB
      thumbnail: 2 * 1024 * 1024, // 2MB for thumbnails
      'resource-images': 5 * 1024 * 1024 // 5MB for resource images
    };

    const allowedTypes = {
      product: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'],
      preview: ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/jpg'],
      thumbnail: ['image/jpeg', 'image/png', 'image/jpg'],
      'resource-images': ['image/jpeg', 'image/png', 'image/gif', 'image/jpg']
    };

    // Check file size
    if (file.size > maxSizes[uploadType]) {
      this.showErrorModal(`File size too large. Maximum allowed: ${maxSizes[uploadType] / (1024 * 1024)}MB`);
      return false;
    }

    // Check file type
    if (!allowedTypes[uploadType].includes(file.type)) {
      this.showErrorModal(`Invalid file type for ${uploadType}. Please select a supported file format.`);
      return false;
    }

    return true;
  }

  /**
   * Update file upload UI
   */
  updateFileUI(file, uploadType) {
    const dropZone = document.querySelector(`[data-upload-type="${uploadType}"]`);
    const fileInfo = dropZone.querySelector('.file-info');
    const dropContent = dropZone.querySelector('.drop-zone-content');
    const fileInput = dropZone.querySelector('input[type="file"]');

    // Hide drop content, show file info
    dropContent.style.display = 'none';
    fileInfo.style.display = 'block';
    fileInfo.classList.add('show');
    // Prevent invisible input from intercepting clicks
    if (fileInput) fileInput.style.pointerEvents = 'none';

    // For resource images, show multiple files
    if (uploadType === 'resource-images') {
      const files = Array.isArray(this.uploadedFiles[uploadType]) ? this.uploadedFiles[uploadType] : [];
      const names = files.map(f => `<li>${this.escapeHtml(f.name)}</li>`).join('');
      fileInfo.innerHTML = `
        <div class="file-info-row">
          <i class="fas fa-images file-info-icon"></i>
          <div class="file-info-list-wrap">
            <ul class="file-list">${names}</ul>
          </div>
          <button type="button" class="file-remove-btn" onclick="adminManager.removeFile('${uploadType}', event)"><i class="fas fa-times"></i></button>
        </div>
      `;
      // Allow adding more images; keep input enabled
      if (fileInput) fileInput.disabled = false;
      // Bind remove button
      const btn = fileInfo.querySelector('button');
      if (btn) btn.addEventListener('click', (ev) => this.removeFile(uploadType, ev));
    } else {
      // Single file display
      fileInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <i class="fas fa-file-alt" style="color: #2c77cc; font-size: 1.2rem;"></i>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">
              ${file.name}
            </div>
            <div style="color: #718096; font-size: 0.875rem;">
              ${this.formatFileSize(file.size)} • ${file.type.split('/')[1].toUpperCase()}
            </div>
          </div>
          <button type="button" onclick="adminManager.removeFile('${uploadType}', event)"
                  style="background: #e53e3e; color: white; border: none; border-radius: 4px;
                         padding: 0.5rem; cursor: pointer; transition: all 0.2s ease;">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      // Disable input to avoid accidental picker when file-info is shown
      if (fileInput) fileInput.disabled = true;
      // Bind remove button
      const btn = fileInfo.querySelector('button');
      if (btn) btn.addEventListener('click', (ev) => this.removeFile(uploadType, ev));
    }
  }

  /**
   * Remove uploaded file
   */
  removeFile(uploadType, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const dropZone = document.querySelector(`[data-upload-type="${uploadType}"]`);
    if (!dropZone) return;
    const fileInfo = dropZone.querySelector('.file-info');
    const dropContent = dropZone.querySelector('.drop-zone-content');
    const fileInput = dropZone.querySelector('input[type="file"]');

    // Reset UI
    if (fileInfo) {
      fileInfo.style.display = 'none';
      fileInfo.classList.remove('show');
    }
    if (dropContent) dropContent.style.display = 'block';

    // Clear tracked files
    if (uploadType === 'resource-images') {
      this.uploadedFiles[uploadType] = [];
    } else {
      this.uploadedFiles[uploadType] = null;
    }

    // Robustly clear native file input and re-bind listeners
    if (fileInput) {
      // Ensure enabled and clickable again
      fileInput.disabled = false;
      fileInput.style.pointerEvents = 'auto';
      try { fileInput.value = ''; } catch {}
      // If still has files, replace node
      let currentInput = fileInput;
      if (fileInput.files && fileInput.files.length) {
        const newInput = fileInput.cloneNode(true);
        newInput.value = '';
        newInput.style.pointerEvents = 'auto';
        // Re-bind change handler
        newInput.addEventListener('change', (ev) => this.handleFileSelect(ev, uploadType));
        fileInput.parentNode.replaceChild(newInput, fileInput);
        currentInput = newInput;
      } else {
        // Make sure change handler exists in case it was removed/disabled
        fileInput.addEventListener('change', (ev) => this.handleFileSelect(ev, uploadType));
      }
      // Re-wire browse link to current input
      const browseLink = dropZone.querySelector('.browse-link');
      if (browseLink) {
        browseLink.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); currentInput.click(); };
      }
    }

    // Reset progress
    const progress = dropZone.querySelector('.upload-progress');
    if (progress) progress.style.display = 'none';
    dropZone.classList.remove('uploading');
  }

  /**
   * Simulate upload progress
   */
  simulateUploadProgress(uploadType) {
    const dropZone = document.querySelector(`[data-upload-type="${uploadType}"]`);
    const progress = dropZone.querySelector('.upload-progress');
    const progressFill = dropZone.querySelector('.progress-fill');
    const progressText = dropZone.querySelector('.progress-text');

    dropZone.classList.add('uploading');
    progress.style.display = 'block';

    let percent = 0;
    const interval = setInterval(() => {
      percent += Math.random() * 15;
      if (percent >= 100) {
        percent = 100;
        clearInterval(interval);
        setTimeout(() => {
          progress.style.display = 'none';
          dropZone.classList.remove('uploading');
        }, 500);
      }
      
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${Math.round(percent)}%`;
    }, 200);
  }

  /**
   * Format file size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Handle product form submission
   */
  async handleProductSubmission(e) {
    e.preventDefault();

    console.log('handleProductSubmission called, isSubmitting:', this.isSubmitting);

    // Prevent multiple concurrent submissions
    if (this.isSubmitting) {
      console.log('Already submitting, ignoring duplicate submission');
      return;
    }

    const isValid = this.validateForm();
    console.log('Form validation result:', isValid);

    if (!isValid) {
      console.log('Form validation failed, not submitting');
      return;
    }

    const submitBtn = document.querySelector('.submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    // Check if button elements exist
    if (!submitBtn || !btnText || !btnSpinner) {
      console.error('Submit button elements not found');
      return;
    }

    try {
      // Set submission flag
      this.isSubmitting = true;

      // Show loading state with enhanced visibility
      submitBtn.classList.add('loading');
      submitBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'flex';

      // Sync WYSIWYG content into hidden field
      const editor = document.getElementById('product-description-editor');
      const hiddenDesc = document.getElementById('product-description');
      if (editor && hiddenDesc) hiddenDesc.value = editor.innerHTML.trim();

      // Prepare product data (will be used for each retry)
      const productData = {
        name: document.getElementById('product-name').value,
        category: document.getElementById('product-category').value,
        price: parseFloat(document.getElementById('product-price').value) * 100, // Convert to cents
        description: document.getElementById('product-description').value || null,
        featured: document.getElementById('product-featured').checked
      };

      // If editing, add product ID
      if (this.currentEditingProduct) {
        productData.id = this.currentEditingProduct.id;
      }

      console.log('Submitting product data:', productData);

      // Validate required fields
      if (!productData.name || !productData.category || typeof productData.price !== 'number') {
        throw new Error('Missing required fields: name, category, and price are required');
      }

      if (productData.price <= 0) {
        throw new Error('Price must be greater than 0');
      }

      // Validate auth token once
      const authToken = localStorage.getItem('admin_token');
      if (!authToken) {
        throw new Error('Authentication token not found. Please log in again.');
      }
      console.log('Auth token validated (length):', authToken.length);

      // Test token validity by making a simple request first
      try {
        console.log('Testing authentication...');
        const testResponse = await fetch(functionsUrl('manage-products'), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${authToken}`
          }
        });

        if (testResponse.status === 401) {
          throw new Error('Authentication expired. Please log out and log back in.');
        }

        console.log('Authentication test passed');
      } catch (authTestError) {
        console.warn('Authentication test failed:', authTestError.message);
        // Continue anyway, but log the warning
      }

      // Test if the target endpoint is reachable
      try {
        console.log('Testing endpoint connectivity...');
        const testUrl = this.currentEditingProduct ? functionsUrl('update-product') : functionsUrl('create-product');
        const endpointTest = await fetch(testUrl, { method: 'OPTIONS' });
        console.log('Endpoint test status:', endpointTest.status);
      } catch (endpointError) {
        console.warn('Endpoint test failed:', endpointError.message);
      }

      // Choose endpoint based on whether we're creating or updating
      const endpoint = this.currentEditingProduct ?
        functionsUrl('update-product') :
        functionsUrl('create-product');

      console.log('Making request to:', endpoint);

      // Small delay to prevent potential timing issues
      await new Promise(resolve => setTimeout(resolve, 100));

      // New path: use signed uploads to Supabase to avoid large multipart through Netlify
      const totalBytes = (
        (this.uploadedFiles.product?.size || 0) +
        (this.uploadedFiles.preview?.size || 0) +
        (Array.isArray(this.uploadedFiles['resource-images']) ? this.uploadedFiles['resource-images'].reduce((s,f)=>s+(f?.size||0),0) : 0)
      );

      const preparePayload = {
        productId: this.currentEditingProduct ? productData.id : undefined,
        productData,
        files: {
          product: this.uploadedFiles.product ? { filename: this.uploadedFiles.product.name, contentType: this.uploadedFiles.product.type } : null,
          preview: this.uploadedFiles.preview ? { filename: this.uploadedFiles.preview.name, contentType: this.uploadedFiles.preview.type } : null,
          resourceImages: Array.isArray(this.uploadedFiles['resource-images']) ? this.uploadedFiles['resource-images'].map(f=> ({ filename: f.name, contentType: f.type })) : []
        }
      };

      // Step 1: prepare signed URLs
      const prepRes = await fetch(functionsUrl('prepare-product-upload'), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(preparePayload)
      });
      const prepJson = await this.processResponse(prepRes);
      if (prepJson.error) throw new Error(prepJson.error);

      const { productId, upload } = prepJson;
      const fileMeta = { product: null, preview: null };

      // Step 2: upload files directly to Supabase using signed URLs
      async function putSigned(url, file) {
        const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!res.ok) {
          let msg = `Upload failed (${res.status})`;
          try { msg = await res.text(); } catch {}
          throw new Error(msg);
        }
      }

      if (upload.product?.signedUrl && this.uploadedFiles.product) {
        await putSigned(upload.product.signedUrl, this.uploadedFiles.product);
        fileMeta.product = { originalName: this.uploadedFiles.product.name, contentType: this.uploadedFiles.product.type, size: this.uploadedFiles.product.size };
      }
      if (upload.preview?.signedUrl && this.uploadedFiles.preview) {
        await putSigned(upload.preview.signedUrl, this.uploadedFiles.preview);
        fileMeta.preview = { originalName: this.uploadedFiles.preview.name, contentType: this.uploadedFiles.preview.type, size: this.uploadedFiles.preview.size };
      }
      const uploadedImagePaths = [];
      if (Array.isArray(upload.resourceImages) && Array.isArray(this.uploadedFiles['resource-images'])) {
        for (let i = 0; i < upload.resourceImages.length; i++) {
          const u = upload.resourceImages[i];
          const f = this.uploadedFiles['resource-images'][i];
          if (u?.signedUrl && f) {
            await putSigned(u.signedUrl, f);
            uploadedImagePaths.push(u.path);
          }
        }
      }

      // Step 3: finalize product in DB
      const finalizePayload = {
        productData,
        productId,
        paths: {
          product: upload.product?.path || null,
          preview: upload.preview?.path || null,
          resourceImages: uploadedImagePaths
        },
        fileMeta
      };
      const finEndpoint = this.currentEditingProduct ? 'finalize-product-update' : 'finalize-product';
      const finRes = await fetch(functionsUrl(finEndpoint), {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(finalizePayload)
      });
      const finJson = await this.processResponse(finRes);
      if (finJson.error) throw new Error(finJson.error);

      console.log('Product created via signed uploads');

      // Show success modal
      this.showSuccessModal();
      
      // Reset form and editing state
      this.resetForm();
      this.currentEditingProduct = null;
      this.updateFormTitle();
      
      // Refresh products and all logs
      await this.loadProducts();
      await this.loadAdminLogs();

    } catch (error) {
      console.error('Product save error:', error);
      console.error('Error stack:', error.stack);
      console.error('Error name:', error.name);
      console.error('Error type:', typeof error);
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)));

      // Provide more specific error messages
      let errorMessage = error.message || 'An unknown error occurred';

      if (error.message.includes('Failed to fetch')) {
        errorMessage = 'Network error: Please check your internet connection and try again.';
      } else if (error.message.includes('body stream already read')) {
        errorMessage = 'Request processing error: The server response could not be read. Please try again.';
      } else if (error.message.includes('timeout') || error.name === 'AbortError') {
        errorMessage = 'Request timed out: The server took too long to respond. Please try again.';
      } else if (error.message.includes('JSON')) {
        errorMessage = 'Server response error: The server returned an invalid response. Please try again.';
      } else if (error.message.includes('500')) {
        // For 500 errors, show the full error message which should include server details
        errorMessage = `Server error: ${error.message}`;
      } else if (error.message.includes('401')) {
        errorMessage = 'Authentication error: Please log out and log back in.';
      } else if (error.message.includes('400')) {
        errorMessage = 'Invalid request: Please check all form fields and try again.';
      }

      this.showErrorModal(errorMessage);
    } finally {
      // Reset submission flag
      this.isSubmitting = false;

      // Reset button state
      submitBtn.classList.remove('loading');
      submitBtn.disabled = false;
      btnText.style.display = 'flex';
      btnSpinner.style.display = 'none';
    }
  }

  /**
   * Validate form
   */
  validateForm() {
    let isValid = true;

    // Check required fields
    const requiredFields = document.querySelectorAll('input[required], select[required]');
    requiredFields.forEach(field => {
      if (!this.validateField(field)) {
        isValid = false;
      }
    });

    // Check required files (only for new products)
    if (!this.currentEditingProduct && !this.uploadedFiles.product) {
      this.showErrorModal('Please upload the main product file.');
      isValid = false;
    }

    return isValid;
  }

  /**
   * Validate individual field
   */
  validateField(field) {
    const value = field.value.trim();
    const fieldGroup = field.closest('.form-group');

    if (field.required && !value) {
      if (fieldGroup) fieldGroup.classList.add('error');
      return false;
    }

    // Additional validation for price
    if (field.name === 'price') {
      const price = parseFloat(value);
      if (isNaN(price) || price < 0) {
        if (fieldGroup) fieldGroup.classList.add('error');
        return false;
      }
    }

    return true;
  }

  /**
   * Clear field error
   */
  clearFieldError(field) {
    const fieldGroup = field.closest('.form-group');
    if (fieldGroup) {
      fieldGroup.classList.remove('error');
    }
  }

  /**
   * Simple markdown renderer for text formatting
   */
  renderMarkdown(text) {
    if (!text) return '';

    return text
      // Headers
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Underline (using HTML tags)
      .replace(/<u>(.*?)<\/u>/g, '<u>$1</u>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
      // Bullet points
      .replace(/^• (.*$)/gim, '<li>$1</li>')
      // Wrap lists
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      // Line breaks
      .replace(/\n/g, '<br>');
  }

  /**
   * Toggle preview mode for description textarea
   */
  togglePreview(textarea, button) {
    const preview = document.getElementById('description-preview');
    const previewContent = preview?.querySelector('.preview-content');

    if (!preview || !previewContent) return;

    const isPreviewMode = preview.style.display !== 'none';

    if (isPreviewMode) {
      // Switch back to edit mode
      preview.style.display = 'none';
      textarea.style.display = 'block';
      button.classList.remove('active');
      button.innerHTML = '<i class="fas fa-eye"></i>';
      button.title = 'Show Preview';
    } else {
      // Switch to preview mode
      const renderedContent = this.renderMarkdown(textarea.value || 'Enter your description...');
      previewContent.innerHTML = renderedContent;
      preview.style.display = 'block';
      textarea.style.display = 'none';
      button.classList.add('active');
      button.innerHTML = '<i class="fas fa-edit"></i>';
      button.title = 'Edit Description';
    }
  }

  /**
   * Reset form
   */
  resetForm() {
    const form = document.getElementById('product-form');
    form.reset();

    // Clear description editor
    const editor = document.getElementById('product-description-editor');
    if (editor) editor.innerHTML = '';
    const hiddenDesc = document.getElementById('product-description');
    if (hiddenDesc) hiddenDesc.value = '';

    // Clear uploaded files
    this.removeFile('product');
    this.removeFile('preview');
    this.removeFile('resource-images');

    // Clear form errors
    const errorFields = document.querySelectorAll('.form-group.error');
    errorFields.forEach(field => field.classList.remove('error'));
  }

  /**
   * Update form title based on editing state
   */
  updateFormTitle() {
    const sectionTitle = document.querySelector('.upload-section .section-header h2');
    const sectionDesc = document.querySelector('.upload-section .section-header p');
    const submitBtnText = document.querySelector('.submit-btn .btn-text');
    
    if (this.currentEditingProduct) {
      sectionTitle.innerHTML = '<i class="fas fa-edit"></i> Edit Product';
      sectionDesc.textContent = `Update "${this.currentEditingProduct.name}" information`;
      submitBtnText.innerHTML = '<i class="fas fa-save"></i> Update Product';
    } else {
      sectionTitle.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Upload New Product';
      sectionDesc.textContent = 'Add a new educational resource to the store';
      submitBtnText.innerHTML = '<i class="fas fa-plus"></i> Create Product';
    }
  }

  /**
   * Show success modal
   */
  showSuccessModal() {
    const modal = document.getElementById('success-modal');
    const modalTitle = modal.querySelector('.modal-text h3');
    const modalDesc = modal.querySelector('.modal-text p');
    
    if (this.currentEditingProduct) {
      modalTitle.textContent = 'Product Updated Successfully!';
      modalDesc.textContent = 'Your product changes have been saved.';
    } else {
      modalTitle.textContent = 'Product Created Successfully!';
      modalDesc.textContent = 'Your product has been uploaded and is now available in the store.';
    }
    
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close success modal
   */
  closeSuccessModal() {
    const modal = document.getElementById('success-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  /**
   * Show error modal
   */
  showErrorModal(message) {
    const modal = document.getElementById('error-modal');
    const messageElement = document.getElementById('error-message');
    messageElement.textContent = message;
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close error modal
   */
  closeErrorModal() {
    const modal = document.getElementById('error-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  /**
   * Load products from backend
   */
  async loadProducts() {
    const loadingDiv = document.getElementById('products-loading');
    const productsGrid = document.getElementById('products-grid');
    const noProductsDiv = document.getElementById('no-products');

    try {
      // Show loading state
      loadingDiv.style.display = 'flex';
      productsGrid.style.display = 'none';
      noProductsDiv.style.display = 'none';

      const response = await fetch(functionsUrl('manage-products'), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load products');
      }

      this.products = result.products || [];
      this.renderProducts();

    } catch (error) {
      console.error('Error loading products:', error);
      this.showErrorModal(error.message);
    } finally {
      loadingDiv.style.display = 'none';
    }
  }

  /**
   * Filter products based on search term
   */
  filterProducts(e) {
    const searchTerm = e.target.value.toLowerCase();
    const filteredProducts = this.products.filter(product => 
      product.name.toLowerCase().includes(searchTerm) || 
      (product.category && product.category.toLowerCase().includes(searchTerm)) ||
      (product.description && product.description.toLowerCase().includes(searchTerm))
    );
    
    this.renderProducts(filteredProducts);
  }

  /**
   * Render products in the admin panel
   */
  renderProducts(products = this.products) {
    const productsGrid = document.getElementById('products-grid');
    const noProductsDiv = document.getElementById('no-products');
    
    if (!products || products.length === 0) {
      productsGrid.style.display = 'none';
      noProductsDiv.style.display = 'block';
      return;
    }

    noProductsDiv.style.display = 'none';
    productsGrid.style.display = 'grid';
    productsGrid.innerHTML = '';
    
    products.forEach(product => {
      const card = document.createElement('div');
      card.className = 'product-manage-card';
      card.setAttribute('data-product-id', product.id);
      
      const price = (product.price / 100).toFixed(2);
      const category = product.category || 'Uncategorized';
      const description = product.description || 'No description available';
      const isFeatureBadge = product.featured ? '<span class="product-manage-featured"><i class="fas fa-star"></i> Featured</span>' : '';

      // Truncate description before rendering markdown - handle very long words
      const maxLength = 120;
      let truncatedDescription = description;

      if (description.length > maxLength) {
        // Try to truncate at word boundaries first
        const shortText = description.substring(0, maxLength);
        const lastSpaceIndex = shortText.lastIndexOf(' ');

        if (lastSpaceIndex > maxLength * 0.7) {
          // Good word boundary found, use it
          truncatedDescription = shortText.substring(0, lastSpaceIndex).trim() + '...';
        } else {
          // No good word boundary, just cut at character limit
          truncatedDescription = shortText.trim() + '...';
        }
      }

      const renderedDescription = this.renderMarkdown(truncatedDescription);

      card.innerHTML = `
        <div class="product-manage-header">
          <div class="product-manage-info">
            <h4>${this.escapeHtml(product.name)}</h4>
            <div class="product-manage-meta">
              <span class="product-manage-category">${this.escapeHtml(category)}</span>
              ${isFeatureBadge}
            </div>
          </div>
        </div>

        <div class="product-manage-price">CAD $${price}</div>

        <div class="product-manage-description">
          ${renderedDescription}
        </div>
        
        <div class="product-manage-actions">
          <button class="product-edit-btn control-btn" onclick="adminManager.editProduct(${product.id})">
            <span class="btn-text"><i class="fas fa-edit"></i> Edit</span>
            <span class="btn-spinner" style="display: none;"><div class="spinner-circle"></div></span>
          </button>
          <button class="product-delete-btn control-btn" onclick="adminManager.confirmDeleteProduct(${product.id}, '${this.escapeHtml(product.name)}')">
            <span class="btn-text"><i class="fas fa-trash"></i> Delete</span>
            <span class="btn-spinner" style="display: none;"><div class="spinner-circle"></div></span>
          </button>
        </div>
      `;
      
      productsGrid.appendChild(card);
    });
  }

  /**
   * Edit product - Load product data into form
   */
  async editProduct(productId) {
    let targetButton = null;
    let originalContent = '';

    try {
      // Show loading state
      const editButtons = document.querySelectorAll('.product-edit-btn');
      targetButton = Array.from(editButtons).find(btn =>
        btn.getAttribute('onclick').includes(productId)
      );

      if (targetButton) {
        originalContent = targetButton.innerHTML;
        targetButton.classList.add('loading');
        targetButton.disabled = true;
        
        // Ensure spinner structure exists
        if (!targetButton.querySelector('.btn-spinner')) {
          targetButton.innerHTML = `
            <span class="btn-text"><i class="fas fa-edit"></i> Edit</span>
            <span class="btn-spinner" style="display: none;"><div class="spinner-circle"></div></span>
          `;
        }
        
        // Show spinner, hide text
        const btnText = targetButton.querySelector('.btn-text');
        const btnSpinner = targetButton.querySelector('.btn-spinner');
        if (btnText) btnText.style.display = 'none';
        if (btnSpinner) btnSpinner.style.display = 'flex';
      }

      // Fetch product data
      const response = await fetch(`${functionsUrl('get-product')}?product_id=${productId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(result.error);
      }

      const product = result.product;

      if (!product) {
        throw new Error('Product data not found');
      }

      // Set current editing product
      this.currentEditingProduct = product;

      // Populate form fields
      document.getElementById('product-name').value = product.name || '';
      document.getElementById('product-category').value = product.category || '';
      document.getElementById('product-price').value = (product.price / 100).toFixed(2);
      document.getElementById('product-description').value = product.description || '';
      const editor = document.getElementById('product-description-editor');
      if (editor) editor.innerHTML = product.description || '';
      document.getElementById('product-featured').checked = Boolean(product.featured);

      // Update form UI
      this.updateFormTitle();

      // Reset uploaded files (user can optionally upload new ones)
      this.resetUploadedFiles();

      // Scroll to form with a delay to ensure button state is updated
      setTimeout(() => {
        document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });
      }, 100);

    } catch (error) {
      console.error('Error loading product for edit:', error);
      this.showErrorModal('Failed to load product data for editing: ' + error.message);
    } finally {
      // Always reset button state
      if (targetButton) {
        targetButton.classList.remove('loading');
        targetButton.disabled = false;
        
        // Reset to proper button structure if needed
        const btnText = targetButton.querySelector('.btn-text');
        const btnSpinner = targetButton.querySelector('.btn-spinner');
        
        if (btnText && btnSpinner) {
          btnText.style.display = 'flex';
          btnSpinner.style.display = 'none';
        } else {
          // Fallback: restore original content
          targetButton.innerHTML = originalContent || '<i class="fas fa-edit"></i> Edit';
        }

        // Force a brief delay to ensure the UI update is visible
        setTimeout(() => {
          if (targetButton && targetButton.disabled) {
            targetButton.disabled = false;
          }
        }, 50);
      }
    }
  }

  /**
   * Reset uploaded files without clearing form
   */
  resetUploadedFiles() {
    this.uploadedFiles = {
      product: null,
      preview: null,
      'resource-images': []
    };
    
    // Reset file UI states
    ['product', 'preview', 'resource-images'].forEach(uploadType => {
      const dropZone = document.querySelector(`[data-upload-type="${uploadType}"]`);
      if (dropZone) {
        const fileInfo = dropZone.querySelector('.file-info');
        const dropContent = dropZone.querySelector('.drop-zone-content');
        const fileInput = dropZone.querySelector('input[type="file"]');
        
        fileInfo.style.display = 'none';
        fileInfo.classList.remove('show');
        dropContent.style.display = 'block';
        fileInput.value = '';
      }
    });
  }

  /**
   * Cancel editing
   */
  cancelEdit() {
    this.currentEditingProduct = null;
    this.resetForm();
    this.updateFormTitle();
  }

  /**
   * Confirm delete product
   */
  confirmDeleteProduct(productId, productName) {
    this.showDeleteConfirmation(productId, productName);
  }

  /**
   * Show delete confirmation modal
   */
  showDeleteConfirmation(productId, productName) {
    // Create modal if it doesn't exist
    let modal = document.getElementById('delete-confirmation-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'delete-confirmation-modal';
      modal.className = 'delete-modal';
      modal.innerHTML = `
        <div class="delete-modal-content">
          <div class="delete-icon">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <h3>Delete Product</h3>
          <p>Are you sure you want to delete <span class="delete-product-name" id="delete-product-name"></span>?</p>
          <p>This action will permanently remove the product and all associated files, previews, and reviews.</p>
          <div class="delete-modal-actions">
            <button class="delete-cancel-btn" onclick="adminManager.hideDeleteConfirmation()">
              <i class="fas fa-times"></i> Cancel
            </button>
            <button class="delete-confirm-btn control-btn" id="confirm-delete-btn">
              <span class="btn-text"><i class="fas fa-trash"></i> Delete</span>
              <span class="btn-spinner" style="display: none;"><div class="spinner-circle"></div></span>
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    // Update modal content
    document.getElementById('delete-product-name').textContent = productName;
    
    // Set up confirm button
    const confirmBtn = document.getElementById('confirm-delete-btn');
    confirmBtn.onclick = () => this.deleteProduct(productId);
    
    // Show modal
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Hide delete confirmation modal
   */
  hideDeleteConfirmation() {
    const modal = document.getElementById('delete-confirmation-modal');
    if (modal) {
      modal.classList.remove('show');
      document.body.style.overflow = '';
    }
  }

  /**
   * Delete product
   */
  async deleteProduct(productId) {
    const confirmBtn = document.getElementById('confirm-delete-btn');
    
    try {
      // Show loading state
      confirmBtn.disabled = true;
      confirmBtn.classList.add('loading');
      
      // Show spinner, hide text
      const btnText = confirmBtn.querySelector('.btn-text');
      const btnSpinner = confirmBtn.querySelector('.btn-spinner');
      if (btnText) btnText.style.display = 'none';
      if (btnSpinner) btnSpinner.style.display = 'flex';
      
      const response = await fetch(`${functionsUrl('manage-products')}?product_id=${productId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete product');
      }

      // Hide confirmation modal
      this.hideDeleteConfirmation();
      
      // Reload products and refresh all logs
      await this.loadProducts();
      await this.loadAdminLogs();

      // Show delete success message
      this.showDeleteSuccessModal();

    } catch (error) {
      console.error('Error deleting product:', error);
      this.showErrorModal(error.message);
    } finally {
      // Reset button state
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('loading');
      
      // Reset to proper button structure
      const btnText = confirmBtn.querySelector('.btn-text');
      const btnSpinner = confirmBtn.querySelector('.btn-spinner');
      
      if (btnText && btnSpinner) {
        btnText.style.display = 'flex';
        btnSpinner.style.display = 'none';
      }
    }
  }

  /**
   * Show delete success modal
   */
  showDeleteSuccessModal() {
    const modal = document.getElementById('delete-success-modal');
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  }

  /**
   * Close delete success modal
   */
  closeDeleteSuccessModal() {
    const modal = document.getElementById('delete-success-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }

  /**
   * Process fetch response with robust error handling
   */
  async processResponse(response) {
    console.log('Processing response...');
    console.log('Response status:', response.status, response.statusText);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    // For successful responses without body consumption issues
    if (response.ok && !response.bodyUsed) {
      try {
        const responseText = await response.text();
        console.log('Response text length:', responseText.length);

        if (responseText.trim()) {
          const result = JSON.parse(responseText);
          console.log('Successfully parsed response:', result);
          return result;
        } else {
          // Empty successful response
          return { success: true, message: 'Operation completed successfully' };
        }
      } catch (error) {
        console.warn('Failed to read successful response body:', error.message);
        // Fallback for successful responses with body issues
        return { success: true, message: 'Operation completed successfully' };
      }
    }

    // For error responses or body consumption issues
    let errorMessage = `Server error: ${response.status} ${response.statusText}`;
    let fullErrorDetails = null;

    try {
      if (!response.bodyUsed) {
        const responseText = await response.text();
        console.log('Error response text:', responseText);

        if (responseText.trim()) {
          try {
            const errorData = JSON.parse(responseText);
            console.log('Error response JSON:', errorData);
            errorMessage = errorData.error || errorData.message || errorMessage;
            fullErrorDetails = errorData;
          } catch (jsonError) {
            // If not JSON, use the text as error message
            console.log('Error response is not JSON, using as text');
            errorMessage = responseText.substring(0, 300);
            fullErrorDetails = { rawResponse: responseText };
          }
        }
      }
    } catch (readError) {
      console.warn('Could not read error response body:', readError.message);
      // Keep the default error message
    }

    return {
      error: errorMessage,
      status: response.status,
      details: fullErrorDetails
    };
  }

  /**
   * Utility method to escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Setup text formatting toolbar functionality
   */
  setupFormattingToolbar() {
    const toolbar = document.getElementById('formatting-toolbar');
    const editor = document.getElementById('product-description-editor');

    if (!toolbar || !editor) return;

    // Ensure editor is focusable
    editor.setAttribute('role', 'textbox');
    editor.setAttribute('aria-multiline', 'true');

    // Apply actions
    toolbar.addEventListener('click', (e) => {
      const button = e.target.closest('.toolbar-btn');
      if (!button) return;
      e.preventDefault();
      const action = button.dataset.action;
      this.handleFormatAction(action, editor, button);
    });

    // Keyboard shortcuts
    editor.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'b':
            e.preventDefault();
            this.handleFormatAction('bold', editor);
            break;
          case 'i':
            e.preventDefault();
            this.handleFormatAction('italic', editor);
            break;
          case 'u':
            e.preventDefault();
            this.handleFormatAction('underline', editor);
            break;
        }
      }
    });

    // Keep toolbar state in sync
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === editor || editor.contains(window.getSelection()?.anchorNode)) {
        this.updateToolbarState(editor);
      }
    });

    editor.addEventListener('keyup', () => this.updateToolbarState(editor));
    editor.addEventListener('mouseup', () => this.updateToolbarState(editor));
  }

  /**
   * Handle formatting actions
   */
  handleFormatAction(action, editor, button = null) {
    editor.focus();
    const sel = window.getSelection();

    const exec = (cmd, val = null) => document.execCommand(cmd, false, val);

    switch (action) {
      case 'bold':
        exec('bold');
        break;
      case 'italic':
        exec('italic');
        break;
      case 'underline':
        exec('underline');
        break;
      case 'heading': {
        let isHeading = false;
        try {
          const node = (sel && sel.rangeCount) ? sel.getRangeAt(0).commonAncestorContainer : null;
          const el = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
          isHeading = !!(el && el.closest && el.closest('h1,h2,h3,h4,h5,h6'));
        } catch(_) {}
        exec('formatBlock', isHeading ? 'P' : 'H1');
        break;
      }
      case 'list':
        exec('insertUnorderedList');
        break;
      case 'link': {
        this.showInsertLinkModal(editor);
        break;
      }
      case 'clear':
        exec('removeFormat');
        // unwrap headings/lists if needed
        try {
          const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
          if (range) {
            const container = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
            if (container && container.closest('h1,h2,h3,h4,h5,h6')) {
              const h = container.closest('h1,h2,h3,h4,h5,h6');
              const span = document.createElement('span');
              span.innerHTML = h.innerHTML;
              h.replaceWith(span);
            }
          }
        } catch(_) {}
        break;
      default:
        return;
    }

    this.updateToolbarState(editor);
  }

  /**
   * Show insert link modal and handle insertion
   */
  showInsertLinkModal(editor) {
    const modal = document.getElementById('insert-link-modal');
    const backdrop = modal ? modal.querySelector('.reviews-modal-backdrop') : null;
    const closeBtn = document.getElementById('insert-link-close');
    const cancelBtn = document.getElementById('insert-link-cancel');
    const insertBtn = document.getElementById('insert-link-insert');
    const urlInput = document.getElementById('insert-link-url');
    const textInput = document.getElementById('insert-link-text');
    const newTabInput = document.getElementById('insert-link-newtab');

    if (!modal || !urlInput || !insertBtn) return;

    // Save current selection inside editor
    this._savedSelection = this.saveEditorSelection(editor);

    // Prefill text from selection if any
    const sel = window.getSelection();
    const selectedText = sel && sel.rangeCount ? sel.toString() : '';
    textInput.value = selectedText || '';

    // Reset fields
    urlInput.value = '';

    // Show modal
    modal.style.display = 'flex';
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';

    const onClose = (e) => {
      e && e.preventDefault();
      modal.classList.remove('show');
      modal.style.display = 'none';
      document.body.style.overflow = '';
      cleanup();
    };

    const onInsert = async (e) => {
      e.preventDefault();
      const url = (urlInput.value || '').trim();
      if (!url) { urlInput.focus(); return; }

      // Visual loading on insert button
      insertBtn.classList.add('loading');
      try {
        await this.insertLinkAtSelection(editor, url, (textInput.value || '').trim(), !!newTabInput.checked);
        onClose(e);
      } finally {
        insertBtn.classList.remove('loading');
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose(e);
      if (e.key === 'Enter' && (e.target === urlInput || e.target === textInput)) onInsert(e);
    };

    const cleanup = () => {
      document.removeEventListener('keydown', onKeyDown);
      if (backdrop) backdrop.removeEventListener('click', onClose);
      if (closeBtn) closeBtn.removeEventListener('click', onClose);
      if (cancelBtn) cancelBtn.removeEventListener('click', onClose);
      insertBtn.removeEventListener('click', onInsert);
    };

    document.addEventListener('keydown', onKeyDown);
    if (backdrop) backdrop.addEventListener('click', onClose);
    if (closeBtn) closeBtn.addEventListener('click', onClose);
    if (cancelBtn) cancelBtn.addEventListener('click', onClose);
    insertBtn.addEventListener('click', onInsert);

    // Focus URL input
    setTimeout(() => urlInput.focus(), 0);
  }

  /**
   * Insert link using saved selection
   */
  async insertLinkAtSelection(editor, url, text, newTab) {
    // Normalize URL (add protocol if missing)
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }

    // Restore selection
    this.restoreEditorSelection(editor, this._savedSelection);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    if (sel.isCollapsed) {
      // No text selected: insert new anchor element
      const a = document.createElement('a');
      a.href = url;
      if (newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.textContent = text || url;
      range.insertNode(a);
      // Move caret after the link
      range.setStartAfter(a);
      range.setEndAfter(a);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      // Text selected: either replace with provided text or keep selection
      if (text) {
        // Replace selection with provided text wrapped in anchor
        const a = document.createElement('a');
        a.href = url;
        if (newTab) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        a.textContent = text;
        range.deleteContents();
        range.insertNode(a);
        // Set selection after the link
        range.setStartAfter(a);
        range.setEndAfter(a);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        // Wrap current selection
        document.execCommand('createLink', false, url);
        // Ensure target on created link
        try {
          const linkEl = this.getLinkUnderSelection();
          if (linkEl && newTab) { linkEl.target = '_blank'; linkEl.rel = 'noopener noreferrer'; }
        } catch(_) {}
      }
    }

    // Update hidden input value to keep editor and form in sync
    const hiddenDesc = document.getElementById('product-description');
    if (hiddenDesc) hiddenDesc.value = editor.innerHTML.trim();

    // Refresh toolbar state
    this.updateToolbarState(editor);
  }

  /** Save current selection relative to editor */
  saveEditorSelection(editor) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editor.contains(range.commonAncestorContainer)) {
        return range.cloneRange();
      }
    }
    return null;
  }

  /** Restore a previously saved selection */
  restoreEditorSelection(editor, savedRange) {
    try {
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    } catch (_) {}
  }

  /** Find nearest link element from current selection */
  getLinkUnderSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      let node = sel.getRangeAt(0).commonAncestorContainer;
      node = node.nodeType === 1 ? node : node.parentElement;
      return node && node.closest ? node.closest('a[href]') : null;
    } catch(_) { return null; }
  }

  /**
   * Update toolbar button states based on current selection
   */
  updateToolbarState(editor) {
    const toolbarButtons = document.querySelectorAll('.toolbar-btn');
    const sel = window.getSelection();
    let selEl = null;
    try {
      const node = (sel && sel.rangeCount) ? sel.getRangeAt(0).commonAncestorContainer : null;
      selEl = node && node.nodeType === 1 ? node : node ? node.parentElement : null;
    } catch(_) {}

    toolbarButtons.forEach(btn => {
      const action = btn.dataset.action;
      let isActive = false;
      try {
        switch (action) {
          case 'bold':
            isActive = document.queryCommandState('bold');
            break;
          case 'italic':
            isActive = document.queryCommandState('italic');
            break;
          case 'underline':
            isActive = document.queryCommandState('underline');
            break;
          case 'list':
            isActive = document.queryCommandState('insertUnorderedList') || !!(selEl && selEl.closest && selEl.closest('ul li'));
            break;
          case 'heading':
            isActive = !!(selEl && selEl.closest && selEl.closest('h1,h2,h3,h4,h5,h6'));
            break;
        }
      } catch(_) {}
      btn.classList.toggle('active', !!isActive);
    });
  }

  /**
   * Check if cursor is inside markdown formatting
   */
  isInsideMarkdown(textarea, position, startMark, endMark = null) {
    const text = textarea.value;
    endMark = endMark || startMark;

    // Find the last occurrence of startMark before position
    const lastStart = text.lastIndexOf(startMark, position);
    if (lastStart === -1) return false;

    // Find the first occurrence of endMark after lastStart
    const nextEnd = text.indexOf(endMark, lastStart + startMark.length);

    // Check if position is between the markers
    return nextEnd !== -1 && position >= lastStart && position <= nextEnd;
  }

  // Logs: set up controls
  setupAdminLogsControls() {
    const sessionsReset = document.getElementById('sessions-reset-btn');
    const sessionsDownload = document.getElementById('sessions-download-btn');
    const activityReset = document.getElementById('activity-reset-btn');
    const activityDownload = document.getElementById('activity-download-btn');

    if (sessionsReset) {
      sessionsReset.addEventListener('click', async () => {
        sessionsReset.classList.add('loading');
        sessionsReset.disabled = true;
        try {
          const keepToken = localStorage.getItem('admin_session_token');
          const keepId = localStorage.getItem('admin_session_id');
          const qs = new URLSearchParams({ type: 'sessions' });
          if (keepToken) qs.set('keep_session_token', keepToken);
          if (keepId) qs.set('keep_id', keepId);
          await fetch(`${functionsUrl('admin-logs')}?${qs.toString()}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
            }
          });
          await this.loadAdminSessions();
        } catch (e) {
          console.error('Reset sessions failed:', e);
        } finally {
          sessionsReset.disabled = false;
          sessionsReset.classList.remove('loading');
        }
      });
    }

    if (sessionsDownload) {
      sessionsDownload.addEventListener('click', async () => {
        sessionsDownload.classList.add('loading');
        sessionsDownload.disabled = true;
        try {
          await this.downloadLog('sessions', 'admin-sessions.csv');
        } finally {
          sessionsDownload.disabled = false;
          sessionsDownload.classList.remove('loading');
        }
      });
    }

    if (activityReset) {
      activityReset.addEventListener('click', async () => {
        activityReset.classList.add('loading');
        activityReset.disabled = true;
        try {
          await fetch(`${functionsUrl('admin-logs')}?type=activity`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('admin_token')}`,
              'Content-Type': 'application/json'
            }
          });
          await this.loadAdminActivity();
        } catch (e) {
          console.error('Reset activity failed:', e);
        } finally {
          activityReset.disabled = false;
          activityReset.classList.remove('loading');
        }
      });
    }

    if (activityDownload) {
      activityDownload.addEventListener('click', async () => {
        activityDownload.classList.add('loading');
        activityDownload.disabled = true;
        try {
          await this.downloadLog('activity', 'admin-activity.csv');
        } finally {
          activityDownload.disabled = false;
          activityDownload.classList.remove('loading');
        }
      });
    }
  }

  // Logs: orchestrator
  async loadAdminLogs() {
    await Promise.all([this.loadAdminSessions(), this.loadAdminActivity(), this.loadAdminReviews()]);
  }

  async loadAdminSessions() {
    const tbody = document.getElementById('sessions-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
      const res = await fetch(`${functionsUrl('admin-logs')}?type=sessions&_ts=${Date.now()}` , {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
        cache: 'no-store'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sessions');
      this.renderSessionsTable(json.sessions || []);
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" style="color:#e53e3e;">${this.escapeHtml(e.message)}</td></tr>`;
    }
  }

  async loadAdminActivity() {
    this._activityAllRows = [];
    this._activityPageIndex = 0;
    this._activityPageSize = 25;
    const tbody = document.getElementById('activity-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
      const res = await fetch(`${functionsUrl('admin-logs')}?type=activity&_ts=${Date.now()}` , {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
        cache: 'no-store'
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load activity');
      this._activityAllRows = json.activity || [];
      this._activityPageIndex = 0;
      this.renderActivityTablePage();
      this.setupActivityPagination();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan=\"6\" style=\"color:#e53e3e;\">${this.escapeHtml(e.message)}</td></tr>`;
    }
  }

  renderSessionsTable(rows) {
    const tbody = document.getElementById('sessions-tbody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">No sessions found</td></tr>';
      return;
    }
    const storedToken = localStorage.getItem('admin_session_token');
    const storedId = localStorage.getItem('admin_session_id');
    tbody.innerHTML = rows.map(r => {
      const isCurrent = (storedToken && r.session_token === storedToken) || (storedId && String(r.id) === String(storedId));
      const status = r.is_active ? (isCurrent ? '<span class="status-badge active">Active</span> <span class="current-session-badge">This session</span>' : '<span class="status-badge active">Active</span>') : '<span class="status-badge inactive">Inactive</span>';
      const uaShort = (r.user_agent || '').slice(0, 60) + ((r.user_agent || '').length > 60 ? '…' : '');
      return `
      <tr${isCurrent ? ' class="is-current-session"' : ''}>
        <td>${this.escapeHtml(r.username || '')}</td>
        <td>${this.escapeHtml(r.ip_address || '')}</td>
        <td title="${this.escapeHtml(r.user_agent || '')}">${this.escapeHtml(uaShort)}</td>
        <td>${this.formatDateTime(r.created_at)}</td>
        <td>${this.formatDateTime(r.expires_at)}</td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }

  async loadAdminReviews() {
    this._reviewsAllRows = [];
    this._reviewsPageIndex = 0;
    this._reviewsPageSize = 10;
    const tbody = document.getElementById('reviews-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6">Loading...</td></tr>';
    try {
      const res = await fetch(functionsUrl('admin-reviews'), {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load reviews');
      this._reviewsAllRows = json.reviews || [];
      this._reviewsPageIndex = 0;
      this.renderReviewsTablePage();
      this.setupReviewsPagination();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan=\"6\" style=\"color:#e53e3e;\">${this.escapeHtml(e.message)}</td></tr>`;
    }
  }

  renderActivityTablePage() {
    const rows = this._activityAllRows || [];
    const start = this._activityPageIndex * this._activityPageSize;
    const end = start + this._activityPageSize;
    const pageRows = rows.slice(start, end);
    const tbody = document.getElementById('activity-tbody');
    const info = document.getElementById('activity-page-info');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">No activity found</td></tr>';
      if (info) info.textContent = 'Page 0 of 0';
      return;
    }
    tbody.innerHTML = pageRows.map(r => `
      <tr>
        <td>${this.formatDateTime(r.created_at)}</td>
        <td>${this.escapeHtml(r.username || '')}</td>
        <td>${this.escapeHtml(r.action || '')}</td>
        <td>${this.escapeHtml(r.resource_type || '')}</td>
        <td>${this.escapeHtml((r.resource_id || (r.resource_type === 'product' && r.details && (r.details.product_id ?? r.details.id))) || '')}</td>
        <td>${this.escapeHtml(r.ip_address || '')}</td>
      </tr>
    `).join('');
    const totalPages = Math.max(1, Math.ceil(rows.length / this._activityPageSize));
    if (info) info.textContent = `Page ${this._activityPageIndex + 1} of ${totalPages}`;
  }

  setupActivityPagination() {
    const prev = document.getElementById('activity-prev');
    const next = document.getElementById('activity-next');
    const update = () => {
      const totalPages = Math.max(1, Math.ceil((this._activityAllRows || []).length / this._activityPageSize));
      if (prev) prev.disabled = this._activityPageIndex <= 0;
      if (next) next.disabled = this._activityPageIndex >= totalPages - 1;
    };
    if (prev) prev.onclick = () => { if (this._activityPageIndex > 0) { this._activityPageIndex--; this.renderActivityTablePage(); update(); } };
    if (next) next.onclick = () => { const totalPages = Math.ceil((this._activityAllRows || []).length / this._activityPageSize); if (this._activityPageIndex < totalPages - 1) { this._activityPageIndex++; this.renderActivityTablePage(); update(); } };
    update();
  }

  formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  renderReviewsTablePage() {
    const rows = this._reviewsAllRows || [];
    const start = this._reviewsPageIndex * this._reviewsPageSize;
    const end = start + this._reviewsPageSize;
    const pageRows = rows.slice(start, end);
    const tbody = document.getElementById('reviews-tbody');
    const info = document.getElementById('reviews-page-info');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6">No reviews found</td></tr>';
      if (info) info.textContent = 'Page 0 of 0';
      return;
    }
    tbody.innerHTML = pageRows.map(r => `
      <tr data-review-id="${r.id}" data-review-text="${this.escapeHtml(r.review || '')}">
        <td>${this.formatDateTime(r.created_at)}</td>
        <td>
          <div style=\"display:flex;align-items:center;gap:.5rem;\">
            <img src="${this.escapeHtml(r.image_url || '')}" alt="review" style="width:40px;height:40px;border-radius:6px;object-fit:cover;background:#e2e8f0;" />
            <button class="control-btn change-image-btn">
              <span class="btn-text"><i class="fas fa-image"></i> Change</span>
              <span class="btn-spinner"><div class="spinner-circle"></div></span>
            </button>
            <input type="file" accept="image/*" class="hidden-file-input" style="display:none" />
          </div>
        </td>
        <td>
          <input type="text" class="reviewer-name-input" value="${this.escapeHtml(r.name || '')}" style="width:100%;padding:.5rem;border:1px solid #e2e8f0;border-radius:6px;" />
          <div class="inline-stars" data-rating="${r.rating ?? 0}">
            ${[1,2,3,4,5].map(v => `<i data-value="${v}" class="fa-star ${v <= (r.rating || 0) ? 'fas filled' : 'far'}"></i>`).join('')}
          </div>
        </td>
        <td>
          <button class="control-btn edit-text-btn">
            <span class="btn-text"><i class="fas fa-pen"></i> Edit</span>
            <span class="btn-spinner"><div class="spinner-circle"></div></span>
          </button>
        </td>
        <td>
          <div class="review-flags">
            <label class="checkbox-label"><input type="checkbox" class="featured-toggle" ${r.featured ? 'checked' : ''}><span class="checkbox-custom"></span> Featured</label>
            <label class="checkbox-label"><input type="checkbox" class="verified-toggle" ${r.verified ? 'checked' : ''}><span class="checkbox-custom"></span> Verified</label>
          </div>
        </td>
        <td>
          <button class="control-btn save-review-btn">
            <span class="btn-text"><i class="fas fa-save"></i> Save</span>
            <span class="btn-spinner"><div class="spinner-circle"></div></span>
          </button>
        </td>
      </tr>
    `).join('');
    const totalPages = Math.max(1, Math.ceil(rows.length / this._reviewsPageSize));
    if (info) info.textContent = `Page ${this._reviewsPageIndex + 1} of ${totalPages}`;

    this.wireReviewsTableRowEvents();
  }

  setupReviewsPagination() {
    const prev = document.getElementById('reviews-prev');
    const next = document.getElementById('reviews-next');
    const update = () => {
      const totalPages = Math.max(1, Math.ceil((this._reviewsAllRows || []).length / this._reviewsPageSize));
      if (prev) prev.disabled = this._reviewsPageIndex <= 0;
      if (next) next.disabled = this._reviewsPageIndex >= totalPages - 1;
    };
    if (prev) prev.onclick = () => { if (this._reviewsPageIndex > 0) { this._reviewsPageIndex--; this.renderReviewsTablePage(); update(); } };
    if (next) next.onclick = () => { const totalPages = Math.ceil((this._reviewsAllRows || []).length / this._reviewsPageSize); if (this._reviewsPageIndex < totalPages - 1) { this._reviewsPageIndex++; this.renderReviewsTablePage(); update(); } };
    update();
  }

  wireReviewsTableRowEvents() {
    const tbody = document.getElementById('reviews-tbody');

    tbody.querySelectorAll('.change-image-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.currentTarget.closest('tr');
        const input = tr.querySelector('.hidden-file-input');
        input.click();
      });
    });

    tbody.querySelectorAll('.hidden-file-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const tr = e.target.closest('tr');
        const btn = tr.querySelector('.change-image-btn');
        btn.classList.add('loading');
        btn.disabled = true;
        try {
          const id = tr.getAttribute('data-review-id');
          const form = new FormData();
          form.append('id', id);
          form.append('image', file);
          const res = await fetch(functionsUrl('admin-reviews'), {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` },
            body: form
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to upload image');
          await this.loadAdminReviews();
        } catch(err) {
          console.error('Upload image failed:', err);
        } finally {
          btn.disabled = false;
          btn.classList.remove('loading');
          e.target.value = '';
        }
      });
    });

    tbody.querySelectorAll('.inline-stars').forEach(wrapper => {
      wrapper.addEventListener('click', (e) => {
        const icon = e.target.closest('.fa-star');
        if (!icon) return;
        const value = parseInt(icon.getAttribute('data-value'), 10);
        wrapper.setAttribute('data-rating', String(value));
        wrapper.querySelectorAll('.fa-star').forEach(i => {
          const v = parseInt(i.getAttribute('data-value'), 10);
          i.classList.toggle('fas', v <= value);
          i.classList.toggle('far', v > value);
          i.classList.toggle('filled', v <= value);
        });
      });
    });

    tbody.querySelectorAll('.save-review-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const tr = e.currentTarget.closest('tr');
        const id = tr.getAttribute('data-review-id');
        const name = tr.querySelector('.reviewer-name-input').value;
        const reviewInput = tr.querySelector('.review-text-input');
        const review = reviewInput ? reviewInput.value : undefined;
        const featured = tr.querySelector('.featured-toggle').checked;
        const verified = tr.querySelector('.verified-toggle').checked;
        const ratingWrapper = tr.querySelector('.inline-stars');
        const rating = ratingWrapper ? parseInt(ratingWrapper.getAttribute('data-rating') || '0', 10) : undefined;
        const saveBtn = tr.querySelector('.save-review-btn');
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;
        try {
          const res = await fetch(functionsUrl('admin-reviews'), {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('admin_token')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id, name, review, featured, rating, verified })
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to save review');
        } catch(err) {
          console.error('Save review failed:', err);
        } finally {
          saveBtn.disabled = false;
          saveBtn.classList.remove('loading');
        }
      });
    });

    tbody.querySelectorAll('.edit-text-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.currentTarget.closest('tr');
        const id = tr.getAttribute('data-review-id');
        const name = tr.querySelector('.reviewer-name-input').value;
        const ratingWrapper = tr.querySelector('.inline-stars');
        const rating = ratingWrapper ? parseInt(ratingWrapper.getAttribute('data-rating') || '0', 10) : 0;
        const review = tr.getAttribute('data-review-text') || '';
        this.openReviewEditor({ id, name, review, rating });
      });
    });
  }

  openReviewEditor(review) {
    const modal = document.getElementById('review-editor-modal');
    if (!modal) return;
    modal.dataset.reviewId = review.id;
    const nameInput = document.getElementById('review-editor-name');
    const textInput = document.getElementById('review-editor-text');
    const starWrap = document.getElementById('review-editor-rating');
    nameInput.value = review.name || '';
    textInput.value = review.review || '';
    starWrap.setAttribute('data-rating', String(review.rating || 0));
    starWrap.querySelectorAll('.fa-star').forEach(st => {
      const v = parseInt(st.getAttribute('data-value'), 10);
      st.classList.toggle('fas', v <= review.rating);
      st.classList.toggle('far', v > review.rating);
      st.classList.toggle('filled', v <= review.rating);
    });

    // Wire star click once
    if (!this._modalStarBound) {
      starWrap.addEventListener('click', (e) => {
        const icon = e.target.closest('.fa-star');
        if (!icon) return;
        const value = parseInt(icon.getAttribute('data-value'), 10);
        starWrap.setAttribute('data-rating', String(value));
        starWrap.querySelectorAll('.fa-star').forEach(i => {
          const v = parseInt(i.getAttribute('data-value'), 10);
          i.classList.toggle('fas', v <= value);
          i.classList.toggle('far', v > value);
          i.classList.toggle('filled', v <= value);
        });
      });
      this._modalStarBound = true;
    }

    // Close handlers
    const closeEls = [document.getElementById('review-editor-close'), document.getElementById('review-editor-cancel'), modal.querySelector('.reviews-modal-backdrop')];
    closeEls.forEach(el => { if (el) el.onclick = () => this.closeReviewEditor(); });

    // Save handler
    const saveBtn = document.getElementById('review-editor-save');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        saveBtn.classList.add('loading');
        saveBtn.disabled = true;
        try {
          const id = modal.dataset.reviewId;
          const name = nameInput.value;
          const reviewText = textInput.value;
          const rating = parseInt(starWrap.getAttribute('data-rating') || '0', 10);
          const res = await fetch(functionsUrl('admin-reviews'), {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('admin_token')}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id, name, review: reviewText, rating })
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Failed to save review');
          this.closeReviewEditor();
          await this.loadAdminReviews();
        } catch (err) {
          console.error('Save from modal failed:', err);
        } finally {
          saveBtn.disabled = false;
          saveBtn.classList.remove('loading');
        }
      };
    }

    modal.classList.add('show');
    modal.style.display = 'flex';
  }

  closeReviewEditor() {
    const modal = document.getElementById('review-editor-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
  }

  async downloadLog(type, filename) {
    const res = await fetch(`${functionsUrl('admin-logs')}?type=${encodeURIComponent(type)}&mode=download`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
    });
    if (!res.ok) {
      let msg = 'Download failed';
      try { const j = await res.json(); msg = j.error || msg; } catch {}
      throw new Error(msg);
    }
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Initialize admin manager when DOM is loaded
let adminManager;

document.addEventListener('DOMContentLoaded', () => {
  adminManager = new AdminManager();
});

// Make adminManager globally available for onclick handlers
window.adminManager = adminManager;

// Handle page visibility for security
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && adminManager) {
    // Check auth status when page becomes visible
    adminManager.checkAuthStatus();
  }
});

// Auto-logout on browser close (clear session)
window.addEventListener('beforeunload', () => {
  // Keep auth data for page refreshes but clear on actual close
  // This is a basic approach - in production you might want more sophisticated session management
});

// Export for testing if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdminManager;
}
