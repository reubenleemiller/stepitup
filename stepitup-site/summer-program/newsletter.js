document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("newsletter-form");
  if (!form) return;
  const emailInput = form.querySelector("#newsletter-email");
  const btn = form.querySelector(".download-btn");
  const btnText = form.querySelector("#newsletter-btn-text");
  const spinner = form.querySelector("#newsletter-spinner");
  const successMark = form.querySelector("#newsletter-success");
  const errorDiv = form.querySelector("#newsletter-error");
  let downloadBtn = form.querySelector(".newsletter-download-btn");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorDiv.classList.add("hidden");

    // Hide text, show spinner, hide checkmark
    btnText.classList.add("hidden");
    spinner.classList.remove("hidden");
    successMark.classList.add("hidden");
    btn.disabled = true;

    try {
      const res = await fetch("/.netlify/functions/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailInput.value })
      });
      const data = await res.json();

      if (res.ok && data && data.downloadUrl) {
        spinner.classList.add("hidden");
        successMark.classList.remove("hidden");
        // Show Download button if not already there
        if (!downloadBtn) {
          downloadBtn = document.createElement("button");
          downloadBtn.type = "button";
          downloadBtn.className = "newsletter-download-btn";
          downloadBtn.innerHTML = `<span>Download PDF</span>`;
          form.appendChild(downloadBtn);
        }
        downloadBtn.onclick = function () {
          window.open(data.downloadUrl, "_blank");
        };
        downloadBtn.classList.remove("hidden");

        // Make subscribe button green and unclickable
        btn.style.backgroundColor = "#28a745";
        btn.style.pointerEvents = "none";
        btn.disabled = true;
        btnText.textContent = "Subscribed!";

        // KEEP the checkmark visible! (Do not hide it)
      } else {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }
    } catch (err) {
      spinner.classList.add("hidden");
      btnText.classList.remove("hidden");
      errorDiv.textContent = err.message;
      errorDiv.classList.remove("hidden");
      btn.disabled = false;
    }
  });
});