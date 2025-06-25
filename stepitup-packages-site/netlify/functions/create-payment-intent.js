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
    const { package: selectedPackage } = JSON.parse(event.body || "{}");
    const amount = PRICES[selectedPackage];

    if (!amount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid package selected." }),
      };
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "cad",
      automatic_payment_methods: { enabled: true },
      metadata: { package_selected: selectedPackage },
    });
    
    // Set returnUrl based on package
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
      ? "https://packages.stepituplearning.ca/pages/succeeded" // double check spelling here!
      : "https://packages.stepituplearning.ca/pages/success";

    return {
      statusCode: 200,
      body: JSON.stringify({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        returnUrl, 
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
