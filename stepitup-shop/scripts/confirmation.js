/**
 * Confirmation Page Manager
 * Handles order processing and download functionality after successful payment
 */

class ConfirmationManager {
  constructor() {
    this.sessionId = null;
    this.orderData = null;
    this.downloadUrls = []; // Changed to array for multiple downloads
    this.products = []; // Store product information
    this.init();
  }

  /**
   * Initialize the confirmation page
   */
  init() {
    // Get session ID from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    this.sessionId = urlParams.get('session_id');

    // Display session ID for reference
    const sessionIdElement = document.getElementById('session-id');
    if (sessionIdElement) {
      sessionIdElement.textContent = this.sessionId || 'Not available';
    }

    if (!this.sessionId) {
      this.showError('No session found. If you completed a purchase, please contact support with your order details.');
      return;
    }

    // Track page view
    this.trackEvent('view_purchase_confirmation', { session_id: this.sessionId });

    this.processOrder();
  }

  /**
   * Process the order and generate download links
   */
  async processOrder() {
    try {
      this.showProcessingState();

      // Call the send-link-and-invoice function
      const response = await fetch(`/.netlify/functions/send-link-and-invoice?session_id=${this.sessionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('Received order data:', data);
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Handle both old single-download format and new multi-download format
      if (data.signedUrls && Array.isArray(data.signedUrls)) {
        // New format - multiple downloads
        this.downloadUrls = data.signedUrls;
        this.products = data.products || [];
      } else if (data.signedUrl) {
        // Old format - single download (backward compatibility)
        this.downloadUrls = [{ 
          productName: data.productName || 'Educational Resource', 
          signedUrl: data.signedUrl 
        }];
        this.products = [{ name: data.productName || 'Educational Resource' }];
      } else {
        throw new Error('No download links received');
      }

      this.orderData = {
        products: this.products,
        sessionId: this.sessionId,
        downloadCount: this.downloadUrls.length
      };

      this.showSuccessState();
      this.setupDownloadButtons();
      this.showCelebration();

      // Track successful order processing
      this.trackEvent('purchase_complete', {
        session_id: this.sessionId,
        product_count: this.products.length
      });

    } catch (error) {
      console.error('Order processing error:', error);
      this.showError(error.message);
      
      // Track error
      this.trackEvent('purchase_processing_error', {
        session_id: this.sessionId,
        error: error.message
      });
    }
  }

  /**
   * Show processing state
   */
  showProcessingState() {
    document.getElementById('order-processing').style.display = 'block';
    document.getElementById('order-complete').style.display = 'none';
    document.getElementById('order-error').style.display = 'none';
  }

  /**
   * Show success state with order details - Updated for multiple products
   */
  showSuccessState() {
    document.getElementById('order-processing').style.display = 'none';
    document.getElementById('order-complete').style.display = 'block';
    document.getElementById('order-error').style.display = 'none';

    // Update order details for multiple products
    const orderDetails = document.getElementById('order-details');
    if (orderDetails && this.orderData) {
      const productItems = this.products.map(product => `
        <div class="order-item">
          <div class="order-item-name">
            <i class="fas fa-file-download"></i>
            ${this.escapeHtml(product.name || 'Educational Resource')}
          </div>
          <div class="order-item-status">
            <i class="fas fa-check-circle"></i>
            Ready for Download
          </div>
        </div>
      `).join('');

      orderDetails.innerHTML = `
        ${productItems}
        <div class="order-meta">
          <p><strong>Order ID:</strong> ${this.sessionId}</p>
          <p><strong>Items:</strong> ${this.products.length} resource${this.products.length > 1 ? 's' : ''}</p>
          <p><strong>Status:</strong> <span class="status-complete">Complete</span></p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
      `;
    }

    // Update page title
    const itemText = this.products.length === 1 ? 'Purchase' : `${this.products.length} Resources`;
    document.title = `${itemText} Complete - Step it Up Learning`;
  }

  /**
   * Show error state
   */
  showError(message) {
    document.getElementById('order-processing').style.display = 'none';
    document.getElementById('order-complete').style.display = 'none';
    document.getElementById('order-error').style.display = 'block';
    
    const errorMessage = document.getElementById('error-message');
    if (errorMessage) {
      errorMessage.textContent = message;
    }

    // Update page title
    document.title = 'Order Issue - Step it Up Learning';
  }

  /**
   * Setup download button functionality - Updated for multiple products
   */
  setupDownloadButtons() {
    const downloadContainer = document.getElementById('download-container') || 
                            document.querySelector('.download-section');
    
    if (!downloadContainer || this.downloadUrls.length === 0) return;

    console.log('🔧 Setting up download buttons for', this.downloadUrls.length, 'items');

    // Remove any existing download buttons
    const existingButtons = downloadContainer.querySelectorAll('.download-btn');
    existingButtons.forEach(btn => btn.remove());

    // Always show download buttons, whether single or multiple
    if (this.downloadUrls.length === 1) {
      console.log('🔧 Setting up SINGLE download buttons');
      // Single download - use both existing button AND create enhanced section
      this.setupSingleDownloadButton();
      this.setupEnhancedSingleDownload();
    } else {
      console.log('🔧 Setting up MULTIPLE download buttons');
      // Multiple downloads - create individual buttons
      this.setupMultipleDownloadButtons();
    }
  }

  /**
   * Setup single download button (existing functionality)
   */
  setupSingleDownloadButton() {
    const downloadBtn = document.getElementById('download-btn');
    console.log('🔧 Setting up main download button:', !!downloadBtn);
    
    if (!downloadBtn || this.downloadUrls.length === 0) {
      console.log('❌ No download button found or no download URLs');
      return;
    }

    const downloadItem = this.downloadUrls[0];
    console.log('🔧 Download item:', downloadItem.productName);
    
    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('🖱️ Main download button clicked');
      await this.handleSingleDownload(downloadItem, downloadBtn);
    });
  }

  /**
   * Setup enhanced single download section (like multi-download but for one item)
   */
  setupEnhancedSingleDownload() {
    const downloadContainer = document.getElementById('download-container') || 
                            document.querySelector('.download-section');
    
    if (!downloadContainer || this.downloadUrls.length === 0) return;

    const downloadItem = this.downloadUrls[0];

    // Create enhanced download section for single item
    const singleDownloadSection = document.createElement('div');
    singleDownloadSection.className = 'enhanced-single-download-section';
    singleDownloadSection.innerHTML = `
      <h3><i class="fas fa-download"></i> Download Your Resource</h3>
      <p>Your educational resource is ready for download:</p>
      <div class="single-download-card">
        <div class="download-card-content">
          <i class="fas fa-file-download"></i>
          <div class="download-card-info">
            <h4>${this.escapeHtml(downloadItem.productName)}</h4>
            <p>Educational Resource</p>
          </div>
        </div>
        <button class="enhanced-single-download-btn" id="enhanced-single-download-btn">
          <i class="fas fa-download"></i>
          <span>Download</span>
        </button>
      </div>
    `;

    // Setup the enhanced download button
    const enhancedBtn = singleDownloadSection.querySelector('#enhanced-single-download-btn');
    enhancedBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.handleSingleDownload(downloadItem, enhancedBtn);
    });

    downloadContainer.appendChild(singleDownloadSection);
  }

  /**
   * Setup multiple download buttons
   */
  setupMultipleDownloadButtons() {
    const downloadContainer = document.getElementById('download-container') || 
                            document.querySelector('.download-section');
    
    if (!downloadContainer) return;

    // Hide the default single download button
    const defaultBtn = document.getElementById('download-btn');
    if (defaultBtn) {
      defaultBtn.style.display = 'none';
    }

    // Create download section
    const multiDownloadSection = document.createElement('div');
    multiDownloadSection.className = 'multi-download-section';
    multiDownloadSection.innerHTML = `
      <h3><i class="fas fa-download"></i> Download Your Resources</h3>
      <p>Click each button below to download your educational resources:</p>
      <div class="download-buttons-grid"></div>
      <div class="download-all-section">
        <button class="download-all-btn" id="download-all-btn">
          <i class="download-all-icon fas fa-file-archive"></i>
          <span class="download-all-text">Download All as Zip (${this.downloadUrls.length} files)</span>
        </button>
        <p class="download-note">All files will be packaged into a single zip file for easy download.</p>
      </div>
    `;

    const buttonsGrid = multiDownloadSection.querySelector('.download-buttons-grid');
    
    // Create individual download buttons
    this.downloadUrls.forEach((downloadItem, index) => {
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'individual-download-btn';
      downloadBtn.innerHTML = `
        <div class="download-btn-content">
          <i class="fas fa-file-download"></i>
          <span class="download-text">${this.escapeHtml(downloadItem.productName)}</span>
          <div class="download-spinner" style="display: none;"><i class="fas fa-sync fa-spin"></i></div>
        </div>
      `;
      
      downloadBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.handleSingleDownload(downloadItem, downloadBtn);
      });

      buttonsGrid.appendChild(downloadBtn);
    });

    // Setup download all button
    const downloadAllBtn = multiDownloadSection.querySelector('#download-all-btn');
    downloadAllBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.handleDownloadAll();
    });

    downloadContainer.appendChild(multiDownloadSection);
  }

  /**
   * Handle single download
   */
  async handleSingleDownload(downloadItem, button) {
    // For the main download button, look for specific IDs first, then class names
    const buttonText = button.querySelector('#download-text') || button.querySelector('.download-text');
    const buttonSpinner = button.querySelector('#download-spinner') || button.querySelector('.download-spinner');
    const originalText = buttonText ? buttonText.innerHTML : button.innerHTML;

    console.log('🔍 Download button debug:', {
      buttonId: button.id,
      hasButtonText: !!buttonText,
      hasButtonSpinner: !!buttonSpinner,
      textContent: buttonText?.textContent,
      spinnerDisplay: buttonSpinner?.style.display,
      downloadItem: downloadItem
    });

    // Function to reset button state
    const resetButton = () => {
      console.log('🔄 Resetting button state');
      button.disabled = false;
      if (buttonText && buttonSpinner) {
        buttonText.style.display = 'inline-block';
        buttonSpinner.style.display = 'none';
      } else if (buttonText) {
        buttonText.innerHTML = originalText;
      } else {
        button.innerHTML = originalText;
      }
    };

    try {
      // Update UI to show loading
      button.disabled = true;
      
      if (buttonText && buttonSpinner) {
        // For the main download button with separate text and spinner elements
        console.log('🔄 Showing spinner for main button');
        buttonText.style.display = 'none';
        buttonSpinner.style.display = 'inline-block';
      } else if (buttonText) {
        // For other buttons with embedded text
        console.log('🔄 Showing spinner for other button');
        buttonText.innerHTML = '<i class="fas fa-sync fa-spin"></i> Preparing...';
      } else {
        // Fallback - modify the entire button
        console.log('🔄 Showing spinner fallback');
        button.innerHTML = '<i class="fas fa-sync fa-spin"></i> Preparing...';
      }

      // Validate download URL
      if (!downloadItem || !downloadItem.signedUrl) {
        throw new Error('No download URL available');
      }

      console.log('⬇️ Starting download:', downloadItem.productName);

      // Track download initiation
      this.trackEvent('download_initiated', {
        session_id: this.sessionId,
        product_name: downloadItem.productName
      });

      // Small delay for better UX
      await new Promise(resolve => setTimeout(resolve, 800));

      // Create and trigger download
      const link = document.createElement('a');
      link.href = downloadItem.signedUrl;
      link.download = downloadItem.productName || 'download';
      link.target = '_blank';
      link.style.display = 'none';
      
      // Add the link to DOM
      document.body.appendChild(link);
      
      // Trigger the download
      link.click();
      console.log('✅ Download triggered for:', downloadItem.productName);

      // Cleanup immediately
      document.body.removeChild(link);

      // Show success and reset after short delay
      setTimeout(() => {
        if (buttonText && buttonSpinner) {
          buttonSpinner.style.display = 'none';
          buttonText.innerHTML = '<i class="fas fa-check"></i> Downloaded!';
          buttonText.style.display = 'inline-block';
        } else if (buttonText) {
          buttonText.innerHTML = '<i class="fas fa-check"></i> Downloaded!';
        } else {
          button.innerHTML = '<i class="fas fa-check"></i> Downloaded!';
        }
        button.style.background = '#48bb78';

        // Track successful download
        this.trackEvent('download_success', {
          session_id: this.sessionId,
          product_name: downloadItem.productName
        });
      }, 500);

      // Reset to original state after showing success
      setTimeout(() => {
        resetButton();
        button.style.background = '';
      }, 3000);

    } catch (error) {
      console.error('Download error:', error);
      
      // Reset UI and show error
      button.disabled = false;
      if (buttonText && buttonSpinner) {
        // For the main download button with separate text and spinner elements
        buttonSpinner.style.display = 'none';
        buttonText.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
        buttonText.style.display = 'inline-block';
      } else if (buttonText) {
        // For other buttons with embedded text
        buttonText.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Failed';
      }
      button.style.background = '#e53e3e';
      
      alert(`Download failed for ${downloadItem.productName}. Please try again or contact support.`);
      
      // Track download error
      this.trackEvent('download_error', {
        session_id: this.sessionId,
        product_name: downloadItem.productName,
        error: error.message
      });

      // Reset button after delay
      setTimeout(() => {
        if (button && buttonText) {
          button.style.background = '';
          if (buttonSpinner) {
            buttonSpinner.style.display = 'none';
            buttonText.style.display = 'inline-block';
          }
          buttonText.innerHTML = originalText;
        }
      }, 3000);
    }
  }

  /**
   * Handle download all functionality - Using server-side zip
   */
  async handleDownloadAll() {
    const downloadAllBtn = document.getElementById('download-all-btn');
    const buttonText = downloadAllBtn.querySelector('.download-all-text');
    const buttonIcon = downloadAllBtn.querySelector('.download-all-icon');
    const originalText = buttonText.innerHTML;
    const originalIconClass = buttonIcon.className;

    try {
      // Update UI to show loading
      downloadAllBtn.disabled = true;
      buttonText.innerHTML = 'Creating zip file...';
      buttonIcon.className = 'download-all-icon fas fa-spinner fa-spin';

      // Track download all initiation
      this.trackEvent('download_all_initiated', {
        session_id: this.sessionId,
        file_count: this.downloadUrls.length
      });

      // Call the zip download function
      const response = await fetch(`/.netlify/functions/download-all?session_id=${this.sessionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Update button to show download starting
      buttonText.innerHTML = 'Downloading zip file...';
      buttonIcon.className = 'download-all-icon fas fa-download fa-pulse';

      // Get the filename from the response headers
      const contentDisposition = response.headers.get('content-disposition');
      let filename = `StepItUp_Resources_${this.sessionId.substring(0, 8)}.zip`;
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      // Create blob from response
      const blob = await response.blob();
      
      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Cleanup the blob URL
      window.URL.revokeObjectURL(url);

      // Update button to show success
      buttonText.innerHTML = 'Zip Downloaded!';
      buttonIcon.className = 'download-all-icon fas fa-check';
      downloadAllBtn.style.background = '#48bb78';

      // Track successful download all
      this.trackEvent('download_all_success', {
        session_id: this.sessionId,
        file_count: this.downloadUrls.length,
        download_type: 'zip'
      });

      // Show download instructions for zip
      this.showZipDownloadInstructions();

      // Reset button after delay
      setTimeout(() => {
        downloadAllBtn.disabled = false;
        downloadAllBtn.style.background = '';
        buttonText.innerHTML = originalText;
        buttonIcon.className = originalIconClass;
      }, 5000);

    } catch (error) {
      console.error('Download all error:', error);
      
      // Reset UI and show error
      downloadAllBtn.disabled = false;
      buttonText.innerHTML = 'Download Failed';
      buttonIcon.className = 'download-all-icon fas fa-exclamation-triangle';
      downloadAllBtn.style.background = '#e53e3e';
      
      alert('Failed to create zip file. Please try downloading individual files or contact support if the problem persists.');
      
      // Track download all error
      this.trackEvent('download_all_error', {
        session_id: this.sessionId,
        error: error.message
      });

      // Reset button after delay
      setTimeout(() => {
        downloadAllBtn.style.background = '';
        buttonText.innerHTML = originalText;
        buttonIcon.className = originalIconClass;
      }, 3000);
    }
  }

  /**
   * Show download instructions for zip file
   */
  showZipDownloadInstructions() {
    const instructionsHtml = `
      <div class="download-success-message">
        <div class="success-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h4>Zip File Downloaded!</h4>
        <p>Your ${this.downloadUrls.length} resource${this.downloadUrls.length > 1 ? 's have' : ' has'} been packaged into a single zip file. If the download doesn't start:</p>
        <ul>
          <li>Check your browser's download settings</li>
          <li>Look for the zip file in your Downloads folder</li>
          <li>Extract the zip file to access your individual resources</li>
          <li>Try clicking the "Download All" button again</li>
        </ul>
        <p><strong>Need help?</strong> Contact us at <a href="mailto:info@stepituplearning.ca">info@stepituplearning.ca</a></p>
      </div>
    `;

    const downloadSection = document.querySelector('.download-section') || document.querySelector('.multi-download-section');
    if (downloadSection) {
      // Remove any existing success messages
      const existingSuccess = downloadSection.querySelector('.download-success');
      if (existingSuccess) existingSuccess.remove();

      const successDiv = document.createElement('div');
      successDiv.innerHTML = instructionsHtml;
      successDiv.className = 'download-success';
      downloadSection.appendChild(successDiv);
    }
  }

  /**
   * Show download instructions after successful download
   */
  showDownloadInstructions() {
    const instructionsHtml = `
      <div class="download-success-message">
        <div class="success-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <h4>Downloads Successful!</h4>
        <p>Your ${this.downloadUrls.length} resource${this.downloadUrls.length > 1 ? 's' : ''} should be downloading now. If any don't start:</p>
        <ul>
          <li>Check your browser's download settings</li>
          <li>Look for the files in your Downloads folder</li>
          <li>Try clicking the individual download buttons again</li>
        </ul>
        <p><strong>Need help?</strong> Contact us at <a href="mailto:info@stepituplearning.ca">info@stepituplearning.ca</a></p>
      </div>
    `;

    const downloadSection = document.querySelector('.download-section') || document.querySelector('.multi-download-section');
    if (downloadSection) {
      // Remove any existing success messages
      const existingSuccess = downloadSection.querySelector('.download-success');
      if (existingSuccess) existingSuccess.remove();

      const successDiv = document.createElement('div');
      successDiv.innerHTML = instructionsHtml;
      successDiv.className = 'download-success';
      downloadSection.appendChild(successDiv);
    }
  }

  /**
   * Show celebration effects
   */
  showCelebration() {
    this.createConfetti();
    this.addCelebrationStyles();
  }

  /**
   * Create confetti animation
   */
  createConfetti() {
    const colors = ['#2c77cc', '#48bb78', '#f6ad55', '#667eea', '#764ba2'];
    const confettiCount = this.downloadUrls.length > 1 ? 100 : 60; // More confetti for multiple items

    for (let i = 0; i < confettiCount; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti-piece';
        confetti.style.cssText = `
          position: fixed;
          width: 8px;
          height: 8px;
          background: ${colors[Math.floor(Math.random() * colors.length)]};
          left: ${Math.random() * 100}vw;
          top: -10px;
          z-index: 1000;
          pointer-events: none;
          border-radius: 50%;
          animation: confetti-fall ${3 + Math.random() * 2}s linear forwards;
        `;
        
        document.body.appendChild(confetti);
        
        // Remove confetti after animation
        setTimeout(() => {
          if (confetti.parentNode) {
            confetti.parentNode.removeChild(confetti);
          }
        }, 6000);
      }, i * 80);
    }
  }

