/**
 * Admin Panel Management System
 * Handles authentication, file uploads, product creation, and editing
 */

class AdminManager {
  constructor() {
    this.isAuthenticated = false;
    this.uploadedFiles = {
      product: null,
      preview: null,
      'resource-images': []
    };
    this.products = [];
    this.currentEditingProduct = null;
    this.init();
  }

  /**
   * Initialize the admin panel
   */
  init() {
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
    
    if (token && expiry && new Date().getTime() < parseInt(expiry)) {
      this.isAuthenticated = true;
      this.showAdminPanel();
      this.loadProducts(); // Load products when authenticated
    } else {
      this.clearAuthData();
      this.showLoginModal();
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
      loginBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'flex';
      this.hideLoginError();

      const formData = new FormData(e.target);
      const credentials = {
        username: formData.get('username'),
        password: formData.get('password')
      };

      const response = await fetch('/.netlify/functions/admin-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(credentials)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Authentication failed');
      }

      // Store auth data
      const expiryTime = new Date().getTime() + (24 * 60 * 60 * 1000); // 24 hours
      localStorage.setItem('admin_token', result.token);
      localStorage.setItem('admin_token_expiry', expiryTime.toString());
      
      this.isAuthenticated = true;
      
      // Success animation and transition
      setTimeout(() => {
        this.hideLoginModal();
        this.showAdminPanel();
      }, 500);

    } catch (error) {
      console.error('Login error:', error);
      this.showLoginError(error.message);
    } finally {
      // Reset button state
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
      this.uploadedFiles[uploadType].push(file);
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

    // Hide drop content, show file info
    dropContent.style.display = 'none';
    fileInfo.style.display = 'block';
    fileInfo.classList.add('show');

    // For resource images, show multiple files
    if (uploadType === 'resource-images') {
      const fileCount = this.uploadedFiles[uploadType].length;
      fileInfo.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <i class="fas fa-images" style="color: #2c77cc; font-size: 1.2rem;"></i>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #2d3748; margin-bottom: 0.25rem;">
              ${fileCount} image${fileCount === 1 ? '' : 's'} selected
            </div>
            <div style="color: #718096; font-size: 0.875rem;">
              Ready to upload
            </div>
          </div>
          <button type="button" onclick="adminManager.removeFile('${uploadType}')" 
                  style="background: #e53e3e; color: white; border: none; border-radius: 4px; 
                         padding: 0.5rem; cursor: pointer; transition: all 0.2s ease;">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
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
          <button type="button" onclick="adminManager.removeFile('${uploadType}')" 
                  style="background: #e53e3e; color: white; border: none; border-radius: 4px; 
                         padding: 0.5rem; cursor: pointer; transition: all 0.2s ease;">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
    }
  }

  /**
   * Remove uploaded file
   */
  removeFile(uploadType) {
    const dropZone = document.querySelector(`[data-upload-type="${uploadType}"]`);
    const fileInfo = dropZone.querySelector('.file-info');
    const dropContent = dropZone.querySelector('.drop-zone-content');
    const fileInput = dropZone.querySelector('input[type="file"]');

    // Reset UI
    fileInfo.style.display = 'none';
    fileInfo.classList.remove('show');
    dropContent.style.display = 'block';

    // Clear file data
    if (uploadType === 'resource-images') {
      this.uploadedFiles[uploadType] = [];
    } else {
      this.uploadedFiles[uploadType] = null;
    }
    fileInput.value = '';

    // Reset progress
    const progress = dropZone.querySelector('.upload-progress');
    progress.style.display = 'none';
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

    if (!this.validateForm()) {
      return;
    }

    const submitBtn = document.querySelector('.submit-btn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    try {
      // Show loading state with enhanced visibility
      submitBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'flex';

      // Prepare form data
      const formData = new FormData();
      
      // Add form fields
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

      formData.append('productData', JSON.stringify(productData));

      // Add files
      if (this.uploadedFiles.product) {
        formData.append('productFile', this.uploadedFiles.product);
      }
      
      if (this.uploadedFiles.preview) {
        formData.append('previewFile', this.uploadedFiles.preview);
      }

      // Add resource images
      if (this.uploadedFiles['resource-images'] && this.uploadedFiles['resource-images'].length > 0) {
        this.uploadedFiles['resource-images'].forEach((file, index) => {
          formData.append('resourceImages', file);
        });
      }

      // Add auth token
      formData.append('token', localStorage.getItem('admin_token'));

      // Choose endpoint based on whether we're creating or updating
      const endpoint = this.currentEditingProduct ? 
        '/.netlify/functions/update-product' : 
        '/.netlify/functions/create-product';

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save product');
      }

      // Show success modal
      this.showSuccessModal();
      
      // Reset form and editing state
      this.resetForm();
      this.currentEditingProduct = null;
      this.updateFormTitle();
      
      // Refresh products list
      await this.loadProducts();

    } catch (error) {
      console.error('Product save error:', error);
      this.showErrorModal(error.message);
    } finally {
      // Reset button state
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
      fieldGroup.classList.add('error');
      return false;
    }

