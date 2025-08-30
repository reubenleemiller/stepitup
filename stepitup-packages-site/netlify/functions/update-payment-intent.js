const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  try {
    const { paymentIntentId, customerEmail, customerName } = JSON.parse(event.body || "{}");

    if (!paymentIntentId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing paymentIntentId" }),
      };
    }

    const updateParams = {};

    if (customerEmail) updateParams.receipt_email = customerEmail;

    // Preserve existing metadata and add customer_name
    if (customerName) {
      const existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      const existingMetadata = existingIntent.metadata || {};
      updateParams.metadata = {
        ...existingMetadata,
        customer_name: customerName,
      };
    }

    await stripe.paymentIntents.update(paymentIntentId, updateParams);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};