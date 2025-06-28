document.addEventListener("DOMContentLoaded", () => {
    const applyBtn = document.getElementById("apply-coupon");

    if (!applyBtn) return;

    // Create spinner once
    const spinner = document.createElement("div");
    spinner.classList.add("tiny-spinner");
    spinner.style.position = "absolute";
    spinner.style.top = "50%";
    spinner.style.left = "50%";
    spinner.style.transform = "translate(-50%, -50%)";

    applyBtn.style.position = "relative";

    // Spinner helpers
    window.showSpinner = () => {
      applyBtn.disabled = true;
      applyBtn.dataset.originalText = applyBtn.textContent;
      applyBtn.textContent = "";
      applyBtn.appendChild(spinner);
    };

    window.hideSpinner = () => {
      if (applyBtn.contains(spinner)) {
        applyBtn.removeChild(spinner);
      }

      // Don't reset if coupon has already been applied
      if (!applyBtn.classList.contains("applied")) {
        applyBtn.disabled = false;
        applyBtn.textContent = applyBtn.dataset.originalText || "Apply";
      }
    };

    // Success state: lock the button and show checkmark
    window.applySuccess = () => {
      if (applyBtn.contains(spinner)) {
        applyBtn.removeChild(spinner);
      }
      applyBtn.disabled = true;
      applyBtn.textContent = "Applied";
      applyBtn.classList.add("applied");
      applyBtn.style.backgroundColor = "#4caf50"; // Green
      applyBtn.style.color = "#fff";
      applyBtn.style.border = "none";
    };
  });