// ✅ Smarter Backend with Regex + Company Extraction

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
let companySet = new Set();

function classifyEmail(subject = "", body = "", from = "") {
  const text = `${subject} ${body}`.toLowerCase();

  const interviewPatterns = [
    /schedule.*interview/i,
    /invite.*interview/i,
    /technical.*(assessment|interview)/i,
    /we.*like.*interview/i,
    /move.*forward.*interview/i,
    /calendar.*link/i,
  ];

  const rejectionPatterns = [
    /we.*regret/i,
    /not.*(moving|going).*forward/i,
    /application.*(unsuccessful|declined|rejected)/i,
    /no longer.*considered/i,
    /unfortunately.*decision/i,
    /after careful consideration/i,
  ];

  const linkedinPatterns = [/linkedin/i, /applied via linkedin/i];
  const appliedPatterns = [/thank you for applying/i, /application received/i];

  if (linkedinPatterns.some((r) => r.test(text)) || from.includes("linkedin")) {
    return "LinkedIn";
  }

  if (rejectionPatterns.some((r) => r.test(text))) {
    return "Rejection";
  }

  if (interviewPatterns.some((r) => r.test(text))) {
    return "Interview";
  }

  if (appliedPatterns.some((r) => r.test(text))) {
    return "Applied";
  }

  return "Uncategorized";
}

function extractCompany(from) {
  const match = from.match(/@(.*?)\./);
  return match ? match[1] : "Unknown";
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
    companySet.clear();

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

      let body = "";
      const parts = fullMessage.data.payload.parts || [];
      const textPart =
        parts.find((p) => p.mimeType === "text/plain") ||
        parts.find((p) => p.mimeType === "text/html");

      if (textPart?.body?.data) {
        const buff = Buffer.from(textPart.body.data, "base64");
        body = buff.toString("utf-8").replace(/<[^>]*>/g, "");
      }

      const classification = classifyEmail(subject, body, from);
      const company = extractCompany(from);
      companySet.add(company);
      emails.push({ subject, from, date, classification, company });
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

// OAuth routes
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

// 📍 APIs
app.get("/emails", (req, res) => {
  res.json(cachedEmailsByDay);
});

app.get("/companies", (req, res) => {
  res.json({ companies: [...companySet] });
});

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
