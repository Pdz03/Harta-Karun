// server.js
require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

// --- 1. KONEKSI MONGODB ---
// Ganti dengan Connection String MongoDB-mu (Atlas/Local)
const MONGO_URI = process.env.MONGODB_URI;

// --- KONEKSI DATABASE OPTIMIZED FOR VERCEL ---
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // Wajib false di serverless biar gak nunggu lama kalau putus
    };

    cached.promise = mongoose.connect(process.env.MONGODB_URI, opts).then((mongoose) => {
      console.log("✅ Terkoneksi ke MongoDB (Baru)");
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error("❌ Gagal koneksi DB:", e);
    throw e;
  }

  return cached.conn;
}

// Panggil fungsi connect di setiap request agar aman
app.use(async (req, res, next) => {
    await connectDB();
    next();
});

// --- 2. SCHEMA MONGODB ---
const TreasureSchema = new mongoose.Schema({
  session_name: String, // 'jogja_2026'
  unlock_code: String,  // Kode buat Ida
  admin_code: String,   // Kode buat Fendi (Admin)
  target: {
    lat: Number,
    lng: Number
  },
  release_time: Date // <--- TAMBAHAN FIELD BARU
});
const Treasure = mongoose.model('Treasure', TreasureSchema);

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --- 3. API ROUTES ---

// Init Data (Jalankan sekali aja buat bikin data awal, trus hapus/komen)
app.get('/init', async (req, res) => {
  const exist = await Treasure.findOne({ session_name: 'magelang_2026' });
  if (!exist) {
    await Treasure.create({
      session_name: 'magelang_2026',
      unlock_code: '4913',
      admin_code: 'fendisayangida',
      target: { lat: -7.7956, lng: 110.3695 },
      release_time: new Date('2026-02-08T09:00:00+07:00') // Format ISO
    });
    return res.send('Data Created with Timer!');
  }
  res.send('Data already exists.');
});
// Login & Cek Kode
app.post('/api/login', async (req, res) => {
  const { code } = req.body;
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });

  if (!data) return res.status(500).json({ error: 'Database belum di-init' });

  // 1. CEK ADMIN (BYPASS) - Cek ini duluan biar admin gak kena countdown
  if (code === data.admin_code) {
    return res.json({ role: 'admin', current_release: data.release_time });
  } 
  
  // 2. CEK USER
  else if (code === "idaindarwati") {
    return res.json({ role: 'user', target: data.target });
  }
  else if (code === data.unlock_code) {
    const now = new Date();
    const release = new Date(data.release_time);

    // Kalau belum waktunya -> Lempar status 'countdown'
    if (now < release) {
      return res.json({ 
        role: 'countdown', 
        release_time: data.release_time 
      });
    }

    // Kalau sudah waktunya -> Masuk game
    return res.json({ role: 'user', target: data.target });
  }
  else {
    return res.status(401).json({ error: 'WRONG_PASSCODE' });
  }
});

// Update Lokasi (Fitur Admin)
app.post('/api/update-loc', async (req, res) => {
  const { lat, lng, secret } = req.body;
  
  // Verifikasi double (simple check)
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if(secret !== data.admin_code) return res.status(403).json({error: 'Forbidden'});

  data.target = { lat, lng };
  await data.save();
  
  console.log(`📍 Lokasi Harta Karun Pindah ke: ${lat}, ${lng}`);
  res.json({ success: true });
});

// --- UPDATE SETTING WAKTU (Fitur Admin) ---
app.post('/api/update-time', async (req, res) => {
  const { new_time, secret } = req.body;
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  
  if(secret !== data.admin_code) return res.status(403).json({error: 'Forbidden'});

  data.release_time = new Date(new_time);
  await data.save();
  res.json({ success: true });
});

app.get('/api/status', async (req, res) => {
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if (!data) return res.json({ error: 'No Data' });
  
  // Kirim waktu rilis ke frontend
  res.json({ release_time: data.release_time });
});

// Jalankan Server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Server jalan di http://localhost:${PORT} (Local Development)`);
  });
}

module.exports = app;