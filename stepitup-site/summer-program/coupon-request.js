document.getElementById("coupon-request-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.target;
  const button = document.getElementById("request-access-btn");
  const label = button.querySelector(".btn-label");
  const spinner = button.querySelector(".tiny-spinner");
  const checkmark = button.querySelector(".success-checkmark");
  const msg = document.getElementById("form-message");

  // Start loading
  label.style.display = "none";
  spinner.style.display = "inline-block";
  checkmark.style.display = "none";
  button.disabled = true;
  msg.textContent = "";

  const data = {
    firstName: form.firstName.value.trim(),
    lastName: form.lastName.value.trim(),
    email: form.email.value.trim(),
    numStudents: parseInt(form.numStudents.value.trim()) || 1,
  };

  try {
    const res = await fetch("/.netlify/functions/generate-coupon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    const result = await res.json();
    if (result.success) {
      msg.textContent = "Check your email for next steps!";
      msg.style.color = "green";

      spinner.style.display = "none";
      checkmark.style.display = "inline-block";
      button.classList.add("success"); // turn button green
      // button.disabled = true; // already disabled
    } else {
      throw new Error(result.error);
    }

  } catch (err) {
    msg.textContent = `Error: ${err.message || "Something went wrong."}`;
    msg.style.color = "red";

    // Restore button for retry
    label.style.display = "inline-block";
    spinner.style.display = "none";
    checkmark.style.display = "none";
    button.disabled = false;
    button.classList.remove("success");
  }
});