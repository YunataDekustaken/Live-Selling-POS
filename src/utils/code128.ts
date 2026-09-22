import JsBarcode from 'jsbarcode';

/**
 * Standard Code 128 (Subset B) barcode utility.
 * ISO/IEC 15417 compliant:
 * - Subset B encodes all standard ASCII characters (32 to 127).
 * - Start code B (symbol 104)
 * - Modulo 103 checksum
 * - Stop pattern (symbol 106) + termination bar
 */

export interface Code128Result {
  modules: string; // String of '1' (bar) and '0' (space)
  cleanText: string;
  totalModules: number;
}

/**
 * Generate binary module pattern for Code 128 Subset B
 */
export function getCode128BModules(rawText: string): Code128Result {
  let cleanText = (rawText || '').replace(/^\[\s*|\s*\]$/g, '').trim();
  // Strip non-printable ASCII or control characters
  cleanText = cleanText.replace(/[^\x20-\x7E]/g, '');
  if (!cleanText) cleanText = '001';

  try {
    const encObj: any = {};
    JsBarcode(encObj, cleanText, {
      format: 'CODE128B',
      displayValue: false,
      margin: 0
    });

    const data: string = encObj.encodings?.[0]?.data || '';
    if (data && data.length > 0) {
      return {
        modules: data,
        cleanText,
        totalModules: data.length
      };
    }
  } catch (err) {
    console.warn('JsBarcode CODE128B encoding failed, using fallback:', err);
  }

  // Fallback: standard Code 128 B pattern if needed
  return generateFallbackCode128B(cleanText);
}

/**
 * Draw crisp Code 128 Subset B barcode onto an HTML5 2D Canvas context.
 * Perfect for 203 DPI thermal printheads and pixel-perfect rasterization.
 */
export function drawCode128BToCanvas(
  ctx: CanvasRenderingContext2D,
  rawText: string,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
  options: {
    barColor?: string;
    bgColor?: string;
    showHumanReadable?: boolean;
    textPosition?: 'bottom' | 'none';
    fontSize?: number;
    fontFamily?: string;
  } = {}
): { drawnWidth: number; drawnHeight: number } {
  const { modules, cleanText, totalModules } = getCode128BModules(rawText);
  if (!modules || totalModules === 0) return { drawnWidth: 0, drawnHeight: 0 };

  const barColor = options.barColor || '#000000';
  const bgColor = options.bgColor;
  const showText = options.showHumanReadable ?? false;
  const textH = showText ? (options.fontSize || 10) + 2 : 0;
  const barHeight = Math.max(10, targetHeight - textH);

  // Calculate module width so barcode fits neatly in targetWidth
  // Module width must be at least 1px
  const rawModW = targetWidth / totalModules;
  const modW = Math.max(1, rawModW);
  const actualBarcodeWidth = totalModules * modW;

  // Center horizontally if actual barcode is narrower than targetWidth
  const startX = Math.round(x + Math.max(0, (targetWidth - actualBarcodeWidth) / 2));

  if (bgColor) {
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, targetWidth, targetHeight);
  }

  ctx.fillStyle = barColor;

  // Draw bars by grouping consecutive 1s for crisp, sharp rendering
  let i = 0;
  while (i < totalModules) {
    if (modules[i] === '1') {
      let runLength = 1;
      while (i + runLength < totalModules && modules[i + runLength] === '1') {
        runLength++;
      }
      const barX = startX + (i * modW);
      const barW = runLength * modW;
      ctx.fillRect(barX, y, barW, barHeight);
      i += runLength;
    } else {
      i++;
    }
  }

  // Draw human-readable text if requested
  if (showText && textH > 0) {
    ctx.fillStyle = barColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fontFam = options.fontFamily || 'monospace';
    const fSize = options.fontSize || 10;
    ctx.font = `bold ${fSize}px ${fontFam}`;
    ctx.fillText(cleanText, startX + (actualBarcodeWidth / 2), y + barHeight + 2);
  }

  return { drawnWidth: actualBarcodeWidth, drawnHeight: targetHeight };
}

/**
 * Generate a standalone SVG string for Code 128 Subset B.
 * High-contrast, vector-sharp for HTML and print stylesheets.
 */
export function generateCode128BSvg(
  rawText: string,
  width: number = 200,
  height: number = 40,
  options: {
    barColor?: string;
    bgColor?: string;
    quietZone?: number;
  } = {}
): string {
  const { modules, cleanText, totalModules } = getCode128BModules(rawText);
  if (!modules) return '';

  const barColor = options.barColor || '#000000';
  const quietZone = options.quietZone ?? 4; // Quiet zone in modules
  const fullModules = totalModules + (quietZone * 2);

  const rects: string[] = [];
  let i = 0;
  while (i < totalModules) {
    if (modules[i] === '1') {
      let run = 1;
      while (i + run < totalModules && modules[i + run] === '1') {
        run++;
      }
      const rx = quietZone + i;
      rects.push(`<rect x="${rx}" y="0" width="${run}" height="${height}" fill="${barColor}" />`);
      i += run;
    } else {
      i++;
    }
  }

  const bgRect = options.bgColor ? `<rect x="0" y="0" width="${fullModules}" height="${height}" fill="${options.bgColor}" />` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fullModules} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" data-code="${cleanText}">
    ${bgRect}
    ${rects.join('\n    ')}
  </svg>`;
}

/**
 * Generate a PNG Data URL using an offscreen canvas
 */
export function generateCode128BDataUrl(
  rawText: string,
  width: number = 220,
  height: number = 50
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  drawCode128BToCanvas(ctx, rawText, 0, 0, width, height);

  return canvas.toDataURL('image/png');
}

/**
 * Fallback Code 128 Subset B patterns (in case external library is ever unavailable)
 */
function generateFallbackCode128B(text: string): Code128Result {
  // ISO 15417 Code 128 patterns (widths of 3 bars and 3 spaces)
  const PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131',
    '211412', // 103: Start A
    '211214', // 104: Start B
    '211232', // 105: Start C
    '2331112' // 106: Stop
  ];

  function patternToModules(pat: string): string {
    let res = '';
    let isBar = true;
    for (let i = 0; i < pat.length; i++) {
      const width = parseInt(pat[i], 10);
      res += (isBar ? '1' : '0').repeat(width);
      isBar = !isBar;
    }
    return res;
  }

  // Start B = 104
  const startCode = 104;
  let checksum = startCode;
  const charCodes: number[] = [startCode];

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    const charVal = Math.max(0, Math.min(102, code));
    charCodes.push(charVal);
    checksum += (i + 1) * charVal;
  }

  charCodes.push(checksum % 103);
  charCodes.push(106); // Stop

  let modules = '';
  for (const c of charCodes) {
    modules += patternToModules(PATTERNS[c]);
  }

  return {
    modules,
    cleanText: text,
    totalModules: modules.length
  };
}
