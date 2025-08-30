const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const BIN_ID = process.env.BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const data = JSON.parse(event.body);
  const { name, email, message } = data;

  try {
    // 1. Get the last ticket number
    const getRes = await fetch(`${JSONBIN_URL}/latest`, {
      headers: {
        "X-Master-Key": API_KEY
      }
    });

    const json = await getRes.json();
    const lastTicket = (json && json.record && typeof json.record.lastTicket === "number")
      ? json.record.lastTicket
      : 0;

    const nextTicket = lastTicket + 1;
    const ticketId = `TKT-${String(nextTicket).padStart(4, "0")}`;

    // 2. Save updated ticket number
    const putRes = await fetch(JSONBIN_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      body: JSON.stringify({ lastTicket: nextTicket })
    });

    const putText = await putRes.text();
    console.log("📦 PUT response:", putText);

    if (!putRes.ok) throw new Error(`Failed to update JSONBin: ${putText}`);

    // 3. Build HTML email with Times New Roman
    const emailBody = `
      <div style="font-family: 'Times New Roman', Times, serif; font-size: 16px; line-height: 1.6;">
        Hi ${name},<br><br>

        Thanks for contacting <strong>Step it Up Learning</strong>!<br>
        This is a quick confirmation that we've received your message and created a support ticket.<br><br>

        <strong>Ticket ID:</strong> <code>${ticketId}</code><br><br>

        We typically respond within a few hours. In the meantime, feel free to browse our scheduling options or packages.<br><br>

        <hr>
        <strong>Your Message:</strong><br>
        <blockquote style="border-left: 4px solid #ccc; padding-left: 10px; color: #444;">
          ${message.replace(/\n/g, "<br>")}
        </blockquote><br>

        —<br>
        Step it Up Learning<br>
        <a href="mailto:info@stepituplearning.ca">info@stepituplearning.ca</a><br>
        <a href="https://stepituplearning.ca">stepituplearning.ca</a><br>
        <img src="https://stepituplearning.ca/assets/logo.png" alt="Step it Up Learning Logo" style="height: 160px;">
      </div>
    `;

    // 4. Send email via Resend
    const sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Step it Up Learning <info@stepituplearning.ca>",
        to: email,
        subject: `We've received your message [Ticket ${ticketId}]`,
        html: emailBody
      })
    });

    if (!sendRes.ok) {
      const errText = await sendRes.text();
      throw new Error(`Email failed: ${errText}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ticketId })
    };
  } catch (err) {
    console.error("❌ Email error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};