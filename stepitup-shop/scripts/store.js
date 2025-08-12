/**
 * Enhanced Store Management System
 * Handles product display, cart functionality, file previews, reviews, and checkout process
 */

class StoreManager {
  constructor() {
    this.cart = this.loadCart();
    this.products = [];
    this.currentCategory = 'all';
    this.modalCreated = false;
    this.currentProductForReview = null;
    this.reviewsOffset = 0;
    this.reviewsLimit = 10;
    this.init();
  }

  /**
   * Initialize the store application
   */
  async init() {
    try {
      this.showLoadingState();
      await this.loadProducts();
      this.renderProducts();
      this.renderCart();
      this.renderCartDropdown();
      this.setupEventListeners();
      this.setupModalListeners();
      this.hideLoadingState();
    } catch (error) {
      console.error('Store initialization error:', error);
      this.showErrorState();
    }
  }

  /**
   * Show loading spinner
   */
  showLoadingState() {
    document.getElementById('loading-spinner').style.display = 'block';
    document.getElementById('error-message').style.display = 'none';
    document.getElementById('products-section').style.display = 'none';
  }

  /**
   * Hide loading spinner and show products
   */
  hideLoadingState() {
    document.getElementById('loading-spinner').style.display = 'none';
    document.getElementById('products-section').style.display = 'block';
  }

  /**
   * Show error state
   */
  showErrorState() {
    document.getElementById('loading-spinner').style.display = 'none';
    document.getElementById('error-message').style.display = 'block';
    document.getElementById('products-section').style.display = 'none';
  }

