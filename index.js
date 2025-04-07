// ✅ Intelligent Backend for Mail Classifier App

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const { decode } = require("html-entities");
const base64 = require("base-64");

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

let cachedEmailsByDay = {};
let appliedCompanies = new Set();

function classifyEmail(subject, body = "", from = "") {
  const content = `${subject} ${body} ${from}`.toLowerCase();

  if (
    content.includes("linkedin") ||
    content.includes("applied via linkedin") ||
    content.includes("job alert") ||
    content.includes("job recommendation")
  ) {
    return "LinkedIn";
  }

  if (
    /\b(thank you for applying|application (received|submitted))\b/.test(
      content
    )
  ) {
    return "Applied";
  }

  if (
    /\b(we have decided not to move forward|unfortunately|not selected|rejected|no longer being considered|after careful consideration|we regret to inform)\b/.test(
      content
    )
  ) {
    return "Rejection";
  }

  if (
    /\b(interview|schedule|assessment|invite|calendly|zoom call|phone screen|discussion)\b/.test(
      content
    )
  ) {
    return "Interview";
  }

  return "Uncategorized";
}

function extractCompany(fromField = "") {
  const match = fromField.match(/<([^@]+)@([^>]+)>/);
  return match
    ? match[2].split(".")[0]
    : fromField.split("@")[1]?.split(".")[0];
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
    appliedCompanies = new Set();

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

      const parts = fullMessage.data.payload.parts || [];
      let body = "";
      for (const part of parts) {
        if (part.mimeType === "text/plain" || part.mimeType === "text/html") {
          const data = part.body?.data;
          if (data) {
            body = decode(
              base64.decode(data.replace(/-/g, "+").replace(/_/g, "/"))
            );
            break;
          }
        }
      }

      const classification = classifyEmail(subject, body, from);
      const company = extractCompany(from);
      if (classification === "Applied") appliedCompanies.add(company);

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

// ✅ Auth Routes
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
    res.redirect("https://mail-classifier.vercel.app");
  } catch (err) {
    console.error("Callback error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

app.get("/emails", (req, res) => {
  res.json(cachedEmailsByDay);
});

app.get("/refresh", async (req, res) => {
  try {
    await fetchEmailsFromLast5Days();
    res.json({ message: "Emails refreshed successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh emails" });
  }
});

app.get("/companies", (req, res) => {
  res.json(Array.from(appliedCompanies));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
