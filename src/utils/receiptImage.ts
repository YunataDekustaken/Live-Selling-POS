import type { BuyerBasket, Profile, ReceiptLayoutSettings } from '../types';

/**
 * Helper to wrap text cleanly on canvas if needed
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Helper to safely load the first available image from a list of URL/path candidates
 */
async function loadFirstAvailableImage(candidates: string[]): Promise<HTMLImageElement | null> {
  for (const src of candidates) {
    if (!src || typeof src !== 'string') continue;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        if (src.startsWith('http://') || src.startsWith('https://')) {
          image.crossOrigin = 'anonymous';
        }
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to load: ' + src));
        image.src = src;
      });
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        return img;
      }
    } catch {
      // Continue to next candidate
    }
  }
  return null;
}

/**
 * Generates a high-resolution, pixel-perfect PNG image of an Invoice Receipt
 * optimized for sending online to customers via Messenger, Instagram, WhatsApp, etc.
 */
export async function generateOnlineInvoiceReceiptImage(
  basket: BuyerBasket,
  profile: Profile,
  sessionDate: string = '',
  layoutConfig?: ReceiptLayoutSettings
): Promise<string> {
  const cleanName = (basket.displayName || basket.handle || 'Customer').replace(/^@+/, '');
  const currencyStr = (profile.currency || '₱').replace(/PHP/g, '₱');
  const isPaid = basket.balance <= 0;
  const storeName = (profile.name || 'LIVE SELLING POS').toUpperCase();

  // Virtual Layout Dimensions (scaled 2x for Retina sharp rendering)
  const scale = 2;
  const width = 540; // Base logical width
  const pad = 28;
  const innerW = width - (pad * 2);

  // Check for uploaded store logo (from profile settings, server assets, or candidate paths)
  const logoCandidates: string[] = [
    profile.logoUrl,
    layoutConfig?.logoUrl,
    '/api/receipt-logo',
    '/assets/logo.png',
    '/assets/logo.jpg',
    '/assets/logo.jpeg',
    '/assets/logo.webp',
    '/assets/logo.svg',
    '/logo.png',
    '/logo.jpg',
    '/logo.svg',
  ].filter(Boolean) as string[];

  let logoImg: HTMLImageElement | null = null;
  let logoDrawW = 0;
  let logoDrawH = 0;

  try {
    logoImg = await loadFirstAvailableImage(logoCandidates);
    if (logoImg) {
      const maxW = 150;
      const maxH = 64;
      const ratio = Math.min(maxW / logoImg.naturalWidth, maxH / logoImg.naturalHeight, 1);
      logoDrawW = Math.round(logoImg.naturalWidth * ratio);
      logoDrawH = Math.round(logoImg.naturalHeight * ratio);
    }
  } catch {
    logoImg = null;
  }

  // Pre-calculate dynamic height
  let estimatedH = 40; // Top padding
  if (logoImg && logoDrawH > 0) {
    estimatedH += logoDrawH + 14;
  }
  estimatedH += 36; // Store Name
  estimatedH += 28; // Title + Invoice #
  estimatedH += 22; // Session / Date
  estimatedH += 24; // Divider

  estimatedH += 70; // Customer box & Status badge
  estimatedH += 20; // Spacing

  estimatedH += 36; // Items header
  estimatedH += basket.items.length * 30; // Items
  estimatedH += 20; // Divider

  estimatedH += 110; // Totals box (Items, Subtotal, Balance)
  if (basket.totalPaid > 0) estimatedH += 26;

  // Payments breakdown if any
  if (basket.payments && basket.payments.length > 0) {
    estimatedH += 30 + (basket.payments.length * 22);
  }

  // Payment Accounts & Instructions
  const paymentDetails = (profile.paymentDetails || '').trim();
  const paymentLines = paymentDetails ? paymentDetails.split('\n').filter(l => l.trim().length > 0) : [];
  if (paymentLines.length > 0) {
    estimatedH += 60 + (paymentLines.length * 20);
  }

  // Footer note
  estimatedH += 70; // Footer + Timestamp
  estimatedH += 40; // Bottom padding

  const totalH = Math.max(500, Math.ceil(estimatedH));

  // Create Canvas
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = totalH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create canvas 2D rendering context');
  }

  // Scale for crisp high-DPI output
  ctx.scale(scale, scale);

  // 1. Crisp White Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, totalH);

  // Outer Receipt Border (Clean, rounded aesthetic)
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(10, 10, width - 20, totalH - 20);

  let y = pad + 10;

  // 1b. Store Logo if uploaded
  if (logoImg && logoDrawW > 0 && logoDrawH > 0) {
    const logoX = Math.round((width - logoDrawW) / 2);
    ctx.drawImage(logoImg, logoX, y, logoDrawW, logoDrawH);
    y += logoDrawH + 12;
  }

  // 2. Header: Store Name
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#09090B';
  ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
  ctx.fillText(storeName, width / 2, y);
  y += 28;

  // Subtitle: INVOICE RECEIPT (Word "OFFICIAL" removed)
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#71717A';
  ctx.fillText('INVOICE RECEIPT', width / 2, y);
  y += 20;

  // Invoice Number & Date
  const invoiceNo = `#INV-${sessionDate || 'LIVE'}-${cleanName.toUpperCase()}`;
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillStyle = '#A1A1AA';
  ctx.fillText(`${invoiceNo} • ${dateStr} ${timeStr}`, width / 2, y);
  y += 24;

  // Header Divider
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 18;

  // 3. Customer Info & Status Badge (Side-by-Side Card)
  const custBoxY = y;
  const custBoxH = 64;

  ctx.fillStyle = '#F8FAFC';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pad, custBoxY, innerW, custBoxH, 10);
  } else {
    ctx.rect(pad, custBoxY, innerW, custBoxH);
  }
  ctx.fill();
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Customer Name
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 17px system-ui, -apple-system, sans-serif';
  const customerLabel = `@${cleanName}`;
  ctx.fillText(customerLabel, pad + 16, custBoxY + 14);

  // Subtitle / Handle
  ctx.font = '11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(`Customer Account • ${basket.items.length} item${basket.items.length === 1 ? '' : 's'} mined`, pad + 16, custBoxY + 38);

  // Status Badge Pill on Right
  const badgeW = isPaid ? 78 : 124;
  const badgeH = 28;
  const badgeX = width - pad - badgeW - 14;
  const badgeY = custBoxY + 18;

  ctx.fillStyle = isPaid ? '#DCFCE7' : '#FEF2F2';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 14);
  } else {
    ctx.rect(badgeX, badgeY, badgeW, badgeH);
  }
  ctx.fill();
  ctx.strokeStyle = isPaid ? '#86EFAC' : '#FCA5A5';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = isPaid ? '#15803D' : '#B91C1C';
  const statusText = isPaid ? '✓ PAID' : `UNPAID • ${currencyStr}${basket.balance.toLocaleString()}`;
  ctx.fillText(statusText, badgeX + (badgeW / 2), badgeY + 7);

  y += custBoxH + 20;

  // 4. Itemized Table Header
  ctx.fillStyle = '#F4F4F5';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pad, y, innerW, 28, 6);
  } else {
    ctx.rect(pad, y, innerW, 28);
  }
  ctx.fill();

  ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#52525B';
  ctx.textAlign = 'left';
  ctx.fillText('ITEM / CODE & DESCRIPTION', pad + 12, y + 8);
  ctx.textAlign = 'right';
  ctx.fillText(`AMOUNT (${currencyStr})`, width - pad - 12, y + 8);
  y += 34;

  // 5. Items List
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  basket.items.forEach((item, index) => {
    const itemNum = `${index + 1}. `;
    const code = item.controlNum ? `#${item.controlNum}` : (item.controlCode || item.tag || 'Item');
    const desc = (item.description && item.description !== item.controlCode && item.description !== 'Decor')
      ? ` • ${item.description}`
      : '';
    const qty = (item.numberOfItems && item.numberOfItems > 1) ? ` (${item.numberOfItems} pcs)` : '';
    const fullDesc = `${itemNum}${code}${desc}${qty}`;

    // Item name / code
    ctx.textAlign = 'left';
    ctx.fillStyle = '#18181B';
    const truncatedDesc = fullDesc.length > 40 ? fullDesc.substring(0, 39) + '…' : fullDesc;
    ctx.fillText(truncatedDesc, pad + 12, y);

    // Item price
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.fillStyle = '#09090B';
    ctx.fillText(`${currencyStr} ${item.price.toLocaleString()}`, width - pad - 12, y);
    ctx.font = '13px system-ui, -apple-system, sans-serif';

    y += 24;

    // Light divider between items
    if (index < basket.items.length - 1) {
      ctx.strokeStyle = '#F4F4F5';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad + 8, y);
      ctx.lineTo(width - pad - 8, y);
      ctx.stroke();
      y += 6;
    }
  });

  y += 12;

  // Divider above totals
  ctx.strokeStyle = '#E4E4E7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y);
  ctx.lineTo(width - pad, y);
  ctx.stroke();
  y += 14;

  // 6. Totals Box
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#52525B';
  ctx.fillText('Total Items:', pad + 12, y);
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#18181B';
  ctx.fillText(`${basket.items.length} pcs`, width - pad - 12, y);
  y += 22;

  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#52525B';
  ctx.fillText('Subtotal:', pad + 12, y);
  ctx.textAlign = 'right';
  ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillStyle = '#18181B';
  ctx.fillText(`${currencyStr} ${basket.totalAmount.toLocaleString()}`, width - pad - 12, y);
  y += 22;

  if (basket.totalPaid > 0) {
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#15803D';
    ctx.fillText('Total Paid / Advance:', pad + 12, y);
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.fillText(`- ${currencyStr} ${basket.totalPaid.toLocaleString()}`, width - pad - 12, y);
    y += 24;
  }

  // Highlighted Balance Box
  const balanceBoxH = 46;
  ctx.fillStyle = isPaid ? '#F0FDF4' : '#FFFBEB';
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(pad, y, innerW, balanceBoxH, 8);
  } else {
    ctx.rect(pad, y, innerW, balanceBoxH);
  }
  ctx.fill();
  ctx.strokeStyle = isPaid ? '#BBF7D0' : '#FDE68A';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = isPaid ? '#166534' : '#92400E';
  ctx.fillText(isPaid ? 'TOTAL AMOUNT DUE:' : 'REMAINING BALANCE DUE:', pad + 16, y + 15);

  ctx.textAlign = 'right';
  ctx.font = '900 18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
  ctx.fillStyle = isPaid ? '#15803D' : '#B91C1C';
  const balanceText = isPaid
    ? `${currencyStr} 0 (PAID)`
    : `${currencyStr} ${Math.abs(basket.balance).toLocaleString()}`;
  ctx.fillText(balanceText, width - pad - 16, y + 13);
  y += balanceBoxH + 18;

  // 7. Payments Record Breakdown (if any payments are logged)
  if (basket.payments && basket.payments.length > 0) {
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#71717A';
    ctx.fillText('PAYMENT HISTORY:', pad + 12, y);
    y += 18;

    basket.payments.forEach(p => {
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#166534';
      const refPart = p.ref ? ` (${p.ref})` : '';
      const datePart = p.time ? ` • ${p.time}` : '';
      ctx.fillText(`✓ ${p.method}${refPart}${datePart}`, pad + 16, y);

      ctx.textAlign = 'right';
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.fillText(`+${currencyStr} ${p.amount.toLocaleString()}`, width - pad - 12, y);
      ctx.textAlign = 'left';
      y += 18;
    });
    y += 10;
  }

  // 8. Payment Instructions Box (GCash, Maya, Bank details)
  if (paymentLines.length > 0) {
    const payBoxY = y;
    const payBoxH = 40 + (paymentLines.length * 18);

    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(pad, payBoxY, innerW, payBoxH, 8);
    } else {
      ctx.rect(pad, payBoxY, innerW, payBoxH);
    }
    ctx.fill();
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('PAYMENT ACCOUNTS & INSTRUCTIONS:', pad + 14, payBoxY + 12);

    let lineY = payBoxY + 30;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    ctx.fillStyle = '#0F172A';
    paymentLines.forEach(line => {
      ctx.fillText(line, pad + 14, lineY);
      lineY += 18;
    });

    y += payBoxH + 16;
  }

  // 9. Footer Note & Verification Mark
  ctx.textAlign = 'center';
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#4B5563';
  const customNote = layoutConfig?.customFooterNote || 'Thank you for shopping with us! Please send payment screenshot to confirm.';
  ctx.fillText(customNote, width / 2, y);
  y += 20;

  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#9CA3AF';
  ctx.fillText(`Digital Verification: #${sessionDate || 'LIVE'}-${cleanName.toUpperCase()} • All Rights Reserved`, width / 2, y);

  return canvas.toDataURL('image/png');
}

/**
 * Downloads a given data URL as a PNG file
 */
export function downloadReceiptPng(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Copies a PNG data URL image directly to clipboard
 */
export async function copyReceiptPngToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (navigator.clipboard && (window as any).ClipboardItem) {
      await navigator.clipboard.write([new (window as any).ClipboardItem({ 'image/png': blob })]);
      return true;
    }
  } catch (err) {
    console.warn('Clipboard write failed:', err);
  }
  return false;
}

/**
 * Triggers native Web Share API with an image file if supported
 */
export async function shareReceiptPng(
  dataUrl: string,
  filename: string,
  title: string,
  text: string
): Promise<boolean> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title,
        text,
        files: [file]
      });
      return true;
    } else if (navigator.share) {
      await navigator.share({
        title,
        text
      });
      return true;
    }
  } catch (err: any) {
    // AbortError is triggered when user cancels the share dialog, which is normal
    if (err.name !== 'AbortError') {
      console.warn('Web Share failed:', err);
    }
  }
  return false;
}
