// ═══════════════════════════════════════════════════════════════
// MAHARASHTRA GEO CATALOG — towns & trade corridors for the
// Trip Planner route builder (logistics view).
//
//  · MAHARASHTRA_TOWNS — every major city / tehsil town / trade hub
//    across all 36 districts of Maharashtra. Powers the Start/End
//    dropdowns and the "All Maharashtra towns" picker.
//  · MH_CORRIDORS — ordered town sequences for the state's major
//    highway / trade corridors. When the user picks Start & End,
//    `corridorTownsBetween()` slices the towns lying between them so
//    the route builder can suggest ONLY on-route towns.
//    (Catalog-based matching — a practical trade-route map, not GPS.)
//
// Matching is case-insensitive. Town names are unique across the
// catalog (deduped at module load).
// ═══════════════════════════════════════════════════════════════

// ── Konkan (Mumbai City, Mumbai Suburban, Thane, Palghar, Raigad, Ratnagiri, Sindhudurg) ──
// ── Pune division (Pune, Satara, Sangli, Solapur, Kolhapur) ──
// ── Nashik division (Nashik, Dhule, Nandurbar, Jalgaon, Ahmednagar) ──
// ── Chh. Sambhajinagar division (Aurangabad, Jalna, Beed, Dharashiv, Latur, Nanded, Parbhani, Hingoli) ──
// ── Amravati division (Amravati, Akola, Washim, Buldhana, Yavatmal) ──
// ── Nagpur division (Nagpur, Wardha, Bhandara, Gondia, Chandrapur, Gadchiroli) ──
const RAW_TOWNS: string[] = [
  // Mumbai City & Mumbai Suburban
  "Mumbai", "Andheri", "Bandra", "Borivali", "Chembur", "Dadar", "Ghatkopar",
  "Goregaon", "Jogeshwari", "Kurla", "Malad", "Mulund", "Powai", "Santacruz",
  "Vashi", "Vile Parle", "Vikhroli",

  // Thane & Palghar
  "Thane", "Dombivli", "Kalyan", "Ulhasnagar", "Ambernath", "Badlapur",
  "Bhiwandi", "Shahapur", "Murbad", "Mira Road", "Bhayandar", "Titwala",
  "Palghar", "Boisar", "Dahanu", "Talasari", "Jawhar", "Mokhada",
  "Vikramgad", "Wada", "Vasai", "Virar", "Nalasopara",

  // Raigad
  "Panvel", "Navi Mumbai", "Taloja", "Kharghar", "Uran", "Pen", "Alibaug",
  "Roha", "Murud", "Mhasala", "Shrivardhan", "Mahad", "Poladpur",
  "Khalapur", "Pali", "Khopoli", "Karjat",

  // Ratnagiri & Sindhudurg
  "Ratnagiri", "Chiplun", "Sangameshwar", "Rajapur", "Lanja", "Dapoli",
  "Khed", "Guhagar", "Kankavli", "Kudal", "Sawantwadi", "Malvan",
  "Vengurla", "Dodamarg", "Devgad",

  // Pune district
  "Pune", "Pimpri-Chinchwad", "Hinjawadi", "Wakad", "Baner", "Kharadi",
  "Hadapsar", "Alandi", "Dehu", "Chakan", "Talegaon Dabhade", "Lonavala",
  "Khandala", "Kamshet", "Vadgaon Maval", "Rajgurunagar", "Manchar",
  "Narayangaon", "Otur", "Alephata", "Junnar", "Shirur", "Koregaon Bhima",
  "Shikrapur", "Wagholi", "Ranjangaon", "Sanaswadi", "Uruli Kanchan",
  "Yavat", "Daund", "Patas", "Bhigwan", "Kedgaon", "Kurkumbh", "Indapur", "Baramati",
  "Saswad", "Jejuri", "Purandar", "Bhor", "Pirangut", "Paud", "Velhe",
  "Loni Kalbhor", "Phursungi", "Urali Devachi", "Nere", "Punawale",

  // Satara district
  "Satara", "Karad", "Wai", "Mahabaleshwar", "Panchgani", "Koregaon",
  "Rahimatpur", "Dahiwadi", "Khatav", "Vita", "Tasgaon",
  "Kavathe Mahankal", "Shirwal", "Lonand", "Umbraj", "Masur", "Kodoli",
  "Ashta", "Phaltan", "Lonand Phata",

  // Sangli district
  "Sangli", "Miraj", "Ichalkaranji", "Islampur", "Atpadi", "Palus",
  "Kupwad", "Vite", "Jat", "Khanapur",

  // Kolhapur district
  "Kolhapur", "Gadhinglaj", "Ajra", "Chandgad", "Radhanagari", "Kagal",
  "Panhala", "Hatkanangale", "Shirol", "Gaganbawada", "Bavda",

  // Solapur district
  "Solapur", "Barshi", "Akkalkot", "Pandharpur", "Sangola", "Malshiras",
  "Akluj", "Tembhurni", "Karmala", "Madha", "Mohol", "Mangalwedha",
  "Vairag", "Kurduwadi", "Modnimb", "Natepute", "Omerga", "Tuljapur",

  // Nashik district
  "Nashik", "Malegaon", "Sinnar", "Igatpuri", "Dindori", "Peint",
  "Trimbakeshwar", "Kalwan", "Satana", "Chandwad", "Nandgaon", "Yeola",
  "Peth", "Surgana", "Ozar", "Niphad", "Nashik Road", "Manmad",

  // Dhule & Nandurbar
  "Dhule", "Sindkheda", "Dondaicha", "Sakri", "Nandurbar", "Shahada",
  "Taloda", "Navapur", "Akkalkuwa",

  // Jalgaon district
  "Jalgaon", "Bhusawal", "Chopda", "Pachora", "Jamner", "Chalisgaon",
  "Erandol", "Dharangaon", "Raver", "Yawal", "Amalner", "Parola",
  "Bhadgaon", "Muktainagar",

  // Ahmednagar (Ahilyanagar) district
  "Ahmednagar", "Shrirampur", "Newasa", "Shevgaon", "Pathardi", "Rahata",
  "Shirdi", "Kopargaon", "Sangamner", "Akole", "Jamkhed", "Parner",
  "Rahuri", "Ghodegaon", "Chaufula",

  // Chhatrapati Sambhajinagar (Aurangabad) district
  "Chhatrapati Sambhajinagar", "Aurangabad", "Kannad", "Sillod",
  "Phulambri", "Khultabad", "Paithan", "Gangapur", "Vaijapur",

  // Jalna district
  "Jalna", "Badnapur", "Bhokardan", "Jafrabad", "Partur", "Mantha",
  "Ghansawangi", "Ambad",

  // Beed district
  "Beed", "Ashti", "Patoda", "Shirur Kasar", "Georai", "Majalgaon",
  "Kaij", "Ambajogai", "Parli Vaijnath", "Wadwani", "Dharur",

  // Dharashiv (Osmanabad) district
  "Dharashiv", "Osmanabad", "Kalamb", "Bhum", "Paranda", "Umarga",

  // Latur district
  "Latur", "Nilanga", "Ausa", "Udgir", "Ahmadpur", "Chakur", "Jalkot",

  // Nanded district
  "Nanded", "Deglur", "Mukhed", "Bhokar", "Kandhar", "Loha", "Biloli",
  "Mudkhed", "Hadgaon", "Kinwat", "Mahur", "Dharmabad",

  // Parbhani & Hingoli
  "Parbhani", "Gangakhed", "Purna", "Selu", "Manwath", "Pathri",
  "Jintur", "Sonpeth", "Hingoli", "Kalamnuri", "Vasmat", "Sengaon",
  "Aundha Nagnath", "Basmath",

  // Washim & Akola
  "Washim", "Risod", "Karanja", "Mangrulpir", "Akola", "Akot",
  "Telhara", "Balapur", "Patur", "Barshitakli", "Murtizapur",

  // Buldhana district
  "Buldhana", "Chikhli", "Deulgaon Raja", "Mehkar", "Khamgaon",
  "Shegaon", "Malkapur", "Jalgaon Jamod", "Sindkhed Raja",

  // Amravati district
  "Amravati", "Achalpur", "Anjangaon", "Chandur Railway", "Morshi",
  "Warud", "Dharni", "Chikhaldara", "Daryapur", "Nandgaon Khandeshwar",

  // Yavatmal district
  "Yavatmal", "Pusad", "Umarkhed", "Digras", "Darwha", "Pandharkawada",
  "Ghatanji", "Wani", "Mahagaon", "Babhulgaon", "Kalamb Wani",

  // Wardha district
  "Wardha", "Arvi", "Deoli", "Pulgaon", "Hinganghat", "Samudrapur",
  "Seloo", "Karanja Ghadge",

  // Nagpur district
  "Nagpur", "Kamptee", "Hingna", "Umred", "Ramtek", "Katol", "Narkhed",
  "Kalameshwar", "Mouda", "Parseoni", "Kanhan", "Butibori",

  // Bhandara & Gondia
  "Bhandara", "Tumsar", "Sakoli", "Lakhani", "Pauni", "Mohadi",
  "Gondia", "Tirora", "Arjuni Morgaon", "Deori", "Amgaon",
  "Sadak Arjuni",

  // Chandrapur district
  "Chandrapur", "Ballarpur", "Rajura", "Korpana", "Warora", "Chimur",
  "Bhadravati", "Brahmapuri", "Mul", "Nagbhid", "Gondpipri",

  // Gadchiroli district
  "Gadchiroli", "Desaiganj", "Aheri", "Sironcha", "Chamorshi", "Armori",
  "Kurkheda", "Dhanora",
];

