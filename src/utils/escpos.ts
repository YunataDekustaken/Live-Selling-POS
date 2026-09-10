/**
 * ESC/POS Binary Command Builder for 58mm (PT-210 / GOOJPRT / MPT) and 80mm Thermal Printers
 * Standard 58mm receipt printers have 32 characters per line (font A).
 */

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
    // Replace currency symbols if needed for raw ASCII or UTF-8
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
 * Builds standard 58mm Thermal Sticker byte stream for PT-210
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
  paperCols: number = 32
): Uint8Array {
  const enc = new EscPosEncoder(paperCols);

  enc.init()
    .alignCenter()
    .bold(true)
    .line(profile.name || 'LIVE MINING POS')
    .normal()
    .alignCenter()
    .line(`Session: #${sessionDate || '0905'} ${item.time || ''}`)
    .separator('-');

  // Big Bold Item Control Code Box
  const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
  enc.alignCenter()
    .size(2, 2)
    .bold(true)
    .line(`[ ${codeStr} ]`)
    .normal();

  // Item Description / Tag
  if (item.tag || item.description) {
    enc.alignCenter()
      .bold(true)
      .line(`Tag: ${item.tag || item.controlCode}`)
      .normal();
    if (item.description) {
      enc.alignCenter()
        .line(`(${item.description})`);
    }
  }

  enc.separator('-');

  // Price (Large)
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');
  enc.alignCenter()
    .size(2, 2)
    .bold(true)
    .line(`${currencyStr} ${item.price.toLocaleString()}`)
    .normal();

  // Buyer Tag (Inverted / Bold highlight)
  const cleanBuyer = (item.buyer || '').replace(/^@+/, '');
  enc.alignCenter()
    .bold(true)
    .size(1, 2)
    .line(`@${cleanBuyer}`)
    .normal()
    .separator('=')
    .feed(3);

  return enc.encode();
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
  paperCols: number = 32
): Uint8Array {
  const enc = new EscPosEncoder(paperCols);
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');

  enc.init()
    .alignCenter()
    .bold(true)
    .line(profile.name || 'LIVE SELLING POS')
    .line('PARCEL PACKING SLIP')
    .normal()
    .line(`Session: #${sessionDate} • ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
    .separator('-');

  // Customer Name Large
  enc.alignCenter()
    .size(2, 2)
    .bold(true)
    .line(`@${(basket.displayName || basket.handle).replace(/^@+/, '')}`)
    .normal()
    .alignCenter()
    .line(`STATUS: ${basket.balance <= 0 ? 'FULLY SETTLED (PAID)' : 'OWING BALANCE'}`)
    .separator('-');

  // Items Header
  enc.twoColumns('ITEM / CODE', `AMT (${currencyStr})`)
    .separator('-');

  basket.items.forEach((it, idx) => {
    const code = it.controlNum ? `#${it.controlNum}` : it.controlCode;
    const desc = it.description ? ` (${it.description})` : '';
    const label = `${idx + 1}. ${code} [${it.tag || code}]${desc}`;
    enc.twoColumns(label, `${it.price.toLocaleString()}`);
  });

  enc.separator('-')
    .bold(true)
    .twoColumns(`Total Items:`, `${basket.items.length} pcs`)
    .twoColumns(`Subtotal:`, `${currencyStr} ${basket.totalAmount.toLocaleString()}`);

  if (basket.totalPaid > 0) {
    enc.twoColumns(`Paid:`, `${currencyStr} ${basket.totalPaid.toLocaleString()}`);
  }

  enc.size(1, 2)
    .twoColumns(`BALANCE DUE:`, `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`)
    .normal()
    .doubleSeparator()
    .alignCenter()
    .line('QC Verified: [  ] Packed Pass')
    .line(`*${basket.handle}*`)
    .feed(3);

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
  paperCols: number = 32
): Uint8Array {
  const enc = new EscPosEncoder(paperCols);
  const currencyStr = (profile.currency || 'PHP').replace(/₱/g, 'PHP');
  const cleanName = (basket.displayName || basket.handle).replace(/^@+/, '');

  enc.init()
    .alignCenter()
    .bold(true)
    .line(profile.name || 'LIVE SELLING POS')
    .line('OFFICIAL SALES INVOICE')
    .normal()
    .line(`#INV-${sessionDate}-${cleanName.toUpperCase()}`)
    .separator('-');

  enc.alignCenter()
    .size(2, 2)
    .bold(true)
    .line(`@${cleanName}`)
    .normal()
    .line(`Date: ${sessionDate} • ${new Date().toLocaleDateString()}`)
    .separator('-');

  enc.twoColumns('ITEM', `PRICE`)
    .separator('-');

  basket.items.forEach((it, i) => {
    const code = it.controlNum ? `#${it.controlNum}` : it.controlCode;
    const desc = it.description ? ` (${it.description})` : '';
    enc.twoColumns(`${i + 1}. ${code}${desc}`, `${it.price.toLocaleString()}`);
  });

  enc.separator('-')
    .twoColumns('Subtotal:', `${currencyStr} ${basket.totalAmount.toLocaleString()}`);

  if (basket.totalPaid > 0) {
    enc.twoColumns('Paid:', `${currencyStr} ${basket.totalPaid.toLocaleString()}`);
  }

  enc.size(1, 2)
    .bold(true)
    .twoColumns('TOTAL DUE:', `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`)
    .normal()
    .separator('-');

  if (profile.paymentDetails) {
    enc.alignLeft()
      .bold(true)
      .line('PAYMENT ACCOUNTS:')
      .normal();
    const lines = profile.paymentDetails.split('\n');
    lines.forEach(l => {
      if (l.trim()) enc.line(l.trim());
    });
    enc.separator('-');
  }

  enc.alignCenter()
    .line('Thank you for mining with us!')
    .line(`*${basket.handle}*`)
    .feed(3);

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