    // Additional validation for price
    if (field.name === 'price') {
      const price = parseFloat(value);
      if (isNaN(price) || price < 0) {
        fieldGroup.classList.add('error');
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
    fieldGroup.classList.remove('error');
  }

  /**
   * Reset form
   */
  resetForm() {
    const form = document.getElementById('product-form');
    form.reset();

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

      const response = await fetch('/.netlify/functions/manage-products', {
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
          ${this.escapeHtml(description.substring(0, 120))}${description.length > 120 ? '...' : ''}
        </div>
        
        <div class="product-manage-actions">
          <button class="product-edit-btn" onclick="adminManager.editProduct(${product.id})">
            <i class="fas fa-edit"></i> Edit
          </button>
          <button class="product-delete-btn" onclick="adminManager.confirmDeleteProduct(${product.id}, '${this.escapeHtml(product.name)}')">
            <i class="fas fa-trash"></i> Delete
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
    try {
      // Show loading state
      const editButtons = document.querySelectorAll('.product-edit-btn');
      const targetButton = Array.from(editButtons).find(btn => 
        btn.getAttribute('onclick').includes(productId)
      );
      
      if (targetButton) {
        const originalContent = targetButton.innerHTML;
        targetButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        targetButton.disabled = true;
      }

      // Fetch product data
      const response = await fetch(`/.netlify/functions/get-product?product_id=${productId}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load product');
      }

      const product = result.product;
      
      // Set current editing product
      this.currentEditingProduct = product;
      
      // Populate form fields
      document.getElementById('product-name').value = product.name || '';
      document.getElementById('product-category').value = product.category || '';
      document.getElementById('product-price').value = (product.price / 100).toFixed(2);
      document.getElementById('product-description').value = product.description || '';
      document.getElementById('product-featured').checked = product.featured || false;
      
      // Update form UI
      this.updateFormTitle();
      
      // Scroll to form
      document.querySelector('.upload-section').scrollIntoView({ behavior: 'smooth' });
      
      // Reset uploaded files (user can optionally upload new ones)
      this.resetUploadedFiles();
      
    } catch (error) {
      console.error('Error loading product for edit:', error);
      this.showErrorModal('Failed to load product data for editing.');
    } finally {
      // Reset button state
      if (targetButton) {
        targetButton.innerHTML = '<i class="fas fa-edit"></i> Edit';
        targetButton.disabled = false;
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
            <button class="delete-confirm-btn" id="confirm-delete-btn">
              <i class="fas fa-trash"></i> Delete
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
    const originalContent = confirmBtn.innerHTML;
    
    try {
      // Show loading state
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
      
      const response = await fetch(`/.netlify/functions/manage-products?product_id=${productId}`, {
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
      
      // Reload products
      await this.loadProducts();
      
      // Show delete success message
      this.showDeleteSuccessModal();

    } catch (error) {
      console.error('Error deleting product:', error);
      this.showErrorModal(error.message);
    } finally {
      // Reset button state
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = originalContent;
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
   * Utility method to escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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