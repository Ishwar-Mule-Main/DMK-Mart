// ═══════════════════════════════════════════════════════════════
// /api/v1/products/template — CSV template download (one example row)
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

const HEADERS = [
  "SKU",
  "Product Name",
  "Category",
  "Brand/Manufacturer",
  "Unit",
  "HSN Code",
  "GST Rate (%)",
  "Purchase Cost",
  "Price_Tier1_Distributor",
  "Price_Tier2_Wholesale",
  "Price_Tier3_SemiWholesale",
  "Price_Tier4_Retailer",
  "Price_Tier5_MRP",
  "Opening Stock",
  "Opening Damaged Stock",
  "Low Stock Threshold",
  "Weight (g)",
  "Barcode",
];

export async function GET() {
  const example = [
    "DMK-CH-001",
    "Premium Arm Chair (Natural)",
    "Chairs",
    "DMK Polymers",
    "Pcs",
    "3924",
    "18",
    "210",
    "210",
    "235",
    "260",
    "295",
    "399",
    "180",
    "0",
    "40",
    "2400",
    "8901234567890",
  ];
  const csv = [HEADERS.join(","), example.join(",")].join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="dmk-product-template.csv"',
    },
  });
}
