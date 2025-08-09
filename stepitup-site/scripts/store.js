/**
 * Store Management System
 * Handles product display, cart functionality, and checkout process
 */

class StoreManager {
  constructor() {
    this.cart = this.loadCart();
    this.products = [];
    this.currentCategory = 'all';
    this.modalCreated = false;
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
      this.setupEventListeners();
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
        <button class="add-to-cart-btn" data-product-id="${product.id}">
          <i class="fas fa-shopping-cart"></i> Add to Cart
        </button>
      </div>
    `;

    // Add click event listener
    const addButton = card.querySelector('.add-to-cart-btn');
    addButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.addToCart(product);
      this.showAddedFeedback(addButton);
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