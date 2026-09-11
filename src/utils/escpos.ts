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
   * Set left margin in dots (GS L nL nH)
   * Essential for narrow paper pushed to right side by printer guide.
   * e.g. 18mm * 8 dots/mm = 144 dots
   */
  public setLeftMargin(dots: number = 0): this {
    const clamped = Math.max(0, Math.min(576, dots));
    const nL = clamped % 256;
    const nH = Math.floor(clamped / 256);
    this.buffer.push(0x1D, 0x4C, nL, nH);
    return this;
  }

  /**
   * Set printable area width in dots (GS W nL nH)
   * e.g. 30mm * 8 dots/mm = 240 dots
   */
  public setPrintAreaWidth(dots: number = 384): this {
    const clamped = Math.max(8, Math.min(576, dots));
    const nL = clamped % 256;
    const nH = Math.floor(clamped / 256);
    this.buffer.push(0x1D, 0x57, nL, nH);
    return this;
  }

  /**
   * Set line spacing in dots (ESC 3 n)
   * e.g., 14 or 16 dots for compact sticker printing within 20mm height
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
  paperCols: number = 20,
  layoutConfig?: LabelLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const is30x20 = cfg.labelSize === '30x20mm';
  
  // 30mm width is approx 18-20 characters in compact font
  const cols = is30x20 ? 20 : paperCols;
  const enc = new EscPosEncoder(cols);

  enc.init();

  // Physical right-side or custom horizontal offset (PT-265 has left guide pushing paper to right)
  const offsetMm = cfg.horizontalOffsetMm !== undefined ? cfg.horizontalOffsetMm : (cfg.paperGuidePosition === 'right' ? 18 : 0);
  const leftMarginDots = Math.round(offsetMm * 8);
  if (leftMarginDots > 0) {
    enc.setLeftMargin(leftMarginDots);
    enc.setPrintAreaWidth(is30x20 ? 240 : 384);
  }

  // Ultra-compact line spacing so 30x20mm content never exceeds 140 dots (20mm = 160 dots)
  enc.setLineSpacing(is30x20 ? 14 : 20);

  // 1. Store Name (Only if enabled and space permits)
  if (cfg.showStoreName) {
    const storeStr = (profile.name || 'LIVE POS').substring(0, cols);
    enc.alignCenter().bold(true).line(storeStr).normal();
    enc.setLineSpacing(is30x20 ? 14 : 20);
  }

  // 2. Control Code (e.g. [ #001 ] or [ #0910-01 ])
  if (cfg.showControlCode) {
    const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
    enc.alignCenter().bold(true);
    if (cfg.codeSize === 'extra_large' && !is30x20) {
      enc.size(2, 2);
    } else if (cfg.codeSize === 'large' || is30x20) {
      enc.size(1, 1);
    } else {
      enc.size(1, 1);
    }
    enc.line(`[ ${codeStr} ]`).normal();
    enc.setLineSpacing(is30x20 ? 14 : 20);
  }

  // 3. Buyer Tag
  if (cfg.showBuyer) {
    const cleanBuyer = (item.buyer || '').replace(/^@+/, '').substring(0, cols - 1);
    enc.alignCenter().bold(true).line(`@${cleanBuyer}`).normal();
    enc.setLineSpacing(is30x20 ? 14 : 20);
  }

  // 4. Tag / Description & Price (Combined compactly for 20mm height)
  if (cfg.showPrice || cfg.showTag || cfg.showDescription) {
    const currencyStr = (profile.currency || 'P').replace(/₱/g, 'P').replace(/PHP/g, 'P');
    const priceStr = cfg.showPrice ? `${currencyStr}${item.price.toLocaleString()}` : '';
    const tagPart = cfg.showTag ? (item.tag || item.controlCode || '') : '';
    const descPart = (cfg.showDescription && item.description) ? item.description : '';
    const itemLabel = tagPart || descPart;

    if (itemLabel && priceStr) {
      enc.alignCenter().bold(true).line(`${itemLabel.substring(0, 10)}  ${priceStr}`).normal();
    } else if (priceStr) {
      enc.alignCenter().bold(true).line(priceStr).normal();
    } else if (itemLabel) {
      enc.alignCenter().line(itemLabel.substring(0, cols)).normal();
    }
    enc.setLineSpacing(is30x20 ? 14 : 20);
  }

  // 5. Custom Footer Note (optional)
  if (cfg.customFooterText && cfg.customFooterText.trim()) {
    enc.alignCenter().line(cfg.customFooterText.trim().substring(0, cols));
  }

  // 6. Cutoff Gap Feed
  if (cfg.gapFeedMode === 'gs_ff') {
    enc.feedToLabelGap();
  } else if (cfg.gapFeedMode === 'form_feed') {
    enc.formFeed();
  } else if (cfg.extraFeedLines > 0) {
    enc.feed(cfg.extraFeedLines);
  }

  return enc.encode();
}

/**
 * Builds Native TSPL Label Byte stream for PT-265 (30mm x 20mm and custom sizes)
 * Uses printer hardware coordinates, right-side guide offset, and hardware gap sensor.
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

  // Physical label dimensions in mm (203 DPI = 8 dots/mm)
  // 30mm = 240 dots, 20mm = 160 dots
  const widthMm = is30x20 ? 30 : (cfg.labelSize === '40x30mm' ? 40 : 50);
  const heightMm = is30x20 ? 20 : (cfg.labelSize === '40x30mm' ? 30 : 30);
  const gapMm = cfg.gapHeightMm || 2;

  // Calculate right-side physical guide offset in dots
  // On PT-265 (58mm mechanism), a 30mm roll pushed to the right has ~18mm offset
  const offsetMm = cfg.horizontalOffsetMm !== undefined ? cfg.horizontalOffsetMm : (cfg.paperGuidePosition === 'right' ? 18 : 0);
  const xOffsetDots = Math.max(0, Math.round(offsetMm * 8));
  const yOffsetDots = Math.round((cfg.verticalOffsetMm || 0) * 8);

  const cleanBuyer = (item.buyer || '').replace(/^@+/, '').replace(/"/g, '');
  const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
  const currencyStr = (profile.currency || 'P').replace(/₱/g, 'P').replace(/PHP/g, 'P');
  const priceStr = `${currencyStr}${item.price.toLocaleString()}`;

  // Build TSPL command stream
  let tspl = `SIZE ${widthMm} mm, ${heightMm} mm\r\n`;
  tspl += `GAP ${gapMm} mm, 0 mm\r\n`;
  tspl += `SPEED ${cfg.printSpeed || 3}\r\n`;
  tspl += `DENSITY ${cfg.printDensity || 10}\r\n`;
  tspl += `DIRECTION 1\r\n`;
  tspl += `REFERENCE ${xOffsetDots},${yOffsetDots}\r\n`;
  tspl += `CLS\r\n`;

  // Center coordinate on 30mm sticker (240 dots wide / 2 = 120 dots)
  const stickerCenter = Math.round((widthMm * 8) / 2); // 120 for 30mm
  const stickerRight = Math.round((widthMm * 8) - 10); // 230 for 30mm
  const stickerLeft = 10;

  let yPos = is30x20 ? 8 : 12;

  // 1. Store Name (Optional on 30x20mm)
  if (cfg.showStoreName) {
    const storeName = (profile.name || 'LIVE POS').replace(/"/g, '').substring(0, 14);
    tspl += `TEXT ${stickerCenter},${yPos},"1",0,1,1,2,"${storeName}"\r\n`;
    yPos += is30x20 ? 18 : 22;
  }

  // 2. Control Code (e.g. [ #001 ])
  if (cfg.showControlCode) {
    const font = cfg.codeSize === 'extra_large' ? '3' : (cfg.codeSize === 'large' ? '3' : '2');
    tspl += `TEXT ${stickerCenter},${yPos},"${font}",0,1,1,2,"[ ${codeStr} ]"\r\n`;
    yPos += is30x20 ? 30 : 34;
  }

  // 3. Buyer Handle (e.g. @janedoe)
  if (cfg.showBuyer) {
    const buyerFont = cfg.buyerSize === 'large' ? '3' : '2';
    tspl += `TEXT ${stickerCenter},${yPos},"${buyerFont}",0,1,1,2,"@${cleanBuyer.substring(0, 13)}"\r\n`;
    yPos += is30x20 ? 28 : 32;
  }

  // 4. Tag / Description & Price (Smart compact 20mm layout)
  if (cfg.showPrice || cfg.showTag || cfg.showDescription) {
    const tagPart = cfg.showTag ? (item.tag || item.controlCode || '') : '';
    const descPart = (cfg.showDescription && item.description) ? item.description : '';
    const labelText = (tagPart || descPart).replace(/"/g, '').substring(0, 10);

    if (cfg.showPrice && labelText) {
      // Print Tag on left, Price on right
      tspl += `TEXT ${stickerLeft},${yPos},"1",0,1,1,1,"${labelText}"\r\n`;
      tspl += `TEXT ${stickerRight},${yPos},"2",0,1,1,3,"${priceStr}"\r\n`;
      yPos += is30x20 ? 22 : 26;
    } else if (cfg.showPrice) {
      tspl += `TEXT ${stickerCenter},${yPos},"3",0,1,1,2,"${priceStr}"\r\n`;
      yPos += is30x20 ? 24 : 28;
    } else if (labelText) {
      tspl += `TEXT ${stickerCenter},${yPos},"1",0,1,1,2,"${labelText}"\r\n`;
      yPos += is30x20 ? 18 : 22;
    }
  }

  // 5. Custom Footer (if space and configured)
  if (cfg.customFooterText && cfg.customFooterText.trim() && yPos <= 140) {
    const footer = cfg.customFooterText.trim().replace(/"/g, '').substring(0, 14);
    tspl += `TEXT ${stickerCenter},${yPos},"1",0,1,1,2,"${footer}"\r\n`;
  }

  // 6. Print Command: PT-265 will print exactly 1 label and stop precisely at gap
  tspl += `PRINT 1,1\r\n`;

  return new TextEncoder().encode(tspl);
}

/**
 * Builds Gap Feed / Align Calibration command for PT-265
 */
export function buildFeedGapEscPos(layoutConfig?: LabelLayoutSettings): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const enc = new EscPosEncoder(20);
  enc.init();
  const offsetMm = cfg.horizontalOffsetMm !== undefined ? cfg.horizontalOffsetMm : 18;
  enc.setLeftMargin(Math.round(offsetMm * 8));
  enc.feedToLabelGap();
  return enc.encode();
}

export function buildFeedGapTSPL(layoutConfig?: LabelLayoutSettings): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const gapMm = cfg.gapHeightMm || 2;
  const tspl = `GAP ${gapMm} mm, 0 mm\r\nFORMFEED\r\n`;
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
