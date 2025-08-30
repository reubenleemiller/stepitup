const form = document.getElementById("contact-form");
const submitBtn = document.getElementById("submit-btn");
const spinner = submitBtn.querySelector(".spinner");
const btnText = submitBtn.querySelector(".btn-text");

function showSpinner() {
  spinner.classList.add("active");
  btnText.style.display = "none";    // Hide the text
  submitBtn.disabled = true;
}

function hideSpinner() {
  spinner.classList.remove("active");
  btnText.style.display = "inline";  // Show the text
  submitBtn.disabled = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (form.querySelector('input[name="bot-field"]').value !== "") return;

  showSpinner();

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
      // Redirect; no need to hide spinner because page unloads
      window.location.href = "https://stepituplearning.ca/pages/thankyou.html";
    } else {
      alert("❌ Error sending ticket.");
      hideSpinner();
    }
  } catch (err) {
    alert("❌ Network error.");
    hideSpinner();
  }
});