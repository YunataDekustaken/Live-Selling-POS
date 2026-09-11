/**
 * ESC/POS & TSPL Binary Command Builder for PT-210 (58mm Receipt) and PT-265 (30x20mm Thermal Label)
 * Standard 58mm receipt printers have 32 characters per line (font A).
 * 30mm x 20mm label printers (PT-265) have ~240 x 160 dots at 203 DPI.
 */

import type { LabelLayoutSettings, ReceiptLayoutSettings } from '../types';
import { defaultLabelLayout, defaultReceiptLayout } from '../data/defaultSettings';

export class EscPosEncoder {
  private buffer: number[] = [];
  private encoder: TextEncoder = new TextEncoder();
  private paperWidthCols: number = 32; // Default 58mm = 32 cols

  constructor(paperWidthCols: number = 32) {
    this.paperWidthCols = paperWidthCols;
    this.init();
  }

  public setPaperWidth(cols: number): this {
    this.paperWidthCols = cols;
    return this;
  }

  public getPaperWidth(): number {
    return this.paperWidthCols;
  }

  public init(): this {
    // ESC @ (Initialize printer)
    this.buffer.push(0x1B, 0x40);
    return this;
  }

  public alignLeft(): this {
    this.buffer.push(0x1B, 0x61, 0x00);
    return this;
  }

  public alignCenter(): this {
    this.buffer.push(0x1B, 0x61, 0x01);
    return this;
  }

  public alignRight(): this {
    this.buffer.push(0x1B, 0x61, 0x02);
    return this;
  }

  public bold(enabled: boolean = true): this {
    this.buffer.push(0x1B, 0x45, enabled ? 0x01 : 0x00);
    return this;
  }

  public underline(enabled: boolean = true): this {
    this.buffer.push(0x1B, 0x2D, enabled ? 0x01 : 0x00);
    return this;
  }

  public invert(enabled: boolean = true): this {
    this.buffer.push(0x1D, 0x42, enabled ? 0x01 : 0x00);
    return this;
  }

  /**
   * Set line spacing in dots (ESC 3 n)
   * e.g., 18 or 20 dots for compact sticker printing within 20mm height
   */
  public setLineSpacing(dots: number = 24): this {
    const clamped = Math.max(0, Math.min(255, dots));
    this.buffer.push(0x1B, 0x33, clamped);
    return this;
  }

  public resetLineSpacing(): this {
    // ESC 2 (Default line spacing ~30 dots)
    this.buffer.push(0x1B, 0x32);
    return this;
  }

  /**
   * Set text magnification:
   * widthMultiplier: 1 to 8 (1 = normal)
   * heightMultiplier: 1 to 8 (1 = normal)
   */
  public size(widthMultiplier: number = 1, heightMultiplier: number = 1): this {
    const w = Math.min(Math.max(1, widthMultiplier), 8) - 1;
    const h = Math.min(Math.max(1, heightMultiplier), 8) - 1;
    const byteVal = (w << 4) | h;
    this.buffer.push(0x1D, 0x21, byteVal);
    return this;
  }

  public normal(): this {
    this.bold(false);
    this.underline(false);
    this.invert(false);
    this.size(1, 1);
    this.alignLeft();
    return this;
  }

