/**
 * seedProductIngredients.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE-TIME script — DB se categories + inventory khud fetch karta hai,
 * phir interactive mode mein aap assign karo.
 *
 * USAGE:
 *   node seedProductIngredients.js              # interactive assign mode
 *   node seedProductIngredients.js --list       # sirf DB data print karo (kuch save nahi)
 *   node seedProductIngredients.js --dry-run    # preview only, no saves
 *   node seedProductIngredients.js --force      # overwrite existing ingredients
 *
 * FLOW (normal run):
 *   1. DB se saari categories + inventory items fetch hote hain
 *   2. Console pe table print hoti hai — aap dekhte hain kya available hai
 *   3. Script CATEGORY_ASSIGNMENTS use karta hai (neeche define karo)
 *   4. Har category ke products mein ingredients set ho jaate hain
 *   5. Scaling: MEDIUM = base. Small = medium-2g, Large = medium+20g, pieces = same always
 *   6. Sirf woh sizes process hoti hain jo product mein actually exist karti hain
 *   7. Agar kisi size mein ingredients pehle se hain → sirf woh size skip, baaki process
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');

// ── Inline Models ─────────────────────────────────────────────────────────────
const inventorySchema = new mongoose.Schema({
  name:         { type: String, required: true },
  category:     { type: String },
  currentStock: { type: Number, default: 0 },
  unit:         { type: String, default: '' },
  branchId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Branch' },
  isActive:     { type: Boolean, default: true },
}, { timestamps: true });

const productSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  category: { type: String, required: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
  sizes: [{
    size:  { type: String, required: true },
    price: { type: Number, required: true },
    ingredients: [{
      inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      quantity:        { type: Number, required: true },
      unit:            { type: String, default: '' },
    }],
  }],
  isAvailable: { type: Boolean, default: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
const Product   = mongoose.models.Product   || mongoose.model('Product',   productSchema);

// ═══════════════════════════════════════════════════════════════════════════════
// ✏️  STEP 1: Pehle  `node seedProductIngredients.js --list`  chalao
//             Console pe aapki DB ki categories + inventory items print honge
//
// ✏️  STEP 2: Neeche CATEGORY_ASSIGNMENTS mein fill karo:
//
//   Key   = exact category name jaise DB mein hai (--list se copy karo)
//   Value = array of ingredients, har ek mein:
//     inventoryName : exact inventory item name (--list se copy karo)
//     smallQty      : base quantity for SMALL size
//     unit          : same unit jo inventory mein hai
//
// SIZE AUTO-SCALING:
//   g / ml / gram / liter  →  medium = small+20,  large = small+40
//   pieces / pcs / nos      →  sab sizes mein SAME quantity
//   kg / half_kg            →  medium = small+0.02, large = small+0.04
//
// ⚠️  Agar koi category assign nahi ki → uske products skip honge (safe)
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_ASSIGNMENTS = {

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // NOTE: "smallQty" field = MEDIUM size ki base quantity
  //   MEDIUM = as defined here (base)
  //   SMALL  = medium - 2g  / -0.002kg   (auto)
  //   LARGE  = medium + 20g / +0.02kg    (auto)
  //   EXTRA/XL = medium + 40g            (auto)
  //   pieces   → sab sizes SAME          (no scaling)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // ── Burgers (12 products) ─────────────────────────────────────────────────
  'Burgers': [
    { inventoryName: 'Burgur Bread',   smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'petty',          smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'cheese slice',   smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'mayonise',       smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Ketchup',        smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Tamatar',        smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Kheray',         smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Payaz',          smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'special souce',  smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'butter paper',   smallQty: 1,     unit: 'pieces' },
  ],

  // ── AMPF Special (11 products) ────────────────────────────────────────────
  // Special burgers / signature items — longer bun, zinger piece, extra sauce
  'AMPF Special': [
    { inventoryName: 'Lambay Burgur',        smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'Zinger Pices',         smallQty: 0.08,  unit: 'kg'     },
    { inventoryName: 'cheese slice',         smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'mayonise',             smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'special souce',        smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'special souce reciepe',smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'Tamatar',              smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Kheray',               smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Payaz',               smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'butter paper',         smallQty: 1,     unit: 'pieces' },
  ],

  // ── Pizza (12 products) ───────────────────────────────────────────────────
  // Small/Medium/Large/XL pizza dough alag alag items hain DB mein
  // Script size name ke hisaab se sahi dough assign karegi
  // (small → Small Pizza dhoo, medium → Medium Pizza Dhoo, etc.)
  'Pizza': [
    { inventoryName: 'Small Pizza dhoo',  smallQty: 0.15,  unit: 'kg'     },  // small size
    { inventoryName: 'pizza souce',       smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'cheese',            smallQty: 0.08,  unit: 'kg'     },
    { inventoryName: 'pizza chicken',     smallQty: 0.06,  unit: 'kg'     },
    { inventoryName: 'Zaitoon',           smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'shimla',            smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Mashroom',          smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'sweet corn',        smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Oill',              smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'pizza box',         smallQty: 1,     unit: 'pieces' },
  ],

  // ── Shawarmas (12 products) ───────────────────────────────────────────────
  'Shawarmas': [
    { inventoryName: 'Shawarma Bread',    smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'shawarma chicken',  smallQty: 0.07,  unit: 'kg'     },
    { inventoryName: 'shawarma reciepe',  smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'mayonise',          smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Ketchup',           smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'Tamatar',           smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Kheray',            smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'Payaz',             smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'BandGhobhi',        smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'butter paper',      smallQty: 1,     unit: 'pieces' },
  ],

  // ── Shawarma Platters (6 products) ────────────────────────────────────────
  'Shawarma Platters': [
    { inventoryName: 'Shawarma Bread',    smallQty: 2,     unit: 'pieces' },
    { inventoryName: 'shawarma chicken',  smallQty: 0.15,  unit: 'kg'     },
    { inventoryName: 'shawarma reciepe',  smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'mayonise',          smallQty: 0.04,  unit: 'kg'     },
    { inventoryName: 'Ketchup',           smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'fries',             smallQty: 0.1,   unit: 'kg'     },
    { inventoryName: 'Oill',              smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'platter box',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Wraps (5 products) ────────────────────────────────────────────────────
  'Wraps': [
    { inventoryName: 'wrap',             smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'grill chicken',    smallQty: 0.07,  unit: 'kg'     },
    { inventoryName: 'grill souce',      smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'mayonise',         smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Tamatar',          smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Kheray',           smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'BandGhobhi',       smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'butter paper',     smallQty: 1,     unit: 'pieces' },
  ],

  // ── Sandwiches (6 products) ───────────────────────────────────────────────
  'Sandwiches': [
    { inventoryName: 'Sandwitch Braed',  smallQty: 2,     unit: 'pieces' },
    { inventoryName: 'grill chicken',    smallQty: 0.06,  unit: 'kg'     },
    { inventoryName: 'cheese slice',     smallQty: 1,     unit: 'pieces' },
    { inventoryName: 'mayonise',         smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Tamatar',          smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Kheray',           smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Payaz',            smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'butter paper',     smallQty: 1,     unit: 'pieces' },
  ],

  // ── Fries (3 products) ────────────────────────────────────────────────────
  'Fries': [
    { inventoryName: 'fries',          smallQty: 0.15,  unit: 'kg'     },
    { inventoryName: 'reciepe fries',  smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'Ketchup',        smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Hot Wings (4 products) ────────────────────────────────────────────────
  'Hot Wings': [
    { inventoryName: 'Zinger Pices',   smallQty: 0.15,  unit: 'kg'     },
    { inventoryName: 'zinger reciepe', smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'spicy',          smallQty: 0.01,  unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.08,  unit: 'kg'     },
    { inventoryName: 'Dip souce',      smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Oven Baked Wings (2 products) ─────────────────────────────────────────
  'Oven Baked Wings': [
    { inventoryName: 'Zinger Pices',   smallQty: 0.15,  unit: 'kg'     },
    { inventoryName: 'zinger reciepe', smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'bar b q souce',  smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'Dip souce',      smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Chicken Frieds (2 products) ───────────────────────────────────────────
  'Chicken Frieds': [
    { inventoryName: 'Zinger Pices',   smallQty: 0.12,  unit: 'kg'     },
    { inventoryName: 'zinger reciepe', smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.08,  unit: 'kg'     },
    { inventoryName: 'Dip souce',      smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Parathas (11 products) ────────────────────────────────────────────────
  'Parathas': [
    { inventoryName: 'paratha',        smallQty: 2,     unit: 'pieces' },
    { inventoryName: 'Meda',           smallQty: 0.1,   unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Ketchup',        smallQty: 0.015, unit: 'kg'     },
    { inventoryName: 'butter paper',   smallQty: 1,     unit: 'pieces' },
  ],

  // ── Paratha Platters (4 products) ─────────────────────────────────────────
  'Paratha Platters': [
    { inventoryName: 'Paratha',        smallQty: 3,     unit: 'pieces' },
    { inventoryName: 'Meda',           smallQty: 0.15,  unit: 'kg'     },
    { inventoryName: 'Egg',            smallQty: 2,     unit: 'pieces' },
    { inventoryName: 'anday',          smallQty: 0.1,   unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Ketchup',        smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'platter box',    smallQty: 1,     unit: 'pieces' },
  ],

  // ── Pasta (4 products) ────────────────────────────────────────────────────
  'Pasta': [
    { inventoryName: 'microni',        smallQty: 0.1,   unit: 'kg'     },
    { inventoryName: 'pizza souce',    smallQty: 0.04,  unit: 'kg'     },
    { inventoryName: 'pizza chicken',  smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'cheese',         smallQty: 0.04,  unit: 'kg'     },
    { inventoryName: 'cream',          smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Mashroom',       smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'Oill',           smallQty: 0.02,  unit: 'kg'     },
    { inventoryName: 'pasta packing',  smallQty: 1,     unit: 'pieces' },
  ],

  // ── Desserts (4 products) ─────────────────────────────────────────────────
  'Desserts': [
    { inventoryName: 'Jelly Pino',     smallQty: 0.08,  unit: 'kg'     },
    { inventoryName: 'cream',          smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Soups (1 product) ─────────────────────────────────────────────────────
  'Soups': [
    { inventoryName: 'microni',        smallQty: 0.05,  unit: 'kg'     },
    { inventoryName: 'daniya',         smallQty: 0.005, unit: 'kg'     },
    { inventoryName: 'hari mirch',     smallQty: 0.005, unit: 'kg'     },
    { inventoryName: 'cream',          smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Sides (3 products) — extra / add-on items ─────────────────────────────
  'Sides': [
    { inventoryName: 'fries',          smallQty: 0.1,   unit: 'kg'     },
    { inventoryName: 'Dip souce',      smallQty: 0.03,  unit: 'kg'     },
    { inventoryName: 'Food bag',       smallQty: 1,     unit: 'pieces' },
  ],

  // ── Charges (2 products) — delivery/packaging fee items ───────────────────
  // Usually no ingredients — skipped intentionally
  // 'Charges': [],   ← uncomment + fill if needed

};

// ── Size scaling ──────────────────────────────────────────────────────────────
// MEDIUM = base  (mediumQty in CATEGORY_ASSIGNMENTS — field name "smallQty" purana tha)
// SMALL  = medium - 2g / -0.002kg   (thoda kam)
// LARGE  = medium + 20g / +0.02kg   (zyada)
// EXTRA/XL = medium + 40g / +0.04kg
// pieces/pcs/nos → har size SAME (no scaling)
//
// G/ML offset per size:
//   small=-2,  medium=0,  large=+20,  extra/xl=+40

// regular/full/standard → medium ke barabar treat karo (offset 0)
const SIZE_OFFSETS_G = { small: -2, medium: 0, regular: 0, full: 0, standard: 0, large: 20, extra: 40, xl: 40 };

function calcQty(mediumQty, sizeKey, unit) {
  const u       = (unit || '').toLowerCase();
  const isPiece = ['pieces', 'piece', 'pcs', 'nos'].includes(u);
  const isKg    = ['kg', 'half_kg', 'quarter_kg'].includes(u);

  if (isPiece) return mediumQty;                          // pieces: always same

  const offsetG = SIZE_OFFSETS_G[sizeKey] ?? 0;          // unknown size → medium qty

  if (isKg) return +Math.max(0, mediumQty + offsetG / 1000).toFixed(4);
  return Math.max(0, mediumQty + offsetG);                // g / ml
}

// ── Pretty table printer ──────────────────────────────────────────────────────
function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
  );
  const line = widths.map(w => '─'.repeat(w + 2)).join('┼');
  const fmt  = row => widths.map((w, i) => ` ${String(row[i] ?? '').padEnd(w)} `).join('│');

  console.log('┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐');
  console.log('│' + fmt(headers) + '│');
  console.log('├' + line + '┤');
  rows.forEach(r => console.log('│' + fmt(r) + '│'));
  console.log('└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) { console.error('❌  MONGODB_URI .env mein set karo'); process.exit(1); }

  const FORCE   = process.argv.includes('--force');
  const DRY_RUN = process.argv.includes('--dry-run');
  const LIST    = process.argv.includes('--list');

  await mongoose.connect(MONGODB_URI);
  console.log('✅  MongoDB connected\n');

  // ── Fetch DB data ──────────────────────────────────────────────────────────
  const [allInventory, allCategories] = await Promise.all([
    Inventory.find({ isActive: true }).sort({ name: 1 }).lean(),
    Product.distinct('category'),
  ]);

  allCategories.sort();

  // inventory name → doc map
  const inventoryMap = {};
  allInventory.forEach(i => { inventoryMap[i.name] = i; });

  // ── --list mode ────────────────────────────────────────────────────────────
  if (LIST) {
    console.log('═'.repeat(60));
    console.log('📋  DB MEIN PRODUCT CATEGORIES');
    console.log('═'.repeat(60));

    // Count products per category
    const catRows = [];
    for (const cat of allCategories) {
      const count = await Product.countDocuments({ category: cat });
      const assigned = cat in CATEGORY_ASSIGNMENTS ? '✅ assigned' : '⬜ not yet';
      catRows.push([cat, count, assigned]);
    }
    printTable(['Category', 'Products', 'In CATEGORY_ASSIGNMENTS'], catRows);

    console.log('\n' + '═'.repeat(60));
    console.log('📦  INVENTORY ITEMS (active)');
    console.log('═'.repeat(60));
    printTable(
      ['#', 'Name', 'Unit', 'Stock'],
      allInventory.map((i, idx) => [idx + 1, i.name, i.unit || '—', i.currentStock])
    );

    console.log('\n💡  TIP: Upar se naam copy karo → CATEGORY_ASSIGNMENTS mein paste karo → script dobara chalao\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ── Show fetched data summary before processing ────────────────────────────
  console.log(`📦  Inventory items fetched   : ${allInventory.length}`);
  console.log(`📂  Product categories in DB  : ${allCategories.length}  (${allCategories.join(', ')})`);
  console.log(`🗂️   Categories assigned       : ${Object.keys(CATEGORY_ASSIGNMENTS).length}`);
  console.log(`🚀  Mode                       : ${DRY_RUN ? 'DRY RUN' : FORCE ? 'FORCE (overwrite)' : 'SAFE (skip existing)'}`);
  console.log('\n' + '='.repeat(60));

  // ── Warn about unassigned categories ──────────────────────────────────────
  const unassigned = allCategories.filter(c => !(c in CATEGORY_ASSIGNMENTS));
  if (unassigned.length > 0) {
    console.log(`\n⚠️   UNASSIGNED CATEGORIES (will be skipped):`);
    unassigned.forEach(c => console.log(`   • ${c}`));
    console.log('');
  }

  // ── Stats ──────────────────────────────────────────────────────────────────
  let totalProducts = 0, productsSkipped = 0, sizesUpdated = 0, sizesSkipped = 0;
  const warnings = [];

  // ── Process each assigned category ────────────────────────────────────────
  for (const [category, template] of Object.entries(CATEGORY_ASSIGNMENTS)) {

    // Validate category exists in DB
    if (!allCategories.includes(category)) {
      console.log(`\n❌  Category "${category}" DB mein nahi mili — typo check karo`);
      warnings.push(`Category "${category}" DB mein nahi mili`);
      continue;
    }

    const products = await Product.find({ category }).lean();
    console.log(`\n📂  CATEGORY: "${category}"  (${products.length} products found)`);

    // Resolve template items → inventory _ids
    const resolvedTemplate = [];
    for (const t of template) {
      const inv = inventoryMap[t.inventoryName];
      if (!inv) {
        const msg = `Inventory item "${t.inventoryName}" nahi mila — skip`;
        console.log(`   ❌  ${msg}`);
        warnings.push(`[${category}] ${msg}`);
        continue;
      }
      resolvedTemplate.push({ ...t, inventoryId: inv._id });
    }

    if (resolvedTemplate.length === 0) {
      console.log(`   ⚠️  Koi valid ingredient resolve nahi hua — category skip`);
      continue;
    }

    // Print preview table (medium base, auto-scaled)
    console.log(`   📋  Ingredients (MEDIUM = base, ${resolvedTemplate.length} items):`);
    resolvedTemplate.forEach(t => {
      const sQty = calcQty(t.smallQty, 'small',  t.unit);
      const mQty = t.smallQty;
      const lQty = calcQty(t.smallQty, 'large',  t.unit);
      console.log(`       • ${t.inventoryName.padEnd(22)}  S:${String(sQty).padStart(7)} | M:${String(mQty).padStart(7)} | L:${String(lQty).padStart(7)}  [${t.unit}]`);
    });

    // ── Pizza: size-specific dough items ──────────────────────────────────
    const PIZZA_DOUGH_OVERRIDE = {
      small:  'Small Pizza dhoo',
      medium: 'Medium Pizza Dhoo',
      large:  'Large Pzza Doo',
      xl:     'XL Pizza Dhoo',
      extra:  'XL Pizza Dhoo',
    };
    const PIZZA_DOUGH_NAMES = Object.values(PIZZA_DOUGH_OVERRIDE);
    const PIZZA_DOUGH_QTY   = { small: 0.15, medium: 0.20, large: 0.28, xl: 0.35, extra: 0.35 };

    // ── Har product ────────────────────────────────────────────────────────
    for (const product of products) {
      totalProducts++;
      const doc = await Product.findById(product._id);

      // ✅ SIZE-LEVEL SKIP (fixed):
      // Sirf woh SIZE skip karo jisme ingredients already hain
      // Empty sizes process hoti rahein — partial products bhi fill honge
      const filledSizes = doc.sizes.filter(s => s.ingredients && s.ingredients.length > 0);
      const emptySizes  = doc.sizes.filter(s => !s.ingredients || s.ingredients.length === 0);

      if (!FORCE && filledSizes.length > 0 && emptySizes.length === 0) {
        // Sab sizes filled hain → poora product skip
        sizesSkipped += doc.sizes.length;
        productsSkipped++;
        console.log(`   ⏭️  "${doc.name}" — sab sizes filled [${filledSizes.map(s=>s.size).join(', ')}] → skip`);
        continue;
      }

      if (!FORCE && filledSizes.length > 0) {
        // Kuch filled, kuch empty → sirf empty wali process hongi
        console.log(`   ⚡  "${doc.name}" — partial: [${filledSizes.map(s=>s.size).join(', ')}] filled, [${emptySizes.map(s=>s.size).join(', ')}] empty → sirf empty fill karenge`);
      }

      let productModified = false;

      // ✅ ONLY process sizes that actually exist on this product
      for (const sizeObj of doc.sizes) {
        const sizeKey = sizeObj.size.toLowerCase().trim();

        // ── Size-level skip: agar is size mein already ingredients hain ────────────
        if (!FORCE && sizeObj.ingredients && sizeObj.ingredients.length > 0) {
          sizesSkipped++;
          console.log(`      ⏭️  [${sizeObj.size}] already ${sizeObj.ingredients.length} ing → skip`);
          continue;
        }

        // ── Pizza: swap generic dough → size-specific dough ───────────────
        let sizeTemplate = resolvedTemplate;
        if (category === 'Pizza') {
          const correctDoughName = PIZZA_DOUGH_OVERRIDE[sizeKey];
          const correctDoughInv  = correctDoughName ? inventoryMap[correctDoughName] : null;
          if (correctDoughInv) {
            sizeTemplate = resolvedTemplate
              .filter(t => !PIZZA_DOUGH_NAMES.includes(t.inventoryName))
              .concat({
                inventoryName: correctDoughName,
                inventoryId:   correctDoughInv._id,
                smallQty:      PIZZA_DOUGH_QTY[sizeKey] ?? 0.20,
                unit:          'kg',
              });
          }
        }

        // ── Build final ingredients for this size ──────────────────────────
        const newIngredients = sizeTemplate.map(t => {
          const qty = (category === 'Pizza' && PIZZA_DOUGH_NAMES.includes(t.inventoryName))
            ? t.smallQty                          // pizza dough: exact qty, no scaling
            : calcQty(t.smallQty, sizeKey, t.unit); // everything else: auto scale
          return { inventoryItemId: t.inventoryId, quantity: qty, unit: t.unit };
        });

        if (DRY_RUN) {
          console.log(`   [DRY] "${doc.name}" [${sizeObj.size}]:`);
          sizeTemplate.forEach(t => {
            const qty = (category === 'Pizza' && PIZZA_DOUGH_NAMES.includes(t.inventoryName))
              ? t.smallQty : calcQty(t.smallQty, sizeKey, t.unit);
            console.log(`         • ${t.inventoryName.padEnd(24)}: ${String(qty).padStart(8)} ${t.unit}`);
          });
        } else {
          sizeObj.ingredients = newIngredients;
          productModified = true;
          sizesUpdated++;
          console.log(`   ✅  "${doc.name}" [${sizeObj.size}] — ${newIngredients.length} ingredients set`);
        }
      }

      if (productModified && !DRY_RUN) {
        await doc.save();
      }
    }
  }

  // ── Final Summary ──────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('📊  FINAL SUMMARY');
  console.log('='.repeat(60));
  console.log(`   Products processed       : ${totalProducts}`);
  console.log(`   Products skipped (existing ingredients) : ${productsSkipped}`);
  console.log(`   Size entries updated     : ${sizesUpdated}`);
  console.log(`   Inventory items in DB    : ${allInventory.length}`);
  console.log(`   Categories assigned      : ${Object.keys(CATEGORY_ASSIGNMENTS).length} / ${allCategories.length}`);

  if (warnings.length > 0) {
    console.log(`\n⚠️   WARNINGS (${warnings.length}):`);
    warnings.forEach(w => console.log(`   • ${w}`));
  }

  if (DRY_RUN) {
    console.log('\n💡  Dry run tha — kuch save nahi hua. --dry-run flag hataao asli run ke liye.\n');
  } else if (sizesUpdated > 0) {
    console.log('\n🎉  Done! Products ke ingredients set ho gaye. App mein check karo.\n');
  } else {
    console.log('\nℹ️   Koi update nahi hua — sab already set tha ya koi assignment match nahi ki.\n');
  }

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('\n❌  ERROR:', err.message);
  process.exit(1);
});