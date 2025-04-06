// ✅ Final Backend with Refresh Route

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");

dotenv.config();
const app = express();
app.use(
  cors({
    origin: ["https://mail-classifier.vercel.app"], // ✅ Add your Vercel frontend URL here
    credentials: true,
  })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let cachedEmailsByDay = {};

function classifyEmail(subject, body = "", from = "") {
  const content = (subject + " " + body + " " + from).toLowerCase();

  if (
    content.includes("linkedin") ||
    content.includes("applied via linkedin")
  ) {
    return "LinkedIn";
  }

  if (
    content.includes("unfortunately") ||
    content.includes("we regret") ||
    content.includes("not selected") ||
    content.includes("rejected") ||
    content.includes("declined") ||
    content.includes("not moving forward")
  ) {
    return "Rejection";
  }

  if (
    content.includes("interview") ||
    content.includes("schedule") ||
    content.includes("assessment") ||
    content.includes("invite")
  ) {
    return "Interview";
  }

  return "Uncategorized";
}

async function fetchEmailsFromLast5Days() {
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:5d",
      maxResults: 100,
    });

    const messageIds = messagesRes.data.messages || [];
    const emails = [];

    for (const msg of messageIds) {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });

      const headers = fullMessage.data.payload.headers;
      const subject = headers.find((h) => h.name === "Subject")?.value || "";
      const from = headers.find((h) => h.name === "From")?.value || "";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      const classification = classifyEmail(subject, "", from);

      emails.push({ subject, from, date, classification });
    }

    cachedEmailsByDay = emails.reduce((acc, email) => {
      const day = new Date(email.date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      if (!acc[day]) acc[day] = [];
      acc[day].push(email);
      return acc;
    }, {});

    console.log("✅ Emails refreshed and cached");
  } catch (err) {
    console.error("❌ Gmail Fetch Error:", err.message);
  }
}

// 📍 OAuth Routes
app.get("/auth/google", (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "profile",
      "email",
    ],
    prompt: "consent",
  });
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await fetchEmailsFromLast5Days();
    res.redirect("http://localhost:3000");
  } catch (err) {
    console.error("Callback error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

// 📍 Cached Email Endpoint
app.get("/emails", (req, res) => {
  res.json(cachedEmailsByDay);
});

// 📍 Refresh Endpoint
app.get("/refresh", async (req, res) => {
  try {
    await fetchEmailsFromLast5Days();
    res.json({ message: "Emails refreshed successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh emails" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
