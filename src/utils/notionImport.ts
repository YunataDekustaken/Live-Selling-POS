import type { MinedItem, PaymentRecord } from '../types';

export interface ParsedCsvResult {
  type: 'notion_balances' | 'notion_invoices' | 'pos_mines' | 'generic';
  typeName: string;
  headers: string[];
  rowCount: number;
  validRowCount: number;
  previewRows: Array<Record<string, any>>;
  uniqueCustomers: string[];
  totalSales: number;
  totalPayments: number;
  totalOutstanding: number;
  minedItems: MinedItem[];
  payments: PaymentRecord[];
  customerNotes: Record<string, string>;
  maxControlNum: number;
  detectedSessionDates: string[];
  warnings: string[];
}

export interface ImportedFileRecord {
  id: string;
  name: string;
  size: number;
  text: string;
  parsed: ParsedCsvResult;
}

export interface CombinedNotionImportData {
  files: ImportedFileRecord[];
  totalFiles: number;
  totalValidRows: number;
  uniqueCustomers: string[];
  totalSales: number;
  totalPayments: number;
  totalOutstanding: number;
  minedItems: MinedItem[];
  payments: PaymentRecord[];
  customerNotes: Record<string, string>;
  maxControlNum: number;
  detectedSessionDates: string[];
  hasInvoices: boolean;
  hasBalances: boolean;
  invoicesCount: number;
  balancesCount: number;
  invoicesPreview: Array<Record<string, any>>;
  balancesPreview: Array<Record<string, any>>;
  warnings: string[];
}

/**
 * Robust RFC 4180 compliant CSV line parser.
 * Handles quoted fields, embedded commas, double quotes, and CRLF/LF line breaks.
 */
