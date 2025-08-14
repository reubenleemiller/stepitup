const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { 
      review_id, 
      vote_type, // 'helpful' or 'not_helpful'
      user_identifier // Could be IP address or session ID for anonymous voting
    } = JSON.parse(event.body);

    // Validate required fields
    if (!review_id || !vote_type || !user_identifier) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Missing required fields: review_id, vote_type, user_identifier' 
        })
      };
    }

    // Validate vote type
    if (!['helpful', 'not_helpful'].includes(vote_type)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'vote_type must be either "helpful" or "not_helpful"' 
        })
      };
    }

    console.log('🗳️ Processing vote for review:', review_id, 'type:', vote_type);

    // Initialize Supabase client with service role for write operations
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Check if user has already voted on this review
    const { data: existingVote } = await supabase
      .from('review_votes')
      .select('id, vote_type')
      .eq('review_id', review_id)
      .eq('user_identifier', user_identifier)
      .single();

    // If user already voted with the same type, remove the vote (toggle off)
    if (existingVote && existingVote.vote_type === vote_type) {
      const { error: deleteError } = await supabase
        .from('review_votes')
        .delete()
        .eq('id', existingVote.id);

      if (deleteError) {
        console.error('❌ Error removing vote:', deleteError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to remove vote' })
        };
      }

      // Update the review vote counts
      await updateReviewVoteCounts(supabase, review_id);

      console.log('✅ Vote removed successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Vote removed successfully',
          action: 'removed'
        })
      };
    }

    // If user voted with different type, update the vote
    if (existingVote && existingVote.vote_type !== vote_type) {
      const { error: updateError } = await supabase
        .from('review_votes')
        .update({ 
          vote_type,
          created_at: new Date().toISOString()
        })
        .eq('id', existingVote.id);

      if (updateError) {
        console.error('❌ Error updating vote:', updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to update vote' })
        };
      }

      // Update the review vote counts
      await updateReviewVoteCounts(supabase, review_id);

      console.log('✅ Vote updated successfully');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Vote updated successfully',
          action: 'updated'
        })
      };
    }

    // Insert new vote
    const { error: insertError } = await supabase
      .from('review_votes')
      .insert({
        review_id,
        vote_type,
        user_identifier,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('❌ Error inserting vote:', insertError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to submit vote' })
      };
    }

    // Update the review vote counts
    await updateReviewVoteCounts(supabase, review_id);

    console.log('✅ Vote submitted successfully');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Vote submitted successfully',
        action: 'added'
      })
    };

  } catch (error) {
    console.error('❌ Unexpected error in vote-review:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      })
    };
  }
};

// Helper function to update vote counts on the review
async function updateReviewVoteCounts(supabase, reviewId) {
  try {
    // Get current vote counts
    const { data: votes } = await supabase
      .from('review_votes')
      .select('vote_type')
      .eq('review_id', reviewId);

    const helpfulVotes = votes?.filter(v => v.vote_type === 'helpful').length || 0;
    const notHelpfulVotes = votes?.filter(v => v.vote_type === 'not_helpful').length || 0;

    // Update the review with new counts
    const { error: updateError } = await supabase
      .from('product_reviews')
      .update({
        helpful_votes: helpfulVotes,
        not_helpful_votes: notHelpfulVotes
      })
      .eq('id', reviewId);

    if (updateError) {
      console.error('❌ Error updating review vote counts:', updateError);
    } else {
      console.log('✅ Updated vote counts for review:', reviewId);
    }
  } catch (error) {
    console.error('❌ Error in updateReviewVoteCounts:', error);
  }
}