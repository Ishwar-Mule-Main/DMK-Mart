// ═══════════════════════════════════════════════════════════════
// DMK MART ERP — KEYBOARD SHORTCUTS REGISTRY (single source of truth)
// ═══════════════════════════════════════════════════════════════
// Every shortcut that ACTUALLY works in the product is declared here.
// Three consumers:
//   • use-global-shortcuts.ts  → installs the real key handlers
//   • shortcuts-dialog.tsx (?) → the in-app help overlay
//   • Settings → Keyboard Shortcuts card → the company-profile list
// Add a shortcut here once and it works, is listed, and is searchable.
// ═══════════════════════════════════════════════════════════════

export type ShortcutSection = "global" | "navigate" | "search" | "language";

export interface ShortcutDef {
  id: string;
  /** Display combo, e.g. "⌘ K" or "G then D". */
  keys: string;
  /** Human description per UI language. */
  desc: Record<"en" | "hi" | "mr", string>;
  section: ShortcutSection;
  /** The chord letter used after "G" (navigate section only). */
  chord?: string;
}

export const SHORTCUT_SECTIONS: Array<{ id: ShortcutSection; labelKey: string }> = [
  { id: "global", labelKey: "kbs.section.global" },
  { id: "navigate", labelKey: "kbs.section.navigate" },
  { id: "search", labelKey: "kbs.section.search" },
  { id: "language", labelKey: "kbs.section.language" },
];

export const SHORTCUTS: ShortcutDef[] = [
  // ── Global ──────────────────────────────────────────────────
  {
    id: "palette",
    keys: "⌘ K / Ctrl K",
    desc: {
      en: "Open the command palette — search everything, jump anywhere",
      hi: "कमांड पैलेट खोलें — सब कुछ खोजें, कहीं भी जाएँ",
      mr: "कमांड पॅलेट उघडा — सर्व काही शोधा, कुठेही जा",
    },
    section: "global",
  },
  {
    id: "help",
    keys: "?",
    desc: {
      en: "Open this keyboard shortcuts help",
      hi: "यह कीबोर्ड शॉर्टकट सहायता खोलें",
      mr: "ही कीबोर्ड शॉर्टकट मदत उघडा",
    },
    section: "global",
  },
  {
    id: "esc",
    keys: "Esc",
    desc: {
      en: "Close any open dialog, palette or dropdown",
      hi: "कोई भी खुला डायलॉग, पैलेट या ड्रॉपडाउन बंद करें",
      mr: "कोणताही उघडा डायलॉग, पॅलेट किंवा ड्रॉपडाउन बंद करा",
    },
    section: "global",
  },

  // ── Navigate (G chords) ─────────────────────────────────────
  { id: "nav-dashboard", keys: "G → D", chord: "d", section: "navigate", desc: { en: "Go to Dashboard", hi: "डैशबोर्ड पर जाएँ", mr: "डॅशबोर्डवर जा" } },
  { id: "nav-billing", keys: "G → B", chord: "b", section: "navigate", desc: { en: "Go to Fast Billing (B2B)", hi: "तेज़ बिलिंग (B2B) पर जाएँ", mr: "जलद बिलिंग (B2B) वर जा" } },
  { id: "nav-b2c", keys: "G → C", chord: "c", section: "navigate", desc: { en: "Go to B2C Counter", hi: "B2C काउंटर पर जाएँ", mr: "B2C काउंटरवर जा" } },
  { id: "nav-invoices", keys: "G → I", chord: "i", section: "navigate", desc: { en: "Go to Invoice Register", hi: "इनवॉइस रजिस्टर पर जाएँ", mr: "इन्व्हॉइस रजिस्टरवर जा" } },
  { id: "nav-products", keys: "G → P", chord: "p", section: "navigate", desc: { en: "Go to Products", hi: "उत्पाद पर जाएँ", mr: "उत्पादनेवर जा" } },
  { id: "nav-po", keys: "G → O", chord: "o", section: "navigate", desc: { en: "Go to Purchase Orders", hi: "खरीद आदेश पर जाएँ", mr: "खरेदी ऑर्डरवर जा" } },
  { id: "nav-vendors", keys: "G → V", chord: "v", section: "navigate", desc: { en: "Go to Vendors", hi: "विक्रेता पर जाएँ", mr: "पुरवठादार यांच्याकडे जा" } },
  { id: "nav-ai", keys: "G → A", chord: "a", section: "navigate", desc: { en: "Go to AI Copilot", hi: "AI कोपायलट पर जाएँ", mr: "AI को-पायलटवर जा" } },
  { id: "nav-reports", keys: "G → R", chord: "r", section: "navigate", desc: { en: "Go to Reports & Exports", hi: "रिपोर्ट और निर्यात पर जाएँ", mr: "अहवाल व निर्यातवर जा" } },
  { id: "nav-settings", keys: "G → S", chord: "s", section: "navigate", desc: { en: "Go to Settings", hi: "सेटिंग्स पर जाएँ", mr: "सेटिंग्जवर जा" } },

  // ── Search ──────────────────────────────────────────────────
  {
    id: "slash",
    keys: "/",
    desc: {
      en: "Open search (command palette) from any page",
      hi: "किसी भी पेज से खोज (कमांड पैलेट) खोलें",
      mr: "कोणत्याही पानावरून शोध (कमांड पॅलेट) उघडा",
    },
    section: "search",
  },
  {
    id: "palette-search",
    keys: "type in ⌘K",
    desc: {
      en: "Word-wise search: type SKU, party, invoice # — best matches surface on top",
      hi: "शब्द-वार खोज: SKU, पार्टी, इनवॉइस # लिखें — सबसे उपयुक्त नतीजे सबसे ऊपर",
      mr: "शब्दनिहाय शोध: SKU, पक्षकार, इन्व्हॉइस # टाइप करा — योग्य निकाल सर्वात वर",
    },
    section: "search",
  },

  // ── Language & voice ────────────────────────────────────────
  {
    id: "cycle-lang",
    keys: "Alt L",
    desc: {
      en: "Cycle interface language — English → हिंदी → मराठी",
      hi: "इंटरफ़ेस भाषा बदलें — English → हिंदी → मराठी",
      mr: "इंटरफेस भाषा बदला — English → हिंदी → मराठी",
    },
    section: "language",
  },
  {
    id: "voice",
    keys: "Mic button",
    desc: {
      en: "In AI Copilot: speak your question, hear the answer aloud (EN/हिंदी/मराठी)",
      hi: "AI कोपायलट में: सवाल बोलें, उत्तर ज़ोर से सुनें (EN/हिंदी/मराठी)",
      mr: "AI को-पायलटमध्ये: प्रश्न बोला, उत्तर मोठ्याने ऐका (EN/हिंदी/मराठी)",
    },
    section: "language",
  },
];

/** The chord map used by the global key handler (chord letter → ViewId). */
export const G_CHORDS: Record<string, string> = {
  d: "dashboard",
  b: "sales/billing",
  c: "sales/b2c",
  i: "sales/invoices",
  p: "inventory/products",
  o: "purchase/orders",
  v: "purchase/vendors",
  a: "ai",
  r: "reports",
  s: "settings",
};
