const stripe = Stripe("pk_live_51RcDEiEAXTaZVoaTK0xXr59LktlXUozw9WXX2NiOIAmuqxZbYRSXneL7IYIiCpRoKqMiyhIwOgDSVNiYzieXr8Wi00L7SmoVSs");

let elements;
let clientSecret;
let paymentIntentId;
let returnUrl;
let baseAmount = 0;
let appliedDiscount = 0;
let selectedCouponCode = "";

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

// UPDATED: Added optional color parameter with default empty string
function updatePriceDisplay(originalPrice, discount = 0, color = "") {
  const finalPrice = (originalPrice - discount) / 100;
  const priceDisplay = document.querySelector("#price-display");
  priceDisplay.textContent = `$${finalPrice.toFixed(2)}`;
  priceDisplay.style.color = color;  // set text color dynamically
}

document.addEventListener("DOMContentLoaded", async () => {
  const packageValue = new URLSearchParams(window.location.search).get("package");
  if (!packageValue) {
    document.querySelector("#error-message").textContent = "No package selected.";
    document.querySelector("#submit").disabled = true;
    return;
  }

  baseAmount = PRICES[packageValue];
  if (!baseAmount) {
    document.querySelector("#error-message").textContent = "Invalid package.";
    document.querySelector("#submit").disabled = true;
    return;
  }

  updatePriceDisplay(baseAmount);

  await createOrUpdatePaymentIntent(packageValue);

  // Coupon handling logic
  const applyBtn = document.querySelector("#apply-coupon");
  if (applyBtn) {
    applyBtn.addEventListener("click", async () => {
      showSpinner();
      const code = document.querySelector("#coupon-code")?.value.trim();
      const msg = document.querySelector("#coupon-message");
      selectedCouponCode = code;

      try {
        const response = await fetch("/.netlify/functions/create-payment-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            package: packageValue,
            coupon: selectedCouponCode,
          }),
        });

        const data = await response.json();

        if (!data.clientSecret) throw new Error(data.error || "Invalid coupon code");

        clientSecret = data.clientSecret;
        paymentIntentId = data.paymentIntentId;
        returnUrl = data.returnUrl;
        appliedDiscount = data.discountAmount || 0;

        // UPDATED: Pass color "green" when coupon applied
        updatePriceDisplay(baseAmount, appliedDiscount, "green");
        msg.textContent = `Coupon applied! You save $${(appliedDiscount / 100).toFixed(2)}.`;
        applySuccess();
        document.getElementById("coupon-code").disabled = true;


        elements = stripe.elements({ clientSecret });
        const paymentElement = elements.create("payment");
        paymentElement.mount("#payment-element");
      } catch (err) {
        console.error(err);
        appliedDiscount = 0;
        // UPDATED: Reset color to default when coupon invalid
        updatePriceDisplay(baseAmount, 0, "");
        msg.textContent = err.message;
        msg.style.color = "red";
      }
      hideSpinner();
    });
  }

  const form = document.querySelector("#payment-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    document.querySelector("#submit").disabled = true;

    const firstName = document.getElementById("first-name")?.value.trim() || "";
    const lastName = document.getElementById("last-name")?.value.trim() || "";
    const customerEmail = document.getElementById("email")?.value.trim() || "";
    const customerName = `${firstName} ${lastName}`.trim();

    if (!customerEmail || !customerName) {
      document.querySelector("#error-message").textContent = "Please enter your full name and email.";
      document.querySelector("#submit").disabled = false;
      return;
    }

    try {
      const updateResponse = await fetch("/.netlify/functions/update-payment-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentIntentId,
          customerEmail,
          customerName,
        }),
      });
      const updateData = await updateResponse.json();

      if (!updateData.success) throw new Error(updateData.error || "Failed to update payment intent");

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl || "https://packages.stepituplearning.ca/pages/success",
          payment_method_data: {
            billing_details: {
              name: customerName,
              email: customerEmail,
            },
          },
        },
      });

      if (error) {
        document.querySelector("#error-message").textContent = error.message;
        document.querySelector("#submit").disabled = false;
      }
    } catch (err) {
      console.error(err);
      document.querySelector("#error-message").textContent = `Error: ${err.message}`;
      document.querySelector("#submit").disabled = false;
    }
  });
});

// Helper to create payment intent on load or after applying coupon
async function createOrUpdatePaymentIntent(packageValue) {
  try {
    const response = await fetch("/.netlify/functions/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: packageValue,
        coupon: selectedCouponCode || "",
      }),
    });

    const data = await response.json();
    if (!data.clientSecret) throw new Error(data.error || "Failed to create payment intent");

    clientSecret = data.clientSecret;
    paymentIntentId = data.paymentIntentId;
    returnUrl = data.returnUrl;
    appliedDiscount = data.discountAmount || 0;

    // UPDATED: Pass color depending on discount amount
    updatePriceDisplay(baseAmount, appliedDiscount, appliedDiscount > 0 ? "green" : "");

    elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create("payment");
    paymentElement.mount("#payment-element");
  } catch (err) {
    console.error(err);
    document.querySelector("#error-message").textContent = `Error: ${err.message}`;
  }
}
