const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

module.exports = {
  // Fetch all active products
  getActiveProducts: async () => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, resource_path, category')
        .eq('active', true)
        .order('id', { ascending: true });

      if (error) {
        console.error('Database error fetching products:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error in getActiveProducts:', error);
      throw error;
    }
  },

  // Fetch a single product by id
  getProductById: async (id) => {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, name, description, price, resource_path, category')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Database error fetching product:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in getProductById:', error);
      throw error;
    }
  },

  // Insert a purchase record (with duplicate handling)
  addPurchase: async (stripeSessionId, email, productId) => {
    try {
      // First check if purchase already exists
      const { data: existing, error: checkError } = await supabase
        .from('purchases')
        .select('id')
        .eq('stripe_session_id', stripeSessionId)
        .single();

      if (existing) {
        console.log('Purchase already recorded for session:', stripeSessionId);
        return existing;
      }

      // Insert new purchase record
      const { data, error } = await supabase
        .from('purchases')
        .insert([
          {
            stripe_session_id: stripeSessionId,
            email: email,
            product_id: productId
          }
        ])
        .select()
        .single();

      if (error) {
        console.error('Database error adding purchase:', error);
        throw error;
      }

      return data;
    } catch (error) {
      console.error('Error in addPurchase:', error);
      throw error;
    }
  },

  // Get purchases for a user (optional, for admin/dashboard)
  getPurchasesByEmail: async (email) => {
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select(`
          *,
          products (
            name,
            description,
            price
          )
        `)
        .eq('email', email)
        .order('id', { ascending: false });

      if (error) {
        console.error('Database error fetching purchases:', error);
        throw error;
      }

      return data || [];
    } catch (error) {
      console.error('Error in getPurchasesByEmail:', error);
      throw error;
    }
  },

  // Verify purchase (for download validation)
  verifyPurchase: async (sessionId, productId) => {
    try {
      const { data, error } = await supabase
        .from('purchases')
        .select('id, email, product_id')
        .eq('stripe_session_id', sessionId)
        .eq('product_id', productId)
        .single();

      if (error) {
        console.error('Database error verifying purchase:', error);
        return false;
      }

      return !!data;
    } catch (error) {
      console.error('Error in verifyPurchase:', error);
      return false;
    }
  }
};