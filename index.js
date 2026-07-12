const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ফায়ারবেস অ্যাডমিন কনফিগারেশন
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// টেলিগ্রাম ডেটা আসলেই আসল কিনা তা ভেরিফাই করার মেথড
function verifyTelegramData(initData) {
  if (!initData) return false;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  
  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
    
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  
  return calculatedHash === hash;
}

// সিকিউর কয়েন ক্লেইম এপিআই
app.post('/api/claim-coins', async (req, res) => {
  try {
    const { initData, action, userId } = req.body;
    
    // ১. টেলিগ্রামের সেশন যাচাই
    if (!verifyTelegramData(initData)) {
      return res.status(403).json({ success: false, error: 'Unauthorized Telegram session' });
    }
    
    const userRef = db.ref(`users/${userId}`);
    const snapshot = await userRef.once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const userData = snapshot.val();
    let coinsToAdd = 0;
    
    // ২. প্রতিটি অ্যাকশন অনুযায়ী কয়েন সেট ও সার্ভার ভেরিফিকেশন
    if (action === 'daily_reward') {
      const lastClaim = userData.lCD;
      const today = new Date().toDateString();
      if (lastClaim === today) {
        return res.status(400).json({ success: false, error: 'Already claimed today' });
      }
      coinsToAdd = 10; // দৈনিক পুরস্কার কয়েন
      await userRef.update({ lCD: today });
    } else if (action === 'captcha') {
      coinsToAdd = 10; // ক্যাপচা রিওয়ার্ড কয়েন
    } else if (action === 'ad') {
      coinsToAdd = 5; // বিজ্ঞাপন রিওয়ার্ড কয়েন
    } else {
      return res.status(400).json({ success: false, error: 'Invalid action' });
    }
    
    // ৩. ব্যাকএন্ড থেকে নিরাপদে কয়েন আপডেট করা
    const currentCoins = userData.coins || 0;
    const currentTotalEarned = userData.tE || 0;
    const newCoins = currentCoins + coinsToAdd;
    
    await userRef.update({
      coins: newCoins,
      tE: currentTotalEarned + coinsToAdd
    });
    
    return res.json({ success: true, coins: newCoins });
    
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
