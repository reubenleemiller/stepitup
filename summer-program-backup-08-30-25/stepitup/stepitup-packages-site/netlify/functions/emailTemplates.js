export function welcomeEmail(name, formattedSessionListHtml, logoUrl) {
  return `
    <div style="color: black; font-family: serif, sans-serif;">
      <h1>Welcome to Step it Up Learning, ${name}!</h1>
      <p>We're excited to have you on board. Your booking is confirmed and we're looking forward to helping you reach your goals.</p>
      <p>Your upcoming session times are:</p>
      <ul style="color: black;">${formattedSessionListHtml}</ul>
      <p><strong>Please be on the look out for more emails from us</strong> with reminders for each upcoming session inlcuding the materials your student will need. At the end of each session, your student will also be given homework which is optional but highly recommended so that your child can get the most out of the program. </p>
      <p>If you have any questions, feel free to reply to this email.</p>
      <p>See you soon!</p>
      <br>
      <p>
        --<br>
        <div style="color:#888;"><strong>Rebecca Miller</strong></div>
        <div style="color: #888;">Step it Up Learning</div>
        <a href="mailto:rebecca.miller@stepituplearning.ca">rebecca.miller@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca" target="_blank">stepituplearning.ca</a><br>
        <img src="${logoUrl}" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
      </p>
    </div>
  `;
}

export function confirmationEmail(name, formattedSessionListHtml, logoUrl) {
  return `
    <div style="color: black; font-family: serif, sans-serif;">
      <h1>Thanks for booking again, ${name}!</h1>
      <p>Your new sessions have been scheduled. We appreciate your continued trust in Step it Up Learning.</p>
      <p>Your upcoming session times:</p>
      <ul style="color: black;">${formattedSessionListHtml}</ul>
      <p><strong>Please be on the look out for more emails from us</strong> with reminders for each upcoming session inlcuding the materials your student will need. At the end of each session, your student will also be given homework which is optional but highly recommended so that your child can get the most out of the program. </p>
      <p>If you need to make changes or have questions, just reply to this email.</p>
      <p>See you soon!</p>
      <br>
      <p>
        --<br>
        <div style="color:#888;"><strong>Rebecca Miller</strong></div>
        <div style="color: #888;">Step it Up Learning</div>
        <a href="mailto:rebecca.miller@stepituplearning.ca">rebecca.miller@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca" target="_blank">stepituplearning.ca</a><br>
        <img src="${logoUrl}" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
      </p>
    </div>
  `;
}
