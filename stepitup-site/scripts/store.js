/**
 * Store Management System
 * Handles product display, cart functionality, and checkout process
 */

class StoreManager {
  constructor() {
    this.cart = this.loadCart();
    this.products = [];
    this.currentCategory = 'all';
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
      <div class="no-products" style="grid-column: 1 / -1;">
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
      <div class="no-products" style="grid-column: 1 / -1;">
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
    
    card.innerHTML = `
      <div class="product-image">
        <i class="${productIcon}"></i>
      </div>
      <div class="product-content">
        <h3>${this.escapeHtml(product.name)}</h3>
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
    // Check if product already exists in cart
    const existingItemIndex = this.cart.findIndex(item => item.id === product.id);
    
    if (existingItemIndex > -1) {
      this.cart[existingItemIndex].quantity += 1;
    } else {
      this.cart.push({
        ...product,
        quantity: 1,
        addedAt: new Date().toISOString()
      });
    }

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
   * Update cart item quantity
   */
  updateCartQuantity(productId, quantity) {
    const item = this.cart.find(item => item.id === productId);
    if (item) {
      if (quantity <= 0) {
        this.removeFromCart(productId);
      } else {
        item.quantity = quantity;
        this.saveCart();
        this.renderCart();
      }
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
   * Render shopping cart
   */
  renderCart() {
    const cartSection = document.getElementById('cart-section');
    const cartEmpty = document.getElementById('cart-empty');
    const cartContent = document.getElementById('cart-content');
    const cartCount = document.getElementById('cart-count');

    // Update cart count
    const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
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
      const totalPrice = ((item.price * item.quantity) / 100).toFixed(2);
      
      li.innerHTML = `
        <div class="cart-item-info">
          <div class="cart-item-name">${this.escapeHtml(item.name)}</div>
          <div class="cart-item-price">$${price} each</div>
        </div>
        <div class="cart-item-actions">
          <div class="quantity-controls">
            <button class="quantity-btn" onclick="storeManager.updateCartQuantity('${item.id}', ${item.quantity - 1})">-</button>
            <span class="quantity">${item.quantity}</span>
            <button class="quantity-btn" onclick="storeManager.updateCartQuantity('${item.id}', ${item.quantity + 1})">+</button>
          </div>
          <button class="remove-btn" onclick="storeManager.removeFromCart('${item.id}')">
            <i class="fas fa-trash"></i> Remove
          </button>
        </div>
      `;
      
      cartItems.appendChild(li);
    });
  }

  /**
   * Update cart totals display
   */
  updateCartTotals() {
    const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const total = subtotal; // Add tax/shipping calculations here if needed

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

    // Clear cart button
    const clearCartBtn = document.getElementById('clear-cart-btn');
    if (clearCartBtn) {
      clearCartBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear your cart? This action cannot be undone.')) {
          this.clearCart();
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
   * Handle checkout process
   */
  async handleCheckout() {
    if (this.cart.length === 0) {
      alert('Your cart is empty! Please add some resources before checking out.');
      return;
    }

    // For now, only allow single-item purchases to simplify delivery
    if (this.cart.length > 1) {
      alert('Currently, only one resource can be purchased at a time. Please remove other items from your cart or complete separate purchases.');
      return;
    }

    const checkoutBtn = document.getElementById('checkout-btn');
    const checkoutText = document.getElementById('checkout-text');
    const checkoutSpinner = document.getElementById('checkout-spinner');

    try {
      // Update UI to show processing
      checkoutBtn.disabled = true;
      checkoutText.innerHTML = '<i class="fas fa-sync fa-spin"></i> Processing...';
      checkoutSpinner.style.display = 'inline-block';

      // Track checkout initiation
      this.trackEvent('begin_checkout', {
        cart_value: this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0),
        item_count: this.cart.reduce((sum, item) => sum + item.quantity, 0)
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

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
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

// Add styles for improved UX
const additionalStyles = document.createElement('style');
additionalStyles.textContent = `
  .no-products {
    text-align: center;
    padding: 4em 2em;
    color: #718096;
    background: #f7fafc;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
  }
  
  .no-products i {
    font-size: 4em;
    color: #cbd5e0;
    margin-bottom: 1em;
    display: block;
  }

  .no-products h3 {
    color: #4a5568;
    margin: 0.5em 0;
  }

  .product-card.fade-in {
    animation: fadeInUp 0.5s ease forwards;
  }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .cart-item-actions {
    flex-wrap: wrap;
    gap: 0.8em;
  }

  @media (max-width: 600px) {
    .cart-item-actions {
      width: 100%;
      justify-content: space-between;
      margin-top: 1em;
    }
    
    .quantity-controls {
      order: 1;
    }
    
    .remove-btn {
      order: 2;
    }
  }
`;

document.head.appendChild(additionalStyles);

// Handle offline/online status
window.addEventListener('online', () => {
  console.log('Back online');
  // Optionally refresh products or show notification
});

window.addEventListener('offline', () => {
  console.log('Gone offline');
  // Optionally show offline notification
});

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StoreManager;
}