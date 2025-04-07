// ✅ Refined Backend with Intelligent Classification

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
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

let cachedEmailsByDay = {};
let companyStats = {};

function classifyEmail(subject = "", body = "", from = "") {
  const text = `${subject} ${body}`.toLowerCase();

  if (text.includes("linkedin") || text.includes("applied via linkedin")) {
    return "LinkedIn";
  }

  const rejectionKeywords = [
    "we have decided not to move forward",
    "unfortunately we have decided",
    "not selected",
    "didn't work out",
    "application was not successful",
    "no longer being considered",
    "after careful consideration",
    "we regret to inform you",
    "rejection",
    "not moving forward",
  ];
  const isRejection = rejectionKeywords.some((k) => text.includes(k));
  if (isRejection) return "Rejection";

  const interviewPhrases = [
    "interview confirmed",
    "your interview is scheduled",
    "we look forward to speaking",
    "zoom interview link",
    "technical interview",
    "please select a time slot",
    "join us for an interview",
    "assessment scheduled",
    "invitation to interview",
  ];

  const interviewFalsePositives = [
    "we will contact you to schedule an interview",
    "we may reach out to schedule",
    "you may be contacted",
  ];

  const isInterview =
    interviewPhrases.some((p) => text.includes(p)) &&
    !interviewFalsePositives.some((p) => text.includes(p));

  if (isInterview) return "Interview";

  const appliedPhrases = [
    "thank you for applying",
    "your application has been received",
    "we received your application",
    "application submitted",
    "your application is under review",
  ];
  const isApplied = appliedPhrases.some((p) => text.includes(p));
  if (isApplied) return "Applied";

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
    companyStats = {};

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
      const snippet = fullMessage.data.snippet || "";
      const classification = classifyEmail(subject, snippet, from);

      const company = from.split("<")[0].trim();
      if (!companyStats[company])
        companyStats[company] = { applied: 0, interviews: 0 };
      if (classification === "Applied") companyStats[company].applied++;
      if (classification === "Interview") companyStats[company].interviews++;

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
    res.redirect("https://mail-classifier.vercel.app");
  } catch (err) {
    console.error("Callback error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

// 📍 Cached Email Endpoint
app.get("/emails", (req, res) => {
  res.json(cachedEmailsByDay);
});

// 📍 Stats for Companies Endpoint
app.get("/companies", (req, res) => {
  res.json(companyStats);
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
