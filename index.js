const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const fs = require("fs");
const { decode } = require("html-entities");
const base64 = require("base-64");

dotenv.config();

const app = express();
app.use(
  cors({ origin: ["https://mail-classifier.vercel.app"], credentials: true })
);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

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
    await fetchAndStoreEmails();
    res.send("✅ Emails fetched and stored for training.");
  } catch (err) {
    console.error("Callback error:", err.message);
    res.status(500).send("Authentication failed");
  }
});

async function fetchAndStoreEmails() {
  try {
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const messagesRes = await gmail.users.messages.list({
      userId: "me",
      q: "newer_than:5d",
      maxResults: 50,
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

      let body = "";
      const parts = fullMessage.data.payload.parts || [];
      const textPart = parts.find(
        (p) => p.mimeType === "text/plain" && p.body?.data
      );

      if (textPart) {
        body = base64.decode(
          textPart.body.data.replace(/-/g, "+").replace(/_/g, "/")
        );
        body = decode(body);
      }

      emails.push({ subject, from, date, body, label: "" }); // you'll label these later
    }

    fs.writeFileSync("training_data.json", JSON.stringify(emails, null, 2));
    console.log("✅ Emails saved to training_data.json");
  } catch (err) {
    console.error("Fetch error:", err.message);
  }
}

app.listen(8080, () => {
  console.log("🚀 Server running on http://localhost:8080");
});
