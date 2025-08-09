const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('./db.js');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const session_id = event.queryStringParameters.session_id;
    
    if (!session_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Session ID is required" }),
      };
    }

    // Retrieve Stripe session with line items
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['line_items', 'line_items.data.price.product', 'customer']
    });
    
    console.log('Session retrieved:', session_id);
    console.log('Session payment_status:', session.payment_status);
    console.log('Session amount_total:', session.amount_total, 'cents');
    console.log('Session currency:', session.currency);
    console.log('Session line_items count:', session.line_items?.data?.length || 0);

    if (session.payment_status !== 'paid') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Payment not completed" }),
      };
    }

    // Get customer email
    const email = session.customer_details?.email || session.customer_email;

    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "No email found for this session." }),
      };
    }

    // Handle multiple items from cart metadata or line items
    let cartItems = [];
    let products = [];
    let signedUrls = [];

    try {
      if (session.metadata && session.metadata.cart_items) {
        // Multiple items case - use metadata
        cartItems = JSON.parse(session.metadata.cart_items);
      } else if (session.metadata && session.metadata.product_id) {
        // Single item case (backward compatibility)
        cartItems = [{ id: session.metadata.product_id }];
      } else if (session.line_items && session.line_items.data) {
        // Fallback: extract from line items
        cartItems = session.line_items.data
          .filter(item => item.price && item.price.product && item.price.product.metadata)
          .map(item => ({
            id: item.price.product.metadata.product_id,
            name: item.price.product.name,
            resource_path: item.price.product.metadata.resource_path
          }));
      } else {
        throw new Error("No product information found in session");
      }

      // Process each item
      for (const cartItem of cartItems) {
        const productId = cartItem.id;

        // Get product info first to get the price
        const product = await db.getProductById(productId);
        if (!product) {
          console.error(`Product not found: ${productId}`);
          continue; // Skip this product but continue with others
        }

        // Find the corresponding line item to get the actual amount paid
        let amountPaid = product.price; // Default to product price
        if (session.line_items && session.line_items.data) {
          const lineItem = session.line_items.data.find(item => {
            // Try to match by product metadata or name
            const itemProductId = item.price?.product?.metadata?.product_id;
            const itemProductName = item.price?.product?.name;
            return itemProductId === productId.toString() || 
                   itemProductName === product.name;
          });
          
          if (lineItem) {
            amountPaid = lineItem.amount_subtotal || lineItem.amount_total || product.price;
            console.log(`Found line item for ${product.name}: $${amountPaid / 100}`);
          }
        }

        // Record the purchase with actual amount paid (with idempotency check)
        try {
          await db.addPurchase(session_id, email, productId, amountPaid, session.currency || 'usd');
        } catch (e) {
          // Ignore duplicate errors - purchase already recorded
          console.log('Purchase already recorded or error:', e.message);
        }

        products.push(product);

        // Generate signed URL for download
        try {
          const signedResponse = await fetch(`${process.env.URL || 'https://localhost:8888'}/.netlify/functions/generate-signed-url?resource=${encodeURIComponent(product.resource_path)}`);
          
          if (!signedResponse.ok) {
            throw new Error(`Failed to generate signed URL: ${signedResponse.status}`);
          }
          
          const signedData = await signedResponse.json();
          signedUrls.push({
            productName: product.name,
            signedUrl: signedData.signedUrl
          });
        } catch (error) {
          console.error(`Error generating signed URL for ${product.name}:`, error);
          // Continue with other products even if one fails
        }
      }

      if (products.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "No valid products found for this purchase" }),
        };
      }

    } catch (error) {
      console.error('Error processing cart items:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to process purchased items" }),
      };
    }

    // Create a proper receipt using Stripe's invoice functionality
    let invoiceUrl = null;
    let invoicePdf = null;
    
    try {
      const customerId = session.customer;
      if (!customerId) {
        throw new Error('No customer found in session');
      }

      console.log('Creating receipt for customer ID:', customerId);
      console.log('Session amount total:', session.amount_total, 'cents = $' + (session.amount_total / 100).toFixed(2));

      // Create invoice items for each product with proper amount mapping
      const invoiceItems = [];
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        
        // Find the corresponding line item to get the actual amount paid
        let itemAmount = product.price; // Default to product price
        if (session.line_items && session.line_items.data) {
          const lineItem = session.line_items.data.find(item => {
            const itemProductId = item.price?.product?.metadata?.product_id;
            const itemProductName = item.price?.product?.name;
            return itemProductId === product.id.toString() || 
                   itemProductName === product.name;
          });
          
          if (lineItem) {
            itemAmount = lineItem.amount_subtotal || lineItem.amount_total || product.price;
            console.log(`Using line item amount for ${product.name}: $${itemAmount / 100} (line item: ${lineItem.amount_subtotal || lineItem.amount_total})`);
          } else {
            console.log(`No matching line item found for ${product.name}, using product price: $${itemAmount / 100}`);
          }
        }
        
        console.log(`Creating invoice item: ${product.name} = $${(itemAmount / 100).toFixed(2)}`);
        
        const invoiceItem = await stripe.invoiceItems.create({
          customer: customerId,
          amount: itemAmount,
          currency: session.currency || 'usd',
          description: product.name,
          metadata: {
            product_id: product.id.toString(),
            session_id: session_id
          }
        });
        
        invoiceItems.push(invoiceItem);
        console.log(`Invoice item created: ${invoiceItem.id} for $${invoiceItem.amount / 100}`);
      }

      // Wait a moment to ensure all invoice items are processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Create the invoice
      const invoice = await stripe.invoices.create({
        customer: customerId,
        description: `Receipt - Step it Up Learning Store (Order #${session_id.substring(8, 16)})`,
        footer: 'Thank you for your purchase from Step it Up Learning!',
        metadata: {
          session_id: session_id,
          order_reference: session_id.substring(8, 16)
        }
      });

      console.log('Invoice created:', invoice.id);
      console.log('Invoice subtotal:', invoice.subtotal / 100);
      console.log('Invoice total:', invoice.total / 100);
      console.log('Invoice line items count:', invoice.lines?.data?.length || 0);
      
      // Retrieve the invoice again to make sure all items are attached
      const refreshedInvoice = await stripe.invoices.retrieve(invoice.id);
      console.log('Refreshed invoice total:', refreshedInvoice.total / 100);
      console.log('Refreshed invoice line items:', refreshedInvoice.lines?.data?.length || 0);
      
      // If invoice total is still 0, something went wrong
      if (refreshedInvoice.total === 0) {
        console.error('❌ WARNING: Invoice total is $0.00! Checking invoice items...');
        
        // List all invoice items for this customer  
        const customerInvoiceItems = await stripe.invoiceItems.list({
          customer: customerId,
          limit: 10
        });
        
        console.log('Customer invoice items:', customerInvoiceItems.data.length);
        customerInvoiceItems.data.forEach(item => {
          console.log(`- Item: ${item.description} = $${item.amount / 100} (${item.currency})`);
        });
        
        // Don't continue with zero total invoice
        console.error('❌ Aborting invoice processing due to zero total');
        throw new Error('Invoice total is $0.00 - please contact support');
      }

      // Finalize the invoice
      const finalizedInvoice = await stripe.invoices.finalizeInvoice(refreshedInvoice.id);
      console.log('Invoice finalized:', finalizedInvoice.id);
      console.log('Finalized invoice total:', finalizedInvoice.total / 100);

      // Mark the invoice as paid first
      const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
        paid_out_of_band: true
      });

      console.log('Invoice paid:', paidInvoice.id, 'Amount paid:', paidInvoice.amount_paid / 100);
      
      invoiceUrl = paidInvoice.hosted_invoice_url;
      invoicePdf = paidInvoice.invoice_pdf;
      
      console.log('Invoice after payment - URL:', !!invoiceUrl, 'PDF:', !!invoicePdf);
      
      // Enhanced PDF generation wait with multiple checks
      if (!invoicePdf) {
        console.log('📄 No PDF immediately available, attempting multiple retrieval attempts...');
        
        // Try multiple times with increasing delays
        for (let attempt = 1; attempt <= 3; attempt++) {
          const waitTime = attempt * 3000; // 3s, 6s, 9s
          console.log(`📄 Attempt ${attempt}: Waiting ${waitTime}ms for PDF generation...`);
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          const recheckInvoice = await stripe.invoices.retrieve(paidInvoice.id);
          invoicePdf = recheckInvoice.invoice_pdf;
          
          console.log(`📄 Attempt ${attempt} - PDF available:`, !!invoicePdf);
          
          if (invoicePdf) {
            console.log('✅ PDF generated successfully on attempt', attempt);
            break;
          }
        }
        
        if (!invoicePdf) {
          console.log('⚠️ PDF still not available after all attempts - may be Stripe test mode limitation');
        }
      }
      
      console.log('📄 Final PDF URL for attachment:', invoicePdf ? 'Available' : 'Not available');
      
    } catch (error) {
      console.error('Error creating receipt:', error.message);
      // Continue without invoice
    }

    // Send email with Resend (if API key is configured)
    if (process.env.RESEND_API_KEY) {
      try {
        // Create download links HTML without emojis
        const downloadLinksHtml = signedUrls.map(item => `
          <div style="background: #f0f4ff; border: 1px solid #c5d9ff; border-radius: 8px; padding: 1.2em; margin: 1em 0;">
            <h4 style="margin: 0 0 0.5em 0; color: #2c77cc; display: flex; align-items: center;">
              <i class="fas fa-file-download" style="margin-right: 8px;"></i>
              ${item.productName}
            </h4>
            <a href="${item.signedUrl}" class="download-btn" style="
              display: inline-block; 
              background: #2c77cc; 
              color: white !important; 
              padding: 10px 20px; 
              text-decoration: none; 
              border-radius: 6px; 
              margin: 5px 0;
              font-weight: 500;
              transition: background 0.2s ease;
            " onmouseover="this.style.background='#1e5aa8'" onmouseout="this.style.background='#2c77cc'">
              <i class="fas fa-download" style="margin-right: 6px;"></i>
              Download ${item.productName}
            </a>
          </div>
        `).join('');

        // Create product list for summary
        const productListHtml = products.map(product => 
          `<li style="margin-bottom: 0.5em; display: flex; align-items: center;">
            <i class="fas fa-check-circle" style="color: #48bb78; margin-right: 8px;"></i>
            ${product.name} - $${(product.price / 100).toFixed(2)}
          </li>`
        ).join('');

        const totalAmount = products.reduce((sum, product) => sum + product.price, 0);

        const emailData = {
          from: "Step it Up Resource Store <noreply@stepituplearning.ca>",
          to: email,
          subject: `Your Educational Resources - Download & Receipt (${products.length} item${products.length > 1 ? 's' : ''})`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Your Purchase from Step it Up Resource Store</title>
              <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
            </head>
            <body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #2d3748; margin: 0; padding: 0; background-color: #f7fafc;">
              <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <div style="background: #2c77cc; color: white; padding: 2em; text-align: center;">
                  <h1 style="margin: 0; font-size: 1.8em;">
                    <i class="fas fa-check-circle" style="margin-right: 12px;"></i>
                    Thank you for your purchase!
                  </h1>
                  <p>Step it Up Resource Store</p>
                </div>
                
                <div style="padding: 2em; margin-top: 1em;">
                  <h2 style="margin-top: 0;">Your Educational Resources are Ready!</h2>
                  <p>You have successfully purchased <strong>${products.length} educational resource${products.length > 1 ? 's' : ''}</strong>:</p>
                  
                  <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.5em; margin: 1.5em 0;">
                    <h3 style="color: #2c77cc; margin-top: 0;">
                      <i class="fas fa-list-ul" style="margin-right: 10px;"></i>
                      Your Purchase Summary
                    </h3>
                    <ul style="margin: 0; padding-left: 1.5em; list-style: none;">
                      ${productListHtml}
                    </ul>
                    <div style="font-size: 1.2em; font-weight: 600; color: #2c77cc; border-top: 1px solid #e2e8f0; padding-top: 0.5em; margin-top: 0.5em;">
                      <i class="fas fa-receipt" style="margin-right: 8px;"></i>
                      Total: $${(totalAmount / 100).toFixed(2)}
                    </div>
                  </div>
                  
                  <div style="background: #e6fffa; border: 1px solid #4fd1c7; border-radius: 8px; padding: 1.5em; margin: 1.5em 0;">
                    <h3 style="color: #285e61; margin-top: 0;">
                      <i class="fas fa-cloud-download-alt" style="margin-right: 10px;"></i>
                      Download Your Resources
                    </h3>
                    <p>Click the buttons below to download each of your resources:</p>
                    ${downloadLinksHtml}
                    <p style="font-size: 0.9em; color: #4a5568; margin-top: 1em;">
                      <i class="fas fa-clock" style="margin-right: 6px; color: #f6ad55;"></i>
                      <strong>Note:</strong> Download links are valid for 1 hour for security purposes.
                    </p>
                  </div>
                  
                  ${invoiceUrl ? `
                  <div style="background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 1.5em; margin: 1.5em 0;">
                    <h3 style="color: #4a5568; margin-top: 0;">
                      <i class="fas fa-file-invoice" style="margin-right: 10px;"></i>
                      Your Receipt
                    </h3>
                    <p>Your invoice is available online:</p>
                    <a href="${invoiceUrl}" style="display: inline-block; background: #48bb78; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 10px 0; font-weight: 500;">
                      <i class="fas fa-external-link-alt" style="margin-right: 6px;"></i>
                      View Invoice Online
                    </a>
                  </div>
                  ` : ''}
                  
                  <div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; padding: 1.5em; margin: 1.5em 0;">
                    <h3 style="color: #856404; margin-top: 0;">
                      <i class="fas fa-question-circle" style="margin-right: 10px;"></i>
                      Need Help?
                    </h3>
                    <p style="color: #856404; margin-bottom: 0.5em;">If you have any questions or issues with your downloads, please contact us:</p>
                    <ul style="color: #856404; margin: 0.5em 0; padding-left: 1.5em;">
                      <li>
                        <i class="fas fa-envelope" style="margin-right: 6px;"></i>
                        Email: <a href="mailto:info@stepituplearning.ca" style="color: #856404;">info@stepituplearning.ca</a>
                      </li>
                      <li>
                        <i class="fas fa-phone" style="margin-right: 6px;"></i>
                        Phone: +1 (403) 598-4840
                      </li>
                    </ul>
                    <p style="font-size: 0.9em; color: #856404; margin-bottom: 0;">
                      <strong>Reference your Order ID:</strong> <code style="background: rgba(133, 100, 4, 0.1); padding: 2px 6px; border-radius: 3px;">${session_id}</code>
                    </p>
                  </div>
                </div>
                
                <div style="background: #f7fafc; padding: 1.5em; text-align: center; border-top: 1px solid #e2e8f0;">
                  <p style="margin: 0.3em 0; color: #4a5568; font-size: 0.9em;"><strong>Step it Up Learning</strong></p>
                  <p style="margin: 0.3em 0; color: #4a5568; font-size: 0.9em;">Quality educational resources to support your learning journey</p>
                  <p style="margin: 0.3em 0; color: #4a5568; font-size: 0.9em;">
                    <i class="fas fa-globe" style="margin-right: 6px;"></i>
                    www.stepituplearning.ca
                  </p>
                  <p style="margin-top: 1em; font-size: 0.8em; color: #718096;">
                    <i class="fas fa-copyright" style="margin-right: 4px;"></i>
                    2025 Step it Up Learning. All rights reserved.
                  </p>
                  <p style="margin-top: 0.5em; font-size: 0.8em; color: #718096;">
                    This email was sent to ${email} regarding your purchase from Step it Up Resource Store.
                  </p>
                </div>
              </div>
            </body>
            </html>
          `
        };

        // Generate SIMPLE PDF invoice with NO OVERLAPS GUARANTEED
        console.log('📄 Generating SIMPLE PDF invoice with ZERO overlap guarantee...');
        
        try {
          const PDFDocument = require('pdfkit');
          const invoiceNumber = `INV-${session_id.substring(8, 16)}`;
          const invoiceDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',  
            day: 'numeric'
          });
          
          // Create PDF with generous margins
          const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
            info: {
              Title: `Invoice ${invoiceNumber}`,
              Author: 'Step it Up Learning'
            }
          });

          const chunks = [];
          doc.on('data', chunk => chunks.push(chunk));
          
          const pdfPromise = new Promise((resolve) => {
            doc.on('end', () => resolve(Buffer.concat(chunks)));
          });

          // SIMPLE CONSTANTS - NO COMPLEX CALCULATIONS
          const pageWidth = 612;
          const pageHeight = 792;
          const leftMargin = 50;
          const rightMargin = 50;
          const topMargin = 50;
          const bottomMargin = 50;
          const usableWidth = pageWidth - leftMargin - rightMargin;
          const footerY = pageHeight - 40; // Fixed footer position
          
          let y = topMargin;

          // Colors
          const darkGray = '#1a1a1a';
          const mediumGray = '#6b7280';
          const blue = '#2c77cc';
          const green = '#059669';
          const lightGray = '#f9fafb';

          // HEADER SECTION - SIMPLE TWO COLUMN
          
          // Logo (small and simple)
          let logoBuffer = null;
          try {
            const logoResponse = await fetch('https://www.stepituplearning.ca/assets/logo.png');
            if (logoResponse.ok) {
              logoBuffer = await logoResponse.arrayBuffer();
            }
          } catch (e) {}

          if (logoBuffer) {
            try {
              doc.image(Buffer.from(logoBuffer), leftMargin, y, { width: 60 });
            } catch (e) {
              doc.fontSize(14).fillColor(blue).text('Step it Up Learning', leftMargin, y);
            }
          } else {
            doc.fontSize(14).fillColor(blue).text('Step it Up Learning', leftMargin, y);
          }

          // INVOICE title (right side)
          doc.fontSize(20).fillColor(darkGray).text('INVOICE', pageWidth - rightMargin - 100, y, {
            width: 100,
            align: 'right'
          });

          y += 80; // Fixed spacing

          // COMPANY INFO SECTION - SIMPLE LAYOUT
          
          // Left side - company details (ABSOLUTE COORDINATES)
          doc.fontSize(9).fillColor(mediumGray);
          doc.text('Step it Up Learning', leftMargin, 130);
          doc.text('Educational Resources', leftMargin, 145);
          doc.text('www.stepituplearning.ca', leftMargin, 160);
          doc.text('info@stepituplearning.ca', leftMargin, 175);
          doc.text('+1 (403) 598-4840', leftMargin, 190);

          // Right side - invoice details (ABSOLUTE FIXED COORDINATES - NO OVERLAP POSSIBLE)
          const rightStartX = pageWidth - rightMargin - 200;
          const rightColumnWidth = 200;
          
          // ABSOLUTE Y COORDINATES - GUARANTEED NO OVERLAP
          doc.fontSize(9).fillColor(mediumGray);
          doc.text(`Invoice: ${invoiceNumber}`, rightStartX, 130, { width: rightColumnWidth, align: 'right' });
          doc.text(`Date: ${invoiceDate}`, rightStartX, 150, { width: rightColumnWidth, align: 'right' });
          
          // FULL ORDER ID - handle long IDs
          const fullOrderId = session_id;
          if (fullOrderId.length > 30) {
            // Split very long order ID
            const line1 = fullOrderId.substring(0, 30);
            const line2 = fullOrderId.substring(30);
            doc.text(`Order: ${line1}`, rightStartX, 170, { width: rightColumnWidth, align: 'right' });
            doc.text(`${line2}`, rightStartX, 190, { width: rightColumnWidth, align: 'right' });
            doc.text(`Currency: ${(session.currency || 'usd').toUpperCase()}`, rightStartX, 210, { width: rightColumnWidth, align: 'right' });
            doc.fontSize(10).fillColor(green).text('PAID', rightStartX, 235, { width: rightColumnWidth, align: 'right' });
          } else {
            doc.text(`Order: ${fullOrderId}`, rightStartX, 170, { width: rightColumnWidth, align: 'right' });
            doc.text(`Currency: ${(session.currency || 'usd').toUpperCase()}`, rightStartX, 190, { width: rightColumnWidth, align: 'right' });
            doc.fontSize(10).fillColor(green).text('PAID', rightStartX, 215, { width: rightColumnWidth, align: 'right' });
          }

          // SET FIXED Y POSITION AFTER COMPANY INFO SECTION
          y = 260; // Absolute position - well below all company info

          // DIVIDER LINE
          doc.strokeColor('#e5e7eb').lineWidth(1)
             .moveTo(leftMargin, y).lineTo(pageWidth - rightMargin, y).stroke();
          y += 25;

          // BILL TO SECTION
          doc.fontSize(10).fillColor(darkGray).text('Bill To:', leftMargin, y);
          y += 15;
          doc.fontSize(9).fillColor(mediumGray).text(email, leftMargin, y);
          y += 35;

          // ITEMS TABLE - SIMPLE HEADER
          const tableStartY = y;
          doc.rect(leftMargin, tableStartY, usableWidth, 20).fill(lightGray);
          
          doc.fontSize(8).fillColor(mediumGray);
          doc.text('DESCRIPTION', leftMargin + 10, tableStartY + 6);
          doc.text('AMOUNT', pageWidth - rightMargin - 60, tableStartY + 6, { width: 50, align: 'right' });
          
          y = tableStartY + 20;

          // ITEMS - SIMPLE ROWS WITH GUARANTEED SPACING
          const rowHeight = 30; // Fixed row height
          const maxRows = Math.min(products.length, 15); // Maximum 15 items to prevent overflow
          
          for (let i = 0; i < maxRows; i++) {
            const product = products[i];
            
            // Stop if we're too close to footer
            if (y + rowHeight > footerY - 60) {
              break;
            }

            // Alternate background
            if (i % 2 === 1) {
              doc.rect(leftMargin, y, usableWidth, rowHeight).fill('#fefefe');
            }

            // Product name (truncated if too long)
            doc.fontSize(9).fillColor(darkGray);
            const maxNameLength = 50; // Character limit
            const displayName = product.name.length > maxNameLength 
              ? product.name.substring(0, maxNameLength) + '...'
              : product.name;
            doc.text(displayName, leftMargin + 10, y + 6);
            
            // Product description
            doc.fontSize(7).fillColor(mediumGray);
            doc.text('Educational Resource - Digital Download', leftMargin + 10, y + 18);

            // Amount
            doc.fontSize(9).fillColor(darkGray);
            doc.text(`${(product.price / 100).toFixed(2)}`, pageWidth - rightMargin - 60, y + 10, {
              width: 50,
              align: 'right'
            });

            y += rowHeight;
          }

          // Show truncation notice if needed
          if (products.length > maxRows) {
            doc.fontSize(7).fillColor(mediumGray);
            doc.text(`... and ${products.length - maxRows} more items (see online receipt for full details)`, 
              leftMargin + 10, y + 5);
            y += 20;
          }

          // TOTALS SECTION - SIMPLE RIGHT ALIGNMENT
          y += 15;
          const totalsX = pageWidth - rightMargin - 150;
          
          doc.fontSize(8).fillColor(mediumGray);
          doc.text('Subtotal:', totalsX, y);
          doc.text(`${(totalAmount / 100).toFixed(2)}`, totalsX + 100, y, { width: 50, align: 'right' });
          
          y += 15;
          doc.text('Tax:', totalsX, y);
          doc.text('$0.00', totalsX + 100, y, { width: 50, align: 'right' });
          
          y += 10;
          doc.strokeColor(darkGray).lineWidth(1)
             .moveTo(totalsX, y).lineTo(totalsX + 140, y).stroke();
          
          y += 15;
          doc.fontSize(10).fillColor(darkGray);
          doc.text('Total:', totalsX, y);
          doc.text(`${(totalAmount / 100).toFixed(2)}`, totalsX + 100, y, { width: 50, align: 'right' });

          // THANK YOU BOX - ONLY IF SPACE ALLOWS
          if (y + 80 < footerY) {
            y += 30;
            doc.rect(leftMargin, y, usableWidth, 35).fill(lightGray).stroke('#e5e7eb');
            doc.fontSize(10).fillColor(darkGray);
            doc.text('Thank you for your purchase!', leftMargin + 15, y + 10);
          }

          // SIMPLE FOOTER - ABSOLUTELY POSITIONED
          doc.fontSize(7).fillColor(mediumGray);
          doc.text('© 2025 Step it Up Learning  •  info@stepituplearning.ca  •  +1 (403) 598-4840', 
            leftMargin, footerY, { 
              width: usableWidth, 
              align: 'center' 
            });

          doc.end();
          const pdfBuffer = await pdfPromise;
          const pdfBase64 = pdfBuffer.toString('base64');
          
          console.log('📄 Professional PDF invoice generated with ANTI-OVERLAP protection, size:', pdfBuffer.length, 'bytes');
          
          // Add PDF attachment
          emailData.attachments = [
            {
              filename: `StepItUp_Invoice_${invoiceNumber}.pdf`,
              content: pdfBase64,
              type: 'application/pdf',
              disposition: 'attachment'
            }
          ];
          
          console.log('✅ Professional PDF invoice attachment added to email');
          
        } catch (pdfError) {
          console.error('❌ Error generating PDF invoice:', pdfError.message);
          console.error('PDF Error stack:', pdfError.stack);
          
          // Fallback to simple text receipt
          console.log('📄 Falling back to text receipt...');
          const receiptText = `STEP IT UP LEARNING - RECEIPT

Invoice: INV-${session_id.substring(8, 16)}
Date: ${new Date().toLocaleDateString()}
Order ID: ${session_id}

Bill To: ${email}
Status: PAID

Items:
${products.map(p => `- ${p.name}: $${(p.price / 100).toFixed(2)}`).join('\n')}

Total: $${(totalAmount / 100).toFixed(2)}

Thank you for your purchase!
Visit: www.stepituplearning.ca
Email: info@stepituplearning.ca`;

          emailData.attachments = [{
            filename: `StepItUp_Receipt_${session_id.substring(8, 16)}.txt`,
            content: Buffer.from(receiptText).toString('base64'),
            type: 'text/plain',
            disposition: 'attachment'
          }];
        }

        // Log email data summary before sending
        console.log('📧 Sending email to:', email);
        console.log('📧 Email subject:', emailData.subject);
        console.log('📧 Has attachments:', !!emailData.attachments, emailData.attachments?.length || 0);
        if (emailData.attachments) {
          emailData.attachments.forEach((attachment, index) => {
            console.log(`📎 Attachment ${index + 1}:`, attachment.filename, 'size:', attachment.content?.length || 0, 'chars');
          });
        }

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(emailData)
        });

        if (!emailResponse.ok) {
          const errorText = await emailResponse.text();
          console.error('❌ Failed to send email:', errorText);
        } else {
          const emailResult = await emailResponse.json();
          console.log('✅ Email sent successfully:', emailResult.id);
        }
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Don't fail the whole request if email fails
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        signedUrls,
        message: "Download links generated successfully",
        products: products.map(p => ({ id: p.id, name: p.name })),
        invoiceUrl: invoiceUrl
      }),
    };

  } catch (error) {
    console.error('Send link error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Failed to process request",
        details: error.message 
      }),
    };
  }
};