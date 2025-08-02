exports.handler = async function(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { email } = JSON.parse(event.body || "{}");
  if (!email) {
    return { statusCode: 400, body: "Missing email." };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: "Missing RESEND_API_KEY." };
  }

  // Define your logo URL here (replace with your actual logo path if needed)
  const logoUrl = "https://stepituplearning.ca/logo.png"; // <-- CHANGE THIS TO YOUR ACTUAL LOGO

  const body = {
    from: "Step It Up Learning <rebecca.miller@stepituplearning.ca>",
    to: [email],
    subject: "Welcome to Step It Up Learning!",
    html: `
      <div style="font-family:sans-serif;font-size:16px;line-height:1.7;">
        <p>Hi Friend,</p>
        <p>Thank you for joining the Step It Up family! I’m so glad you’re here.</p>
        <p>I created Step It Up to support K–6 students with the confidence and academic skills they need to succeed — not just in school, but in life. Whether your child is starting Kindergarten or preparing for Grade 6, we’re here to make the transition smoother, stronger, and a little more fun.</p>
        <p>In these newsletters, I’ll be sharing:</p>
        <ul>
          <li>✅ Practical tips for summer learning</li>
          <li>✅ Free printables and challenges</li>
          <li>✅ Exclusive updates on my tutoring services and new resources</li>
        </ul>
        <p>Please feel free to respond directly to this email if you have any questions. I look forward to sharing with you to support your child's learning!</p>
        <br>
        <p>
        --<br>
        <div style="color:#888;"><strong>Rebecca Miller</strong></div>
        <div style="color: #888;">Step it Up Learning</div>
        <a href="mailto:rebecca.miller@stepituplearning.ca">rebecca.miller@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca" target="_blank">stepituplearning.ca</a><br>
        <img src="${logoUrl}" alt="Step it Up Learning" style="width:120px; margin-top:8px;" />
        </p>
      </div>`
  };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      return { statusCode: 500, body: "Failed to send email." };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    return { statusCode: 500, body: "Email send error." };
  }
};