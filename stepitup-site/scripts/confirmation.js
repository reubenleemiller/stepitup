/**
 * Confirmation Page Manager
 * Handles order processing and download functionality after successful payment
 */

class ConfirmationManager {
  constructor() {
    this.sessionId = null;
    this.orderData = null;
    this.downloadUrl = null;
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
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Store the download URL and show success state
      this.downloadUrl = data.signedUrl;
      this.orderData = {
        productName: data.productName,
        sessionId: this.sessionId
      };

      this.showSuccessState();
      this.setupDownloadButton();
      this.showCelebration();

      // Track successful order processing
      this.trackEvent('purchase_complete', {
        session_id: this.sessionId,
        product_name: data.productName
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
   * Show success state with order details
   */
  showSuccessState() {
    document.getElementById('order-processing').style.display = 'none';
    document.getElementById('order-complete').style.display = 'block';
    document.getElementById('order-error').style.display = 'none';

    // Update order details
    const orderDetails = document.getElementById('order-details');
    if (orderDetails && this.orderData) {
      orderDetails.innerHTML = `
        <div class="order-item">
          <div class="order-item-name">
            <i class="fas fa-file-download"></i>
            ${this.escapeHtml(this.orderData.productName || 'Educational Resource')}
          </div>
          <div class="order-item-status">
            <i class="fas fa-check-circle"></i>
            Ready for Download
          </div>
        </div>
        <div class="order-meta">
          <p><strong>Order ID:</strong> ${this.sessionId}</p>
          <p><strong>Status:</strong> <span class="status-complete">Complete</span></p>
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
        </div>
      `;
    }

    // Update page title
    document.title = 'Purchase Complete - Step it Up Learning';
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
   * Setup download button functionality
   */
  setupDownloadButton() {
    const downloadBtn = document.getElementById('download-btn');
    if (!downloadBtn || !this.downloadUrl) return;

    downloadBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await this.handleDownload();
    });
  }

  /**
   * Handle download process
   */
  async handleDownload() {
    const downloadBtn = document.getElementById('download-btn');
    const downloadText = document.getElementById('download-text');
    const downloadSpinner = document.getElementById('download-spinner');

    try {
      // Update UI to show loading
      downloadBtn.disabled = true;
      downloadText.innerHTML = '<i class="fas fa-sync fa-spin"></i> Preparing Download...';
      downloadSpinner.style.display = 'inline-block';

      // Track download initiation
      this.trackEvent('download_initiated', {
        session_id: this.sessionId,
        product_name: this.orderData?.productName
      });

      // Small delay for better UX
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Attempt to download
      if (this.downloadUrl) {
        // Create a hidden link and click it
        const link = document.createElement('a');
        link.href = this.downloadUrl;
        link.download = ''; // Let browser determine filename
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Update button to show success
        downloadText.innerHTML = '<i class="fas fa-check"></i> Download Started!';
        downloadSpinner.style.display = 'none';

        // Track successful download
        this.trackEvent('download_success', {
          session_id: this.sessionId,
          product_name: this.orderData?.productName
        });

        // Show download success message
        this.showDownloadInstructions();

        // Reset button after delay
        setTimeout(() => {
          if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadText.innerHTML = '<i class="fas fa-download"></i> Download Again';
          }
        }, 5000);

      } else {
        throw new Error('Download URL not available');
      }

    } catch (error) {
      console.error('Download error:', error);
      
      // Reset UI and show error
      downloadBtn.disabled = false;
      downloadText.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Download Failed';
      downloadSpinner.style.display = 'none';
      
      alert('Download failed. Please try again or contact support if the problem persists.');
      
      // Track download error
      this.trackEvent('download_error', {
        session_id: this.sessionId,
        error: error.message
      });

      // Reset button after delay
      setTimeout(() => {
        if (downloadBtn && downloadText) {
          downloadText.innerHTML = '<i class="fas fa-download"></i> Try Download Again';
        }
      }, 3000);
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
        <h4>Download Successful!</h4>
        <p>Your resource should begin downloading automatically. If it doesn't start:</p>
        <ul>
          <li>Check your browser's download settings</li>
          <li>Look for the file in your Downloads folder</li>
          <li>Try clicking the download button again</li>
        </ul>
        <p><strong>Need help?</strong> Contact us at <a href="mailto:info@stepituplearning.ca">info@stepituplearning.ca</a></p>
      </div>
    `;

    const downloadSection = document.querySelector('.download-section');
    if (downloadSection) {
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
    const colors = ['#667eea', '#764ba2', '#48bb78', '#f6ad55', '#e53e3e'];
    const confettiCount = 60;

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
      }, i * 100);
    }
  }

  /**
   * Add celebration styles
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
      
      .download-success-message {
        background: #e6fffa;
        border: 2px solid #38a169;
        border-radius: 8px;
        padding: 1.5em;
        margin-top: 2em;
        animation: slideInUp 0.5s ease;
      }
      
      .download-success-message .success-icon {
        color: #38a169;
        font-size: 2em;
        margin-bottom: 0.5em;
      }
      
      .download-success-message h4 {
        color: #2f855a;
        margin: 0 0 1em 0;
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
          <p>We've sent your receipt and a permanent download link to your email address. Don't forget to check your spam folder if you don't see it in your inbox.</p>
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