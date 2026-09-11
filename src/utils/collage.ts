import type { BuyerBasket, Profile } from '../types';

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('No image src'));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
}

export function drawCanvasRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill = true,
  stroke = false
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

export function drawImageAspectCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;
  let sw: number, sh: number, sx: number, sy: number;
  if (imgRatio > targetRatio) {
    sh = img.height;
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = img.width / targetRatio;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export async function createPhotoCollageCanvas(
  target: BuyerBasket,
  profile: Profile,
  sessionDate: string
): Promise<string> {
  const items = target.items || [];
  const count = items.length;

  let cols = 2;
  if (count >= 5) cols = 3;
  if (count >= 10) cols = 4;
  const rows = Math.max(1, Math.ceil(count / cols));

  const itemW = 340;
  const itemH = 340;
  const padding = 24;
  const gap = 16;
  const headerH = 130;
  const footerH = 160;

  const canvasW = padding * 2 + (cols * itemW) + ((cols - 1) * gap);
  const canvasH = headerH + (rows * itemH) + ((rows - 1) * gap) + footerH + padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Overall dark canvas background
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header Background Bar
  ctx.fillStyle = '#27272a';
  ctx.fillRect(0, 0, canvasW, headerH);

  // Accent Top Border
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(0, 0, canvasW, 5);

  // Store Name & Subtitle
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
  ctx.fillText(profile.name || 'Live Selling Store', padding, 48);

  ctx.fillStyle = '#a1a1aa';
  ctx.font = '14px system-ui, -apple-system, sans-serif';
  ctx.fillText(`${profile.category || 'Live Selling'} • Session #${sessionDate}`, padding, 74);

  // Buyer Name Pill in Header (Top Right)
  const cleanBuyerName = (target.displayName || target.handle).replace(/^@+/, '');
  const buyerTagText = `@${cleanBuyerName}`;
  ctx.font = 'bold 20px system-ui, -apple-system, sans-serif';
  const tagW = ctx.measureText(buyerTagText).width + 28;
  const tagH = 40;
  const tagX = canvasW - padding - tagW;
  const tagY = 30;

  ctx.fillStyle = '#7e22ce';
  drawCanvasRoundRect(ctx, tagX, tagY, tagW, tagH, 12, true);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(buyerTagText, tagX + 14, tagY + 27);

  // Subtitle indicator
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 13px monospace';
  ctx.fillText(`MINED ITEMS PHOTO GALLERY (${count} ITEMS)`, padding, 106);

  // Draw Cards for each mined item
  for (let i = 0; i < count; i++) {
    const it = items[i];
    const c = i % cols;
    const r = Math.floor(i / cols);

    const cellX = padding + c * (itemW + gap);
    const cellY = headerH + padding + r * (itemH + gap);

    // Card Background
    ctx.fillStyle = '#ffffff';
    drawCanvasRoundRect(ctx, cellX, cellY, itemW, itemH, 16, true);

    // Image Area
    let imgDrawn = false;
    if (it.photo) {
      try {
        const img = await loadImageElement(it.photo);
        ctx.save();
        drawCanvasRoundRect(ctx, cellX, cellY, itemW, itemH - 58, 16, false);
        ctx.clip();
        drawImageAspectCover(ctx, img, cellX, cellY, itemW, itemH - 58);
        ctx.restore();
        imgDrawn = true;
      } catch (e) {
        console.warn('Failed to load item photo into collage:', it.controlCode, e);
      }
    }

    if (!imgDrawn) {
      ctx.fillStyle = '#f4f4f5';
      ctx.fillRect(cellX, cellY, itemW, itemH - 58);
      ctx.fillStyle = '#71717a';
      ctx.font = 'bold 36px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(it.controlNum ? '#' + it.controlNum : it.controlCode, cellX + itemW / 2, cellY + (itemH - 58) / 2);
      ctx.font = '15px system-ui, -apple-system, sans-serif';
      const fallbackItemName = (it.description && it.description !== it.controlCode && it.description !== 'Decor') ? it.description : '';
      if (fallbackItemName) {
        ctx.fillText(fallbackItemName, cellX + itemW / 2, cellY + (itemH - 58) / 2 + 30);
      }
      ctx.textAlign = 'left';
    }

    // Overlaid Control Number Badge
    const codeStr = it.controlNum ? '#' + it.controlNum : it.controlCode;
    ctx.font = 'bold 15px monospace';
    const codeWidth = ctx.measureText(codeStr).width + 16;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    drawCanvasRoundRect(ctx, cellX + 10, cellY + 10, codeWidth, 26, 6, true);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(codeStr, cellX + 18, cellY + 28);

    // Overlaid Price Badge
    const priceStr = `${profile.currency}${it.price.toLocaleString()}`;
    ctx.font = 'bold 16px monospace';
    const priceWidth = ctx.measureText(priceStr).width + 16;
    ctx.fillStyle = '#09090b';
    drawCanvasRoundRect(ctx, cellX + itemW - priceWidth - 10, cellY + itemH - 58 - 34, priceWidth, 28, 6, true);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(priceStr, cellX + itemW - priceWidth - 10 + 8, cellY + itemH - 58 - 15);

    // Card Bottom Info Bar
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cellX, cellY + itemH - 58, itemW, 58);
    ctx.fillStyle = '#18181b';
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
    const bottomItemTitle = (it.description && it.description !== it.controlCode && it.description !== 'Decor') 
      ? it.description 
      : (it.controlNum ? '#' + it.controlNum : it.controlCode);
    ctx.fillText(bottomItemTitle, cellX + 12, cellY + itemH - 34);

    ctx.fillStyle = '#71717a';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(it.time ? `Mined at ${it.time}` : (it.date || 'Live Mine'), cellX + 12, cellY + itemH - 14);
  }

  // Footer Section: Totals and GCash Instructions
  const footerY = canvasH - footerH - padding;
  ctx.fillStyle = '#27272a';
  drawCanvasRoundRect(ctx, padding, footerY, canvasW - padding * 2, footerH, 16, true);

  // Left Col: Totals
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px system-ui, -apple-system, sans-serif';
  ctx.fillText(`ORDER SUMMARY (${count} ITEMS)`, padding + 20, footerY + 36);

  ctx.fillStyle = '#d4d4d8';
  ctx.font = '14px monospace';
  ctx.fillText(`Subtotal: ${profile.currency}${target.totalAmount.toLocaleString()}`, padding + 20, footerY + 66);
  if (target.totalPaid > 0) {
    ctx.fillStyle = '#34d399';
    ctx.fillText(`Payments Made: -${profile.currency}${target.totalPaid.toLocaleString()}`, padding + 20, footerY + 90);
  }

  ctx.fillStyle = '#f87171';
  ctx.font = 'bold 18px monospace';
  ctx.fillText(`TOTAL DUE: ${profile.currency}${Math.abs(target.balance).toLocaleString()}`, padding + 20, footerY + 124);

  // Right Col: Payment Details
  const rightColX = Math.round(canvasW / 2) + 10;
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
  ctx.fillText('💳 PAYMENT INSTRUCTIONS:', rightColX, footerY + 36);

  ctx.fillStyle = '#e4e4e7';
  ctx.font = '12px monospace';
  const payText = profile.paymentDetails || 'GCash: 0917-123-4567\nBDO: 1234-5678-9012\nPlease send screenshot within 24h.';
  const payLines = payText.split('\n');
  let py = footerY + 60;
  for (let li = 0; li < Math.min(payLines.length, 4); li++) {
    ctx.fillText(payLines[li], rightColX, py);
    py += 20;
  }

  return canvas.toDataURL('image/png');
}
