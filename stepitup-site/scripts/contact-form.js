const form = document.getElementById("contact-form");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (form.querySelector('input[name="bot-field"]').value !== "") return;

    const formData = {
      name: form.name.value,
      email: form.email.value,
      message: form.message.value
    };

    try {
      // 1. Submit to Netlify Forms
      const netlifyPayload = new FormData(form);
      await fetch("/", {
        method: "POST",
        body: netlifyPayload
      });

      // 2. Submit to ticket function
      const res = await fetch("/.netlify/functions/ticket", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formData)
      });

      const result = await res.json();

      if (result.success) {
        // 3. Redirect only after both succeed
        window.location.href = "/pages/thankyou.html";
      } else {
        alert("❌ Error sending ticket.");
      }
    } catch (err) {
      alert("❌ Network error.");
    }
});