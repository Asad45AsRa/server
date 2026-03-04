require('dotenv').config();
const mongoose = require('mongoose');

// ── Branch Schema ─────────────────────────────────────────────────
const branchSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  address:     { type: String, required: true },
  city:        { type: String, required: true },
  phone:       { type: String, required: true },
  managerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isActive:    { type: Boolean, default: true },
  openingTime: { type: String, default: '09:00' },
  closingTime: { type: String, default: '23:00' },
}, { timestamps: true });

// ── Table Schema ──────────────────────────────────────────────────
const tableSchema = new mongoose.Schema({
  tableNumber:    { type: Number, required: true },
  capacity:       { type: Number, required: true },
  floor: {
    type: String, required: true,
    enum: ['ground_floor', 'first_floor', 'second_floor', 'outdoor'],
    default: 'ground_floor',
  },
  branchId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  isOccupied:     { type: Boolean, default: false },
  currentOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  isActive:       { type: Boolean, default: true },
}, { timestamps: true });

tableSchema.index({ branchId: 1, tableNumber: 1, floor: 1 }, { unique: true });

const Branch = mongoose.models.Branch || mongoose.model('Branch', branchSchema);
const Table  = mongoose.models.Table  || mongoose.model('Table',  tableSchema);

// ── Config ────────────────────────────────────────────────────────
const MONGODB_URI      = process.env.MONGODB_URI;
const FLOORS           = ['ground_floor', 'first_floor', 'second_floor', 'outdoor'];
const TABLES_PER_FLOOR = 30;
const CAPACITY         = 4;

if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI .env mein set karo');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────
async function seed() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅  MongoDB connected\n');

  // ── Sari active branches fetch karo ──────────────────────────
  const branches = await Branch.find({ isActive: true }).lean();

  if (branches.length === 0) {
    console.error('❌  Koi active branch nahi mili database mein');
    process.exit(1);
  }

  if (branches.length === 1) {
    console.log(`🏢  Branch mili: ${branches[0].name} (${branches[0].city})`);
    console.log(`    ID: ${branches[0]._id}\n`);
  } else {
    console.log('🏢  Multiple branches mili hain — sab ke liye seed karunga:');
    branches.forEach((b, i) => {
      console.log(`    [${i + 1}] ${b.name} — ${b.city} | ID: ${b._id}`);
    });
    console.log('');
  }

  // ── Har branch ke liye seed karo ─────────────────────────────
  for (const branch of branches) {
    console.log(`\n━━━ Branch: ${branch.name} ━━━`);

    // STEP 1: Purani occupied tables reset karo
    const resetResult = await Table.updateMany(
      { branchId: branch._id, isOccupied: true },
      { $set: { isOccupied: false, currentOrderId: null } }
    );
    console.log(`🔄  ${resetResult.modifiedCount} tables ka occupancy reset kiya`);

    // STEP 2: 30 tables per floor ensure karo (upsert — duplicate safe)
    for (const floor of FLOORS) {
      let created = 0;
      let skipped = 0;

      for (let tableNumber = 1; tableNumber <= TABLES_PER_FLOOR; tableNumber++) {
        try {
          await Table.findOneAndUpdate(
            { branchId: branch._id, tableNumber, floor },
            {
              $setOnInsert: {
                tableNumber,
                capacity:   CAPACITY,
                floor,
                branchId:   branch._id,
                isOccupied: false,
                isActive:   true,
              },
            },
            { upsert: true, new: true }
          );
          created++;
        } catch (e) {
          if (e.code === 11000) { skipped++; }
          else console.error(`  ❌  floor=${floor} table=${tableNumber}:`, e.message);
        }
      }
      console.log(`  ✓  ${floor.replace(/_/g, ' ')} — ${created} OK, ${skipped} skipped`);
    }

    const total = await Table.countDocuments({ branchId: branch._id });
    console.log(`  📊  Total tables in DB: ${total}`);
  }

  await mongoose.disconnect();
  console.log('\n🎉  Seed complete! Ab app chalao.\n');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});