  public text(str: string): this {
    if (!str) return this;
    // Replace currency symbols and special chars for standard ASCII
    const cleanStr = str
      .replace(/₱/g, 'PHP ')
      .replace(/•/g, '-');
    const bytes = this.encoder.encode(cleanStr);
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i]);
    }
    return this;
  }

  public line(str: string = ''): this {
    this.text(str);
    this.buffer.push(0x0A);
    return this;
  }

  public feed(lines: number = 1): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0A);
    }
    return this;
  }

  /**
   * Feed until label gap / black mark sensor cutoff (GS FF: 0x1D, 0x0C)
   * In label mode, this commands PT-265 to stop precisely at the die-cut sticker gap.
   */
  public feedToLabelGap(): this {
    this.buffer.push(0x1D, 0x0C);
    return this;
  }

  /**
   * Form Feed (0x0C)
   */
  public formFeed(): this {
    this.buffer.push(0x0C);
    return this;
  }

  public separator(char: string = '-'): this {
    const repeated = char.repeat(this.paperWidthCols);
    return this.line(repeated);
  }

  public doubleSeparator(): this {
    return this.separator('=');
  }

  public twoColumns(left: string, right: string): this {
    const width = this.paperWidthCols;
    const cleanLeft = left.replace(/₱/g, 'PHP ').replace(/•/g, '-');
    const cleanRight = right.replace(/₱/g, 'PHP ').replace(/•/g, '-');
    
    const leftLen = cleanLeft.length;
    const rightLen = cleanRight.length;
    
    if (leftLen + rightLen >= width) {
      const availableForLeft = Math.max(1, width - rightLen - 1);
      const truncatedLeft = cleanLeft.substring(0, availableForLeft);
      const spaces = ' '.repeat(Math.max(1, width - truncatedLeft.length - rightLen));
      return this.line(truncatedLeft + spaces + cleanRight);
    } else {
      const spaces = ' '.repeat(width - leftLen - rightLen);
      return this.line(cleanLeft + spaces + cleanRight);
    }
  }

  public cut(): this {
    // GS V 66 0 (Partial cut with feed)
    this.buffer.push(0x1D, 0x56, 0x42, 0x00);
    return this;
  }

  public encode(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

/**
 * Builds ESC/POS Thermal Sticker byte stream optimized for 30x20mm (PT-265) & custom sizes
 */
export function buildStickerEscPos(
  item: {
    controlCode: string;
    controlNum?: number | string;
    tag?: string;
    description?: string;
    price: number;
    buyer: string;
    date?: string;
    time?: string;
  },
  profile: {
    name: string;
    currency?: string;
  },
  sessionDate: string = '',
  paperCols: number = 24,
  layoutConfig?: LabelLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const is30x20 = cfg.labelSize === '30x20mm';
  
  // Set appropriate columns: 30mm is ~20-24 chars in Font B, 58mm is 32 chars
  const cols = is30x20 ? (paperCols <= 24 ? paperCols : 22) : paperCols;
  const enc = new EscPosEncoder(cols);

  enc.init();

  // For 30x20mm compact sticker, set tight line spacing (18 dots) so content stays within 20mm
  if (is30x20 || cfg.compactSpacing) {
    enc.setLineSpacing(18);
  }

  // 1. Store Name / Session header (Optional, usually omitted on 30x20mm to save space)
  if (cfg.showStoreName) {
    enc.alignCenter()
      .bold(true)
      .line(profile.name || 'LIVE POS')
      .normal();
    if (is30x20) enc.setLineSpacing(18);
  }

  if (cfg.showSessionDate || cfg.showTime) {
    const parts: string[] = [];
    if (cfg.showSessionDate) parts.push(`#${sessionDate || 'LIVE'}`);
    if (cfg.showTime) parts.push(item.time || '');
    if (parts.length > 0) {
      enc.alignCenter().line(parts.join(' '));
    }
  }

  // 2. Control Code (e.g. [ #001 ] or [ LL-0910-001 ])
  if (cfg.showControlCode) {
    const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
    enc.alignCenter().bold(true);
    if (cfg.codeSize === 'extra_large') {
      enc.size(2, 2);
    } else if (cfg.codeSize === 'large') {
      enc.size(1, 2);
    } else {
      enc.size(1, 1);
    }
    enc.line(`[ ${codeStr} ]`).normal();
    if (is30x20) enc.setLineSpacing(18);
  }

  // 3. Buyer Tag (Prominent)
  if (cfg.showBuyer) {
    const cleanBuyer = (item.buyer || '').replace(/^@+/, '');
    enc.alignCenter().bold(true);
    if (cfg.buyerSize === 'large') {
      enc.size(1, 2);
    } else {
      enc.size(1, 1);
    }
    enc.line(`@${cleanBuyer}`).normal();
    if (is30x20) enc.setLineSpacing(18);
  }

  // 4. Item Tag / Description
  if (cfg.showTag || cfg.showDescription) {
    const tagPart = cfg.showTag ? (item.tag || item.controlCode) : '';
    const descPart = (cfg.showDescription && item.description) ? item.description : '';
    let textOut = '';
    if (tagPart && descPart) {
      textOut = `${tagPart}: ${descPart}`;
    } else {
      textOut = tagPart || descPart;
    }
    if (textOut) {
      enc.alignCenter().line(textOut.substring(0, cols));
    }
  }

  // 5. Price
  if (cfg.showPrice) {
    const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');
    enc.alignCenter().bold(true);
    if (cfg.priceSize === 'large') {
      enc.size(1, 2);
    } else {
      enc.size(1, 1);
    }
    enc.line(`${currencyStr} ${item.price.toLocaleString()}`).normal();
    if (is30x20) enc.setLineSpacing(18);
  }

  // 6. Custom Footer Note
  if (cfg.customFooterText && cfg.customFooterText.trim()) {
    enc.alignCenter().line(cfg.customFooterText.trim().substring(0, cols));
  }

  // 7. Gap Feed & Cutoff Line Command (Crucial for PT-265 sticker alignment)
  if (cfg.gapFeedMode === 'gs_ff') {
    // Command PT-265 to feed directly to sticker gap / black mark cutoff
    enc.feedToLabelGap();
  } else if (cfg.gapFeedMode === 'form_feed') {
    enc.formFeed();
  } else {
    // Plain line feeds
    const lines = cfg.feedLines !== undefined ? cfg.feedLines : (is30x20 ? 0 : 2);
    if (lines > 0) {
      enc.feed(lines);
    }
  }

  return enc.encode();
}

/**
 * Builds Native TSPL Label Byte stream for PT-265 (30mm x 20mm)
 * Uses printer hardware coordinates and gap sensor calibration for exact stopping.
 */
export function buildStickerTSPL(
  item: {
    controlCode: string;
    controlNum?: number | string;
    tag?: string;
    description?: string;
    price: number;
    buyer: string;
    date?: string;
    time?: string;
  },
  profile: {
    name: string;
    currency?: string;
  },
  sessionDate: string = '',
  layoutConfig?: LabelLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const is30x20 = cfg.labelSize === '30x20mm';

  // Label dimensions in mm (203 DPI = 8 dots/mm)
  // 30mm = 240 dots, 20mm = 160 dots
  const widthMm = is30x20 ? 30 : (cfg.labelSize === '40x30mm' ? 40 : 50);
  const heightMm = is30x20 ? 20 : (cfg.labelSize === '40x30mm' ? 30 : 30);

  const cleanBuyer = (item.buyer || '').replace(/^@+/, '').replace(/"/g, '');
  const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');
  const priceStr = `${currencyStr} ${item.price.toLocaleString()}`;

  let tspl = `SIZE ${widthMm} mm, ${heightMm} mm\r\n`;
  tspl += `GAP 2 mm, 0 mm\r\n`;
  tspl += `SPEED 4\r\n`;
  tspl += `DENSITY 10\r\n`;
  tspl += `DIRECTION 1\r\n`;
  tspl += `REFERENCE 0,0\r\n`;
  tspl += `CLS\r\n`;

  let yPos = 12;

  if (cfg.showStoreName) {
    const storeName = (profile.name || 'LIVE POS').replace(/"/g, '').substring(0, 16);
    tspl += `TEXT 120,${yPos},"1",0,1,1,2,"${storeName}"\r\n`; // Centered
    yPos += 22;
  }

  if (cfg.showControlCode) {
    tspl += `TEXT 120,${yPos},"3",0,1,1,2,"[ ${codeStr} ]"\r\n`;
    yPos += 34;
  }

  if (cfg.showBuyer) {
    tspl += `TEXT 120,${yPos},"2",0,1,1,2,"@${cleanBuyer.substring(0, 14)}"\r\n`;
    yPos += 28;
  }

  if (cfg.showTag || cfg.showDescription) {
    const desc = ((cfg.showDescription && item.description) ? item.description : (item.tag || '')).replace(/"/g, '').substring(0, 16);
    if (desc) {
      tspl += `TEXT 120,${yPos},"1",0,1,1,2,"${desc}"\r\n`;
      yPos += 20;
    }
  }

  if (cfg.showPrice) {
    tspl += `TEXT 120,${yPos},"3",0,1,1,2,"${priceStr}"\r\n`;
    yPos += 30;
  }

  if (cfg.customFooterText && cfg.customFooterText.trim()) {
    const footer = cfg.customFooterText.trim().replace(/"/g, '').substring(0, 16);
    tspl += `TEXT 120,${yPos},"1",0,1,1,2,"${footer}"\r\n`;
  }

  tspl += `PRINT 1,1\r\n`;

  return new TextEncoder().encode(tspl);
}

/**
 * Builds Gap Feed / Align Calibration command for PT-265
 */
export function buildFeedGapEscPos(): Uint8Array {
  const enc = new EscPosEncoder(24);
  enc.init();
  enc.feedToLabelGap();
  return enc.encode();
}

export function buildFeedGapTSPL(): Uint8Array {
  const tspl = `GAP 2 mm, 0 mm\r\nFORMFEED\r\n`;
  return new TextEncoder().encode(tspl);
}

/**
 * Builds consolidated Packing Slip ESC/POS byte stream for PT-210
 */
export function buildPackingSlipEscPos(
  basket: {
    handle: string;
    displayName?: string;
    items: Array<{ controlCode: string; controlNum?: number | string; tag?: string; description?: string; price: number }>;
    totalAmount: number;
    totalPaid: number;
    balance: number;
    status: string;
  },
  profile: {
    name: string;
    currency?: string;
    paymentDetails?: string;
  },
  sessionDate: string = '',
  paperCols: number = 32,
  layoutConfig?: ReceiptLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultReceiptLayout;
  const cols = cfg.paperWidth === '80mm' ? 48 : paperCols;
  const enc = new EscPosEncoder(cols);
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');

  enc.init();

  if (cfg.showStoreName || cfg.showTitle) {
    enc.alignCenter().bold(true);
    if (cfg.showStoreName) {
      enc.line(profile.name || 'LIVE SELLING POS');
    }
    if (cfg.showTitle) {
      enc.line('PARCEL PACKING SLIP');
    }
    enc.normal();
  }

  if (cfg.showSessionDate || cfg.showDateTime) {
    const parts: string[] = [];
    if (cfg.showSessionDate) parts.push(`Session: #${sessionDate}`);
    if (cfg.showDateTime) parts.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    enc.alignCenter().line(parts.join(' - '));
  }

  if (cfg.showDividers) enc.separator('-');

  // Customer Name
  if (cfg.showBuyerName) {
    enc.alignCenter()
      .size(2, 2)
      .bold(true)
      .line(`@${(basket.displayName || basket.handle).replace(/^@+/, '')}`)
      .normal();
  }

  if (cfg.showPaymentStatus) {
    enc.alignCenter()
      .line(`STATUS: ${basket.balance <= 0 ? 'FULLY SETTLED (PAID)' : 'OWING BALANCE'}`);
  }

  if (cfg.showDividers) enc.separator('-');

  // Items Header
  enc.twoColumns('ITEM / CODE', `AMT (${currencyStr})`);
  if (cfg.showDividers) enc.separator('-');

  basket.items.forEach((it, idx) => {
    const numPart = cfg.showItemNumber ? `${idx + 1}. ` : '';
    const code = it.controlNum ? `#${it.controlNum}` : it.controlCode;
    const tag = cfg.showItemTag ? ` [${it.tag || code}]` : '';
    const desc = (cfg.showItemDescription && it.description) ? ` (${it.description})` : '';
    const label = `${numPart}${code}${tag}${desc}`;
    enc.twoColumns(label, `${it.price.toLocaleString()}`);
  });

  if (cfg.showDividers) enc.separator('-');

  enc.bold(true);
  if (cfg.showItemCount) {
    enc.twoColumns(`Total Items:`, `${basket.items.length} pcs`);
  }
  if (cfg.showSubtotal) {
    enc.twoColumns(`Subtotal:`, `${currencyStr} ${basket.totalAmount.toLocaleString()}`);
  }
  if (cfg.showTotalPaid && basket.totalPaid > 0) {
    enc.twoColumns(`Paid:`, `${currencyStr} ${basket.totalPaid.toLocaleString()}`);
  }
  if (cfg.showBalanceDue) {
    enc.size(1, 2)
      .twoColumns(`BALANCE DUE:`, `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`)
      .normal();
  }

  if (cfg.showDividers) enc.doubleSeparator();

  if (cfg.showQcCheckbox) {
    enc.alignCenter().line('QC Verified: [  ] Packed Pass');
  }

  if (cfg.customFooterNote && cfg.customFooterNote.trim()) {
    enc.alignCenter().line(cfg.customFooterNote.trim());
  }

  enc.alignCenter().line(`*${basket.handle}*`);

  const lines = cfg.feedLines !== undefined ? cfg.feedLines : 3;
  if (lines > 0) {
    enc.feed(lines);
  }

  return enc.encode();
}

/**
 * Builds Official Customer Invoice ESC/POS byte stream for PT-210
 */
export function buildInvoiceEscPos(
  basket: {
    handle: string;
    displayName?: string;
    items: Array<{ controlCode: string; controlNum?: number | string; tag?: string; description?: string; price: number }>;
    totalAmount: number;
    totalPaid: number;
    balance: number;
    status: string;
  },
  profile: {
    name: string;
    currency?: string;
    paymentDetails?: string;
  },
  sessionDate: string = '',
  paperCols: number = 32,
  layoutConfig?: ReceiptLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultReceiptLayout;
  const cols = cfg.paperWidth === '80mm' ? 48 : paperCols;
  const enc = new EscPosEncoder(cols);
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');
  const cleanName = (basket.displayName || basket.handle).replace(/^@+/, '');

  enc.init();

  if (cfg.showStoreName || cfg.showTitle) {
    enc.alignCenter().bold(true);
    if (cfg.showStoreName) {
      enc.line(profile.name || 'LIVE SELLING POS');
    }
    if (cfg.showTitle) {
      enc.line('OFFICIAL SALES INVOICE');
    }
    enc.normal();
  }

  enc.alignCenter().line(`#INV-${sessionDate}-${cleanName.toUpperCase()}`);
  if (cfg.showDividers) enc.separator('-');

  if (cfg.showBuyerName) {
    enc.alignCenter()
      .size(2, 2)
      .bold(true)
      .line(`@${cleanName}`)
      .normal();
  }

  if (cfg.showSessionDate || cfg.showDateTime) {
    enc.alignCenter().line(`Date: ${sessionDate} - ${new Date().toLocaleDateString()}`);
  }

  if (cfg.showDividers) enc.separator('-');

  enc.twoColumns('ITEM', `PRICE`);
  if (cfg.showDividers) enc.separator('-');

  basket.items.forEach((it, i) => {
    const numPart = cfg.showItemNumber ? `${i + 1}. ` : '';
    const code = it.controlNum ? `#${it.controlNum}` : it.controlCode;
    const desc = (cfg.showItemDescription && it.description) ? ` (${it.description})` : '';
    enc.twoColumns(`${numPart}${code}${desc}`, `${it.price.toLocaleString()}`);
  });

  if (cfg.showDividers) enc.separator('-');

  if (cfg.showSubtotal) {
    enc.twoColumns('Subtotal:', `${currencyStr} ${basket.totalAmount.toLocaleString()}`);
  }
  if (cfg.showTotalPaid && basket.totalPaid > 0) {
    enc.twoColumns('Paid:', `${currencyStr} ${basket.totalPaid.toLocaleString()}`);
  }
  if (cfg.showBalanceDue) {
    enc.size(1, 2)
      .bold(true)
      .twoColumns('TOTAL DUE:', `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`)
      .normal();
  }

  if (cfg.showDividers) enc.separator('-');

  if (cfg.showPaymentAccounts && profile.paymentDetails) {
    enc.alignLeft()
      .bold(true)
      .line('PAYMENT ACCOUNTS:')
      .normal();
    const lines = profile.paymentDetails.split('\n');
    lines.forEach(l => {
      if (l.trim()) enc.line(l.trim());
    });
    if (cfg.showDividers) enc.separator('-');
  }

  if (cfg.customFooterNote && cfg.customFooterNote.trim()) {
    enc.alignCenter().line(cfg.customFooterNote.trim());
  }

  enc.alignCenter().line(`*${basket.handle}*`);

  const lines = cfg.feedLines !== undefined ? cfg.feedLines : 3;
  if (lines > 0) {
    enc.feed(lines);
  }

  return enc.encode();
}

/**
 * Builds printer self-test receipt byte stream
 */
export function buildTestReceiptEscPos(
  storeName: string = 'PT-210 Thermal Printer',
  paperCols: number = 32
): Uint8Array {
  const enc = new EscPosEncoder(paperCols);
  enc.init()
    .alignCenter()
    .bold(true)
    .size(2, 2)
    .line('TEST PRINT')
    .normal()
    .line(storeName)
    .separator('=')
    .alignCenter()
    .line('Direct Web Bluetooth Ready!')
    .line('ESC/POS Protocol: OK')
    .line(`Width: ${paperCols} columns (58mm)`)
    .line(`Date: ${new Date().toLocaleString()}`)
    .separator('-')
    .bold(true)
    .line('*** 100% SUCCESS ***')
    .normal()
    .feed(3);
  return enc.encode();
}
