/**
 * Mock implementation of ExcelJS for Jest tests.
 * ExcelJS has ESM/CJS interop issues in Jest environments.
 */

function makeCell() {
  return {
    value: null,
    font: null,
    fill: null,
    border: null,
    alignment: null,
  };
}

function makeRow(cells) {
  const row = {
    _cells: cells || [],
    font: null,
    fill: null,
    border: null,
    alignment: null,
    getCell: jest.fn((_i) => makeCell()),
  };
  return row;
}

function makeWorksheet(name) {
  const rows = [];
  // columns is a writable array-like so forEach and assignment both work
  const columns = [];
  const ws = {
    name,
    get columns() {
      return columns;
    },
    set columns(val) {
      // When source sets sheet.columns = [...], copy items in
      columns.length = 0;
      if (Array.isArray(val)) val.forEach((v) => columns.push({ ...v }));
    },
    autoFilter: null,
    properties: {},
    addRow: jest.fn((data) => {
      const row = makeRow(data);
      rows.push(row);
      return row;
    }),
    getRow: jest.fn((i) => {
      while (rows.length < i) rows.push(makeRow());
      return rows[i - 1] || makeRow();
    }),
    mergeCells: jest.fn(),
  };
  return ws;
}

function Workbook() {
  this.creator = "";
  this.created = null;
  this.modified = null;
  this.title = "";

  const sheets = [];

  this.addWorksheet = jest.fn((name, _options) => {
    const ws = makeWorksheet(name);
    sheets.push(ws);
    return ws;
  });

  this.xlsx = {
    writeBuffer: jest.fn().mockResolvedValue(Buffer.from("xlsx-content")),
  };

  this.sheets = sheets;
}

module.exports = { Workbook };
module.exports.default = { Workbook };
// Handle both `import ExcelJS from 'exceljs'` and `const ExcelJS = require('exceljs')`
Object.defineProperty(module.exports, "__esModule", { value: true });
module.exports.default = { Workbook };
