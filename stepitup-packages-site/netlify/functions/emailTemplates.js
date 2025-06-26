export function welcomeEmail(name, formattedSessionListHtml, logoUrl) {
  return `
    <div style="color: black; font-family: Arial, sans-serif;">
      <h1>Welcome to Step it Up Learning, ${name}!</h1>
      <p>We're excited to have you on board. Your booking is confirmed and we're looking forward to helping you reach your goals.</p>
      <p>Your upcoming session times:</p>
      <ul style="color: black;">${formattedSessionListHtml}</ul>
      <p>If you have any questions, feel free to reply to this email.</p>
      <p>See you soon!</p>
      <br>
      <p>
        --
        <br>
        <strong>Best,</strong><br>
        Rebecca Miller<br>
        Step it Up Learning<br>
        <a href="mailto:rebecca.miller@stepituplearning.ca" style="color: black; text-decoration: none;">rebecca.miller@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca" target="_blank" style="color: black; text-decoration: none;">stepituplearning.ca</a><br>
        <img src="${logoUrl}" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
      </p>
    </div>
  `;
}

export function confirmationEmail(name, formattedSessionListHtml, logoUrl) {
  return `
    <div style="color: black; font-family: Arial, sans-serif;">
      <h1>Thanks for booking again, ${name}!</h1>
      <p>Your new sessions have been scheduled. We appreciate your continued trust in Step it Up Learning.</p>
      <p>Your upcoming session times:</p>
      <ul style="color: black;">${formattedSessionListHtml}</ul>
      <p>If you need to make changes or have questions, just reply to this email.</p>
      <p>See you soon!</p>
      <br>
      <p>
        --
        <br>
        <strong>Best,</strong><br>
        Rebecca Miller<br>
        Step it Up Learning<br>
        <a href="mailto:rebecca.miller@stepituplearning.ca" style="color: black; text-decoration: none;">rebecca.miller@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca" target="_blank" style="color: black; text-decoration: none;">stepituplearning.ca</a><br>
        <img src="${logoUrl}" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
      </p>
    </div>
  `;
}