/** Deduped, alphabetically sorted catalog of Maharashtra towns. */
export const MAHARASHTRA_TOWNS: string[] = [...new Set(RAW_TOWNS)].sort((a, b) =>
  a.localeCompare(b)
);

const TOWN_KEYS: ReadonlySet<string> = new Set(
  MAHARASHTRA_TOWNS.map((t) => t.toLowerCase())
);

// ═══════════════════════════════════════════════════════════════
// TRADE CORRIDORS — ordered town sequences along Maharashtra's
// major highway / distribution routes (the state's real freight
// arteries). Order matters: `corridorTownsBetween` slices between
// the start and end indices to list only the towns en route.
// ═══════════════════════════════════════════════════════════════
export interface MhCorridor {
  /** Corridor label shown in the UI, e.g. "NH-48 · Pune → Mumbai". */
  label: string;
  /** Ordered towns from one end to the other (must exist in the catalog). */
  towns: string[];
}

export const MH_CORRIDORS: MhCorridor[] = [
  {
    label: "NH-48 · Pune → Mumbai",
    towns: [
      "Pune", "Pimpri-Chinchwad", "Talegaon Dabhade", "Lonavala",
      "Khandala", "Khopoli", "Panvel", "Navi Mumbai", "Thane", "Mumbai",
    ],
  },
  {
    label: "NH-60 · Pune → Nashik",
    towns: [
      "Pune", "Chakan", "Rajgurunagar", "Manchar", "Narayangaon",
      "Alephata", "Sangamner", "Sinnar", "Nashik",
    ],
  },
  {
    label: "NH-61 · Pune → Ahmednagar → Chh. Sambhajinagar",
    towns: [
      "Pune", "Koregaon Bhima", "Shirur", "Ahmednagar", "Newasa",
      "Paithan", "Chhatrapati Sambhajinagar",
    ],
  },
  {
    label: "NH-52 · Chh. Sambhajinagar → Jalna → Khamgaon → Akola → Amravati → Nagpur",
    towns: [
      "Chhatrapati Sambhajinagar", "Jalna", "Mehkar", "Khamgaon",
      "Shegaon", "Akola", "Murtizapur", "Amravati", "Chandur Railway",
      "Nagpur",
    ],
  },
  {
    label: "NH-65 · Pune → Solapur",
    towns: [
      "Pune", "Uruli Kanchan", "Kurkumbh", "Patas", "Bhigwan", "Indapur",
      "Tembhurni", "Karmala", "Mohol", "Solapur",
    ],
  },
  {
    label: "NH-48 · Pune → Satara → Karad → Kolhapur",
    towns: [
      "Pune", "Shirwal", "Lonand", "Satara", "Umbraj", "Karad",
      "Kodoli", "Ichalkaranji", "Kolhapur",
    ],
  },
  {
    label: "NH-548 · Pune → Baramati → Pandharpur",
    towns: [
      "Pune", "Uruli Kanchan", "Baramati", "Natepute", "Pandharpur",
    ],
  },
  {
    label: "NH-3 · Mumbai → Nashik",
    towns: ["Mumbai", "Thane", "Bhiwandi", "Shahapur", "Igatpuri", "Nashik"],
  },
  {
    label: "NH-66 · Mumbai → Ratnagiri → Sindhudurg (Goa road)",
    towns: [
      "Mumbai", "Panvel", "Pen", "Khopoli", "Mahad", "Poladpur",
      "Chiplun", "Sangameshwar", "Ratnagiri", "Rajapur", "Kankavli",
      "Kudal", "Sawantwadi",
    ],
  },
  {
    label: "NH-52 · Nashik → Yeola → Chh. Sambhajinagar",
    towns: ["Nashik", "Ozar", "Yeola", "Vaijapur", "Chhatrapati Sambhajinagar"],
  },
  {
    label: "NH-52 · Nashik → Manmad → Dhule",
    towns: ["Nashik", "Ozar", "Yeola", "Manmad", "Dhule"],
  },
  {
    label: "Pune → Saswad → Phaltan → Satara",
    towns: ["Pune", "Saswad", "Jejuri", "Phaltan", "Satara"],
  },
  {
    label: "Pune → Bhor → Wai → Mahabaleshwar",
    towns: ["Pune", "Bhor", "Wai", "Panchgani", "Mahabaleshwar"],
  },
  {
    label: "Solapur → Omerga → Latur → Nanded",
    towns: ["Solapur", "Umarga", "Omerga", "Latur", "Ahmadpur", "Nanded"],
  },
  {
    label: "Solapur → Pandharpur → Sangli → Kolhapur",
    towns: ["Solapur", "Pandharpur", "Sangli", "Miraj", "Ichalkaranji", "Kolhapur"],
  },
  {
    label: "Pune → Daund → Barshi → Latur",
    towns: ["Pune", "Daund", "Kurduwadi", "Barshi", "Nilanga", "Latur"],
  },
  {
    label: "Nashik → Dhule → Nandurbar",
    towns: ["Nashik", "Manmad", "Dhule", "Sindkheda", "Dondaicha", "Nandurbar"],
  },
  {
    label: "Nagpur → Wardha → Hinganghat → Chandrapur",
    towns: ["Nagpur", "Butibori", "Wardha", "Hinganghat", "Warora", "Chandrapur"],
  },
  {
    label: "Nagpur → Bhandara → Gondia",
    towns: ["Nagpur", "Kamptee", "Bhandara", "Tumsar", "Sakoli", "Gondia"],
  },
];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

