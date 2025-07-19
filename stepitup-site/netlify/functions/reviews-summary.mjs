import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export const handler = async () => {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('rating');

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }

    if (!data.length) {
      return { statusCode: 200, body: JSON.stringify({ avg_rating: 0, total_reviews: 0 }) };
    }

    const totalReviews = data.length;
    const sumRatings = data.reduce((acc, cur) => acc + cur.rating, 0);
    const avgRating = (sumRatings / totalReviews).toFixed(2);

    return {
      statusCode: 200,
      body: JSON.stringify({ avg_rating: avgRating, total_reviews: totalReviews }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