  /**
   * Add celebration styles - Updated for multiple downloads
   */
  addCelebrationStyles() {
    if (document.getElementById('celebration-styles')) return;

    const style = document.createElement('style');
    style.id = 'celebration-styles';
    style.textContent = `
      @keyframes confetti-fall {
        to {
          transform: translateY(100vh) rotate(720deg);
          opacity: 0;
        }
      }
      
      .multi-download-section {
        background: #f7fafc;
        border: 2px solid #2c77cc;
        border-radius: 12px;
        padding: 2em;
        margin: 2em 0;
        text-align: center;
      }
      
      .multi-download-section h3 {
        color: #2c77cc;
        margin: 0 0 1em 0;
      }
      
      .multi-download-section p {
        color: #4a5568;
        margin: 0 0 1.5em 0;
      }
      
      .download-buttons-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1em;
        margin: 1.5em 0;
      }
      
      .individual-download-btn {
        background: #2c77cc;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 1em;
        cursor: pointer;
        transition: all 0.3s ease;
        font-weight: 500;
      }
      
      .individual-download-btn:hover:not(:disabled) {
        background: #2563eb;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(44, 119, 204, 0.3);
      }
      
      .individual-download-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
      }
      
      .download-btn-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5em;
      }
      
      .download-all-section {
        margin-top: 2em;
        padding-top: 1.5em;
        border-top: 1px solid #e2e8f0;
      }
      
      .download-all-btn {
        background: #48bb78;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 1em 2em;
        cursor: pointer;
        transition: all 0.3s ease;
        font-weight: 600;
        font-size: 1.1em;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5em;
        margin: 0 auto;
      }
      
      .download-all-btn:hover:not(:disabled) {
        background: #38a169;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(72, 187, 120, 0.3);
      }
      
      .download-all-btn:disabled {
        opacity: 0.8;
        cursor: not-allowed;
        transform: none;
      }
      
      .download-note {
        font-size: 0.85em;
        color: #718096;
        margin-top: 0.5em;
        font-style: italic;
      }
      
      .enhanced-single-download-section {
        background: #f7fafc;
        border: 2px solid #2c77cc;
        border-radius: 12px;
        padding: 2em;
        margin: 2em 0;
        text-align: center;
      }
      
      .enhanced-single-download-section h3 {
        color: #2c77cc;
        margin: 0 0 1em 0;
      }
      
      .enhanced-single-download-section p {
        color: #4a5568;
        margin: 0 0 1.5em 0;
      }
      
      .single-download-card {
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 1.5em;
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 1em 0;
      }
      
      .download-card-content {
        display: flex;
        align-items: center;
        gap: 1em;
      }
      
      .download-card-content > i {
        font-size: 2em;
        color: #2c77cc;
      }
      
      .download-card-info h4 {
        margin: 0;
        color: #2d3748;
        font-weight: 600;
      }
      
      .download-card-info p {
        margin: 0.2em 0 0 0;
        color: #718096;
        font-size: 0.9em;
      }
      
      .enhanced-single-download-btn {
        background: #2c77cc;
        color: white;
        border: none;
        border-radius: 6px;
        padding: 0.8em 1.5em;
        cursor: pointer;
        transition: all 0.3s ease;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 0.5em;
      }
      
      .enhanced-single-download-btn:hover:not(:disabled) {
        background: #2563eb;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(44, 119, 204, 0.3);
      }
      
      .enhanced-single-download-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
        transform: none;
      }
      
      .download-success-message {
        background: #e6fffa;
        border: 2px solid #38a169;
        border-radius: 8px;
        padding: 1.5em;
        margin-top: 2em;
        animation: slideInUp 0.5s ease;
        text-align: left;
      }
      
      .download-success-message .success-icon {
        color: #38a169;
        font-size: 2em;
        margin-bottom: 0.5em;
        text-align: center;
      }
      
      .download-success-message h4 {
        color: #2f855a;
        margin: 0 0 1em 0;
        text-align: center;
      }
      
      .download-success-message ul {
        text-align: left;
        color: #2d3748;
      }
      
      .order-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1em;
        background: white;
        border-radius: 6px;
        margin-bottom: 1em;
        border: 1px solid #e2e8f0;
      }
      
      .order-item-name {
        display: flex;
        align-items: center;
        gap: 0.5em;
        font-weight: 500;
        color: #2d3748;
      }
      
      .order-item-status {
        display: flex;
        align-items: center;
        gap: 0.5em;
        color: #38a169;
        font-weight: 500;
      }
      
      .order-meta {
        background: #f7fafc;
        padding: 1em;
        border-radius: 6px;
        font-size: 0.9em;
      }
      
      .order-meta p {
        margin: 0.3em 0;
        color: #4a5568;
      }
      
      .status-complete {
        color: #38a169;
        font-weight: 600;
      }
      
      @keyframes slideInUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      @media (max-width: 768px) {
        .download-buttons-grid {
          grid-template-columns: 1fr;
        }
        
        .multi-download-section {
          padding: 1.5em;
        }
        
        .individual-download-btn,
        .download-all-btn {
          padding: 0.8em;
          font-size: 0.95em;
        }
      }
    `;
    
    document.head.appendChild(style);
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
}

// Initialize confirmation manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ConfirmationManager();
});

