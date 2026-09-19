"use client";

// ═══════════════════════════════════════════════════════════════
// INV-GUIDE — the step-by-step "how to link a platform" page.
// Universal Inventory is the source of truth; an external codebase
// (ERP / B2B store / Franchise-B2C) integrates over the
// /api/universal/v1 REST surface with its own API key. This guide
// is written so an outside developer can do it without help.
// ═══════════════════════════════════════════════════════════════

import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  BookOpenText, KeyRound, Radio, Boxes, RefreshCw, ShieldCheck, Copy, Check,
  Building2, Store, ShoppingBag, ArrowRight,
} from "lucide-react";

const ENDPOINTS: Array<[string, string, string]> = [
  ["GET", "/api/universal/v1/health", "Connection + auth test"],
  ["GET", "/api/universal/v1/products", "Full catalog (delta since ?since=ISO)"],
  ["GET", "/api/universal/v1/products/{sku}", "One product"],
  ["POST", "/api/universal/v1/products", "Create one product (attribution to your portal)"],
  ["POST", "/api/universal/v1/products/bulk", "Upsert up to 500 rows by SKU"],
  ["GET", "/api/universal/v1/stock", "TOTAL stock map for every SKU"],
  ["GET", "/api/universal/v1/stock/{sku}", "TOTAL stock for one SKU"],
  ["POST", "/api/universal/v1/stock/{sku}", "Stock delta (+receive / −sale)"],
];

const STEPS: Array<{ title: string; body: React.ReactNode; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }> = [
  {
    title: "Register the platform in Integrations",
    body: <>Open the <b>Integrations</b> tab → “Register platform” → pick the kind (ERP · B2B store · Franchise &amp; B2C). A unique API key is generated and shown exactly once — store it in the platform&apos;s secrets manager, never in code.</>,
    icon: KeyRound,
  },
  {
    title: "Verify the connection",
    body: <>From the platform&apos;s backend, call <code className="font-mono text-dmk-yellow">GET /api/universal/v1/health</code> with the header <code className="font-mono text-dmk-yellow">X-API-Key: &lt;key&gt;</code>. A green “UP” proves the key, the network path and permissions in one shot.</>,
    icon: Radio,
  },
  {
    title: "Mirror the catalog",
    body: <>Pull the full catalog once with <code className="font-mono text-dmk-yellow">GET /products?limit=1000</code>, then keep it fresh with delta pulls (<code className="font-mono text-dmk-yellow">?since=&lt;lastSync ISO&gt;</code>) every 30–60 minutes — or register a webhook URL and the inventory engine will push new/updated products to you automatically on the same cadence.</>,
    icon: Boxes,
  },
  {
    title: "Create products from your platform",
    body: <>When your portal adds a product, POST it to <code className="font-mono text-dmk-yellow">/products</code> (or <code className="font-mono text-dmk-yellow">/products/bulk</code> for batches). It lands in the shared catalog attributed to your platform (<code className="font-mono">sourcePortal</code>) and becomes visible everywhere instantly — including its canonical “Brand Name + Product Name” image file name.</>,
    icon: Store,
  },
  {
    title: "Read totals, never warehouses",
    body: <>Stock answers contain <b>totals only</b> (<code className="font-mono">totalStock</code>, <code className="font-mono">availableStock</code>, <code className="font-mono">damagedStock</code>, <code className="font-mono">lowStock</code>). Warehouse placement is a physical-operations concern that stays inside this portal — an attempt to send a warehouse field is rejected with <code className="font-mono">ERR_WAREHOUSE_IS_PRIVATE</code>.</>,
    icon: ShieldCheck,
  },
  {
    title: "Report stock movements",
    body: <>Sales, returns and receipts go out as deltas: <code className="font-mono text-dmk-yellow">POST /stock/&#123;sku&#125; {"{ \"delta\": -3 }"}</code>. The universal engine mirrors the delta onto the default warehouse and the catalog total stays exact for everyone.</>,
    icon: RefreshCw,
  },
];

function CodeBlock({ title, code }: { title: string; code: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="rounded-lg border border-dmk-border-subtle overflow-hidden">
      <div className="flex items-center justify-between bg-dmk-hover px-3 py-1.5">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-dmk-text-muted">{title}</p>
        <button
          onClick={() => { void navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); toast({ title: "Copied" }); }}
          className="inline-flex items-center gap-1 text-[10.5px] text-dmk-text-muted hover:text-dmk-text-primary transition-colors"
          aria-label={`Copy ${title} snippet`}
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[11px] leading-relaxed font-mono text-dmk-text-secondary bg-[#0B1220]">{code}</pre>
    </div>
  );
}

