const stripe = Stripe("pk_live_51RcDEiEAXTaZVoaTK0xXr59LktlXUozw9WXX2NiOIAmuqxZbYRSXneL7IYIiCpRoKqMiyhIwOgDSVNiYzieXr8Wi00L7SmoVSs");

const subscriptionLinks = {
  "4-hour-package": "https://buy.stripe.com/14A14n7Kze4Ceb9e8T0Jq03",
  "8-hour-package": "https://buy.stripe.com/bJeaEXc0P1hQ8QP3uf0Jq02",
  "12-hour-package": "https://buy.stripe.com/7sY6oHaWL9Omeb9gh10Jq01"
};

let selectedPackage = "8-hour-package"; // Default selected
let currentIndex = 1;

document.addEventListener("DOMContentLoaded", () => {
  const pricingCards = document.querySelectorAll(".pricing-card");
  const checkboxes = document.querySelectorAll("input[type='checkbox'][name='package-checkbox']");
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

  function uncheckAllCheckboxes() {
    checkboxes.forEach(cb => {
      cb.checked = false;
    });
  }

  function createDots() {
    dotContainer.innerHTML = "";
    pricingCards.forEach((_, i) => {
      const dot = document.createElement("div");
      dot.classList.add("carousel-dot");
      if (i === currentIndex) dot.classList.add("active");
      dot.addEventListener("click", () => {
        selectCard(i);
        uncheckAllCheckboxes();
      });
      dotContainer.appendChild(dot);
    });
  }

  function scrollToCard(index, smooth = true) {
    const card = pricingCards[index];
    if (!card) return;
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
    });
    selectedPackage = pricingCards[index].dataset.package;
    scrollToCard(index);
    uncheckAllCheckboxes();
  }

  // Checkbox logic: only one checked at a time, like radio buttons, but still checkboxes
  checkboxes.forEach((cb, idx) => {
    cb.addEventListener('click', function(e) {
      e.stopPropagation(); // Don't trigger card selection
      if (cb.checked) {
        // Uncheck all others except this
        checkboxes.forEach((other, j) => {
          if (other !== cb) {
            other.checked = false;
          }
        });
      }
      // If unchecked, all are unchecked (no default selection)
    });
    // Prevent card click from toggling checkbox
    cb.addEventListener('mousedown', function(e) {
      e.stopPropagation();
    });
  });

  // Card click: select the card (highlight), but do NOT change checkbox state (except uncheck all)
  pricingCards.forEach((card, idx) => {
    card.addEventListener('click', function(e) {
      selectCard(idx);
    });
  });

  // Keyboard support: allow arrow keys to navigate and select cards
  document.addEventListener('keydown', function(e) {
    if (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "TEXTAREA") return;
    if (e.key === "ArrowLeft" && currentIndex > 0) {
      selectCard(currentIndex - 1);
    } else if (e.key === "ArrowRight" && currentIndex < pricingCards.length - 1) {
      selectCard(currentIndex + 1);
    }
  });

  if (leftArrow && rightArrow) {
    leftArrow.addEventListener("click", () => {
      if (currentIndex > 0) {
        selectCard(currentIndex - 1);
        uncheckAllCheckboxes();
      }
    });

    rightArrow.addEventListener("click", () => {
      if (currentIndex < pricingCards.length - 1) {
        selectCard(currentIndex + 1);
        uncheckAllCheckboxes();
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

    function waitForPreloaderThenScroll() {
      const selectedCard = document.querySelector(".pricing-card.selected");
      const carousel = document.querySelector(".pricing-carousel");

      if (!selectedCard || !carousel) return;

      const cardCenter = selectedCard.offsetLeft + selectedCard.offsetWidth / 2;
      const carouselCenter = carousel.offsetWidth / 2;
      const scrollLeft = cardCenter - carouselCenter;

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

      // Find the selected pricing card
      const selectedCard = document.querySelector(".pricing-card.selected");
      if (!selectedCard) {
        document.querySelector("#error-message").textContent = "Please select a package.";
        submitButton.disabled = false;
        return;
      }
      const pkg = selectedCard.dataset.package;

      // Check checkbox state inside selected card for subscribe
      const subscribe = selectedCard.querySelector("input[type='checkbox'][name='package-checkbox']")?.checked;

      if (subscribe && subscriptionLinks[pkg]) {
        window.location.href = subscriptionLinks[pkg];
      } else {
        window.location.href = `./pages/checkout.html?package=${pkg}`;
      }
    });
  }
});