export function parseCsvText(csvText: string): string[][] {
  if (!csvText || typeof csvText !== 'string') return [];

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  // Normalize newlines
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote: "" -> "
        currentField += '"';
        i++; // skip next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // End of field
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !insideQuotes) {
      // End of row
      currentRow.push(currentField.trim());
      // Only push non-empty rows
      if (currentRow.some(col => col.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  // Last field/row if any
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some(col => col.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Parses currency strings like "₱1,120.00", "₱ 785.00", "1,520.00", or "-₱500" into numeric values.
 */
export function parseCurrencyValue(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val || typeof val !== 'string') return 0;
  
  // Clean currency symbols, commas, spaces
  const cleaned = val
    .replace(/[₱\$\u20b1,]/g, '')
    .replace(/\s+/g, '')
    .trim();
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalizes customer names/handles by removing outer quotes, excessive whitespace, and leading @
 */
export function normalizeCustomerName(name: string): string {
  if (!name) return '';
  return name.replace(/^["']|["']$/g, '').trim();
}

/**
 * Analyzes CSV header row and content to determine Notion CSV type and maps records.
 */
export function analyzeNotionCsv(
  csvContent: string,
  prefix = 'A',
  defaultSession = '0911',
  fileSeed = ''
): ParsedCsvResult {
  const rows = parseCsvText(csvContent);
  const warnings: string[] = [];

  if (rows.length === 0) {
    return {
      type: 'generic',
      typeName: 'Empty File',
      headers: [],
      rowCount: 0,
      validRowCount: 0,
      previewRows: [],
      uniqueCustomers: [],
      totalSales: 0,
      totalPayments: 0,
      totalOutstanding: 0,
      minedItems: [],
      payments: [],
      customerNotes: {},
      maxControlNum: 0,
      detectedSessionDates: [],
      warnings: ['The provided CSV file contains no readable rows.']
    };
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map(h => h.toUpperCase().replace(/\s+/g, ' ').trim());
  const dataRows = rows.slice(1);

  // Helper to find column index by multiple potential name aliases
  const findCol = (aliases: string[]): number => {
    for (const alias of aliases) {
      const idx = headers.findIndex(h => h === alias || h.includes(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  // Check column indices for Notion Balances
  const custBalCol = findCol(['CUSTOMER', 'BUYER', 'NAME']);
  const statusCol = findCol(['STATUS']);
  const dateIssuedCol = findCol(['DATE ISSUED', 'DATE']);
  const totalAmtCol = findCol(['TOTAL AMOUNT', 'TOTAL', 'SUBTOTAL']);
  const paymentDateCol = findCol(['PAYMENT DATE']);
  const paymentsMadeCol = findCol(['PAYMENTS MADE', 'AMOUNT PAID', 'PAYMENT']);
  const outstandingCol = findCol(['OUTSTANDING', 'BALANCE', 'DUE']);
  const commentCol = findCol(['COMMENT', 'COMMENTS', 'NOTES', 'NOTE']);
  const overdueCol = findCol(['OVERDUE']);
  const tagsCol = findCol(['TAGS', 'TAG']);

  // Check column indices for Notion Invoices (Mined Items)
  const custNameCol = findCol(['CUSTOMER NAME', 'CUSTOMER', 'BUYER']);
  const amountCol = findCol(['AMOUNT', 'PRICE']);
  const controlNumCol = findCol(['CONTROL #', 'CONTROL NUMBER', 'CONTROL NO', 'ITEM #', 'CONTROL']);
  const dateCol = findCol(['DATE', 'DATE ISSUED']);
  const descCol = findCol(['DESCRIPTION', 'ITEM NAME', 'ITEM', 'PRODUCT']);
  const pictureCol = findCol(['PICTURE', 'PHOTO', 'IMAGE']);

  // Auto-detect type
  let detectedType: 'notion_balances' | 'notion_invoices' | 'pos_mines' | 'generic' = 'generic';
  let typeName = 'Generic CSV';

  if (controlNumCol !== -1 && descCol !== -1 && amountCol !== -1) {
    detectedType = 'notion_invoices';
    typeName = 'Notion Invoices (Items)';
  } else if (statusCol !== -1 && (paymentsMadeCol !== -1 || outstandingCol !== -1 || totalAmtCol !== -1)) {
    detectedType = 'notion_balances';
    typeName = 'Notion Customer Balances';
  } else if (custNameCol !== -1 && amountCol !== -1) {
    detectedType = 'notion_invoices';
    typeName = 'Itemized Invoices CSV';
  } else if (custBalCol !== -1 && (totalAmtCol !== -1 || commentCol !== -1)) {
    detectedType = 'notion_balances';
    typeName = 'Customer Balances CSV';
  }

  const minedItems: MinedItem[] = [];
  const payments: PaymentRecord[] = [];
  const customerNotes: Record<string, string> = {};
  const uniqueCustomerSet = new Set<string>();
  const sessionDatesSet = new Set<string>();
  const previewRows: Array<Record<string, any>> = [];

  let totalSales = 0;
  let totalPayments = 0;
  let totalOutstanding = 0;
  let maxControlNum = 0;
  let validRowCount = 0;

  const nowTimestamp = Date.now();
  const seedPrefix = fileSeed ? `${fileSeed}_` : '';

  if (detectedType === 'notion_invoices') {
    // Process Itemized Invoices
    dataRows.forEach((row, idx) => {
      const buyerRaw = custNameCol !== -1 ? row[custNameCol] : '';
      const buyer = normalizeCustomerName(buyerRaw);
      const priceRaw = amountCol !== -1 ? row[amountCol] : '';
      const price = parseCurrencyValue(priceRaw);
      const controlRaw = controlNumCol !== -1 ? row[controlNumCol] : '';
      const controlNum = parseInt(controlRaw.replace(/\D/g, ''), 10) || (idx + 1);
      const dateStr = (dateCol !== -1 ? row[dateCol] : '') || defaultSession;
      const descRaw = descCol !== -1 ? row[descCol] : '';
      const desc = descRaw.trim();
      const picRaw = pictureCol !== -1 ? row[pictureCol] : '';
      const tags = tagsCol !== -1 ? row[tagsCol] : '';

      // Skip totally blank rows
      if (!buyer && price === 0 && !desc) return;

      validRowCount++;
      if (buyer) uniqueCustomerSet.add(buyer);
      if (dateStr) sessionDatesSet.add(dateStr);
      if (controlNum > maxControlNum) maxControlNum = controlNum;
      totalSales += price;

      const cleanPrefix = prefix || 'A';
      const numFormatted = String(controlNum).padStart(2, '0');
      const controlCode = `${cleanPrefix}${numFormatted}`;

      const mineItem: MinedItem = {
        id: `notion_mine_${seedPrefix}${nowTimestamp}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        controlCode: controlCode,
        controlNum: controlNum,
        tag: desc || controlCode,
        description: desc || controlCode,
        price: price,
        buyer: buyer || 'Unassigned',
        photo: picRaw && picRaw.startsWith('http') ? picRaw : '',
        date: dateStr,
        time: '',
        timestamp: nowTimestamp - (dataRows.length - idx) * 1000
      };

      minedItems.push(mineItem);

      if (previewRows.length < 50) {
        previewRows.push({
          controlNum: controlNum,
          controlCode: controlCode,
          customer: buyer || '—',
          description: desc || '—',
          price: price,
          date: dateStr,
          photo: picRaw ? '📸 Photo' : '—',
          tags: tags || '—'
        });
      }
    });

  } else {
    // Process Notion Customer Balances
    dataRows.forEach((row, idx) => {
      const buyerRaw = custBalCol !== -1 ? row[custBalCol] : '';
      const buyer = normalizeCustomerName(buyerRaw);
      const status = statusCol !== -1 ? row[statusCol] : '';
      const dateIssued = dateIssuedCol !== -1 ? row[dateIssuedCol] : '';
      const paymentDate = paymentDateCol !== -1 ? row[paymentDateCol] : '';
      const comment = commentCol !== -1 ? row[commentCol] : '';
      const totalRaw = totalAmtCol !== -1 ? row[totalAmtCol] : '';
      const totalAmount = parseCurrencyValue(totalRaw);
      const paidRaw = paymentsMadeCol !== -1 ? row[paymentsMadeCol] : '';
      const paymentsMade = parseCurrencyValue(paidRaw);
      const outstandingRaw = outstandingCol !== -1 ? row[outstandingCol] : '';
      const outstanding = parseCurrencyValue(outstandingRaw);
      const overdue = overdueCol !== -1 ? row[overdueCol] : '';

      // Skip empty placeholder rows (like 'test,,,,,,,🟢 Paid,,')
      if (!buyer || (buyer.toLowerCase() === 'test' && totalAmount === 0 && paymentsMade === 0)) {
        return;
      }

      validRowCount++;
      uniqueCustomerSet.add(buyer);
      if (dateIssued) sessionDatesSet.add(dateIssued);
      if (paymentDate) sessionDatesSet.add(paymentDate);

      // Total calculations
      const rowTotal = totalAmount > 0 ? totalAmount : (paymentsMade + outstanding);
      totalSales += rowTotal;
      totalPayments += paymentsMade;
      totalOutstanding += (outstanding > 0 ? outstanding : Math.max(0, rowTotal - paymentsMade));

      // Customer comments / deposit notes
      if (comment && comment.trim()) {
        customerNotes[buyer] = comment.trim();
      }

      // Record payments if any
      if (paymentsMade > 0) {
        payments.push({
          id: `notion_pay_${seedPrefix}${nowTimestamp}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          buyer: buyer,
          amount: paymentsMade,
          method: 'GCash / Notion',
          ref: comment ? `Notion (${comment})` : 'Notion Import',
          date: paymentDate || dateIssued || defaultSession,
          time: '',
          timestamp: nowTimestamp - (dataRows.length - idx) * 2000
        });
      }

      if (previewRows.length < 50) {
        previewRows.push({
          customer: buyer,
          status: status || (outstanding > 0 ? '🔴 Due' : '🟢 Paid'),
          dateIssued: dateIssued || '—',
          totalAmount: rowTotal,
          paymentsMade: paymentsMade,
          paymentDate: paymentDate || '—',
          outstanding: outstanding > 0 ? outstanding : Math.max(0, rowTotal - paymentsMade),
          comment: comment || '—',
          overdue: overdue || '—'
        });
      }
    });
  }

  if (validRowCount === 0) {
    warnings.push('No valid data rows could be extracted from this CSV.');
  }

  return {
    type: detectedType,
    typeName: typeName,
    headers: rawHeaders,
    rowCount: dataRows.length,
    validRowCount: validRowCount,
    previewRows: previewRows,
    uniqueCustomers: Array.from(uniqueCustomerSet),
    totalSales: totalSales,
    totalPayments: totalPayments,
    totalOutstanding: totalOutstanding,
    minedItems: minedItems,
    payments: payments,
    customerNotes: customerNotes,
    maxControlNum: maxControlNum,
    detectedSessionDates: Array.from(sessionDatesSet),
    warnings: warnings
  };
}

/**
 * Combines multiple parsed Notion CSV files into a unified dataset.
 * Properly aggregates itemized mined items, customer payments, deposits, and balances.
 */
export function combineImportedFiles(files: ImportedFileRecord[]): CombinedNotionImportData {
  const uniqueCustomers = new Set<string>();
  const sessionDates = new Set<string>();
  const combinedMinedItems: MinedItem[] = [];
  const combinedPayments: PaymentRecord[] = [];
  const combinedNotes: Record<string, string> = {};
  const invoicesPreview: Array<Record<string, any>> = [];
  const balancesPreview: Array<Record<string, any>> = [];
  const warnings: string[] = [];

  let totalValidRows = 0;
  let maxControlNum = 0;
  let hasInvoices = false;
  let hasBalances = false;
  let balanceTotalSales = 0;
  let invoiceTotalSales = 0;
  let totalPayments = 0;
  let totalOutstanding = 0;

  files.forEach(file => {
    const p = file.parsed;
    totalValidRows += p.validRowCount;
    
    p.uniqueCustomers.forEach(c => uniqueCustomers.add(c));
    p.detectedSessionDates.forEach(d => sessionDates.add(d));

    if (p.type === 'notion_invoices' || p.minedItems.length > 0) {
      hasInvoices = true;
      combinedMinedItems.push(...p.minedItems);
      invoiceTotalSales += p.totalSales;
      if (p.maxControlNum > maxControlNum) {
        maxControlNum = p.maxControlNum;
      }
      if (invoicesPreview.length < 50) {
        invoicesPreview.push(...p.previewRows.slice(0, 50 - invoicesPreview.length));
      }
    }

    if (p.type === 'notion_balances' || p.payments.length > 0 || Object.keys(p.customerNotes).length > 0) {
      hasBalances = true;
      combinedPayments.push(...p.payments);
      Object.assign(combinedNotes, p.customerNotes);
      balanceTotalSales += p.totalSales;
      totalPayments += p.totalPayments;
      totalOutstanding += p.totalOutstanding;
      if (balancesPreview.length < 50) {
        balancesPreview.push(...p.previewRows.slice(0, 50 - balancesPreview.length));
      }
    }

    if (p.warnings.length > 0) {
      warnings.push(...p.warnings.map(w => `[${file.name}] ${w}`));
    }
  });

  // Calculate overall sales volume: prioritize itemized invoices total if present
  const totalSales = hasInvoices ? invoiceTotalSales : balanceTotalSales;

  return {
    files: files,
    totalFiles: files.length,
    totalValidRows: totalValidRows,
    uniqueCustomers: Array.from(uniqueCustomers),
    totalSales: totalSales,
    totalPayments: totalPayments,
    totalOutstanding: totalOutstanding,
    minedItems: combinedMinedItems,
    payments: combinedPayments,
    customerNotes: combinedNotes,
    maxControlNum: maxControlNum,
    detectedSessionDates: Array.from(sessionDates),
    hasInvoices: hasInvoices,
    hasBalances: hasBalances,
    invoicesCount: combinedMinedItems.length,
    balancesCount: combinedPayments.length > 0 ? combinedPayments.length : Object.keys(combinedNotes).length,
    invoicesPreview: invoicesPreview,
    balancesPreview: balancesPreview,
    warnings: warnings
  };
}
