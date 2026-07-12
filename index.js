export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, error: "Only POST allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    try {
      const { initData, action, userId } = await request.json();

      // ১. টেলিগ্রাম সেশন সিকিউর ভেরিফিকেশন
      const isValidTelegram = await verifyTelegramData(initData, env.TELEGRAM_BOT_TOKEN);
      if (!isValidTelegram) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized Telegram session" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const dbUrl = env.FIREBASE_DATABASE_URL.replace(/\/$/, ""); 
      const dbSecret = env.FIREBASE_DATABASE_SECRET;

      const userUrl = `${dbUrl}/users/${userId}.json?auth=${dbSecret}`;
      const userRes = await fetch(userUrl);
      if (!userRes.ok) {
        return new Response(JSON.stringify({ success: false, error: "Firebase Read Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const userData = await userRes.json();
      if (!userData) {
        return new Response(JSON.stringify({ success: false, error: "User not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      let coinsToAdd = 0;
      let updates = {};

      // ২. অ্যাকশন চেক
      if (action === 'daily_reward') {
        const lastClaim = userData.lCD;
        const today = new Date().toDateString();
        if (lastClaim === today) {
          return new Response(JSON.stringify({ success: false, error: "Already claimed today" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        coinsToAdd = 10;
        updates.lCD = today;
      } else if (action === 'captcha') {
        coinsToAdd = 10;
      } else if (action === 'ad') {
        coinsToAdd = 5;
      } else {
        return new Response(JSON.stringify({ success: false, error: "Invalid action" }), {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const currentCoins = userData.coins || 0;
      const currentTotalEarned = userData.tE || 0;
      const newCoins = currentCoins + coinsToAdd;

      updates.coins = newCoins;
      updates.tE = currentTotalEarned + coinsToAdd;

      // ৩. ডাটাবেজ আপডেট
      const updateRes = await fetch(userUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });

      if (!updateRes.ok) {
        return new Response(JSON.stringify({ success: false, error: "Firebase Update Error" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      return new Response(JSON.stringify({ success: true, coins: newCoins }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

// টেলিগ্রাম SHA-256 এনক্রিপশন লজিক
async function verifyTelegramData(initData, botToken) {
  if (!initData || !botToken) return false;
  
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  
  const dataCheckString = Array.from(params.entries())
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const encoder = new TextEncoder();
  
  const cWebAppData = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const secretKeyBuffer = await crypto.subtle.sign(
    "HMAC",
    cWebAppData,
    encoder.encode(botToken)
  );
  
  const cSecretKey = await crypto.subtle.importKey(
    "raw",
    secretKeyBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cSecretKey,
    encoder.encode(dataCheckString)
  );
  
  const signatureArray = Array.from(new Uint8Array(signatureBuffer));
  const calculatedHash = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return calculatedHash === hash;
}