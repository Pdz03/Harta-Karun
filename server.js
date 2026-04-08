// server.js
require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();

// --- 1. KONEKSI MONGODB ---
const MONGO_URI = process.env.MONGODB_URI;
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI, { bufferCommands: false }).then((m) => {
      console.log("✅ Terkoneksi ke MongoDB");
      return m;
    });
  }
  try { cached.conn = await cached.promise; } 
  catch (e) { cached.promise = null; throw e; }
  return cached.conn;
}
app.use(async (req, res, next) => { await connectDB(); next(); });

// --- 2. SCHEMA MONGODB ---
// A. Schema Main Harta Karun (Yang Lama)
const TreasureSchema = new mongoose.Schema({
  session_name: String, unlock_code: String, admin_code: String,
  target: { lat: Number, lng: Number }, release_time: Date 
});
const Treasure = mongoose.model('Treasure', TreasureSchema);

// B. Schema Quest H-1 (BARU)
const QuestSchema = new mongoose.Schema({
  session_name: { type: String, default: 'magelang_2026' },
  destinations: [{ id: String, name: String, link: String, description: String }], // <-- Tambah description di sini
  ida_opinions: { type: Map, of: String, default: {} }, // Pendapat per lokasi
  ida_shortlist: { type: [String], default: [] }, // Checkbox Calon
  ida_final: { type: String, default: '' }, // Radio Pilih Lokasi
  ida_custom_dest: { type: String, default: '' },
  dest_submitted: { type: Boolean, default: false }, // Kunci Form Tujuan
  foods: { type: [String], default: ['', '', ''] },
  photo_url: { type: String, default: '' },
  quest_submitted: { type: Boolean, default: false }, // Kunci Form Quest
  drive_link: { type: String, default: '' },
});
const Quest = mongoose.model('Quest', QuestSchema);

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));

// --- 3. API ROUTES QUEST (BARU) ---

// Init Quest Data (Jalankan sekali aja: /api/quest/init)
app.get('/api/quest/init', async (req, res) => {
  const exist = await Quest.findOne({ session_name: 'magelang_2026' });
  if (!exist) {
    await Quest.create({ session_name: 'magelang_2026' });
    return res.send('Quest DB Created!');
  }
  res.send('Quest DB already exists.');
});

// Get Data Quest (Untuk Frontend Ida & Admin)
app.get('/api/quest/data', async (req, res) => {
  const data = await Quest.findOne({ session_name: 'magelang_2026' });
  res.json(data);
});

// Admin: Tambah Destinasi
// Admin: Tambah Destinasi
app.post('/api/quest/admin/add-dest', async (req, res) => {
  try {
      const { name, link, description, secret } = req.body;
      const t = await Treasure.findOne({ session_name: 'magelang_2026' });
      if(!t || secret !== t.admin_code) return res.status(403).json({error: 'Forbidden'});

      let q = await Quest.findOne({ session_name: 'magelang_2026' });
      
      // FIX BUG: Jika data Quest belum ada di DB, otomatis buat baru!
      if (!q) {
          q = new Quest({ session_name: 'magelang_2026' });
      }

      // Masukkan destinasi baru
      q.destinations.push({ id: 'dest_' + Date.now(), name, link, description }); 
      await q.save();
      
      res.json({success: true});
  } catch (err) {
      res.status(500).json({error: err.message});
  }
});

// Admin: Buka Gembok Form Ida
app.post('/api/quest/admin/unlock', async (req, res) => {
  const { type, secret } = req.body; // type: 'dest' atau 'task'
  const t = await Treasure.findOne({ session_name: 'magelang_2026' });
  if(secret !== t.admin_code) return res.status(403).json({error: 'Forbidden'});

  const q = await Quest.findOne({ session_name: 'magelang_2026' });
  if (type === 'dest') q.dest_submitted = false;
  if (type === 'task') q.quest_submitted = false;
  await q.save();
  res.json({success: true});
});

// Ida: Submit Pilihan Tujuan & Pendapat
app.post('/api/quest/submit-dest', async (req, res) => {
  const { opinions, shortlist, finalChoice, customDest } = req.body;
  const q = await Quest.findOne({ session_name: 'magelang_2026' });
  
  q.ida_opinions = opinions;
  q.ida_shortlist = shortlist;
  q.ida_final = finalChoice;
  q.ida_custom_dest = customDest; // <-- Simpan ke DB
  q.dest_submitted = true;
  await q.save();
  res.json({success: true});
});

// Ida: Submit Quest Makanan & Foto
// --- UPDATE API SUBMIT TASK ---
app.post('/api/quest/submit-task', async (req, res) => {
  const { foods, photo_url, drive_link } = req.body; // <-- Tangkap drive_link
  const q = await Quest.findOne({ session_name: 'magelang_2026' });
  
  q.foods = foods;
  q.photo_url = photo_url;
  q.drive_link = drive_link; // <-- Simpan ke DB
  q.quest_submitted = true;
  await q.save();
  res.json({success: true});
});

// --- API HARTA KARUN LAMA TETAP ADA DI BAWAH SINI ---
app.post('/api/login', async (req, res) => {
  const { code } = req.body;
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if (code === data.admin_code) return res.json({ role: 'admin', current_release: data.release_time });
  else if (code === data.unlock_code) {
    const now = new Date();
    const release = new Date(data.release_time);
    if (now < release) return res.json({ role: 'countdown', release_time: data.release_time });
    return res.json({ role: 'user', target: data.target });
  }
  return res.status(401).json({ error: 'WRONG_PASSCODE' });
});

app.post('/api/update-loc', async (req, res) => {
  const { lat, lng, secret } = req.body;
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if(secret !== data.admin_code) return res.status(403).json({error: 'Forbidden'});
  data.target = { lat, lng }; await data.save(); res.json({ success: true });
});

app.post('/api/update-time', async (req, res) => {
  const { new_time, secret } = req.body;
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if(secret !== data.admin_code) return res.status(403).json({error: 'Forbidden'});
  data.release_time = new Date(new_time); await data.save(); res.json({ success: true });
});

app.get('/api/status', async (req, res) => {
  const data = await Treasure.findOne({ session_name: 'magelang_2026' });
  if (!data) return res.json({ error: 'No Data' });
  res.json({ release_time: data.release_time });
});

if (process.env.NODE_ENV !== 'production') {
  app.listen(process.env.PORT || 3000, () => console.log(`🚀 Server Local Jalan`));
}
module.exports = app;