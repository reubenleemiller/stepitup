const stripe = Stripe("pk_live_51RcDEiEAXTaZVoaTK0xXr59LktlXUozw9WXX2NiOIAmuqxZbYRSXneL7IYIiCpRoKqMiyhIwOgDSVNiYzieXr8Wi00L7SmoVSs");

const subscriptionLinks = {
  "math-package": "LINK_HERE_IF_EVER_ADDED",
  "step-it-up-package": "LINK_HERE_IF_EVER_ADDED",
  "language-package": "LINK_HERE_IF_EVER_ADDED"
};

let selectedPackage = "step-it-up-package";
let currentIndex = 1;

document.addEventListener("DOMContentLoaded", () => {
  const pricingCards = document.querySelectorAll(".pricing-card");
  const submitButton = document.querySelector("#submit");
  const dotContainer = document.querySelector("#carousel-dots");
  const leftArrow = document.querySelector(".carousel-arrow.left");
  const rightArrow = document.querySelector(".carousel-arrow.right");
  const carousel = document.querySelector(".pricing-carousel");

  function updateActiveDot(index) {
    document.querySelectorAll(".carousel-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  function createDots() {
    dotContainer.innerHTML = "";
    pricingCards.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.classList.add("carousel-dot");
      if (i === currentIndex) dot.classList.add("active");
      // Make dots clickable
      dot.addEventListener("click", () => {
        selectCard(i);
      });
      dotContainer.appendChild(dot);
    });
  }

  function scrollToCard(index, smooth = true) {
    const card = pricingCards[index];
    if (!card) return;
    // Use scrollIntoView for better mobile cross-browser support
    card.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
      inline: "center",
      block: "nearest"
    });
    updateActiveDot(index);
    currentIndex = index;
  }

  function selectCard(index) {
    pricingCards.forEach((card, i) => {
      card.classList.toggle("selected", i === index);
      const checkbox = card.querySelector("input[type='checkbox']");
      if (checkbox && i !== index) checkbox.checked = false;
    });

    selectedPackage = pricingCards[index].dataset.package;
    scrollToCard(index);
  }

  // Make Select button and Card both clickable
  pricingCards.forEach((card, index) => {
    const selectBtn = card.querySelector(".select-btn");
    if (selectBtn) {
      selectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        selectCard(index);
      });
    }
    card.addEventListener("click", (e) => {
      // Avoid double trigger if clicking the button itself
      if (!e.target.classList.contains('select-btn') && !card.classList.contains('selected')) {
        selectCard(index);
      }
    });
  });

  if (leftArrow && rightArrow) {
    leftArrow.addEventListener("click", () => {
      if (currentIndex > 0) {
        selectCard(currentIndex - 1);
      }
    });

    rightArrow.addEventListener("click", () => {
      if (currentIndex < pricingCards.length - 1) {
        selectCard(currentIndex + 1);
      }
    });
  }

  if (carousel) {
    carousel.addEventListener("scroll", () => {
      const center = carousel.scrollLeft + carousel.offsetWidth / 2;
      let closest = 0;
      let minDiff = Infinity;

      pricingCards.forEach((card, i) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const diff = Math.abs(center - cardCenter);
        if (diff < minDiff) {
          minDiff = diff;
          closest = i;
        }
      });

      currentIndex = closest;
      updateActiveDot(currentIndex);
    });

    // Final guaranteed scroll on full page + layout render
    function waitForPreloaderThenScroll() {
      const selectedCard = document.querySelector(".pricing-card.selected");
      const carousel = document.querySelector(".pricing-carousel");

      if (!selectedCard || !carousel) return;

      const cardCenter = selectedCard.offsetLeft + selectedCard.offsetWidth / 2;
      const carouselCenter = carousel.offsetWidth / 2;
      const scrollLeft = cardCenter - carouselCenter;

      // Only scroll once the layout is stable and the preloader is gone
      if (document.documentElement.classList.contains('preloader-lock') || carousel.offsetWidth === 0) {
        requestAnimationFrame(waitForPreloaderThenScroll);
      } else {
        carousel.scrollLeft = scrollLeft;
      }
    }

    window.addEventListener("load", () => {
      requestAnimationFrame(waitForPreloaderThenScroll);
    });
  }

  createDots();

  if (submitButton) {
    submitButton.addEventListener("click", async e => {
      e.preventDefault();
      submitButton.disabled = true;

      const selectedCard = document.querySelector(".pricing-card.selected");
      const subscribe = selectedCard?.querySelector("input[type='checkbox']")?.checked;
      const pkg = selectedCard?.dataset.package;

      if (!pkg) {
        document.querySelector("#error-message").textContent = "Please select a package.";
        submitButton.disabled = false;
        return;
      }

      if (subscribe && subscriptionLinks[pkg]) {
        window.location.href = subscriptionLinks[pkg];
      } else {
        window.location.href = `https://packages.stepituplearning.ca/pages/checkout.html?package=${pkg}`;
      }
    });
  }
});