  /**
   * Load products from Netlify function
   */
  async loadProducts() {
    try {
      const response = await fetch('/.netlify/functions/get-products', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error);
      }

      this.products = Array.isArray(data) ? data : [];
      console.log('Loaded products:', this.products);
      
    } catch (error) {
      console.error('Error loading products:', error);
      throw error;
    }
  }

  /**
   * Render products grid with filtering
   */
  renderProducts() {
    const productsList = document.getElementById('products-list');
    
    if (!this.products || this.products.length === 0) {
      productsList.innerHTML = this.createNoProductsMessage();
      return;
    }

    // Filter products by category
    const filteredProducts = this.currentCategory === 'all' 
      ? this.products 
      : this.products.filter(product => 
          product.category && product.category.toLowerCase() === this.currentCategory
        );

    productsList.innerHTML = '';
    
    if (filteredProducts.length === 0) {
      productsList.innerHTML = this.createNoCategoryProductsMessage();
      return;
    }

    filteredProducts.forEach(product => {
      const productCard = this.createProductCard(product);
      productsList.appendChild(productCard);
    });

    // Animate cards in
    setTimeout(() => {
      const cards = productsList.querySelectorAll('.product-card');
      cards.forEach((card, index) => {
        setTimeout(() => {
          card.classList.add('fade-in');
        }, index * 100);
      });
    }, 100);
  }

  /**
   * Create no products message
   */
  createNoProductsMessage() {
    return `
      <div class="no-products">
        <i class="fas fa-box-open"></i>
        <h3>No Resources Available</h3>
        <p>We're working on adding new educational resources. Please check back soon!</p>
      </div>
    `;
  }

  /**
   * Create no category products message
   */
  createNoCategoryProductsMessage() {
    return `
      <div class="no-products">
        <i class="fas fa-search"></i>
        <h3>No Resources Found</h3>
        <p>No resources found in this category. Try selecting a different category.</p>
      </div>
    `;
  }

  /**
   * Create individual product card
   */
  createProductCard(product) {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.setAttribute('data-product-id', product.id);

    const price = (product.price / 100).toFixed(2);
    const category = product.category || 'Resource';
    const productIcon = this.getProductIcon(category);
    
    // Handle product image - show image if available, otherwise show icon
    const imageSection = product.image_url 
      ? `<img src="${this.escapeHtml(product.image_url)}" alt="${this.escapeHtml(product.name)}">`
      : `<div class="fallback-icon"><i class="${productIcon}"></i></div>`;
    
    card.innerHTML = `
      <div class="product-image">
        ${imageSection}
      </div>
      <div class="product-content">
        <div class="product-title-row">
          <div class="product-category-icon">
            <i class="${productIcon}"></i>
          </div>
          <h3>${this.escapeHtml(product.name)}</h3>
        </div>
        <p>${this.escapeHtml(product.description || 'Educational resource to support your learning journey.')}</p>
        <div class="product-price">
          <span>$${price}</span>
          ${product.featured ? '<span class="price-badge">Popular</span>' : ''}
        </div>
        <div class="product-actions">
          <button class="add-to-cart-btn" data-product-id="${product.id}">
            <i class="fas fa-shopping-cart"></i> Add to Cart
          </button>
          <div class="product-secondary-actions">
            <button class="preview-btn" data-product-id="${product.id}">
              <i class="fas fa-eye"></i> Preview
            </button>
            <button class="reviews-btn" data-product-id="${product.id}">
              <i class="fas fa-star"></i> Reviews
            </button>
          </div>
        </div>
      </div>
    `;

    // Add click event listeners
    const addButton = card.querySelector('.add-to-cart-btn');
    addButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.addToCart(product);
      this.showAddedFeedback(addButton);
    });

    const previewButton = card.querySelector('.preview-btn');
    previewButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.showPreviewModal(product);
    });

    const reviewsButton = card.querySelector('.reviews-btn');
    reviewsButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.showReviewsModal(product);
    });

    return card;
  }

  /**
   * Get appropriate icon for product category
   */
  getProductIcon(category) {
    const iconMap = {
      'worksheets': 'fas fa-file-alt',
      'guides': 'fas fa-book',
      'templates': 'fas fa-clipboard',
      'exercises': 'fas fa-pencil-alt',
      'assessments': 'fas fa-check-square',
      'default': 'fas fa-graduation-cap'
    };

    return iconMap[category.toLowerCase()] || iconMap.default;
  }

  /**
   * Show visual feedback when item is added to cart
   */
  showAddedFeedback(button) {
    const originalContent = button.innerHTML;
    
    button.innerHTML = '<i class="fas fa-check"></i> Added!';
    button.style.background = '#48bb78';
    button.disabled = true;
    
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.style.background = '';
      button.disabled = false;
    }, 2000);
  }

  /**
   * Add product to cart
   */
  addToCart(product) {
    // For digital products, don't allow duplicates - just show message
    const existingItem = this.cart.find(item => item.id === product.id);
    
    if (existingItem) {
      alert('This resource is already in your cart!');
      return;
    }

    this.cart.push({
      ...product,
      quantity: 1,
      addedAt: new Date().toISOString()
    });

    this.saveCart();
    this.renderCart();
    this.renderCartDropdown();
    this.animateCartUpdate();

    // Track add to cart event
    this.trackEvent('add_to_cart', {
      product_id: product.id,
      product_name: product.name,
      price: product.price
    });
  }

  /**
   * Remove product from cart
   */
  removeFromCart(productId) {
    const itemIndex = this.cart.findIndex(item => item.id === productId);
    if (itemIndex > -1) {
      const removedItem = this.cart[itemIndex];
      this.cart.splice(itemIndex, 1);
      this.saveCart();
      this.renderCart();
      this.renderCartDropdown();

      // Track remove from cart event
      this.trackEvent('remove_from_cart', {
        product_id: removedItem.id,
        product_name: removedItem.name
      });
    }
  }

  /**
   * Clear entire cart
   */
  clearCart() {
    if (this.cart.length > 0) {
      this.cart = [];
      this.saveCart();
      this.renderCart();
      this.renderCartDropdown();
      
      // Track clear cart event
      this.trackEvent('clear_cart');
    }
  }

  /**
   * Create and setup clear cart modal - New robust version
   */
  createClearCartModal() {
    console.log('Creating clear cart modal...');
    
    // Remove any existing modal first
    this.removeClearCartModal();

    // Create modal overlay
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'clear-cart-modal-overlay';
    modalOverlay.innerHTML = `
      <div class="clear-cart-modal-backdrop" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.75);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        backdrop-filter: blur(2px);
      ">
        <div class="clear-cart-modal-content" style="
          background: #ffffff;
          border-radius: 12px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          max-width: 400px;
          width: 100%;
          padding: 1.5rem;
          transform: scale(1);
          animation: modalSlideIn 0.2s ease-out;
        ">
          <div class="modal-header" style="text-align: center; margin-bottom: 1rem;">
            <i class="fas fa-exclamation-triangle" style="
              font-size: 2rem; 
              color: #f56565; 
              margin-bottom: 0.5rem;
            "></i>
            <h3 style="
              margin: 0; 
              font-size: 1.2rem; 
              font-weight: 600; 
              color: #2d3748;
            ">Clear Cart</h3>
          </div>
          <div class="modal-body" style="text-align: center; margin-bottom: 1.5rem;">
            <p style="
              margin: 0; 
              color: #4a5568; 
              line-height: 1.5;
            ">Are you sure you want to remove all items from your cart? This cannot be undone.</p>
          </div>
          <div class="modal-actions" style="
            display: flex; 
            gap: 0.75rem; 
            justify-content: center;
          ">
            <button class="modal-cancel-btn" style="
              background: #edf2f7;
              color: #4a5568;
              border: none;
              border-radius: 6px;
              padding: 0.6rem 1.2rem;
              font-size: 0.9rem;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s ease;
              min-width: 80px;
            ">Cancel</button>
            <button class="modal-clear-btn" style="
              background: #e53e3e;
              color: #ffffff;
              border: none;
              border-radius: 6px;
              padding: 0.6rem 1.2rem;
              font-size: 0.9rem;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s ease;
              min-width: 80px;
            ">Clear Cart</button>
          </div>
        </div>
      </div>
      <style>
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
        .modal-cancel-btn:hover {
          background: #e2e8f0 !important;
        }
        .modal-clear-btn:hover {
          background: #c53030 !important;
        }
      </style>
    `;

    // Add modal to page
    document.body.appendChild(modalOverlay);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Setup event listeners
    const backdrop = modalOverlay.querySelector('.clear-cart-modal-backdrop');
    const cancelBtn = modalOverlay.querySelector('.modal-cancel-btn');
    const clearBtn = modalOverlay.querySelector('.modal-clear-btn');

    // Cancel button handler
    const handleCancel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Modal cancel clicked');
      this.hideClearCartModal();
    };

    // Clear button handler
    const handleClear = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Modal clear confirmed');
      this.clearCart();
      this.hideClearCartModal();
    };

    // Backdrop click handler (close modal)
    const handleBackdropClick = (e) => {
      if (e.target === backdrop) {
        console.log('Modal backdrop clicked');
        this.hideClearCartModal();
      }
    };

    // Escape key handler
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        console.log('Escape key pressed');
        this.hideClearCartModal();
      }
    };

    // Attach event listeners
    cancelBtn.addEventListener('click', handleCancel);
    clearBtn.addEventListener('click', handleClear);
    backdrop.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscape);

    // Store handlers for cleanup
    this.modalHandlers = {
      handleCancel,
      handleClear,
      handleBackdropClick,
      handleEscape
    };

    console.log('Clear cart modal created and event listeners attached');
  }

  /**
   * Remove clear cart modal and cleanup
   */
  removeClearCartModal() {
    const existingModal = document.getElementById('clear-cart-modal-overlay');
    if (existingModal) {
      existingModal.remove();
    }
    
    // Restore body scroll
    document.body.style.overflow = '';
    
    // Cleanup event listeners
    if (this.modalHandlers && this.modalHandlers.handleEscape) {
      document.removeEventListener('keydown', this.modalHandlers.handleEscape);
      this.modalHandlers = null;
    }
  }

  /**
   * Show clear cart modal
   */
  showClearCartModal() {
    console.log('showClearCartModal called');
    this.createClearCartModal(); // Always create fresh modal
  }

  /**
   * Hide clear cart modal
   */
  hideClearCartModal() {
    console.log('hideClearCartModal called');
    this.removeClearCartModal();
  }

  /**
   * Render shopping cart
   */
  renderCart() {
    const cartSection = document.getElementById('cart-section');
    const cartEmpty = document.getElementById('cart-empty');
    const cartContent = document.getElementById('cart-content');
    const cartCount = document.getElementById('cart-count');

    // Update cart count
    const totalItems = this.cart.length; // No quantities for digital products
    cartCount.textContent = totalItems;

    // Show/hide cart sections
    if (this.cart.length === 0) {
      cartSection.style.display = 'block';
      cartEmpty.style.display = 'block';
      cartContent.style.display = 'none';
      return;
    } else {
      cartSection.style.display = 'block';
      cartEmpty.style.display = 'none';
      cartContent.style.display = 'block';
    }

    // Render cart items
    this.renderCartItems();
    this.updateCartTotals();
  }

  /**
   * Render cart dropdown
   */
  renderCartDropdown() {
    const cartDropdownCount = document.getElementById('cart-dropdown-count');
    const cartDropdownEmpty = document.getElementById('cart-dropdown-empty');
    const cartDropdownItems = document.getElementById('cart-dropdown-items');
    const cartDropdownList = document.getElementById('cart-dropdown-list');
    const cartDropdownTotal = document.getElementById('cart-dropdown-total');

    // Update dropdown cart count
    const totalItems = this.cart.length;
    cartDropdownCount.textContent = totalItems;

    // Show/hide dropdown sections
    if (this.cart.length === 0) {
      cartDropdownEmpty.style.display = 'block';
      cartDropdownItems.style.display = 'none';
      return;
    } else {
      cartDropdownEmpty.style.display = 'none';
      cartDropdownItems.style.display = 'block';
    }

    // Render dropdown cart items
    cartDropdownList.innerHTML = '';
    this.cart.forEach(item => {
      const li = document.createElement('li');
      const price = (item.price / 100).toFixed(2);
      
      li.innerHTML = `
      <div style="display: flex; align-items: flex-start; justify-content: space-between; text-align: left; width: 100%; padding: 0; margin: 0; box-sizing: border-box;">
  <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; margin: 0; padding: 0; text-align: left;">
    <div style="font-weight: 600; color: #2d3748; font-size: 0.9em; margin: 0; padding: 0; word-break: break-word;">
      ${this.escapeHtml(item.name)}
    </div>
    <div style="color: #718096; font-size: 0.8em; margin: 0; padding: 0;">
      Cost: ${price}
    </div>
  </div>
  <button class="dropdown-remove-btn" data-product-id="${item.id}"
    style="background: #e53e3e; color: white; border: none; border-radius: 4px;
           padding: 0.5em 0.8em; cursor: pointer; font-size: 0.8em;
           transition: background 0.2s; margin: 0 0 0 0.5rem; white-space: nowrap; flex-shrink: 0;">
    <i class="fas fa-times"></i>
  </button>
</div>
      `;
      
      // Add event listener to remove button
      const removeBtn = li.querySelector('.dropdown-remove-btn');
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeFromCart(item.id);
      });
      
      // Add hover effect
      removeBtn.addEventListener('mouseenter', () => {
        removeBtn.style.background = '#c53030';
      });
      removeBtn.addEventListener('mouseleave', () => {
        removeBtn.style.background = '#e53e3e';
      });
      
      cartDropdownList.appendChild(li);
    });

    // Update dropdown total
    const total = this.cart.reduce((sum, item) => sum + item.price, 0);
    cartDropdownTotal.textContent = (total / 100).toFixed(2);
  }

  /**
   * Render cart items list
   */
  renderCartItems() {
    const cartItems = document.getElementById('cart-items');
    cartItems.innerHTML = '';
    
    this.cart.forEach(item => {
      const li = document.createElement('li');
      const price = (item.price / 100).toFixed(2);
      
      li.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${this.escapeHtml(item.name)}</div>
          <div class="cart-item-price">$${price}</div>
        </div>
        <div class="cart-item-actions">
          <button class="remove-btn" data-product-id="${item.id}">
            <i class="fas fa-trash"></i> Remove
          </button>
        </div>
      `;
      
      // Add event listener directly to the button
      const removeBtn = li.querySelector('.remove-btn');
      removeBtn.addEventListener('click', () => {
        this.removeFromCart(item.id);
      });
      
      cartItems.appendChild(li);
    });
  }

  /**
   * Update cart totals display
   */
  updateCartTotals() {
    const subtotal = this.cart.reduce((sum, item) => sum + item.price, 0);
    const total = subtotal; // No tax for digital products

    document.getElementById('cart-subtotal').textContent = (subtotal / 100).toFixed(2);
    document.getElementById('cart-total').textContent = (total / 100).toFixed(2);
  }

  /**
   * Animate cart count update
   */
  animateCartUpdate() {
    const cartCount = document.getElementById('cart-count');
    cartCount.style.animation = 'none';
    setTimeout(() => {
      cartCount.style.animation = 'cartBounce 0.3s ease';
    }, 10);
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Checkout button
    const checkoutBtn = document.getElementById('checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', this.handleCheckout.bind(this));
    }

    // Clear cart button - show modal instead of browser confirm
    const clearCartBtn = document.getElementById('clear-cart-btn');
    if (clearCartBtn) {
      clearCartBtn.addEventListener('click', (e) => {
        e.preventDefault();
        console.log('Clear cart button clicked, cart length:', this.cart.length);
        if (this.cart.length > 0) {
          this.showClearCartModal();
        } else {
          console.log('Cart is empty, not showing modal');
        }
      });
    }

    // Category filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        this.handleCategoryFilter(e.target.dataset.category);
      });
    });

    // Cart dropdown functionality
    this.setupCartDropdown();
  }

  /**
   * Setup cart dropdown functionality
   */
  setupCartDropdown() {
    const cartDropdownBtn = document.getElementById('cart-dropdown-btn');
    const cartDropdownMenu = document.getElementById('cart-dropdown-menu');
    const closeDropdownBtn = document.getElementById('close-cart-dropdown');
    const dropdownCheckoutBtn = document.getElementById('cart-dropdown-checkout');
    const viewFullCartBtn = document.getElementById('view-full-cart');

    // Toggle dropdown
    if (cartDropdownBtn) {
      cartDropdownBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cartDropdownMenu.classList.toggle('show');
      });
    }

    // Close dropdown
    if (closeDropdownBtn) {
      closeDropdownBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cartDropdownMenu.classList.remove('show');
      });
    }

    // Dropdown checkout
    if (dropdownCheckoutBtn) {
      dropdownCheckoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cartDropdownMenu.classList.remove('show');
        this.handleCheckout();
      });
    }

    // View full cart
    if (viewFullCartBtn) {
      viewFullCartBtn.addEventListener('click', (e) => {
        e.preventDefault();
        cartDropdownMenu.classList.remove('show');
        document.getElementById('cart-section').scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!cartDropdownBtn.contains(e.target) && !cartDropdownMenu.contains(e.target)) {
        cartDropdownMenu.classList.remove('show');
      }
    });
  }

  /**
   * Setup modal event listeners
   */
  setupModalListeners() {
    this.setupPreviewModalListeners();
    this.setupReviewsModalListeners();
    this.setupWriteReviewModalListeners();
  }

  /**
   * Setup preview modal listeners
   */
  setupPreviewModalListeners() {
    const previewModal = document.getElementById('preview-modal');
    const closePreviewBtn = document.getElementById('close-preview-modal');

    if (closePreviewBtn) {
      closePreviewBtn.addEventListener('click', () => {
        this.hidePreviewModal();
      });
    }

    if (previewModal) {
      previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
          this.hidePreviewModal();
        }
      });
    }
  }

  /**
   * Setup reviews modal listeners
   */
  setupReviewsModalListeners() {
    const reviewsModal = document.getElementById('reviews-modal');
    const closeReviewsBtn = document.getElementById('close-reviews-modal');
    const writeReviewBtn = document.getElementById('write-review-btn');
    const loadMoreBtn = document.getElementById('load-more-reviews');

    if (closeReviewsBtn) {
      closeReviewsBtn.addEventListener('click', () => {
        this.hideReviewsModal();
      });
    }

    if (writeReviewBtn) {
      writeReviewBtn.addEventListener('click', () => {
        this.showWriteReviewModal();
      });
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => {
        this.loadMoreReviews();
      });
    }

    if (reviewsModal) {
      reviewsModal.addEventListener('click', (e) => {
        if (e.target === reviewsModal) {
          this.hideReviewsModal();
        }
      });
    }

    // Review filter buttons
    const reviewFilterBtns = document.querySelectorAll('.review-filter-btn');
    reviewFilterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.handleReviewFilter(btn.dataset.sort);
      });
    });
  }

  /**
   * Setup write review modal listeners
   */
  setupWriteReviewModalListeners() {
    const writeReviewModal = document.getElementById('write-review-modal');
    const closeWriteReviewBtn = document.getElementById('close-write-review-modal');
    const cancelReviewBtn = document.getElementById('cancel-review');
    const reviewForm = document.getElementById('review-form');

    if (closeWriteReviewBtn) {
      closeWriteReviewBtn.addEventListener('click', () => {
        this.hideWriteReviewModal();
      });
    }

    if (cancelReviewBtn) {
      cancelReviewBtn.addEventListener('click', () => {
        this.hideWriteReviewModal();
      });
    }

    if (writeReviewModal) {
      writeReviewModal.addEventListener('click', (e) => {
        if (e.target === writeReviewModal) {
          this.hideWriteReviewModal();
        }
      });
    }

    if (reviewForm) {
      reviewForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleReviewSubmission();
      });
    }

    // Star rating functionality
    this.setupStarRating();
  }

  /**
   * Setup star rating functionality
   */
  setupStarRating() {
    const starRating = document.querySelector('.star-rating');
    const ratingInput = document.getElementById('rating-value');

    if (starRating && ratingInput) {
      const stars = starRating.querySelectorAll('i');
      
      stars.forEach((star, index) => {
        star.addEventListener('click', () => {
          const rating = index + 1;
          ratingInput.value = rating;
          
          // Update visual state
          stars.forEach((s, i) => {
            if (i < rating) {
              s.classList.add('selected');
            } else {
              s.classList.remove('selected');
            }
          });
        });
        
        star.addEventListener('mouseenter', () => {
          const rating = index + 1;
          
          // Show hover state
          stars.forEach((s, i) => {
            if (i < rating) {
              s.style.color = '#fbbf24';
            } else {
              s.style.color = '#e2e8f0';
            }
          });
        });
      });
      
      starRating.addEventListener('mouseleave', () => {
        const currentRating = parseInt(ratingInput.value) || 0;
        
        // Restore selected state
        stars.forEach((s, i) => {
          if (i < currentRating) {
            s.style.color = '#fbbf24';
          } else {
            s.style.color = '#e2e8f0';
          }
        });
      });
    }
  }

  /**
   * Handle category filtering
   */
  handleCategoryFilter(category) {
    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-category="${category}"]`).classList.add('active');

    // Update current category and re-render
    this.currentCategory = category;
    this.renderProducts();

    // Track filter event
    this.trackEvent('filter_products', { category });
  }

  /**
   * Handle checkout process - Multiple items supported
   */
  async handleCheckout() {
    if (this.cart.length === 0) {
      alert('Your cart is empty! Please add some resources before checking out.');
      return;
    }

    const checkoutBtn = document.getElementById('checkout-btn');
    const checkoutText = document.getElementById('checkout-text');
    const checkoutSpinner = document.getElementById('checkout-spinner');

    try {
      console.log('Starting checkout process with cart:', this.cart);

      // Update UI to show processing
      checkoutBtn.disabled = true;
      checkoutText.innerHTML = '<i class="fas fa-sync fa-spin"></i> Processing...';
      checkoutSpinner.style.display = 'inline-block';

      // Track checkout initiation
      this.trackEvent('begin_checkout', {
        cart_value: this.cart.reduce((sum, item) => sum + item.price, 0),
        item_count: this.cart.length
      });

      // Call Stripe checkout function
      const response = await fetch('/.netlify/functions/stripe-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          cart: this.cart 
        })
      });

      console.log('Checkout response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Checkout error response:', errorText);
        
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch (e) {
          errorData = { error: 'Server error', details: errorText };
        }
        
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Checkout response data:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Clear cart and redirect to Stripe
      this.clearCart();
      window.location.href = data.url;

    } catch (error) {
      console.error('Checkout error:', error);
      
      // Show user-friendly error message
      let errorMessage = 'There was an error processing your checkout. ';
      if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage += 'Please check your internet connection and try again.';
      } else if (error.message.includes('400')) {
        errorMessage += 'Please verify your cart items and try again.';
      } else if (error.message.includes('Stripe not configured')) {
        errorMessage += 'Payment system is not properly configured. Please contact support.';
      } else {
        errorMessage += 'Please try again or contact support if the problem persists.';
      }
      
      alert(errorMessage);
      
      // Reset UI
      checkoutBtn.disabled = false;
      checkoutText.innerHTML = '<i class="fas fa-credit-card"></i> Secure Checkout';
      checkoutSpinner.style.display = 'none';

      // Track checkout error
      this.trackEvent('checkout_error', { error: error.message });
    }
  }

  /**
   * Save cart to localStorage
   */
  saveCart() {
    try {
      localStorage.setItem('stepitup_store_cart', JSON.stringify({
        items: this.cart,
        timestamp: new Date().getTime(),
        version: '2.0'
      }));
    } catch (error) {
      console.error('Error saving cart:', error);
    }
  }

  /**
   * Load cart from localStorage
   */
  loadCart() {
    try {
      const saved = localStorage.getItem('stepitup_store_cart');
      if (!saved) return [];

      const cartData = JSON.parse(saved);
      
      // Check if cart is expired (24 hours)
      const now = new Date().getTime();
      const cartAge = now - (cartData.timestamp || 0);
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      if (cartAge > maxAge) {
        localStorage.removeItem('stepitup_store_cart');
        return [];
      }

      return cartData.items || [];
    } catch (error) {
      console.error('Error loading cart:', error);
      localStorage.removeItem('stepitup_store_cart');
      return [];
    }
  }

  /**
   * Track analytics events
   */
  trackEvent(eventName, parameters = {}) {
    try {
      if (typeof gtag !== 'undefined') {
        gtag('event', eventName, parameters);
      }
      console.log('Tracked event:', eventName, parameters);
    } catch (error) {
      console.error('Error tracking event:', error);
    }
  }

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    if (typeof text !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Format price for display
   */
  formatPrice(cents) {
    return (cents / 100).toFixed(2);
  }

  // ==========================================
  // PREVIEW MODAL FUNCTIONALITY
  // ==========================================

  /**
   * Show preview modal for a product
   */
  async showPreviewModal(product) {
    const modal = document.getElementById('preview-modal');
    const modalTitle = document.getElementById('preview-modal-title');
    const previewLoading = document.getElementById('preview-loading');
    const previewContent = document.getElementById('preview-content');
    const previewError = document.getElementById('preview-error');

    // Set title
    modalTitle.textContent = `${product.name} - Preview`;

    // Show modal and loading state
    modal.classList.add('show');
    previewLoading.style.display = 'block';
    previewContent.style.display = 'none';
    previewError.style.display = 'none';

    try {
      // Fetch previews for this product
      const response = await fetch(`/.netlify/functions/get-previews?product_id=${product.id}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to load previews');
      }

      // Hide loading
      previewLoading.style.display = 'none';

      if (!data.previews || data.previews.length === 0) {
        // No previews available
        previewContent.innerHTML = `
          <div style="text-align: center; padding: 2em; color: #718096;">
            <i class="fas fa-eye-slash" style="font-size: 3em; margin-bottom: 0.5em; color: #cbd5e0;"></i>
            <p>No preview available for this resource.</p>
            <small>Preview will be added soon!</small>
          </div>
        `;
      } else {
        // Render previews
        this.renderPreviews(data.previews);
      }

      previewContent.style.display = 'block';

    } catch (error) {
      console.error('Error loading previews:', error);
      previewLoading.style.display = 'none';
      previewError.style.display = 'block';
    }
  }

  /**
   * Render preview content
   */
  renderPreviews(previews) {
    const previewImages = document.getElementById('preview-images');
    const previewPdf = document.getElementById('preview-pdf');
    const previewVideo = document.getElementById('preview-video');

    // Clear previous content
    previewImages.innerHTML = '';
    previewPdf.innerHTML = '';
    previewVideo.innerHTML = '';

    previews.forEach(preview => {
      switch (preview.preview_type) {
        case 'image':
          const img = document.createElement('img');
          img.src = preview.preview_url;
          img.alt = preview.description || 'Preview image';
          img.style.maxWidth = '100%';
          img.style.borderRadius = '8px';
          img.style.marginBottom = '1em';
          previewImages.appendChild(img);
          break;

        case 'pdf':
          previewPdf.innerHTML = `
            <iframe src="${preview.preview_url}" 
                    width="100%" 
                    height="500" 
                    style="border: none; border-radius: 8px;">
            </iframe>
          `;
          break;

        case 'video':
          previewVideo.innerHTML = `
            <video controls style="width: 100%; border-radius: 8px;">
              <source src="${preview.preview_url}" type="video/mp4">
              Your browser does not support the video tag.
            </video>
          `;
          break;
      }
    });
  }

  /**
   * Hide preview modal
   */
  hidePreviewModal() {
    const modal = document.getElementById('preview-modal');
    modal.classList.remove('show');
  }

  // ==========================================
  // REVIEWS MODAL FUNCTIONALITY
  // ==========================================

  /**
   * Show reviews modal for a product
   */
  async showReviewsModal(product) {
    const modal = document.getElementById('reviews-modal');
    const modalTitle = document.getElementById('reviews-modal-title');

    // Set current product and reset offset
    this.currentProductForReview = product;
    this.reviewsOffset = 0;

    // Set title
    modalTitle.textContent = `${product.name} - Reviews`;

    // Show modal
    modal.classList.add('show');

    // Load reviews
    await this.loadReviews(true);
  }

  /**
   * Load reviews for current product
   */
  async loadReviews(isInitial = false) {
    const reviewsLoading = document.getElementById('reviews-loading');
    const reviewsList = document.getElementById('reviews-list');
    const reviewsError = document.getElementById('reviews-error');
    const noReviews = document.getElementById('no-reviews');
    const loadMoreBtn = document.getElementById('load-more-reviews');

    if (isInitial) {
      reviewsLoading.style.display = 'block';
      reviewsList.style.display = 'none';
      reviewsError.style.display = 'none';
      noReviews.style.display = 'none';
      loadMoreBtn.style.display = 'none';
    }

    try {
      const currentSort = document.querySelector('.review-filter-btn.active')?.dataset.sort || 'recent';
      const response = await fetch(`/.netlify/functions/get-reviews?product_id=${this.currentProductForReview.id}&limit=${this.reviewsLimit}&offset=${this.reviewsOffset}&sort=${currentSort}`);
      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to load reviews');
      }

      if (isInitial) {
        reviewsLoading.style.display = 'none';
        
        // Update review stats
        this.updateReviewStats(data.stats);

        if (!data.reviews || data.reviews.length === 0) {
          noReviews.style.display = 'block';
          return;
        }

        // Clear existing reviews
        reviewsList.innerHTML = '';
      }

      // Render reviews
      this.renderReviews(data.reviews, isInitial);
      reviewsList.style.display = 'block';

      // Show/hide load more button
      if (data.pagination.has_more) {
        loadMoreBtn.style.display = 'block';
      } else {
        loadMoreBtn.style.display = 'none';
      }

    } catch (error) {
      console.error('Error loading reviews:', error);
      if (isInitial) {
        reviewsLoading.style.display = 'none';
        reviewsError.style.display = 'block';
      }
    }
  }

  /**
   * Update review statistics display
   */
  updateReviewStats(stats) {
    const averageRating = document.getElementById('average-rating');
    const totalReviews = document.getElementById('total-reviews');
    const ratingStars = document.getElementById('rating-stars');

    averageRating.textContent = stats.average_rating;
    totalReviews.textContent = stats.total_reviews;

    // Update star display
    ratingStars.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement('i');
      star.className = i <= Math.round(stats.average_rating) ? 'fas fa-star' : 'fas fa-star empty';
      ratingStars.appendChild(star);
    }

    // Update rating breakdown
    for (let rating = 1; rating <= 5; rating++) {
      const count = stats.rating_distribution[rating] || 0;
      const percentage = stats.total_reviews > 0 ? (count / stats.total_reviews) * 100 : 0;
      
      const fillElement = document.querySelector(`.rating-bar-fill[data-rating="${rating}"]`);
      const countElement = document.querySelector(`.rating-count[data-rating="${rating}"]`);
      
      if (fillElement) {
        fillElement.style.width = `${percentage}%`;
      }
      if (countElement) {
        countElement.textContent = count;
      }
    }
  }

  /**
   * Render reviews
   */
  renderReviews(reviews, isInitial) {
    const reviewsList = document.getElementById('reviews-list');

    reviews.forEach(review => {
      const reviewElement = this.createReviewElement(review);
      reviewsList.appendChild(reviewElement);
    });
  }

  /**
   * Create review element
   */
  createReviewElement(review) {
    const reviewDiv = document.createElement('div');
    reviewDiv.className = 'review-item';

    const reviewDate = new Date(review.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });

    const stars = Array.from({length: 5}, (_, i) => 
      `<i class="fas fa-star ${i < review.rating ? '' : 'empty'}"></i>`
    ).join('');

    const verifiedBadge = review.purchase_verified 
      ? '<span class="verified-purchase"><i class="fas fa-check-circle"></i> Verified Purchase</span>'
      : '';

    const sellerResponse = review.response_from_seller 
      ? `<div class="seller-response">
           <div class="seller-response-header">
             <i class="fas fa-reply"></i> Response from Step it Up Learning
           </div>
           <p class="seller-response-text">${this.escapeHtml(review.response_from_seller)}</p>
         </div>`
      : '';

    reviewDiv.innerHTML = `
      <div class="review-header">
        <div class="reviewer-info">
          <div class="reviewer-avatar">
            ${review.customer_name.charAt(0).toUpperCase()}
          </div>
          <div class="reviewer-details">
            <h4>${this.escapeHtml(review.customer_name)}</h4>
            <div class="reviewer-meta">
              <div class="review-rating">${stars}</div>
              <span>${reviewDate}</span>
              ${verifiedBadge}
            </div>
          </div>
        </div>
      </div>
      <div class="review-content">
        ${review.review_title ? `<h5>${this.escapeHtml(review.review_title)}</h5>` : ''}
        ${review.review_text ? `<p class="review-text">${this.escapeHtml(review.review_text)}</p>` : ''}
      </div>
      <div class="review-actions">
        <button class="helpful-btn" onclick="storeManager.markReviewHelpful('${review.id}')">
          <i class="fas fa-thumbs-up"></i> Helpful (${review.helpful_votes})
        </button>
      </div>
      ${sellerResponse}
    `;

    return reviewDiv;
  }

  /**
   * Handle review filter change
   */
  async handleReviewFilter(sortType) {
    // Update active filter button
    document.querySelectorAll('.review-filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-sort="${sortType}"]`).classList.add('active');

    // Reset offset and reload reviews
    this.reviewsOffset = 0;
    await this.loadReviews(true);
  }

  /**
   * Load more reviews
   */
  async loadMoreReviews() {
    this.reviewsOffset += this.reviewsLimit;
    await this.loadReviews(false);
  }

  /**
   * Mark review as helpful
   */
  async markReviewHelpful(reviewId) {
    // This would typically require user authentication
    // For now, just show a message
    alert('Thank you for your feedback! Feature coming soon.');
  }

  /**
   * Hide reviews modal
   */
  hideReviewsModal() {
    const modal = document.getElementById('reviews-modal');
    modal.classList.remove('show');
  }

  // ==========================================
  // WRITE REVIEW MODAL FUNCTIONALITY
  // ==========================================

  /**
   * Show write review modal
   */
  showWriteReviewModal() {
    const modal = document.getElementById('write-review-modal');
    
    // Reset form
    const form = document.getElementById('review-form');
    if (form) {
      form.reset();
      document.getElementById('rating-value').value = '';
      
      // Reset star rating visual state
      const stars = document.querySelectorAll('.star-rating i');
      stars.forEach(star => {
        star.classList.remove('selected');
        star.style.color = '#e2e8f0';
      });
    }

    modal.classList.add('show');
  }

  /**
   * Handle review submission
   */
  async handleReviewSubmission() {
    const submitBtn = document.getElementById('submit-review');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    // Get form data
    const formData = new FormData(document.getElementById('review-form'));
    const reviewData = {
      product_id: this.currentProductForReview.id,
      customer_name: formData.get('name'),
      customer_email: formData.get('email'),
      rating: parseInt(formData.get('rating')),
      review_title: formData.get('title'),
      review_text: formData.get('review'),
      stripe_session_id: formData.get('session_id')
    };

    // Validate required fields
    if (!reviewData.customer_name || !reviewData.customer_email || !reviewData.rating) {
      alert('Please fill in all required fields and select a rating.');
      return;
    }

    try {
      // Show loading state
      submitBtn.disabled = true;
      btnText.style.display = 'none';
      btnSpinner.style.display = 'inline-block';

      const response = await fetch('/.netlify/functions/submit-product-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(reviewData)
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error || 'Failed to submit review');
      }

      // Success
      alert('Thank you for your review! It has been submitted successfully.');
      this.hideWriteReviewModal();
      
      // Reload reviews to show the new one
      this.reviewsOffset = 0;
      await this.loadReviews(true);

    } catch (error) {
      console.error('Error submitting review:', error);
      alert(`Error submitting review: ${error.message}`);
    } finally {
      // Reset button state
      submitBtn.disabled = false;
      btnText.style.display = 'inline';
      btnSpinner.style.display = 'none';
    }
  }

  /**
   * Hide write review modal
   */
  hideWriteReviewModal() {
    const modal = document.getElementById('write-review-modal');
    modal.classList.remove('show');
  }
}

// Initialize store when DOM is loaded
let storeManager;

document.addEventListener('DOMContentLoaded', () => {
  storeManager = new StoreManager();
});

// Make storeManager globally available for onclick handlers
window.storeManager = storeManager;

// Handle offline/online status
window.addEventListener('online', () => {
  console.log('Back online');
});

window.addEventListener('offline', () => {
  console.log('Gone offline');
});

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoreManager;
}