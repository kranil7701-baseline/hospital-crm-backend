import Contact from "./model/Contact.ts"
import mongoose from "mongoose";
import dotenv from "dotenv";
import IDN from "./model/Idn.ts"
import Hospital from "./model/Hospital.ts"
import Deal from "./model/deal.ts"
dotenv.config();
import dns from "dns"
import {contacts, hospitals, IDNs, users, deals, GPOs, products} from "../data.js"

 dns.setDefaultResultOrder("ipv4first");
 dns.setServers(["8.8.8.8", "8.8.4.4"]);

mongoose.connect(process.env.DATABASE).then(() => console.log("MongoDB Connected")).catch((err) => console.log("DB Error:", err));






const normalize = (str) =>
  (str ?? "")
    .toString()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// ---------------- NORMALIZE MAPS ----------------
const normalizedHospitals = Object.keys(hospitals).reduce((acc, key) => {
  acc[normalize(key)] = hospitals[key];
  return acc;
}, {});

const normalizedIDNs = Object.keys(IDNs).reduce((acc, key) => {
  acc[normalize(key)] = IDNs[key];
  return acc;
}, {});

const normalizedGPOs = Object.keys(GPOs).reduce((acc, key) => {
  acc[normalize(key)] = GPOs[key];
  return acc;
}, {});

const normalizedProducts = Object.keys(products).reduce((acc, key) => {
  acc[normalize(key)] = products[key];
  return acc;
}, {});

const normalizedUsers = Object.keys(users).reduce((acc, key) => {
  acc[normalize(key)] = users[key];
  return acc;
}, {});

// ---------------- SAFE OBJECT ID ----------------
function safeObjectId(map, key) {
  if (!key) return undefined;

  const normalizedKey = normalize(key);

  return map[normalizedKey]
    ? new mongoose.Types.ObjectId(map[normalizedKey])
    : undefined;
}

// ---------------- DEBUG TRACKERS ----------------
const invalidHospitals = [];
const invalidUsers = [];
const invalidProducts = [];

// ---------------- FORMAT DEALS ----------------
const formattedDeals = deals.map((d) => {
  const hospitalName = d["Deal Name"]?.toString().trim();
  const ownerName = d["Deal owner"]?.toString().trim();
  const productName = d.Product?.toString().trim();

  const hospitalId = safeObjectId(
    normalizedHospitals,
    hospitalName
  );

  const idnId = safeObjectId(
    normalizedIDNs,
    d.IDN
  );

  const gpoId = safeObjectId(
    normalizedGPOs,
    d.GPO
  );

  const productId = safeObjectId(
    normalizedProducts,
    productName
  );

  const userId = safeObjectId(
    normalizedUsers,
    ownerName
  );

  // ---------------- DEBUG ----------------
  if (!hospitalId) {
    invalidHospitals.push(hospitalName || "EMPTY_HOSPITAL");
  }

  if (!userId) {
    invalidUsers.push(ownerName || "EMPTY_USER");
  }

  // only log if product exists but mapping missing
  if (productName && !productId) {
    invalidProducts.push(productName);
  }

  // ---------------- PRODUCT ARRAY ----------------
  const productsArray = [];

  // only add product object if product exists
  if (productId) {
    productsArray.push({
      product: productId,

      dealAmount:
        d.Amount === "" || d.Amount == null
          ? undefined
          : Number(d.Amount),

      quantity: 1,

      beds: 0,

      stage: d["Deal Stage"] || "Demo",

      expectedCloseDate: d["Expected Close Date"]
        ? new Date(d["Expected Close Date"])
        : undefined,
    });
  }

  return {
    hospital: hospitalId,
    idn: idnId,
    gpo: gpoId,
    user: userId,

    products: productsArray,

    notes: "",
  };
});

// ---------------- PRINT ERRORS ----------------
if (invalidHospitals.length) {
  console.log("\n❌ Missing Hospital IDs:\n");

  console.log([...new Set(invalidHospitals)]);

  console.log(
    "\nTotal Missing Hospitals:",
    [...new Set(invalidHospitals)].length
  );
}

if (invalidUsers.length) {
  console.log("\n❌ Missing Users:\n");

  console.log([...new Set(invalidUsers)]);

  console.log(
    "\nTotal Missing Users:",
    [...new Set(invalidUsers)].length
  );
}

if (invalidProducts.length) {
  console.log("\n❌ Missing Products:\n");

  console.log([...new Set(invalidProducts)]);

  console.log(
    "\nTotal Missing Products:",
    [...new Set(invalidProducts)].length
  );
}

// ---------------- VALID DEALS ONLY ----------------
const validDeals = formattedDeals.filter(
  (d) =>
    d.hospital &&
    d.user
);

// ---------------- INSERT ----------------
async function insertDeals() {
  try {
    const result = await Deal.insertMany(validDeals);
    console.log("\n✅ Deals inserted:", result.length);

    await mongoose.disconnect();
  } catch (err) {
    console.error("\n❌ Error inserting deals:\n", err);
  }
}

insertDeals();