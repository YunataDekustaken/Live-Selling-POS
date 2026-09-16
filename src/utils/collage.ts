import type { BuyerBasket, Profile } from '../types';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function createImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function loadImageElement(src: string): Promise<HTMLImageElement> {
  if (!src || typeof src !== 'string') throw new Error('No image src');

  let formattedSrc = src.trim();

  // Handle SVG data URIs that may contain unescaped characters
  if (formattedSrc.startsWith('data:image/svg+xml')) {
    if (!formattedSrc.includes(';base64,')) {
      try {
        const svgContent = formattedSrc.replace(/^data:image\/svg\+xml;?(utf8)?,?/, '');
        const decoded = decodeURIComponent(svgContent);
        const base64 = btoa(unescape(encodeURIComponent(decoded)));
        formattedSrc = `data:image/svg+xml;base64,${base64}`;
      } catch {
        try {
          const rawSvg = formattedSrc.replace(/^data:image\/svg\+xml;?(utf8)?,?/, '');
          formattedSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rawSvg)}`;
        } catch {
          // keep as is if transformation fails
        }
      }
    }
  }

  // 1. Data or Blob URIs: Load directly without crossOrigin (never taints canvas)
  if (formattedSrc.startsWith('data:') || formattedSrc.startsWith('blob:')) {
    return createImageFromSrc(formattedSrc);
  }

  // 2. HTTP/HTTPS URLs (Cloudflare R2, CDN links, external photos):
  // Convert remote image into a local Base64 Data URL to guarantee non-tainted canvas
  if (formattedSrc.startsWith('http://') || formattedSrc.startsWith('https://')) {
    // Attempt A: Direct CORS fetch -> Base64 Data URL
    try {
      const res = await fetch(formattedSrc, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        return await createImageFromSrc(dataUrl);
      }
    } catch (_) {
      // Direct CORS fetch failed, try backend proxy fallback
    }

    // Attempt B: Backend image proxy (/api/proxy-image) to bypass client-side CORS completely
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(formattedSrc)}`;
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        return await createImageFromSrc(dataUrl);
      }
    } catch (_) {
      // Backend proxy fetch failed
    }

    // Attempt C: Direct image element with crossOrigin = 'anonymous'
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = formattedSrc;
    });
  }

  // 3. Relative or local fallback URLs
  return createImageFromSrc(formattedSrc);
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

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '...';
}

/**
 * Generates a clean, minimalist, white-themed photo list gallery of mined items.
 * Intended to be sent alongside the official PNG invoice receipt.
 * Payment instructions are intentionally omitted so this image functions purely
 * as a high-clarity visual item showcase.
 */