// Add email reminder functionality
document.addEventListener('DOMContentLoaded', () => {
  const reminderHtml = `
    <div class="email-reminder">
      <div class="reminder-content">
        <i class="fas fa-envelope"></i>
        <div>
          <h4>Check Your Email</h4>
          <p>We've sent your receipt and permanent download links to your email address. Don't forget to check your spam folder if you don't see it in your inbox.</p>
        </div>
      </div>
    </div>
  `;

  const confirmationPage = document.querySelector('.confirmation-page');
  if (confirmationPage) {
    const reminderDiv = document.createElement('div');
    reminderDiv.innerHTML = reminderHtml;
    
    const orderComplete = document.getElementById('order-complete');
    if (orderComplete) {
      orderComplete.appendChild(reminderDiv);
    }
  }
});

// Add styles for email reminder
const emailReminderStyles = document.createElement('style');
emailReminderStyles.textContent = `
  .email-reminder {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 8px;
    padding: 1.5em;
    margin: 2em 0;
    animation: slideInUp 0.5s ease 2s both;
  }
  
  .reminder-content {
    display: flex;
    align-items: flex-start;
    gap: 1em;
  }
  
  .email-reminder i {
    color: #856404;
    font-size: 1.5em;
    margin-top: 0.2em;
  }
  
  .email-reminder h4 {
    color: #856404;
    margin: 0 0 0.5em 0;
  }
  
  .email-reminder p {
    color: #856404;
    margin: 0;
    line-height: 1.5;
  }
`;

document.head.appendChild(emailReminderStyles);

// Handle back navigation
window.addEventListener('beforeunload', (e) => {
  // Track page leave
  try {
    if (typeof gtag !== 'undefined') {
      gtag('event', 'page_leave', { page: 'confirmation' });
    }
  } catch (error) {
    console.error('Error tracking page leave:', error);
  }
});

// Export for testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConfirmationManager;
}