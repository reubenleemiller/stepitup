const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  "math-package-k3": 20000,
  "step-it-up-package-k3": 36000,
  "language-package-k3": 20000,
  "math-package-45": 36000,
  "step-it-up-package-45": 50000,
  "language-package-45": 20000,
  "math-package-6": 36000,
  "step-it-up-package-6": 65000,
  "language-package-6": 36000,
};

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const selectedPackage = body.package;
    const promoCodeInput = (body.coupon || "").trim();

    const baseAmount = PRICES[selectedPackage];

    if (!baseAmount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid package selected." }),
      };
    }

    let finalAmount = baseAmount;
    let appliedPromoId = null;
    let discountAmount = 0;

    if (promoCodeInput) {
      const promoList = await stripe.promotionCodes.list({
        code: promoCodeInput,
        active: true,
        limit: 1,
      });

      const promo = promoList.data[0];

      if (!promo) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Invalid or expired coupon code." }),
        };
      }

      const coupon = await stripe.coupons.retrieve(promo.coupon.id);

      // ✅ Manually track redemptions via metadata
      const manualRedemptions = parseInt(promo.metadata.manual_redemptions || "0", 10);
      const maxRedemptions = promo.max_redemptions;

      if (maxRedemptions && manualRedemptions >= maxRedemptions) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "This coupon has already been used." }),
        };
      }

      appliedPromoId = promo.id;

      if (coupon.amount_off) {
        discountAmount = coupon.amount_off;
      } else if (coupon.percent_off) {
        discountAmount = Math.round(baseAmount * (coupon.percent_off / 100));
      }

      finalAmount = baseAmount - discountAmount;

      if (finalAmount < 50) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: "Discount too large for selected package." }),
        };
      }

      // ✅ Increment redemption and optionally deactivate if limit reached
      const newRedemptions = manualRedemptions + 1;
      const shouldDeactivate = maxRedemptions && newRedemptions >= maxRedemptions;

      await stripe.promotionCodes.update(promo.id, {
        metadata: {
          ...promo.metadata,
          manual_redemptions: newRedemptions.toString(),
        },
        active: shouldDeactivate ? false : true,
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: finalAmount,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      metadata: {
        package_selected: selectedPackage,
        base_amount: baseAmount,
        final_amount: finalAmount,
        discount_applied: discountAmount,
        promo_code_input: promoCodeInput || "none",
        applied_promo_id: appliedPromoId || "none",
      },
    });

    const stepItUpPackages = [
      "step-it-up-package-k3",
      "math-package-k3",
      "step-it-up-package-45",
      "math-package-45",
      "step-it-up-package-6",
      "math-package-6",
      "language-package-6",
    ];

    const returnUrl = stepItUpPackages.includes(selectedPackage)
      ? "https://packages.stepituplearning.ca/pages/succeeded"
      : "https://packages.stepituplearning.ca/pages/success";

    return {
      statusCode: 200,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        returnUrl,
        finalAmount,
        discountAmount,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
