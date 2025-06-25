const stripe = Stripe("pk_live_51RcDEiEAXTaZVoaTK0xXr59LktlXUozw9WXX2NiOIAmuqxZbYRSXneL7IYIiCpRoKqMiyhIwOgDSVNiYzieXr8Wi00L7SmoVSs");
let elements;
let clientSecret;
let paymentIntentId;
let returnUrl; // 👈 new variable to store the dynamic return URL

document.addEventListener("DOMContentLoaded", async () => {
  const packageValue = new URLSearchParams(window.location.search).get("package");
  if (!packageValue) {
    document.querySelector("#error-message").textContent = "No package selected.";
    document.querySelector("#submit").disabled = true;
    return;
  }

  try {
    // Create PaymentIntent with dynamic returnUrl
    const response = await fetch("/.netlify/functions/create-payment-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: packageValue }),
    });
    const data = await response.json();
    clientSecret = data.clientSecret;
    paymentIntentId = data.paymentIntentId;
    returnUrl = data.returnUrl; // 👈 capture the dynamic return URL

    if (!clientSecret || !clientSecret.startsWith("pi_")) {
      throw new Error("Invalid clientSecret");
    }

    elements = stripe.elements({ clientSecret });
    const paymentElement = elements.create("payment");
    paymentElement.mount("#payment-element");

  } catch (err) {
    console.error(err);
    document.querySelector("#error-message").textContent = `Error: ${err.message}`;
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
      // Update PaymentIntent with receipt_email and customerName
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

      // Confirm payment using the dynamic return URL
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl || "https://packages.stepituplearning.ca/pages/success", // fallback if missing
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