export function InvGuide() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[20px] font-black tracking-tight text-dmk-text-primary flex items-center gap-2">
          <BookOpenText className="h-5 w-5 text-dmk-yellow" /> Setup Guide — link a platform
        </h1>
        <p className="text-[12px] text-dmk-text-muted mt-1 leading-relaxed">
          Universal Inventory is the single source of truth. Any external codebase — this ERP, a B2B ecommerce
          platform, or the Franchise &amp; B2C software — integrates with one API key and the REST surface below.
          The 30/60-minute re-check keeps everyone aligned automatically.
        </p>
      </div>

      {/* Platform kinds */}
      <div className="grid md:grid-cols-3 gap-3">
        {([
          { icon: Building2, label: "DMK Mart ERP", desc: "Billing, POs and books read catalog + totals; stock changes flow through the shared engine." },
          { icon: Store, label: "B2B ecommerce platform", desc: "Showcases the catalog, takes orders, reads availableStock to promise safely, pushes sales as −deltas." },
          { icon: ShoppingBag, label: "Franchise & B2C software", desc: "Each franchise outlet sells from the same catalog; adds its own products when sourcing locally." },
        ] as const).map((k) => (
          <div key={k.label} className="dmk-card p-4">
            <k.icon className="h-5 w-5 text-dmk-yellow" strokeWidth={1.75} />
            <p className="mt-2 text-[13px] font-bold text-dmk-text-primary">{k.label}</p>
            <p className="mt-1 text-[11.5px] text-dmk-text-muted leading-relaxed">{k.desc}</p>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="space-y-2.5">
        {STEPS.map((s, i) => (
          <div key={s.title} className="dmk-card p-4 flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className="h-8 w-8 rounded-full bg-dmk-yellow/15 border border-dmk-yellow/30 flex items-center justify-center text-[12px] font-black text-dmk-yellow">
                {i + 1}
              </span>
              {i < STEPS.length - 1 && <span className="flex-1 w-px bg-dmk-border-subtle mt-2" aria-hidden />}
            </div>
            <div className="min-w-0 pb-1">
              <p className="text-[13.5px] font-bold text-dmk-text-primary flex items-center gap-2">
                <s.icon className="h-4 w-4 text-dmk-yellow" /> {s.title}
              </p>
              <p className="mt-1.5 text-[12px] text-dmk-text-secondary leading-relaxed">{s.body}</p>
            </div>
          </div>
        ))}
      </div>

      {/* API reference */}
      <div className="dmk-card p-4">
        <p className="text-[13.5px] font-bold text-dmk-text-primary mb-2">Universal API reference</p>
        <div className="rounded-lg border border-dmk-border-subtle overflow-x-auto">
          <table className="w-full text-[11.5px] min-w-[560px]">
            <thead>
              <tr className="bg-dmk-hover text-left text-[9.5px] uppercase tracking-wider text-dmk-text-muted">
                <th className="py-2 px-3 font-bold">Method</th>
                <th className="py-2 px-3 font-bold">Path</th>
                <th className="py-2 px-3 font-bold">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([m, p, d]) => (
                <tr key={m + p} className="border-t border-dmk-border-subtle/60">
                  <td className="py-2 px-3">
                    <span className={cn("dmk-badge h-5 px-1.5 font-mono text-[9.5px]", m === "GET" ? "bg-emerald-500/15 text-emerald-400" : "bg-dmk-yellow/15 text-dmk-yellow")}>{m}</span>
                  </td>
                  <td className="py-2 px-3 font-mono text-[11px] text-dmk-text-primary">{p}</td>
                  <td className="py-2 px-3 text-dmk-text-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2.5 text-[11px] text-dmk-text-muted flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> All requests require the header <code className="font-mono text-dmk-yellow">X-API-Key</code>. Responses are the standard DMK envelope <code className="font-mono">{`{ ok, data }`}</code>.
        </p>
      </div>

      {/* Snippets */}
      <div className="grid lg:grid-cols-2 gap-3">
        <CodeBlock
          title="cURL — pull catalog delta"
          code={`curl "https://<inventory-host>/api/universal/v1/products?since=2026-01-01T00:00:00Z" \\
  -H "X-API-Key: dmk_inv_xxxxxxxxxxxxxxxx"`}
        />
        <CodeBlock
          title="Node.js — create a product from your platform"
          code={`const res = await fetch("/api/universal/v1/products", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({
    sku: "DMK-PL-9001",
    name: "Palace Planter 12 inch",
    brand: "DMK Polymers",
    category: "Planters",
    gstRate: 18,
    tier4Retailer: 240,
    tier5Mrp: 320,
    photoUrl: "https://res.cloudinary.com/dmkmart/.../palace-planter.webp",
    openingStock: 24,
  }),
});
const { data } = await res.json();`}
        />
        <CodeBlock
          title="Node.js — report a sale (stock out)"
          code={`await fetch("/api/universal/v1/stock/DMK-PL-9001", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": KEY },
  body: JSON.stringify({ delta: -2, reason: "B2B order #1043" }),
});`}
        />
        <CodeBlock
          title="Webhook payload you receive (push mode)"
          code={`POST <your-webhookUrl>
{
  "type": "CATALOG_DELTA",
  "source": "DMK Universal Inventory",
  "generatedAt": "2026-01-01T10:00:00Z",
  "changedCount": 3,
  "products": [ { "sku": "…", "name": "…", "image": { "fileName": "brand-product-name.webp" }, "stock": { "totalStock": 120 } } ]
}`}
        />
      </div>

      <div className="dmk-card p-4 border-dmk-yellow/25 bg-dmk-yellow/[0.04]">
        <div className="flex items-start gap-3">
          <ArrowRight className="h-4.5 w-4.5 text-dmk-yellow shrink-0 mt-0.5" strokeWidth={1.75} />
          <p className="text-[11.5px] text-dmk-text-secondary leading-relaxed">
            <b className="text-dmk-text-primary">Rule of thumb:</b> products and images flow OUT of this portal to every platform;
            sales and stock changes flow IN as deltas; warehouse placement never leaves. The Sync Center&apos;s 30/60-minute
            re-check reconciles everything and keeps a durable audit trail.
          </p>
        </div>
      </div>
    </div>
  );
}
