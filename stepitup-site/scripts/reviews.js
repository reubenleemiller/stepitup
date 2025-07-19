const reviewsGrid = document.getElementById('reviews-grid');
const reviewForm = document.getElementById('review-form');
const submitBtn = reviewForm.querySelector('button');
const summaryDiv = document.getElementById('summary');
const prevBtn = document.getElementById('prev-page');
const nextBtn = document.getElementById('next-page');
const pageInfo = document.getElementById('page-info');
const starRating = document.getElementById('star-rating');
let selectedRating = 0;

let currentPage = 1;
const limit = 6;

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

async function loadSummary() {
  const res = await fetch('/.netlify/functions/reviews-summary');
  const summary = await res.json();
  summaryDiv.textContent = summary.error
    ? 'Error loading summary'
    : `Average Rating: ${summary.avg_rating || 0} ★ (${summary.total_reviews} reviews)`;
}

async function loadReviews(page = 1) {
  const res = await fetch(`/.netlify/functions/list-reviews?page=${page}&limit=${limit}`);
  const reviews = await res.json();
  reviewsGrid.innerHTML = '';
  reviews.forEach((r) => {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.innerHTML = `
      <img src="${r.image_url}" alt="${r.name}" />
      <div class="review-name">${r.name}</div>
      <div class="review-rating">${'★'.repeat(r.rating)}</div>
      <div class="review-text">
        <div class="review-quote-top"><i class="fa-solid fa-quote-left"></i></div>
        ${r.review}
        <div class="review-quote-bottom"><i class="fa-solid fa-quote-right"></i></div>
      </div>
    `;
    reviewsGrid.appendChild(card);
  });

  pageInfo.textContent = `Page ${page}`;
  prevBtn.disabled = page === 1;
  nextBtn.disabled = reviews.length < limit;
}

reviewForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (selectedRating === 0) {
    alert('Please select a star rating.');
    return;
  }

  const formData = new FormData(reviewForm);
  formData.append('rating', selectedRating);

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
      loadSummary();
      loadReviews(currentPage);
    }
  } catch (error) {
    alert('Network or server error: ' + error.message);
  } finally {
    submitBtn.classList.remove('loading');
  }
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadReviews(currentPage);
  }
});

nextBtn.addEventListener('click', () => {
  currentPage++;
  loadReviews(currentPage);
});

loadSummary();
loadReviews(currentPage);
