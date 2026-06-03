import xlsx from "xlsx";
import path from "path";
import fs from "fs";

// XLSX file path
const filePath = path.join(
  process.cwd(),
  "_Massachusetts - Nebraska IDN Hospital List.xlsx",
);

// Read workbook with date support
const workbook = xlsx.readFile(filePath, {
  cellDates: true, // ⭐ IMPORTANT FIX
});

// Get first sheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = xlsx.utils.sheet_to_json(worksheet, {
  defval: null, // keeps empty cells as null instead of skipping
});

// Optional: clean + normalize data
const formattedData = data.map((row) => {
  const cleanRow = { ...row };

  // Convert Excel date serial OR Date object safely
  if (cleanRow["Expected Close Date"]) {
    const val = cleanRow["Expected Close Date"];

    if (val instanceof Date) {
      cleanRow["Expected Close Date"] = val.toISOString();
    } else if (typeof val === "number") {
      cleanRow["Expected Close Date"] = new Date(
        (val - 25569) * 86400 * 1000,
      ).toISOString();
    }
  }

  return cleanRow;
});

// Output file path
const outputPath = path.join(process.cwd(), "contacts-data.txt");

// Write JSON data into txt file
fs.writeFileSync(outputPath, JSON.stringify(formattedData, null, 2), "utf-8");

console.log("Data written successfully to contacts-data.txt");
