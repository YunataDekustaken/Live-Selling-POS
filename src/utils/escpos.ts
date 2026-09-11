/**
 * ESC/POS & TSPL Binary Command Builder for PT-210 (58mm Receipt) and PT-265 (30x20mm Thermal Label)
 * Standard 58mm receipt printers have 32 characters per line (font A).
 * 30mm x 20mm label printers (PT-265) have ~240 x 160 dots at 203 DPI.
 */

import type { LabelLayoutSettings, ReceiptLayoutSettings } from '../types';
import { defaultLabelLayout, defaultReceiptLayout } from '../data/defaultSettings';
import QRCode from 'qrcode';

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
    // FS . (Cancel Chinese/Kanji mode if active to ensure crisp ASCII rendering of '@')
    this.buffer.push(0x1C, 0x2E);
    // ESC t 0 (Select Standard Character Code Table - PC437 USA)
    this.buffer.push(0x1B, 0x74, 0x00);
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
   * e.g., 12 or 14 dots for compact sticker printing within 20mm height
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
   * Feed n vertical dots (ESC J n: 0x1B, 0x4A, n)
   */
  public feedDots(dots: number = 60): this {
    const clamped = Math.max(1, Math.min(255, dots));
    this.buffer.push(0x1B, 0x4A, clamped);
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

  /**
   * Print Code128 / Code39 Barcode (GS k)
   */
  public barcode(data: string, heightDots: number = 24): this {
    if (!data) return this;
    const clean = data.replace(/[^A-Za-z0-9_-]/g, '');
    if (!clean) return this;
    
    // Set Barcode Height (GS h n)
    this.buffer.push(0x1D, 0x68, Math.min(255, Math.max(10, heightDots)));
    // Set Barcode Width (GS w 1 - ultra narrow 1-dot module to prevent wide error on 30mm labels)
    this.buffer.push(0x1D, 0x77, 0x01);
    // HRI character position: None (GS H 0)
    this.buffer.push(0x1D, 0x48, 0x00);
    // Align center
    this.alignCenter();
    // Code128 (GS k 73 len data)
    const codeBytes = new TextEncoder().encode(`{B${clean}`);
    this.buffer.push(0x1D, 0x6B, 73, codeBytes.length);
    for (let i = 0; i < codeBytes.length; i++) {
      this.buffer.push(codeBytes[i]);
    }
    this.buffer.push(0x0A);
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
 * Generates an ESC/POS 1-bit Monochrome Raster Graphic (GS v 0) from an HTML5 Canvas.
 * - Matches the visual Label Designer 100% pixel-for-pixel (typography, layout, borders).
 * - Fixed height: exactly 160 dots (20.0mm at 203 DPI) - physically impossible to overflow onto a 2nd sticker!
 * - Full head width: exactly 384 dots (48 bytes) with built-in left margin shift (18mm = 144 dots).
 * - ZERO "wide error" because it uses standard raster image format (GS v 0), not vulnerable text line-wrap/barcode limits.
 * - Concludes with a single Optical Gap Advance (GS FF: 0x1D 0x0C) to stop right at the die-cut peel gap.
 */
export async function buildStickerCanvasRaster(
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
): Promise<Uint8Array> {
  const cfg = layoutConfig || defaultLabelLayout;
  const is30x20 = cfg.labelSize === '30x20mm' || !cfg.labelSize;
  
  // Sticker physical dimensions at 203 DPI (8 dots/mm)
  // 30mm = 240px, 20mm = 160px
  const stickerW = is30x20 ? 240 : (cfg.labelSize === '40x30mm' ? 320 : 384);
  const stickerH = is30x20 ? 160 : (cfg.labelSize === '40x30mm' ? 240 : 240);

  const canvas = document.createElement('canvas');
  canvas.width = stickerW;
  canvas.height = stickerH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Fallback to text ESC/POS if canvas context unavailable
    return buildStickerEscPos(item, profile, sessionDate, 16, cfg);
  }

  // Pure White Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, stickerW, stickerH);

  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';

  const useQrLayout = cfg.showQrCode !== false;

  if (cfg.customElements && cfg.customElements.length > 0) {
    // -------------------------------------------------------------------------
    // DYNAMIC INTERACTIVE VISUAL DESIGNER LAYOUT:
    // Renders each user-customized element at its exact (x, y) coordinates,
    // font size, weight, alignment, and dimensions.
    // -------------------------------------------------------------------------
    for (const elem of cfg.customElements) {
      if (!elem.visible) continue;

      if (elem.id === 'qrCode') {
        const qrSize = elem.width || 88;
        const qrText = item.controlCode || (item.controlNum ? `#${item.controlNum}` : '001');
        try {
          const qr = QRCode.create(qrText, { errorCorrectionLevel: 'M' });
          const moduleCount = qr.modules.size;
          const marginModules = 1;
          const totalModules = moduleCount + (marginModules * 2);
          const modPixel = Math.max(1, Math.floor(qrSize / totalModules));
          const actualQrW = totalModules * modPixel;

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(elem.x, elem.y, actualQrW, actualQrW);
          ctx.fillStyle = '#000000';
          for (let r = 0; r < moduleCount; r++) {
            for (let c = 0; c < moduleCount; c++) {
              if (qr.modules.get(r, c)) {
                ctx.fillRect(
                  elem.x + ((c + marginModules) * modPixel),
                  elem.y + ((r + marginModules) * modPixel),
                  modPixel,
                  modPixel
                );
              }
            }
          }
        } catch (e) {
          console.warn('QR render error:', e);
        }
      } else if (elem.id === 'barcode') {
        const barH = elem.height || 36;
        const totalW = elem.width || 200;
        ctx.fillStyle = '#000000';
        const codeNum = (item.controlCode || (item.controlNum ? String(item.controlNum) : '001')).replace(/[^A-Za-z0-9]/g, '');
        let bX = elem.x;
        for (let i = 0; i < codeNum.length; i++) {
          const charCode = codeNum.charCodeAt(i);
          for (let b = 0; b < 7; b++) {
            if ((charCode >> b) & 1) {
              ctx.fillRect(bX, elem.y, 2, Math.max(16, barH - 12));
            }
            bX += 3;
            if (bX >= elem.x + totalW) break;
          }
        }
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '9px monospace';
        ctx.fillText(`*${codeNum}*`, elem.x + (totalW / 2), elem.y + barH - 10);
      } else if (elem.id === 'divider') {
        const lineW = elem.width || (stickerW - 16);
        ctx.beginPath();
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 2]);
        ctx.moveTo(elem.x, elem.y);
        ctx.lineTo(elem.x + lineW, elem.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Text element
        let val = '';
        if (elem.id === 'controlCode') {
          val = (item.controlCode || (item.controlNum ? `#${item.controlNum}` : 'L0911-002')).replace(/^\[\s*|\s*\]$/g, '');
        } else if (elem.id === 'time') {
          val = item.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        } else if (elem.id === 'buyer') {
          val = (item.buyer || '').replace(/^@+/, '') || 'Buyer';
        } else if (elem.id === 'tag') {
          val = item.tag || item.description || 'Item';
        } else if (elem.id === 'price') {
          let cur = elem.prefix !== undefined ? elem.prefix : (profile.currency || '₱');
          if (cur === 'P') cur = '₱';
          val = `${cur}${item.price.toLocaleString()}`;
        } else if (elem.id === 'storeName') {
          val = profile.name || 'Store';
        } else if (elem.id === 'sessionDate') {
          val = sessionDate || '0911';
        } else if (elem.id === 'footerText') {
          val = elem.customText || cfg.footerText || cfg.customFooterText || '';
        }

        if (elem.prefix && elem.id !== 'price') val = elem.prefix + val;
        if (elem.suffix) val = val + elem.suffix;

        const weight = elem.fontWeight === 'black' ? '900' : (elem.fontWeight === 'bold' ? 'bold' : 'normal');
        const family = elem.fontFamily === 'mono' ? 'monospace' : 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.font = `${weight} ${elem.fontSize || 14}px ${family}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#000000';

        let drawX = elem.x;
        if (elem.width) {
          if (elem.align === 'right') {
            ctx.textAlign = 'right';
            drawX = elem.x + elem.width;
          } else if (elem.align === 'center') {
            ctx.textAlign = 'center';
            drawX = elem.x + Math.round(elem.width / 2);
          } else {
            ctx.textAlign = 'left';
            drawX = elem.x;
          }
        } else {
          ctx.textAlign = elem.align || 'left';
          drawX = elem.x;
        }

        ctx.fillText(val, drawX, elem.y);
      }
    }
  } else if (useQrLayout) {
    // -------------------------------------------------------------------------
    // EXACT REFERENCE DESIGN:
    // Top: [ControlCode] (e.g. L0911-002, bold)   [Time] (e.g. 13:02, regular)
    // Left Column:
    //   - Buyer Name (e.g. Screamcheese)
    //   - Item/Tag (e.g. Pumice)
    //   - Price (e.g. P500)
    // Right Column:
    //   - Clean 2D QR Code
    // -------------------------------------------------------------------------
    const padX = 8;
    const topY = 6;

    // 1. Top Header Row: Control Code on left, Time on right
    let codeStr = item.controlCode || (item.controlNum ? `#${item.controlNum}` : 'L0911-002');
    codeStr = codeStr.replace(/^\[\s*|\s*\]$/g, ''); // Remove brackets

    ctx.textBaseline = 'top';

    if (cfg.showControlCode !== false) {
      ctx.textAlign = 'left';
      const fontSize = cfg.codeSize === 'sm' ? 19 : (cfg.codeSize === 'md' ? 22 : 24);
      ctx.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(codeStr, padX, topY);
    }

    // Time on top right (e.g. "13:02")
    if (cfg.showTime !== false) {
      const timeStr = item.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      ctx.textAlign = 'right';
      ctx.font = '500 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(timeStr, stickerW - padX, topY + 4);
    } else if (cfg.showSessionDate && sessionDate) {
      ctx.textAlign = 'right';
      ctx.font = '500 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(`#${sessionDate}`, stickerW - padX, topY + 4);
    }

    // 2. 2D QR Code Setup
    const isQrRight = cfg.qrPosition !== 'left';
    const qrText = item.controlCode || (item.controlNum ? `#${item.controlNum}` : '001');
    const qr = QRCode.create(qrText, { errorCorrectionLevel: 'M' });
    const moduleCount = qr.modules.size; // 21 modules
    const marginModules = 1;
    const totalModules = moduleCount + (marginModules * 2);

    // Target ~88-92px width
    const modPixel = cfg.qrSize === 'lg' ? 4 : (cfg.qrSize === 'sm' ? 3 : 4);
    const actualQrW = totalModules * modPixel;

    let finalQrX: number;
    let infoX: number;
    let infoW: number;

    if (isQrRight) {
      finalQrX = stickerW - padX - actualQrW;
      infoX = padX;
      infoW = finalQrX - infoX - 8;
    } else {
      finalQrX = padX;
      infoX = finalQrX + actualQrW + 8;
      infoW = stickerW - padX - infoX;
    }

    const headerBottom = topY + 32;
    const remainingH = stickerH - headerBottom;
    const finalQrY = headerBottom + Math.max(0, Math.floor((remainingH - actualQrW) / 2));

    // Draw QR code
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(finalQrX, finalQrY, actualQrW, actualQrW);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.modules.get(r, c)) {
          ctx.fillRect(
            finalQrX + ((c + marginModules) * modPixel),
            finalQrY + ((r + marginModules) * modPixel),
            modPixel,
            modPixel
          );
        }
      }
    }

    // 3. Left Info Column: Clean, left-aligned, spacious text
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    const cleanBuyer = (item.buyer || '').replace(/^@+/, '') || 'Buyer';
    const tagPart = cfg.showTag ? (item.tag || '') : '';
    const descPart = (cfg.showDescription && item.description) ? item.description : '';
    const itemLabel = tagPart ? (descPart ? `${tagPart} ${descPart}` : tagPart) : (descPart || item.tag || 'Item');
    const currencyStr = (profile.currency || '₱').replace(/PHP/g, '₱');
    const priceStr = `${currencyStr}${item.price.toLocaleString()}`;

    const infoRows: { text: string; font: string }[] = [];
    if (cfg.showBuyer !== false) {
      infoRows.push({
        text: cleanBuyer,
        font: 'bold 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      });
    }
    if (cfg.showTag !== false || cfg.showDescription) {
      infoRows.push({
        text: itemLabel,
        font: 'bold 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      });
    }
    if (cfg.showPrice !== false) {
      infoRows.push({
        text: priceStr,
        font: '900 17px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      });
    }

    // Distribute the rows evenly across available vertical space
    const availH = stickerH - headerBottom - 6;
    const rowStep = infoRows.length > 1 ? Math.floor(availH / infoRows.length) : 34;

    infoRows.forEach((row, idx) => {
      ctx.font = row.font;
      let displayText = row.text;
      while (ctx.measureText(displayText).width > infoW && displayText.length > 3) {
        displayText = displayText.substring(0, displayText.length - 1);
      }
      ctx.fillText(displayText, infoX, headerBottom + 6 + (idx * rowStep));
    });

    // Custom Footer (if explicitly set by user)
    const footerStr = (cfg.footerText || cfg.customFooterText || '').trim();
    if (footerStr) {
      ctx.font = 'bold 7px system-ui, -apple-system, sans-serif';
      ctx.fillText(footerStr.substring(0, 16), infoX, stickerH - 9);
    }

  } else {
    // -------------------------------------------------------------------------
    // FULL-WIDTH STACKED LAYOUT (Standard Text / Optional Barcode)
    // -------------------------------------------------------------------------
    const padX = 6;
    let currY = 4;

    // 1. Top Bar: Store Name / Session Date / Time
    const hasTopBar = Boolean(cfg.showStoreName || cfg.showSessionDate || cfg.showTime);
    if (hasTopBar) {
      ctx.textBaseline = 'top';
      if (cfg.showStoreName) {
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        const storeStr = (profile.name || 'LIVE POS').substring(0, 11).toUpperCase();
        ctx.fillText(storeStr, padX, currY);
      }

      const rightParts: string[] = [];
      if (cfg.showSessionDate) rightParts.push(sessionDate ? `#${sessionDate}` : '');
      if (cfg.showTime && item.time) rightParts.push(item.time);
      const rightStr = rightParts.join(' ').trim();
      if (rightStr) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 10px monospace';
        ctx.fillText(rightStr, stickerW - padX, currY);
      }

      currY += 13;
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.moveTo(padX, currY);
      ctx.lineTo(stickerW - padX, currY);
      ctx.stroke();
      currY += 4;
    } else {
      currY += 2;
    }

    // 2. Control Code: e.g. [ #001 ] or [ #2 ]
    if (cfg.showControlCode !== false) {
      const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const fontSize = cfg.codeSize === 'xl' ? 24 : (cfg.codeSize === 'lg' ? 20 : 16);
      ctx.font = `900 ${fontSize}px monospace`;
      ctx.fillText(`[ ${codeStr} ]`, stickerW / 2, currY);
      currY += fontSize + 4;
    }

    // 3. Buyer Handle: e.g. @Edna T
    if (cfg.showBuyer !== false) {
      const cleanBuyer = (item.buyer || '').replace(/^@+/, '');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const buyerFontSize = cfg.buyerSize === 'lg' ? 17 : 14;
      ctx.font = `bold ${buyerFontSize}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(`@${cleanBuyer}`, stickerW / 2, currY);
      currY += buyerFontSize + 4;
    }

    // Separator line before price
    ctx.beginPath();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);
    ctx.moveTo(padX, currY);
    ctx.lineTo(stickerW - padX, currY);
    ctx.stroke();
    ctx.setLineDash([]);
    currY += 5;

    // 4. Tag / Description & Price
    if (cfg.showPrice !== false || cfg.showTag || cfg.showDescription) {
      const currencyStr = (profile.currency || '₱').replace(/PHP/g, '₱');
      const priceStr = cfg.showPrice !== false ? `${currencyStr}${item.price.toLocaleString()}` : '';
      const tagPart = cfg.showTag ? (item.tag || '') : '';
      const descPart = (cfg.showDescription && item.description) ? item.description : '';
      const itemLabel = tagPart ? (descPart ? `${tagPart} ${descPart}` : tagPart) : descPart;

      ctx.textBaseline = 'middle';
      const midY = currY + 8;

      if (itemLabel) {
        ctx.textAlign = 'left';
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        const maxChars = priceStr ? 10 : 16;
        ctx.fillText(itemLabel.substring(0, maxChars), padX, midY);
      }

      if (priceStr) {
        ctx.textAlign = 'right';
        const priceFontSize = cfg.priceSize === 'lg' ? 17 : 14;
        ctx.font = `900 ${priceFontSize}px system-ui, -apple-system, sans-serif`;
        ctx.fillText(priceStr, stickerW - padX, midY);
      }

      currY += 17;
    }

    // 5. Barcode (if enabled)
    if (cfg.showBarcode && currY <= stickerH - 30) {
      const rawCode = item.controlCode || (item.controlNum ? String(item.controlNum) : '001');
      const cleanCode = rawCode.replace(/[^A-Za-z0-9]/g, '') || '001';
      
      const barW = 1.6;
      const barH = 14;
      const startX = Math.round((stickerW - (cleanCode.length * 12 * barW)) / 2);
      ctx.fillStyle = '#000000';
      for (let c = 0; c < cleanCode.length; c++) {
        const charCode = cleanCode.charCodeAt(c);
        const pattern = [
          (charCode & 1) ? 2 : 1,
          (charCode & 2) ? 1 : 2,
          (charCode & 4) ? 2 : 1,
          (charCode & 8) ? 1 : 2,
          (charCode & 16) ? 2 : 1
        ];
        let pX = startX + (c * 12 * barW);
        for (let p = 0; p < pattern.length; p++) {
          if (p % 2 === 0) {
            ctx.fillRect(pX, currY, pattern[p] * barW, barH);
          }
          pX += pattern[p] * barW;
        }
      }
      currY += barH + 2;
      ctx.textAlign = 'center';
      ctx.font = '9px monospace';
      ctx.fillText(`*${cleanCode}*`, stickerW / 2, currY);
      currY += 10;
    }

    // 6. Custom Footer (if space allows)
    const footerStr = (cfg.footerText || cfg.customFooterText || '').trim();
    if (footerStr && currY <= stickerH - 12) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 9px system-ui, -apple-system, sans-serif';
      ctx.fillText(footerStr.substring(0, 20).toUpperCase(), stickerW / 2, currY);
    }
  }

  // Convert HTML5 Canvas to 1-Bit Monochrome ESC/POS Raster (GS v 0)
  // 58mm printer physical printhead width = 384 dots = 48 bytes per line
  const printerWidthDots = 384;
  const printerWidthBytes = 48;
  const offsetMm = cfg.horizontalOffsetMm !== undefined ? cfg.horizontalOffsetMm : (cfg.paperGuidePosition === 'right' ? 18 : 0);
  const xOffsetDots = Math.min(printerWidthDots - stickerW, Math.max(0, Math.round(offsetMm * 8)));

  const imgData = ctx.getImageData(0, 0, stickerW, stickerH);
  const data = imgData.data;

  // Build packed bitmap rows (1 bit per dot, MSB first)
  const totalBitmapBytes = printerWidthBytes * stickerH;
  const rasterBuffer = new Uint8Array(totalBitmapBytes);

  for (let y = 0; y < stickerH; y++) {
    const rowByteStart = y * printerWidthBytes;
    for (let x = 0; x < stickerW; x++) {
      const idx = (y * stickerW + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];

      // Luminance threshold for thermal burn
      const isBlack = a > 50 && (0.299 * r + 0.587 * g + 0.114 * b < 160);
      if (isBlack) {
        const targetDot = xOffsetDots + x;
        if (targetDot < printerWidthDots) {
          const byteOffset = rowByteStart + Math.floor(targetDot / 8);
          const bitPos = 7 - (targetDot % 8);
          rasterBuffer[byteOffset] |= (1 << bitPos);
        }
      }
    }
  }

  // Assemble ESC/POS byte sequence
  const output: number[] = [];

  // ESC @ (Initialize printer)
  output.push(0x1B, 0x40);

  // GS v 0 0 xL xH yL yH (Standard ESC/POS Raster Bit Image)
  // xL = 48 (48 bytes = 384 dots), xH = 0
  // yL = stickerH % 256, yH = Math.floor(stickerH / 256)
  const xL = printerWidthBytes % 256;
  const xH = Math.floor(printerWidthBytes / 256);
  const yL = stickerH % 256;
  const yH = Math.floor(stickerH / 256);

  output.push(0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH);
  for (let i = 0; i < rasterBuffer.length; i++) {
    output.push(rasterBuffer[i]);
  }

  // Exact 1-Sticker Cutoff Gap Feed:
  if (cfg.gapFeedMode === 'form_feed') {
    output.push(0x0C); // FF
  } else if (cfg.gapFeedMode === 'feed_lines') {
    const lines = cfg.extraFeedLines ?? 2;
    for (let i = 0; i < lines; i++) output.push(0x0A);
  } else {
    // Optical Gap Stop (GS FF: 0x1D 0x0C) - stops precisely on 1 sticker!
    output.push(0x1D, 0x0C);
  }

  return new Uint8Array(output);
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
  paperCols: number = 16,
  layoutConfig?: LabelLayoutSettings
): Uint8Array {
  const cfg = layoutConfig || defaultLabelLayout;
  const is30x20 = cfg.labelSize === '30x20mm';
  
  // 30mm width is 16 characters in standard thermal font A
  const cols = is30x20 ? 16 : paperCols;
  const enc = new EscPosEncoder(cols);

  enc.init();

  // Physical right-side or custom horizontal offset (PT-265 has left guide pushing paper to right)
  const offsetMm = cfg.horizontalOffsetMm !== undefined ? cfg.horizontalOffsetMm : (cfg.paperGuidePosition === 'right' ? 18 : 0);
  const leftMarginDots = Math.min(144, Math.max(0, Math.round(offsetMm * 8)));
  if (leftMarginDots > 0) {
    enc.setLeftMargin(leftMarginDots);
    // Note: Never send GS W (setPrintAreaWidth) as it triggers "WIDE ERROR" on POS-58 chipsets
  }

  // Ultra-compact line spacing so 30x20mm content fits within 80 dots (20mm = 160 dots)
  enc.setLineSpacing(is30x20 ? 10 : 16);

  // 1. Top Bar: Store Name / Session Date / Time
  const hasTopBar = Boolean(cfg.showStoreName || cfg.showSessionDate || cfg.showTime);
  if (hasTopBar) {
    const leftText = cfg.showStoreName ? (profile.name || 'LIVE POS').substring(0, 8).toUpperCase() : '';
    const dateText = cfg.showSessionDate ? (sessionDate ? `#${sessionDate}` : '') : '';
    const timeText = cfg.showTime ? (item.time || '') : '';
    const rightText = `${dateText} ${timeText}`.trim().substring(0, 8);

    if (leftText && rightText) {
      enc.twoColumns(leftText, rightText);
    } else if (leftText) {
      enc.alignCenter().bold(true).line(leftText).normal();
    } else if (rightText) {
      enc.alignRight().line(rightText).normal();
    }
    enc.separator('-');
    enc.setLineSpacing(is30x20 ? 10 : 16);
  }

  // 2. Control Code (e.g. [ #001 ] or [ #2 ])
  if (cfg.showControlCode !== false) {
    const codeStr = item.controlNum ? `#${item.controlNum}` : item.controlCode;
    enc.alignCenter().bold(true);
    
    if (cfg.codeSize === 'xl' || cfg.codeSize === 'extra_large') {
      enc.size(2, 2);
    } else if (cfg.codeSize === 'lg' || cfg.codeSize === 'large') {
      enc.size(2, 1);
    } else {
      enc.size(1, 1);
    }
    enc.line(`[ ${codeStr} ]`).normal();
    enc.setLineSpacing(is30x20 ? 10 : 16);
  }

  // 3. Buyer Handle (e.g. @Edna T)
  if (cfg.showBuyer !== false) {
    const cleanBuyer = (item.buyer || '').replace(/^@+/, '').substring(0, cols - 2);
    enc.alignCenter().bold(true);
    if (cfg.buyerSize === 'lg' || cfg.buyerSize === 'large') {
      enc.size(2, 1);
    } else {
      enc.size(1, 1);
    }
    enc.line(`@${cleanBuyer}`).normal();
    enc.setLineSpacing(is30x20 ? 10 : 16);
  }

  // 4. Tag / Description & Price (Smart compact 20mm layout)
  if (cfg.showPrice !== false || cfg.showTag || cfg.showDescription) {
    const currencyStr = (profile.currency || '₱').replace(/PHP/g, '₱');
    const priceStr = (cfg.showPrice !== false) ? `${currencyStr}${item.price.toLocaleString()}` : '';
    const tagPart = cfg.showTag ? (item.tag || '') : '';
    const descPart = (cfg.showDescription && item.description) ? item.description : '';
    const itemLabel = tagPart ? (descPart ? `${tagPart} ${descPart}` : tagPart) : descPart;

    // Dashed divider line above item & price
    enc.separator('-');

    if (itemLabel && priceStr) {
      enc.bold(true);
      enc.twoColumns(itemLabel.substring(0, 8), priceStr);
      enc.normal();
    } else if (priceStr) {
      enc.alignCenter().bold(true);
      if (cfg.priceSize === 'lg' || cfg.priceSize === 'large') {
        enc.size(2, 1);
      }
      enc.line(priceStr).normal();
    } else if (itemLabel) {
      enc.alignCenter().line(itemLabel.substring(0, cols)).normal();
    }
    enc.setLineSpacing(is30x20 ? 10 : 16);
  }

  // 5. Barcode (if enabled)
  if (cfg.showBarcode) {
    const rawCode = item.controlCode || (item.controlNum ? String(item.controlNum) : '');
    enc.barcode(rawCode, 16);
    enc.alignCenter().line(`*${rawCode}*`).normal();
  }

  // 6. Custom Footer Note (optional)
  const footerStr = (cfg.footerText || cfg.customFooterText || '').trim();
  if (footerStr) {
    enc.separator('-');
    enc.alignCenter().line(footerStr.substring(0, cols)).normal();
  }

  // 7. Cutoff Gap Feed: Command PT-265 to feed and stop precisely at the die-cut gap sensor of this 1 sticker
  if (cfg.gapFeedMode === 'form_feed') {
    enc.formFeed();
  } else if (cfg.gapFeedMode === 'feed_lines') {
    enc.feed(cfg.extraFeedLines || 1);
  } else {
    // Optical Gap Stop (GS FF: 0x1D 0x0C) - DO NOT follow with formFeed()!
    enc.feedToLabelGap();
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
  const currencyStr = (profile.currency || '₱').replace(/PHP/g, '₱');
  const priceStr = `${currencyStr}${item.price.toLocaleString()}`;

  // Build TSPL command stream
  let tspl = `SIZE ${widthMm} mm, ${heightMm} mm\r\n`;
  tspl += `GAP ${gapMm} mm, 0 mm\r\n`;
  tspl += `SPEED ${cfg.printSpeed || 3}\r\n`;
  tspl += `DENSITY ${cfg.printDensity || 10}\r\n`;
  tspl += `DIRECTION 1\r\n`;
  tspl += `CODEPAGE UTF-8\r\n`;
  tspl += `REFERENCE ${xOffsetDots},${yOffsetDots}\r\n`;
  tspl += `CLS\r\n`;

  if (cfg.customElements && cfg.customElements.length > 0) {
    // -------------------------------------------------------------------------
    // RENDER VISUAL DESIGNER CUSTOM ELEMENTS IN TSPL HARDWARE PROTOCOL
    // -------------------------------------------------------------------------
    for (const elem of cfg.customElements) {
      if (!elem.visible) continue;

      if (elem.id === 'qrCode') {
        const qrText = (item.controlCode || (item.controlNum ? `#${item.controlNum}` : '001')).replace(/"/g, '');
        const cellW = elem.width ? Math.max(2, Math.min(6, Math.floor(elem.width / 24))) : 4;
        tspl += `QRCODE ${elem.x},${elem.y},M,${cellW},A,0,"${qrText}"\r\n`;
      } else if (elem.id === 'barcode') {
        const rawCode = (item.controlCode || (item.controlNum ? String(item.controlNum) : '001')).replace(/[^A-Za-z0-9]/g, '') || '001';
        const bH = elem.height || 28;
        tspl += `BARCODE ${elem.x},${elem.y},"128",${bH},1,0,2,2,"${rawCode}"\r\n`;
      } else if (elem.id === 'divider') {
        const lineW = elem.width || (widthMm * 8 - 16);
        tspl += `BAR ${elem.x},${elem.y},${lineW},1\r\n`;
      } else {
        let val = '';
        if (elem.id === 'controlCode') {
          val = (item.controlCode || (item.controlNum ? `#${item.controlNum}` : 'L0911-002')).replace(/^\[\s*|\s*\]$/g, '');
        } else if (elem.id === 'time') {
          val = item.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        } else if (elem.id === 'buyer') {
          val = (item.buyer || '').replace(/^@+/, '') || 'Buyer';
        } else if (elem.id === 'tag') {
          val = item.tag || item.description || 'Item';
        } else if (elem.id === 'price') {
          let cur = elem.prefix !== undefined ? elem.prefix : (profile.currency || '₱');
          if (cur === 'P') cur = '₱';
          val = `${cur}${item.price.toLocaleString()}`;
        } else if (elem.id === 'storeName') {
          val = profile.name || 'Store';
        } else if (elem.id === 'sessionDate') {
          val = sessionDate || '0911';
        } else if (elem.id === 'footerText') {
          val = elem.customText || cfg.footerText || cfg.customFooterText || '';
        }

        if (elem.prefix && elem.id !== 'price') val = elem.prefix + val;
        if (elem.suffix) val = val + elem.suffix;
        val = val.replace(/"/g, '');

        let font = '2';
        let xM = 1;
        let yM = 1;
        if (elem.fontSize >= 24) { font = '3'; xM = 1; yM = 2; }
        else if (elem.fontSize >= 18) { font = '3'; xM = 1; yM = 1; }
        else if (elem.fontSize <= 10) { font = '1'; xM = 1; yM = 1; }

        let alignNum = 1; // 1 = left, 2 = center, 3 = right
        let posX = elem.x;
        if (elem.width) {
          if (elem.align === 'right') { alignNum = 3; posX = elem.x + elem.width; }
          else if (elem.align === 'center') { alignNum = 2; posX = elem.x + Math.round(elem.width / 2); }
          else { alignNum = 1; posX = elem.x; }
        } else {
          if (elem.align === 'right') alignNum = 3;
          else if (elem.align === 'center') alignNum = 2;
          else alignNum = 1;
        }

        tspl += `TEXT ${posX},${elem.y},"${font}",0,${xM},${yM},${alignNum},"${val}"\r\n`;
      }
    }
  } else {
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
  if (offsetMm > 0) {
    enc.setLeftMargin(Math.round(offsetMm * 8));
  }
  
  if (cfg.gapFeedMode === 'form_feed') {
    enc.formFeed();
  } else if (cfg.gapFeedMode === 'feed_lines') {
    enc.feed(cfg.extraFeedLines || 3);
  } else {
    // PT-265 ESC/POS Optical Gap Advance: GS FF (0x1D 0x0C) - advances and stops precisely at the next label gap
    enc.feedToLabelGap();
  }
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

  if (cfg.customSections && cfg.customSections.length > 0) {
    const sorted = [...cfg.customSections].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const sec of sorted) {
      if (!sec.visible) continue;

      const setAlign = () => {
        if (sec.align === 'left') enc.alignLeft();
        else if (sec.align === 'right') enc.alignRight();
        else enc.alignCenter();
      };

      if (sec.id === 'storeName') {
        setAlign();
        if (sec.fontWeight !== 'normal') enc.bold(true);
        if (sec.fontSize >= 16) enc.size(2, 2);
        enc.line(profile.name || 'LIVE SELLING POS');
        enc.normal();
      } else if (sec.id === 'title') {
        setAlign();
        if (sec.fontWeight !== 'normal') enc.bold(true);
        enc.line(sec.customText || 'PARCEL PACKING SLIP');
        enc.normal();
      } else if (sec.id === 'sessionDate') {
        setAlign();
        const parts: string[] = [];
        if (sessionDate) parts.push(`Session: #${sessionDate}`);
        parts.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        enc.line(parts.join(' - '));
      } else if (sec.id === 'buyer') {
        setAlign();
        enc.bold(true);
        if (sec.fontSize >= 18) enc.size(2, 2);
        enc.line(`@${(basket.displayName || basket.handle).replace(/^@+/, '')}`);
        enc.normal();
      } else if (sec.id === 'status') {
        setAlign();
        enc.line(`STATUS: ${basket.balance <= 0 ? 'FULLY SETTLED (PAID)' : 'OWING BALANCE'}`);
      } else if (sec.id === 'itemsTable') {
        enc.twoColumns('ITEM / CODE', `AMT (${currencyStr})`);
        enc.separator('-');
        basket.items.forEach((it, idx) => {
          const numPart = `${idx + 1}. `;
          const code = it.controlNum ? `#${it.controlNum}` : it.controlCode;
          const desc = (it.description && it.description !== it.controlCode && it.description !== 'Decor') ? ` • ${it.description}` : '';
          enc.twoColumns(`${numPart}${code}${desc}`, `${it.price.toLocaleString()}`);
        });
      } else if (sec.id === 'totals') {
        enc.bold(true);
        enc.twoColumns(`Total Items:`, `${basket.items.length} pcs`);
        enc.twoColumns(`Subtotal:`, `${currencyStr} ${basket.totalAmount.toLocaleString()}`);
        if (basket.totalPaid > 0) {
          enc.twoColumns(`Paid:`, `${currencyStr} ${basket.totalPaid.toLocaleString()}`);
        }
        if (sec.fontSize >= 16) enc.size(1, 2);
        enc.twoColumns(`BALANCE DUE:`, `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`);
        enc.normal();
      } else if (sec.id === 'qcCheckbox') {
        setAlign();
        enc.line('QC Verified: [  ] Packed Pass');
      } else if (sec.id === 'paymentDetails') {
        if (profile.paymentDetails && profile.paymentDetails.trim()) {
          setAlign();
          enc.line('Payment Details:');
          const lines = profile.paymentDetails.split('\n');
          lines.forEach(l => { if (l.trim()) enc.line(l.trim()); });
        }
      } else if (sec.id === 'footer') {
        setAlign();
        const note = sec.customText || cfg.customFooterNote || 'Thank you for mining with us!';
        if (note.trim()) enc.line(note.trim());
        enc.line(`*${basket.handle}*`);
      }

      if (sec.showDividerBelow) {
        enc.separator('-');
      }
    }
  } else {
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
      const desc = (it.description && it.description !== it.controlCode && it.description !== 'Decor') ? ` • ${it.description}` : '';
      const label = `${numPart}${code}${desc}`;
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
  }

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