export interface CorridorMatch {
  /** Ordered on-route towns strictly between start and end (endpoints excluded). */
  towns: string[];
  /** Label of the matched corridor, e.g. "NH-48 · Pune → Mumbai". */
  corridor: string;
}

/**
 * Towns lying ON the route between `start` and `end`.
 * Matches both towns to the same corridor (case-insensitive) and
 * slices whatever sits between them in driving order. If both
 * endpoints appear in several corridors, the tightest span wins.
 * Returns `null` when no corridor contains both towns.
 */
export function corridorTownsBetween(
  start: string,
  end: string
): CorridorMatch | null {
  const s = start.trim().toLowerCase();
  const e = end.trim().toLowerCase();
  if (!s || !e || s === e) return null;

  let best: { corridor: string; towns: string[] } | null = null;
  for (const c of MH_CORRIDORS) {
    const si = c.towns.findIndex((t) => t.toLowerCase() === s);
    const ei = c.towns.findIndex((t) => t.toLowerCase() === e);
    if (si === -1 || ei === -1 || si === ei) continue;
    const slice = (
      si < ei ? c.towns.slice(si + 1, ei) : c.towns.slice(ei + 1, si)
    ).filter((t) => TOWN_KEYS.has(t.toLowerCase()));
    if (!best || slice.length < best.towns.length) {
      best = { corridor: c.label, towns: slice };
    }
  }
  return best;
}

/** True when the given name exists in the Maharashtra catalog. */
export function isMaharashtraTown(name: string): boolean {
  return TOWN_KEYS.has(name.trim().toLowerCase());
}
