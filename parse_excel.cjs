const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Software/CaptureDoc Suite/capture-flow/CIB Salaries OCT2025.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

const fs = require('fs');
fs.writeFileSync('excel_out.json', JSON.stringify({
    headers: data[0],
    row1: data[1],
    row2: data[2],
    row3: data[3]
}, null, 2));
