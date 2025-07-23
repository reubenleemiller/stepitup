// All code is wrapped in a preloader:done event so nothing runs until main is visible
document.addEventListener('preloader:done', function() {
// === DOM GETTERS ===
const reviewsGrid = document.getElementById('reviews-grid');
const reviewForm = document.getElementById('review-form');
const submitBtn = reviewForm.querySelector('button');
const summaryDiv = document.getElementById('summary');

// --- ADDED CODE: For average star display ---
const avgStarsContainer = document.createElement('div');
avgStarsContainer.id = 'avg-stars';
avgStarsContainer.style.display = 'flex';
avgStarsContainer.style.justifyContent = 'center';
avgStarsContainer.style.alignItems = 'center';
avgStarsContainer.style.fontSize = '2.6rem';
avgStarsContainer.style.marginBottom = '15px';
summaryDiv.parentNode.insertBefore(avgStarsContainer, summaryDiv);

function renderStarRow(avg) {
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (avg >= i) {
      stars += '<i class="fa-solid fa-star" style="color:#FFD700"></i>';
    } else if (avg > i - 1 && avg < i) {
      stars += '<i class="fa-solid fa-star-half-stroke" style="color:#FFD700"></i>';
    } else {
      stars += '<i class="fa-regular fa-star" style="color:#FFD700"></i>';
    }
  }
  return stars;
}
// --- END ADDED CODE ---

// --- SPINNER SETUP ---
const reviewsSpinner = document.getElementById('reviews-spinner');
if (reviewsSpinner && !reviewsSpinner.querySelector('.circle')) {
  reviewsSpinner.innerHTML = '<div class="circle"></div>';
}

// === PAGINATION BUTTONS & RATING ===
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const starRating = document.getElementById('star-rating');
let selectedRating = 0;

let currentPage = 1;
const limit = 6;

// === STAR RATING LOGIC ===
starRating.querySelectorAll('i').forEach((star) => {
  star.addEventListener('mouseover', () => highlightStars(star.dataset.value));
  star.addEventListener('mouseout', () => highlightStars(selectedRating));
  star.addEventListener('click', () => selectRating(star.dataset.value));
});

function highlightStars(rating) {
  starRating.querySelectorAll('i').forEach((star) => {
    star.classList.toggle('hovered', star.dataset.value <= rating);
  });
}

function selectRating(rating) {
  selectedRating = rating;
  starRating.querySelectorAll('i').forEach((star) => {
    star.classList.toggle('selected', star.dataset.value <= rating);
  });
}

// === LOAD SUMMARY ===
async function loadSummary() {
  const res = await fetch('/.netlify/functions/reviews-summary');
  const summary = await res.json();
  if (summary.error) {
    summaryDiv.textContent = 'Error loading summary';
    avgStarsContainer.innerHTML = '';
  } else {
    summaryDiv.textContent = `Average Rating: ${summary.avg_rating || 0} ★ (${summary.total_reviews} reviews)`;
    avgStarsContainer.innerHTML = renderStarRow(Number(summary.avg_rating || 0));
  }
}

// === LOAD REVIEWS WITH SPINNER ===
async function loadReviews(page = 1) {
  // --- Show spinner before loading ---
  if (reviewsSpinner) {
    reviewsSpinner.style.display = "flex";
    // Force browser repaint to ensure spinner appears instantly
    reviewsSpinner.offsetHeight;
  }
  reviewsGrid.innerHTML = '';

  // Minimum spinner display time
  const minTime = 200;
  const start = Date.now();

  const res = await fetch(`/.netlify/functions/list-reviews?page=${page}&limit=${limit}`);
  const reviews = await res.json();
  reviewsGrid.innerHTML = '';
  reviews.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <img src="${r.image_url}" alt="${r.name}" />
      <div class="review-name">
        ${r.name}
        ${r.verified ? '<i class="bi bi-patch-check-fill" style="color:#6CCE35; font-size:1.2rem;" title="Verified Reviewer"></i>' : ''}
      </div>      
      <div class="review-rating">${'★'.repeat(r.rating)}</div>
      <div class="review-text">
        <div class="review-quote-top"><i class="fa-solid fa-quote-left"></i></div>
        ${r.review}
        <br>
        <br>
        <div class="review-quote-bottom"><i class="fa-solid fa-quote-right"></i></div>
      </div>
    `;
    reviewsGrid.appendChild(card);
  });

  pageInfo.textContent = `Page ${page}`;
  prevBtn.disabled = page === 1;
  nextBtn.disabled = reviews.length < limit;

  // --- Hide spinner after loading (with minimum display time) ---
  const elapsed = Date.now() - start;
  const hide = () => { if (reviewsSpinner) reviewsSpinner.style.display = "none"; };
  if (elapsed < minTime) setTimeout(hide, minTime - elapsed);
  else hide();
}

// === REVIEW FORM SUBMIT ===
reviewForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (selectedRating === 0) {
    alert('Please select a star rating.');
    return;
  }

  // Enforce at least email or phone
  const email = reviewForm.querySelector('input[name="email"]') ? reviewForm.querySelector('input[name="email"]').value.trim() : "";
  const phone = reviewForm.querySelector('input[name="phone"]') ? reviewForm.querySelector('input[name="phone"]').value.trim() : "";
  if (!email && !phone) {
    alert('Please provide at least an email address or a phone number.');
    return;
  }

  const formData = new FormData(reviewForm);
  formData.append('rating', selectedRating);
  formData.set('email', email);
  formData.set('phone', phone);

  submitBtn.classList.add('loading');

  try {
    const res = await fetch('/.netlify/functions/submit-review', {
      method: 'POST',
      body: formData,
    });
    const result = await res.json();

    if (result.error) {
      alert('Error: ' + result.error);
    } else {
      reviewForm.reset();
      selectedRating = 0;
      highlightStars(0);
      await loadSummary();
      await loadReviews(currentPage);
    }
  } catch (error) {
    alert('Network or server error: ' + error.message);
  } finally {
    submitBtn.classList.remove('loading');
  }
});

// === PAGINATION EVENTS ===
prevBtn.addEventListener('click', async () => {
  if (currentPage > 1) {
    currentPage--;
    await loadReviews(currentPage);
  }
});

nextBtn.addEventListener('click', async () => {
  currentPage++;
  await loadReviews(currentPage);
});

// === INITIAL LOAD ===
loadSummary();
loadReviews(currentPage);

}); // End preloader:done event listener