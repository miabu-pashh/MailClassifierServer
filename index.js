const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const fs = require("fs");
const { google } = require("googleapis");

dotenv.config();
const app = express();

app.use(
  cors({
    origin: ["https://mail-classifier.vercel.app"],
    credentials: true,
  })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const TOKEN_PATH = "token.json";
if (fs.existsSync(TOKEN_PATH)) {
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
  oauth2Client.setCredentials(token);
}

let cachedEmailsByDay = {};

function classifyEmail(subject = "", body = "", from = "") {
  const text = `${subject} ${body}`.toLowerCase();

  if (text.includes("linkedin") || from.includes("linkedin")) {
    return "LinkedIn";
  }

  if (
    text.includes("we regret") ||
    text.includes("we are sorry") ||
    text.includes("not moving forward") ||
    text.includes("unfortunately") ||
    text.includes("we have decided not to") ||
    text.includes("no longer being considered") ||
    text.includes("didn't work out") ||
    text.includes("we're unable to") ||
    text.includes("we won't be proceeding") ||
    text.includes("decline") ||
    text.includes("not selected") ||
    text.includes("rejection")
  ) {
    return "Rejection";
  }

  if (
    text.includes("interview") ||
    text.includes("assessment") ||
    text.includes("online test") ||
    text.includes("technical screen") ||
    text.includes("hiring manager") ||
    text.includes("interview invite") ||
    text.includes("please schedule")
  ) {
    return "Interview";
  }

  if (
    text.includes("thank you for applying") ||
    text.includes("we received your application") ||
    text.includes("applied successfully") ||
    text.includes("application received")
  ) {
    return "Applied";
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

      // Get body content
      let body = "";
      const parts = fullMessage.data.payload.parts || [];
      const textPart =
        parts.find((p) => p.mimeType === "text/plain") ||
        parts.find((p) => p.mimeType === "text/html");

      if (textPart?.body?.data) {
        const buff = Buffer.from(textPart.body.data, "base64");
        body = buff.toString("utf-8").replace(/<\/?[^>]+(>|$)/g, ""); // remove html tags
      }

      const classification = classifyEmail(subject, body, from);
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

// OAuth Routes
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
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    await fetchEmailsFromLast5Days();
    res.redirect("https://mail-classifier.vercel.app");
  } catch (err) {
    console.error("Callback error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

// Cached Emails Endpoint
app.get("/emails", (req, res) => {
  res.json(cachedEmailsByDay);
});

// Refresh Emails Endpoint
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