export async function createPhotoCollageCanvas(
  target: BuyerBasket,
  profile: Profile,
  sessionDate: string
): Promise<string> {
  const items = target.items || [];
  const count = items.length;

  // Adaptive column and card layout based on total item count
  let cols = 2;
  let itemW = 360;
  let itemH = 370;

  if (count >= 4 && count <= 8) {
    cols = 3;
    itemW = 290;
    itemH = 310;
  } else if (count >= 9) {
    cols = 4;
    itemW = 240;
    itemH = 265;
  }

  const rows = Math.max(1, Math.ceil(count / cols));
  const padding = 28;
  const gap = 16;
  const headerH = 100;
  const footerH = 68;

  const canvasW = padding * 2 + (cols * itemW) + ((cols - 1) * gap);
  const canvasH = headerH + (rows * itemH) + ((rows - 1) * gap) + footerH + padding * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // 1. Clean Minimalist White Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. Header Section
  // Top Subtle Accent Border (2px dark gray/black)
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, canvasW, 4);

  // Store Name
  ctx.fillStyle = '#09090b';
  ctx.font = 'bold 24px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(profile.name || 'Live Selling Store', padding, 46);

  // Header Subtitle (Session & Category)
  ctx.fillStyle = '#71717a';
  ctx.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const effectiveSessionDate = target.sessionDate || sessionDate || 'Live Session';
  ctx.fillText(`Mined Items Photo List  •  Session: ${effectiveSessionDate}`, padding, 72);

  // Customer Handle Pill (Top Right)
  const cleanBuyerName = (target.displayName || target.handle).replace(/^@+/, '');
  const buyerTagText = `@${cleanBuyerName}`;
  
  ctx.font = 'bold 16px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const tagTextWidth = ctx.measureText(buyerTagText).width;
  const tagW = Math.max(120, tagTextWidth + 32);
  const tagH = 38;
  const tagX = canvasW - padding - tagW;
  const tagY = 28;

  // Sleek dark pill for customer handle
  ctx.fillStyle = '#18181b';
  drawCanvasRoundRect(ctx, tagX, tagY, tagW, tagH, 10, true);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(buyerTagText, tagX + tagW / 2, tagY + 25);
  ctx.textAlign = 'left';

  // Sub-badge under handle (Item Count)
  ctx.fillStyle = '#71717a';
  ctx.font = 'bold 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const countSummaryText = `${count} ${count === 1 ? 'ITEM' : 'ITEMS'} MINED`;
  const countTextW = ctx.measureText(countSummaryText).width;
  ctx.fillText(countSummaryText, canvasW - padding - countTextW, tagY + tagH + 18);

  // Header Bottom Divider Line
  ctx.strokeStyle = '#e4e4e7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, headerH);
  ctx.lineTo(canvasW - padding, headerH);
  ctx.stroke();

  // 3. Grid of Mined Item Cards
  const infoBarH = cols >= 4 ? 48 : 54;
  const imgAreaH = itemH - infoBarH;

  for (let i = 0; i < count; i++) {
    const it = items[i];
    const c = i % cols;
    const r = Math.floor(i / cols);

    const cellX = padding + c * (itemW + gap);
    const cellY = headerH + padding + r * (itemH + gap);

    // Card Container (White background with crisp subtle border)
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 1;
    drawCanvasRoundRect(ctx, cellX, cellY, itemW, itemH, 14, true, true);

    // Image Area (Clipped to top rounded corners of card)
    let imgDrawn = false;
    if (it.photo) {
      try {
        const img = await loadImageElement(it.photo);
        ctx.save();
        drawCanvasRoundRect(ctx, cellX, cellY, itemW, imgAreaH, 14, false);
        ctx.clip();
        drawImageAspectCover(ctx, img, cellX, cellY, itemW, imgAreaH);
        ctx.restore();
        imgDrawn = true;
      } catch (e) {
        console.warn('Failed to load item photo for collage:', it.controlCode, e);
      }
    }

    // Fallback if no photo is available
    if (!imgDrawn) {
      ctx.fillStyle = '#f8fafc';
      ctx.save();
      drawCanvasRoundRect(ctx, cellX, cellY, itemW, imgAreaH, 14, false);
      ctx.clip();
      ctx.fillRect(cellX, cellY, itemW, imgAreaH);
      ctx.restore();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      const fallbackCode = it.controlNum ? '#' + it.controlNum : (it.controlCode || `Item ${i + 1}`);
      ctx.fillText(fallbackCode, cellX + itemW / 2, cellY + imgAreaH / 2);
      
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#64748b';
      const fallbackItemDesc = (it.description && it.description !== it.controlCode && it.description !== 'Decor') 
        ? it.description 
        : (it.tag || 'Mined item');
      ctx.fillText(fallbackItemDesc, cellX + itemW / 2, cellY + imgAreaH / 2 + 26);
      ctx.textAlign = 'left';
    }

    // Badge 1: Control Number / Tag Badge (Top Left)
    const codeStr = it.controlNum ? '#' + it.controlNum : (it.controlCode || `#${i + 1}`);
    ctx.font = 'bold 13px monospace';
    const codeWidth = ctx.measureText(codeStr).width + 16;
    ctx.fillStyle = 'rgba(9, 9, 11, 0.88)';
    drawCanvasRoundRect(ctx, cellX + 10, cellY + 10, codeWidth, 24, 6, true);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(codeStr, cellX + 18, cellY + 26);

    // Badge 2: Price Badge (Top Right)
    const priceStr = `${profile.currency}${it.price.toLocaleString()}`;
    ctx.font = 'bold 14px monospace';
    const priceWidth = ctx.measureText(priceStr).width + 18;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.lineWidth = 1;
    drawCanvasRoundRect(ctx, cellX + itemW - priceWidth - 10, cellY + 10, priceWidth, 25, 6, true, true);
    ctx.fillStyle = '#09090b';
    ctx.fillText(priceStr, cellX + itemW - priceWidth - 10 + 9, cellY + 27);

    // Card Bottom Info Strip
    const infoY = cellY + imgAreaH;
    
    // Divider line between photo and info
    ctx.strokeStyle = '#f4f4f5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cellX, infoY);
    ctx.lineTo(cellX + itemW, infoY);
    ctx.stroke();

    // Item Title / Description
    const itemTitle = (it.description && it.description !== it.controlCode && it.description !== 'Decor')
      ? it.description
      : (it.tag || (it.controlNum ? 'Item #' + it.controlNum : 'Mined Item'));
    
    ctx.fillStyle = '#18181b';
    ctx.font = 'bold 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const safeTitle = truncateText(ctx, itemTitle, itemW - 24);
    ctx.fillText(safeTitle, cellX + 12, infoY + 22);

    // Item Subtext (Timestamp or Item index)
    ctx.fillStyle = '#71717a';
    ctx.font = '11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const itemMeta = it.time ? `Mined at ${it.time}` : `Item ${i + 1} of ${count}`;
    ctx.fillText(itemMeta, cellX + 12, infoY + 40);
  }

  // 4. Footer Section (Minimalist Summary — NO Payment Instructions)
  const footerY = canvasH - footerH - padding;

  // Footer Container Box
  ctx.fillStyle = '#fafafa';
  ctx.strokeStyle = '#e4e4e7';
  ctx.lineWidth = 1;
  drawCanvasRoundRect(ctx, padding, footerY, canvasW - padding * 2, footerH, 12, true, true);

  // Left: Total Items & Total Value
  ctx.fillStyle = '#09090b';
  ctx.font = 'bold 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Total Mined: ${count} ${count === 1 ? 'Item' : 'Items'}`, padding + 18, footerY + 28);

  ctx.fillStyle = '#18181b';
  ctx.font = 'bold 15px monospace';
  ctx.fillText(`Total Amount: ${profile.currency}${target.totalAmount.toLocaleString()}`, padding + 18, footerY + 50);

  // Right: Thank You Note / Store Signature
  ctx.textAlign = 'right';
  ctx.fillStyle = '#71717a';
  ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(`Photo showcase for @${cleanBuyerName}`, canvasW - padding - 18, footerY + 28);

  ctx.font = 'bold 12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = '#09090b';
  ctx.fillText(`${profile.name || 'Live Selling POS'}  •  Thank You!`, canvasW - padding - 18, footerY + 50);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}
