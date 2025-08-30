// netlify/functions/reset-ticket.js
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const BIN_ID = process.env.BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const ADMIN_SECRET = process.env.RESET_ACCESS;
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const token = event.headers["x-reset-token"];
  if (token !== ADMIN_SECRET) {
    return {
      statusCode: 403,
      body: JSON.stringify({ success: false, error: "Unauthorized" })
    };
  }

  try {
    const reset = await fetch(JSONBIN_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": API_KEY
      },
      body: JSON.stringify({ lastTicket: 0 })
    });

    const text = await reset.text();
    console.log("🔄 Reset response:", text);

    if (!reset.ok) throw new Error("Reset failed");

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, message: "Ticket counter reset to 0" })
    };
  } catch (err) {
    console.error("❌ Reset error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message })
    };
  }
};
