// Fetch from Netlify function, not directly from Supabase!
async function loadFeaturedReviews() {
  try {
    const res = await fetch("/.netlify/functions/featured-reviews-carousel");
    if (!res.ok) throw new Error("Failed to fetch featured reviews");
    return await res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
}

function renderStars(rating) {
  let stars = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i)      stars += '<i class="fa-solid fa-star"></i>';
    else if (rating >= i - 0.5) stars += '<i class="fa-solid fa-star-half-stroke"></i>';
    else                  stars += '<i class="fa-regular fa-star"></i>';
  }
  return `<div class="review-stars">${stars}</div>`;
}

// -- ADD Helper for verified icon
function renderVerifiedIcon(verified) {
  return verified
    ? `<i class="bi bi-patch-check-fill" style="color:#6CCE35; font-size:1.2rem;" title="Verified Reviewer"></i>`
    : '';
}

async function renderFeaturedCarousel() {
  const reviews = await loadFeaturedReviews();
  const carouselWrapper = document.querySelector('#featured-carousel .swiper-wrapper');
  if (!carouselWrapper) return;
  carouselWrapper.innerHTML = '';

  if (!reviews.length) {
    carouselWrapper.innerHTML = `<div class="swiper-slide"><div class="review-card"><p>No featured reviews yet.</p></div></div>`;
    return;
  }

  reviews.forEach(review => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';
    slide.innerHTML = `
      <div class="review-card">
        <img src="${review.image_url || 'https://via.placeholder.com/80'}" alt="${review.name || 'Reviewer'}" class="review-avatar" />
        <div class="review-name">
          ${review.name || 'Anonymous'}
          ${renderVerifiedIcon(review.verified)}
        </div>
        ${renderStars(review.rating)}
        <div class="review-text">
          <div class="review-quote-top"><i class="fa-solid fa-quote-left"></i></div>
          ${review.review || ''}
          <br>
          <br>
          <div class="review-quote-bottom"><i class="fa-solid fa-quote-right"></i></div>
        </div>
      </div>
    `;
    carouselWrapper.appendChild(slide);
  });

  // (Re)initialize Swiper
  if (window.featuredSwiper) window.featuredSwiper.destroy(true, true);
  window.featuredSwiper = new Swiper('#featured-carousel', {
    loop: false,
    autoplay: {
      delay: 5000,
      disableOnInteraction: false,
    },
    pagination: {
      el: '.swiper-pagination',
      clickable: true
    },
    navigation: {
      nextEl: '.swiper-button-next',
      prevEl: '.swiper-button-prev'
    },
    slidesPerView: 1,
    centeredSlides: false,
    spaceBetween: 0,
    // REMOVE breakpoints so it's always 1 card everywhere!
    // breakpoints: {},
  });
}

document.addEventListener('DOMContentLoaded', renderFeaturedCarousel);