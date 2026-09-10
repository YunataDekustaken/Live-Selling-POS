/**
 * Web Bluetooth Direct ESC/POS Printer Driver for PT-210 / 58mm / 80mm Thermal Printers
 * Enables direct printing from Google Chrome / Edge on Android without RawBT.
 */

import {
  buildStickerEscPos,
  buildPackingSlipEscPos,
  buildInvoiceEscPos,
  buildTestReceiptEscPos
} from './escpos';

// Known Bluetooth Thermal Printer Service & Characteristic UUIDs
const KNOWN_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard ESC/POS
  '0000ffe0-0000-1000-8000-00805f9b34fb', // Common 58mm BLE (PT-210 / MPT-II)
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip Transparent Serial
  '0000ff00-0000-1000-8000-00805f9b34fb', // Feasycom / GOOJPRT
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Telit / Custom GATT
  '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent / WeChat IoT
  '0000ae00-0000-1000-8000-00805f9b34fb', // AI-Thinker / Milestone
  '0000ffff-0000-1000-8000-00805f9b34fb',
  '0000180a-0000-1000-8000-00805f9b34fb'  // Device Info
];

let bluetoothDevice: any = null;
let printerCharacteristic: any = null;

export interface BluetoothPrinterStatus {
  isSupported: boolean;
  isConnected: boolean;
  deviceName: string | null;
  statusText: string;
}

/**
 * Check if Web Bluetooth API is supported in the current browser
 */
export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && typeof (navigator as any).bluetooth?.requestDevice === 'function';
}

/**
 * Get current connected device name
 */
export function getConnectedPrinterName(): string | null {
  if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
    return bluetoothDevice.name || 'PT-210 Printer';
  }
  return null;
}

/**
 * Check if printer is currently connected and ready to receive commands
 */
export function isPrinterConnected(): boolean {
  return Boolean(bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected && printerCharacteristic);
}

/**
 * Connect to Bluetooth Thermal Printer (opens browser pairing dialog)
 */
export async function connectBluetoothPrinter(
  onDisconnectCallback?: () => void
): Promise<{ success: boolean; deviceName: string; error?: string }> {
  if (!isWebBluetoothSupported()) {
    return {
      success: false,
      deviceName: '',
      error: 'Web Bluetooth is not supported in this browser. Please use Chrome on Android.'
    };
  }

  try {
    // Prompt user to select their PT-210 / Thermal printer
    const device = await (navigator as any).bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_PRINTER_SERVICES
    });

    if (!device) {
      return { success: false, deviceName: '', error: 'No printer selected.' };
    }

    bluetoothDevice = device;

    // Handle unexpected disconnects
    device.addEventListener('gattserverdisconnected', () => {
      console.warn('Bluetooth printer disconnected');
      printerCharacteristic = null;
      if (onDisconnectCallback) {
        onDisconnectCallback();
      }
    });

    // Connect to GATT Server
    const server = await device.gatt.connect();

    // Discover writable characteristic across known services
    let writeChar: any = null;

    // First try all declared known services
    for (const serviceUuid of KNOWN_PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        if (service) {
          const characteristics = await service.getCharacteristics();
          for (const char of characteristics) {
            if (char.properties.write || char.properties.writeWithoutResponse) {
              writeChar = char;
              break;
            }
          }
        }
      } catch (e) {
        // Continue probing other service UUIDs
      }
      if (writeChar) break;
    }

    // Fallback: If not found in known list, probe all primary services
    if (!writeChar && typeof server.getPrimaryServices === 'function') {
      try {
        const services = await server.getPrimaryServices();
        for (const service of services) {
          try {
            const characteristics = await service.getCharacteristics();
            for (const char of characteristics) {
              if (char.properties.write || char.properties.writeWithoutResponse) {
                writeChar = char;
                break;
              }
            }
          } catch (e) {}
          if (writeChar) break;
        }
      } catch (e) {}
    }

    if (!writeChar) {
      return {
        success: false,
        deviceName: device.name || 'Printer',
        error: 'Found Bluetooth device, but could not detect ESC/POS writable channel. Ensure printer is in Bluetooth pairing mode.'
      };
    }

    printerCharacteristic = writeChar;
    const name = device.name || 'PT-210 Thermal Printer';

    // Store in localStorage for UI recall
    localStorage.setItem('live_pos_bt_printer_name', name);

    return {
      success: true,
      deviceName: name
    };
  } catch (err: any) {
    console.error('Bluetooth connection failed:', err);
    if (err.name === 'NotFoundError') {
      return { success: false, deviceName: '', error: 'Pairing cancelled.' };
    }
    return {
      success: false,
      deviceName: '',
      error: err.message || 'Bluetooth connection failed.'
    };
  }
}

/**
 * Disconnect from active Bluetooth printer
 */
export function disconnectBluetoothPrinter(): void {
  if (bluetoothDevice && bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
    try {
      bluetoothDevice.gatt.disconnect();
    } catch (e) {
      console.warn('Error disconnecting GATT server:', e);
    }
  }
  bluetoothDevice = null;
  printerCharacteristic = null;
  localStorage.removeItem('live_pos_bt_printer_name');
}

/**
 * Send raw ESC/POS byte buffer to connected printer in safe BLE MTU chunks (64 bytes)
 */
export async function sendEscPosBytes(bytes: Uint8Array): Promise<boolean> {
  if (!printerCharacteristic) {
    throw new Error('No Bluetooth printer connected. Please connect your PT-210 in settings.');
  }

  const CHUNK_SIZE = 64; // Safe BLE MTU write packet size
  const totalLength = bytes.length;

  for (let offset = 0; offset < totalLength; offset += CHUNK_SIZE) {
    const chunk = bytes.slice(offset, Math.min(offset + CHUNK_SIZE, totalLength));
    
    if (printerCharacteristic.writeValueWithoutResponse) {
      await printerCharacteristic.writeValueWithoutResponse(chunk);
    } else if (printerCharacteristic.writeValue) {
      await printerCharacteristic.writeValue(chunk);
    } else {
      throw new Error('Printer characteristic does not support write operations.');
    }

    // Small delay to prevent buffer overflows on microcontrollers like PT-210
    if (offset + CHUNK_SIZE < totalLength) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  return true;
}

/**
 * Directly print a 50x30mm / 58mm thermal sticker to PT-210
 */
export async function printDirectSticker(
  mine: {
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
): Promise<boolean> {
  const bytes = buildStickerEscPos(mine, profile, sessionDate, paperCols);
  return await sendEscPosBytes(bytes);
}

/**
 * Directly print consolidated Packing Slip to PT-210
 */
export async function printDirectPackingSlip(
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
): Promise<boolean> {
  const bytes = buildPackingSlipEscPos(basket, profile, sessionDate, paperCols);
  return await sendEscPosBytes(bytes);
}

/**
 * Directly print Official Customer Invoice to PT-210
 */
export async function printDirectInvoice(
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
): Promise<boolean> {
  const bytes = buildInvoiceEscPos(basket, profile, sessionDate, paperCols);
  return await sendEscPosBytes(bytes);
}

/**
 * Directly print a self-test slip to PT-210
 */
export async function printDirectTest(
  storeName: string = 'PT-210 Thermal Printer',
  paperCols: number = 32
): Promise<boolean> {
  const bytes = buildTestReceiptEscPos(storeName, paperCols);
  return await sendEscPosBytes(bytes);
}
