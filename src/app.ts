import { createApp, ref, reactive, computed, onMounted, nextTick, watch } from 'vue';
import type {
  Profile,
  MinedItem,
  PaymentRecord,
  BuyerBasket,
  AppSettings,
  ActiveStoreForm,
  LiveMiningForm,
  LabelLayoutSettings,
  ReceiptLayoutSettings,
  SavedLabelProfile,
  VisualLabelElement
} from './types';
import { defaultProfiles } from './data/defaultProfiles';
import { defaultSettings, defaultLabelLayout, defaultReceiptLayout, defaultLabelElements, defaultReceiptSections } from './data/defaultSettings';
import { getSampleMines, getSamplePayments, sampleCustomerNotes } from './data/sampleData';
import { playBeep } from './utils/audio';
import { safeGetItem, safeSetItem, safeParseJson } from './utils/storage';
import {
  getProfileDotClass,
  getProfileBadgeClass,
  getStatusText,
  getStatusBadgeClass,
  getBalanceColorClass
} from './utils/formatters';
import {
  exportNotionCustomerBalancesCsv as exportNotionBalancesUtil,
  exportNotionMinedItemsCsv as exportNotionMinesUtil,
  exportRawMinesCsv as exportRawMinesUtil
} from './utils/export';
import { createPhotoCollageCanvas } from './utils/collage';
import {
  getSupabaseClient,
  pushProfileToSupabase,
  pushActiveProfileToSupabase,
  deleteProfileFromSupabase,
  fetchCloudDeletedProfiles,
  removeDeletedProfileTombstone,
  pushSingleMineToSupabase,
  deleteSingleMineFromSupabase,
  fetchCloudDeletedMines,
  pushSinglePaymentToSupabase,
  pushCustomerNoteToSupabase,
  syncR2ConfigToSupabase,
  fetchR2ConfigFromSupabase,
  syncAppSettingsToSupabase,
  fetchAppSettingsFromSupabase,
  syncLabelProfilesToSupabase,
  fetchLabelProfilesFromSupabase,
  pushSinglePhotoToSupabase,
  fetchCloudPhotosForProfile,
  batchPushPhotosToSupabase,
  deleteSinglePhotoFromSupabase,
  syncSecurityPinToSupabase,
  fetchSecurityPinFromSupabase
} from './utils/supabase';
import {
  isWebBluetoothSupported,
  isPrinterConnected,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  printDirectSticker,
  printDirectPackingSlip,
  printDirectInvoice,
  printDirectTest,
  feedToNextLabelGap,
  getConnectedPrinterName
} from './utils/bluetoothPrinter';
import {
  getStoredR2Config,
  setStoredR2Config,
  isR2Configured,
  uploadToCloudflareR2,
  checkServerR2Status,
  R2Config
} from './utils/r2Storage';
import QRCode from 'qrcode';

const app = createApp({
  setup() {
    // App Navigation: Default to Home Dashboard
    const currentTab = ref('dashboard'); // 'dashboard', 'mining', 'balances', 'mined_items', 'designer'
    const previousTab = ref('dashboard');

    function openDesigner(mode?: 'label' | 'receipt') {
      if (mode) {
        designerMode.value = mode;
      }
      if (currentTab.value !== 'designer') {
        previousTab.value = currentTab.value;
      }
      currentTab.value = 'designer';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function exitDesigner() {
      currentTab.value = (previousTab.value && previousTab.value !== 'designer') ? previousTab.value : 'dashboard';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Multi-Business Profiles Definition (with deleted IDs tombstone tracking)
    const deletedProfileIds = new Set<string>(
      safeParseJson(safeGetItem('live_pos_deleted_profile_ids'), [])
    );

    let initialProfiles: Profile[] = [];
    const savedProfiles = safeGetItem('live_pos_profiles');
    if (savedProfiles) {
      const parsed = safeParseJson(savedProfiles, null);
      if (Array.isArray(parsed) && parsed.length > 0) {
        initialProfiles = parsed.filter((p: Profile) => p && p.id && !deletedProfileIds.has(p.id));
      }
    }
    if (initialProfiles.length === 0) {
      initialProfiles = defaultProfiles.filter(p => !deletedProfileIds.has(p.id));
      if (initialProfiles.length === 0) {
        initialProfiles = [defaultProfiles[0]];
      }
    }

    const profiles = ref<Profile[]>(initialProfiles);
    const savedActiveId = safeGetItem('live_pos_active_profile_id') as string | null;
    const activeProfileId = ref<string>(
      (savedActiveId && profiles.value.some(p => p.id === savedActiveId))
        ? savedActiveId
        : profiles.value[0].id
    );

    const activeProfile = computed<Profile>(() => {
      const found = profiles.value.find(p => p.id === activeProfileId.value);
      if (found) {
        return {
          ...defaultProfiles[0],
          ...found,
          currency: found.currency || '₱',
          codePrefix: (found.codePrefix && found.codePrefix !== '#' && found.codePrefix !== '-') 
            ? found.codePrefix 
            : (found.name ? (found.name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'L') : 'L'),
          quickPrefixes: Array.isArray(found.quickPrefixes) && found.quickPrefixes.length > 0 ? found.quickPrefixes : ['A', 'B', 'C', 'D', 'VIP'],
          defaultCategories: Array.isArray(found.defaultCategories) && found.defaultCategories.length > 0 ? found.defaultCategories : ['General']
        };
      }
      if (profiles.value.length > 0) {
        const first = profiles.value[0];
        return {
          ...defaultProfiles[0],
          ...first,
          currency: first.currency || '₱',
          codePrefix: (first.codePrefix && first.codePrefix !== '#' && first.codePrefix !== '-') 
            ? first.codePrefix 
            : (first.name ? (first.name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'L') : 'L'),
          quickPrefixes: Array.isArray(first.quickPrefixes) && first.quickPrefixes.length > 0 ? first.quickPrefixes : ['A', 'B', 'C', 'D', 'VIP'],
          defaultCategories: Array.isArray(first.defaultCategories) && first.defaultCategories.length > 0 ? first.defaultCategories : ['General']
        };
      }
      return defaultProfiles[0];
    });

    // --- Control Code Format & Duplicate Prevention Engine ---
    // Helper to get business prefix (e.g., Leaf & Layer -> 'L', Aura Crystals -> 'A', or custom prefix)
    function getStorePrefix(p?: Profile | null): string {
      if (!p) return 'L';
      const custom = (p.codePrefix || '').trim().replace(/[^A-Za-z0-9]/g, '');
      if (custom && custom !== '#' && custom !== '-') {
        return custom.toUpperCase();
      }
      const nameClean = (p.name || '').trim().replace(/[^A-Za-z0-9]/g, '');
      return nameClean.length > 0 ? nameClean.charAt(0).toUpperCase() : 'L';
    }

    // Helper to get today's live 4-digit MMDD session date (e.g., "0910")
    function getTodaySessionDate(): string {
      const d = new Date();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${m}${day}`;
    }

    // Helper to format any date string to clean 4-digit MMDD (defaults to today)
    function getFormattedSessionDate(val?: string): string {
      const todayMMDD = getTodaySessionDate();
      if (!val) return todayMMDD;
      const clean = String(val).replace(/[^0-9]/g, '');
      if (clean.length === 4) return clean;
      if (clean.length > 4) return clean.slice(-4);
      return todayMMDD;
    }

    // Helper to construct exact control code string: Prefix + MMDD + -001 (e.g. L0910-001)
    function formatControlCode(prefix: string, dateStr: string, seq: number): string {
      const p = (prefix || 'L').toUpperCase();
      const d = getFormattedSessionDate(dateStr);
      const numStr = String(Math.max(1, seq || 1)).padStart(3, '0');
      return `${p}${d}-${numStr}`;
    }

    // Duplicate Prevention: calculates next unique unused sequence number across all existing logs
    function getNextUniqueSequenceNumber(startSeq: number, minesList: MinedItem[], prefix: string, dateStr: string): number {
      const existingCodes = new Set(
        minesList.map(m => (m.controlCode || '').toUpperCase().trim()).filter(Boolean)
      );
      let seq = Math.max(1, startSeq);
      while (existingCodes.has(formatControlCode(prefix, dateStr, seq).toUpperCase())) {
        seq++;
      }
      return seq;
    }

    // Core Data Stores (Profile-isolated with deleted mine tombstones)
    const initialDeletedMineIds = new Set<string>(safeParseJson(safeGetItem('live_pos_deleted_mine_ids'), []));
    const rawLoadedMines = safeParseJson(safeGetItem('live_pos_mines_' + activeProfileId.value) || safeGetItem('live_pos_mines'), []);
    const sanitizedInitialMines = rawLoadedMines
      .filter((m: MinedItem) => m && m.id && !initialDeletedMineIds.has(m.id))
      .map((m: MinedItem) => {
        let cleanDesc = (m.description || '').trim();
        const cleanTag = (m.tag || '').trim();
        if (cleanDesc === 'Decor' && m.id && m.id.startsWith('mine_')) {
          cleanDesc = '';
        }
        if (!cleanDesc && cleanTag && cleanTag !== m.controlCode && cleanTag !== 'Decor') {
          cleanDesc = cleanTag;
        }
        return { 
          ...m, 
          description: cleanDesc,
          tag: cleanDesc || m.controlCode || '' 
        };
      });
    const allMines = ref<MinedItem[]>(sanitizedInitialMines);
    const allPayments = ref<PaymentRecord[]>(
      safeParseJson(safeGetItem('live_pos_payments_' + activeProfileId.value) || safeGetItem('live_pos_payments'), [])
    );

    // Compute appropriate sequence number for a given date (resets to 1 every new day unless items exist for today)
    function computeSequenceForDate(targetDate: string, targetProfile: Profile | null, minesList: MinedItem[], storedSeq?: number): number {
      const prefix = getStorePrefix(targetProfile);
      let maxTodaySeq = 0;
      for (const m of minesList) {
        const code = (m.controlCode || '').toUpperCase().trim();
        const match = code.match(new RegExp(`^${prefix}${targetDate}-(\\d+)$`, 'i'));
        if (match && match[1]) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxTodaySeq) {
            maxTodaySeq = num;
          }
        }
      }

      let startSeq = 1;
      if (maxTodaySeq > 0) {
        startSeq = maxTodaySeq + 1;
      } else if (storedSeq && storedSeq > 1) {
        startSeq = storedSeq;
      }

      return getNextUniqueSequenceNumber(startSeq, minesList, prefix, targetDate);
    }

    // Session Setup: always defaults to TODAY's date (e.g., "0910")
    const now = new Date();
    const defaultSessionDate = getTodaySessionDate();
    const todayMMDD = defaultSessionDate;

    // Check stored session date vs today's date
    const rawStoredDate = (safeGetItem('live_pos_session_date_' + activeProfileId.value) || safeGetItem('live_pos_session_date')) as string;
    const isSameDay = rawStoredDate && getFormattedSessionDate(rawStoredDate) === todayMMDD;

    const sessionDate = ref<string>(todayMMDD);
    const sessionStartTime = ref(
      (safeGetItem('live_pos_session_start_' + activeProfileId.value) || safeGetItem('live_pos_session_start') || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) as string
    );

    // Sequence Counter: resets to 1 everyday / new date, or resumes today's latest item count
    const rawStoredSeq = Number(safeGetItem('live_pos_sequence_counter_' + activeProfileId.value) || safeGetItem('live_pos_sequence_counter') || 1);
    const initialSeq = computeSequenceForDate(todayMMDD, activeProfile.value, allMines.value, isSameDay ? rawStoredSeq : 1);
    const sequenceCounter = ref<number>(initialSeq);

    // Save live today date and sequence state
    safeSetItem('live_pos_session_date_' + activeProfileId.value, todayMMDD);
    safeSetItem('live_pos_sequence_counter_' + activeProfileId.value, String(sequenceCounter.value));

    // Daily Rollover checker: ensures if day rolls over while app is running, sequence resets to 1 for the new day
    function checkAndApplyDailyRollover() {
      const liveToday = getTodaySessionDate();
      if (sessionDate.value !== liveToday) {
        sessionDate.value = liveToday;
        sequenceCounter.value = computeSequenceForDate(liveToday, activeProfile.value, allMines.value, 1);
        safeSetItem('live_pos_session_date_' + activeProfileId.value, liveToday);
        safeSetItem('live_pos_sequence_counter_' + activeProfileId.value, String(sequenceCounter.value));
        pushProfileToSupabase(activeProfile.value, sequenceCounter.value, liveToday);
      }
    }

    // Settings Store
    const initialSettings: AppSettings = safeParseJson(safeGetItem('live_pos_settings'), {
      ...defaultSettings,
      storeName: activeProfile.value ? activeProfile.value.name : defaultSettings.storeName,
      paymentDetails: activeProfile.value ? activeProfile.value.paymentDetails : defaultSettings.paymentDetails,
      printerPaperWidth: '58mm',
      escPosDirectPrint: true
    });

    if (!initialSettings.miningFieldsOrder || !Array.isArray(initialSettings.miningFieldsOrder) || initialSettings.miningFieldsOrder.length === 0) {
      initialSettings.miningFieldsOrder = ['customer', 'description', 'price'];
    } else {
      const validKeys = ['customer', 'description', 'price'];
      const existing = initialSettings.miningFieldsOrder.filter(k => validKeys.includes(k));
      validKeys.forEach(k => {
        if (!existing.includes(k)) existing.push(k);
      });
      initialSettings.miningFieldsOrder = existing;
    }
    if (!initialSettings.syncInterval) {
      initialSettings.syncInterval = '30s';
    }
    if (!initialSettings.printerPaperWidth) {
      initialSettings.printerPaperWidth = '58mm';
    }
    if (initialSettings.escPosDirectPrint === undefined) {
      initialSettings.escPosDirectPrint = true;
    }
    if (initialSettings.autoPrint === undefined) {
      initialSettings.autoPrint = true;
    }
    if (!initialSettings.labelLayout) {
      initialSettings.labelLayout = { ...defaultLabelLayout };
    } else {
      initialSettings.labelLayout = { ...defaultLabelLayout, ...initialSettings.labelLayout };
    }
    if (!initialSettings.labelLayout.customElements || initialSettings.labelLayout.customElements.length === 0) {
      initialSettings.labelLayout.customElements = JSON.parse(JSON.stringify(defaultLabelElements));
    } else {
      for (const el of initialSettings.labelLayout.customElements) {
        if (el.id === 'price' && (el.prefix === 'P' || el.prefix === 'PHP' || !el.prefix)) {
          el.prefix = '₱';
        }
      }
    }

    if (!initialSettings.receiptLayout) {
      initialSettings.receiptLayout = { ...defaultReceiptLayout };
    } else {
      initialSettings.receiptLayout = { ...defaultReceiptLayout, ...initialSettings.receiptLayout };
    }
    if (!initialSettings.receiptLayout.customSections || initialSettings.receiptLayout.customSections.length === 0) {
      initialSettings.receiptLayout.customSections = JSON.parse(JSON.stringify(defaultReceiptSections));
    }
    if (!initialSettings.labelPrinterName) {
      initialSettings.labelPrinterName = 'PT-265';
    }
    if (!initialSettings.receiptPrinterName) {
      initialSettings.receiptPrinterName = 'PT-210';
    }
    if (!initialSettings.activePrinterType) {
      initialSettings.activePrinterType = 'auto';
    }
    if (!initialSettings.securityPin) {
      initialSettings.securityPin = localStorage.getItem('live_pos_admin_pin') || '1234';
    }
    if (initialSettings.requirePasscode === undefined) {
      initialSettings.requirePasscode = true;
    }
    const settings = ref<AppSettings>(initialSettings);

    // Merchant POS Authentication & PIN Protection State
    function isCustomerUrlPresent(): boolean {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      return (
        hash.includes('/order/') || 
        hash.includes('/invoice/') || 
        search.includes('buyer=') || 
        search.includes('order=') || 
        search.includes('invoice=') ||
        search.includes('customer=')
      );
    }

    const hasSavedAuth = localStorage.getItem('live_pos_auth_session') === 'true' || sessionStorage.getItem('live_pos_auth_session') === 'true';
    const isCustomerRoute = isCustomerUrlPresent();

    // Authenticated state: If arriving via a customer checkout link, public users cannot enter merchant dashboard
    const isAdminAuthenticated = ref<boolean>(
      isCustomerRoute ? false : (hasSavedAuth || !initialSettings.requirePasscode)
    );
    const adminPin = ref<string>(initialSettings.securityPin || localStorage.getItem('live_pos_admin_pin') || '1234');
    const showStaffLoginModal = ref<boolean>(false);
    const loginPinInput = ref<string>('');
    const loginErrorMsg = ref<string>('');
    const rememberDevice = ref<boolean>(true);

    // Change PIN Form State in Settings
    const changePinCurrent = ref<string>('');
    const changePinNew = ref<string>('');
    const changePinConfirm = ref<string>('');
    const changePinError = ref<string>('');
    const changePinSuccess = ref<string>('');
    const isSavingPin = ref<boolean>(false);
    const showPinInSettings = ref<boolean>(false);

    function onKeypadPress(num: string) {
      if (loginPinInput.value.length < 8) {
        loginPinInput.value += num;
        loginErrorMsg.value = '';
        const expectedLength = (adminPin.value || settings.value.securityPin || '1234').trim().length || 4;
        if (loginPinInput.value.length >= 4 && loginPinInput.value.length === expectedLength) {
          setTimeout(() => {
            verifyAdminPin();
          }, 100);
        }
      }
    }

    function unlockSuccess() {
      isAdminAuthenticated.value = true;
      loginErrorMsg.value = '';
      loginPinInput.value = '';
      showStaffLoginModal.value = false;
      if (rememberDevice.value) {
        localStorage.setItem('live_pos_auth_session', 'true');
      } else {
        sessionStorage.setItem('live_pos_auth_session', 'true');
      }
      playBeep('success', settings.value.soundEnabled);
      showToast('Store POS Unlocked! Welcome back.');
      if (isCustomerCheckoutView.value) {
        isCustomerCheckoutView.value = false;
      }
    }

    async function verifyAdminPin(enteredPin?: string): Promise<boolean> {
      const testPin = (enteredPin !== undefined ? enteredPin : loginPinInput.value).trim();
      const actualPin = (adminPin.value || settings.value.securityPin || '1234').trim();

      if (testPin === actualPin) {
        unlockSuccess();
        return true;
      }

      // Check Supabase if local pin doesn't match, in case it was changed on another device!
      if (navigator.onLine) {
        try {
          const cloudPin = await fetchSecurityPinFromSupabase();
          if (cloudPin && cloudPin.trim() !== '') {
            const cleanCloud = cloudPin.trim();
            adminPin.value = cleanCloud;
            settings.value.securityPin = cleanCloud;
            localStorage.setItem('live_pos_admin_pin', cleanCloud);
            safeSetItem('live_pos_settings', settings.value);
            if (testPin === cleanCloud) {
              unlockSuccess();
              return true;
            }
          }
        } catch (e) {
          console.warn('verifyAdminPin cloud check notice:', e);
        }
      }

      loginErrorMsg.value = 'Incorrect passcode. Try again.';
      playBeep('error', settings.value.soundEnabled);
      return false;
    }

    function logout() {
      isAdminAuthenticated.value = false;
      localStorage.removeItem('live_pos_auth_session');
      sessionStorage.removeItem('live_pos_auth_session');
      loginPinInput.value = '';
      loginErrorMsg.value = '';
      showStaffLoginModal.value = false;
      appMenuOpen.value = false;
      settingsModalOpen.value = false;
      profileModalOpen.value = false;
      playBeep('undo', settings.value.soundEnabled);
      showToast('Logged out. POS Register is locked.');
    }

    function lockPos() {
      logout();
    }

    async function changeStorePin(): Promise<boolean> {
      changePinError.value = '';
      changePinSuccess.value = '';

      const currentExpected = (adminPin.value || settings.value.securityPin || '1234').trim();
      const currentInput = changePinCurrent.value.trim();
      const newPin = changePinNew.value.trim();
      const confirmPin = changePinConfirm.value.trim();

      if (currentInput !== currentExpected) {
        changePinError.value = 'Current PIN is incorrect.';
        playBeep('error', settings.value.soundEnabled);
        return false;
      }

      if (!newPin) {
        changePinError.value = 'Please enter a new PIN.';
        return false;
      }

      if (!/^\d{4,8}$/.test(newPin)) {
        changePinError.value = 'New PIN must be 4 to 8 numeric digits.';
        return false;
      }

      if (newPin !== confirmPin) {
        changePinError.value = 'New PIN and Confirm PIN do not match.';
        return false;
      }

      isSavingPin.value = true;
      try {
        adminPin.value = newPin;
        settings.value.securityPin = newPin;
        localStorage.setItem('live_pos_admin_pin', newPin);
        safeSetItem('live_pos_settings', settings.value);

        let cloudSynced = false;
        if (navigator.onLine) {
          const pinSaved = await syncSecurityPinToSupabase(newPin);
          await syncAppSettingsToSupabase(JSON.stringify(settings.value));
          cloudSynced = pinSaved;
        }

        changePinCurrent.value = '';
        changePinNew.value = '';
        changePinConfirm.value = '';
        changePinSuccess.value = cloudSynced 
          ? 'PIN updated and synced across devices via Supabase!'
          : 'PIN updated locally. Will sync to Supabase when connected.';

        playBeep('success', settings.value.soundEnabled);
        showToast('PIN changed successfully!');
        return true;
      } catch (err: any) {
        changePinError.value = 'Failed to update PIN: ' + (err.message || 'Error');
        return false;
      } finally {
        isSavingPin.value = false;
      }
    }

    function updateStorePasscode(newPin: string) {
      const clean = (newPin || '').trim();
      if (clean.length < 4) {
        showToast('Passcode must be at least 4 digits');
        return;
      }
      adminPin.value = clean;
      settings.value.securityPin = clean;
      localStorage.setItem('live_pos_admin_pin', clean);
      saveSettings();
      syncSecurityPinToSupabase(clean);
      showToast('Store Passcode updated!');
    }

    // Bluetooth Direct ESC/POS Printer State (PT-210 / 58mm / 80mm)
    const isWebBluetoothAvailable = ref(isWebBluetoothSupported());
    const btPrinterConnected = ref(isPrinterConnected());
    const btPrinterConnecting = ref(false);
    const btPrinterName = ref(localStorage.getItem('live_pos_bt_printer_name') || '');

    // Settings Modal Tab: 'store' | 'overall'
    const settingsTab = ref('store');

    // Form state for active business settings
    const activeStoreForm = reactive<ActiveStoreForm>({
      id: '',
      name: '',
      category: '',
      currency: '₱',
      codePrefix: 'L',
      color: 'emerald',
      quickPrefixesText: '',
      defaultCategoriesText: '',
      paymentDetails: ''
    });

    function syncActiveStoreForm() {
      const p = activeProfile.value;
      if (!p) return;
      activeStoreForm.id = p.id;
      activeStoreForm.name = p.name || '';
      activeStoreForm.category = p.category || 'Retail';
      activeStoreForm.currency = p.currency || '₱';
      activeStoreForm.codePrefix = getStorePrefix(p);
      activeStoreForm.color = p.color || 'emerald';
      activeStoreForm.quickPrefixesText = Array.isArray(p.quickPrefixes) ? p.quickPrefixes.join(', ') : 'A, B, C, D, VIP';
      activeStoreForm.defaultCategoriesText = Array.isArray(p.defaultCategories) ? p.defaultCategories.join(', ') : 'General';
      activeStoreForm.paymentDetails = p.paymentDetails || '';

      settings.value.storeName = activeStoreForm.name;
      settings.value.paymentDetails = activeStoreForm.paymentDetails;
    }

    function saveActiveStoreSettings(showFeedback = false) {
      const pIdx = profiles.value.findIndex(p => p.id === activeProfileId.value);
      if (pIdx === -1) return;

      const prefixes = activeStoreForm.quickPrefixesText
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      const categories = activeStoreForm.defaultCategoriesText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const rawPrefix = activeStoreForm.codePrefix.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const firstLetter = activeStoreForm.name.trim().replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'L';
      const finalPrefix = (rawPrefix && rawPrefix !== '#') ? rawPrefix : firstLetter;

      const updatedStore: Profile = {
        ...profiles.value[pIdx],
        name: activeStoreForm.name.trim() || 'My Business',
        category: activeStoreForm.category.trim() || 'Retail',
        currency: activeStoreForm.currency.trim() || '₱',
        codePrefix: finalPrefix,
        color: activeStoreForm.color || 'emerald',
        quickPrefixes: prefixes.length > 0 ? prefixes : ['A', 'B', 'C'],
        defaultCategories: categories.length > 0 ? categories : ['General'],
        paymentDetails: activeStoreForm.paymentDetails.trim()
      };

      profiles.value[pIdx] = updatedStore;
      settings.value.storeName = updatedStore.name;
      settings.value.paymentDetails = updatedStore.paymentDetails;

      safeSetItem('live_pos_profiles', profiles.value);
      safeSetItem('live_pos_settings', settings.value);
      safeSetItem('live_pos_settings_' + activeProfileId.value, {
        storeName: updatedStore.name,
        paymentDetails: updatedStore.paymentDetails,
        currency: updatedStore.currency,
        codePrefix: updatedStore.codePrefix
      });

      saveProfileData(activeProfileId.value);
      pushProfileToSupabase(updatedStore, sequenceCounter.value, sessionDate.value);
      pushActiveProfileToSupabase(activeProfileId.value);

      if (showFeedback) {
        showToast(`Saved settings for ${updatedStore.name}`);
      }
    }

    function saveSequenceForStore() {
      if (sequenceCounter.value < 1) sequenceCounter.value = 1;
      const prefix = getStorePrefix(activeProfile.value);
      const dateStr = sessionDate.value || defaultSessionDate;
      sequenceCounter.value = getNextUniqueSequenceNumber(sequenceCounter.value, allMines.value, prefix, dateStr);
      safeSetItem('live_pos_sequence_counter_' + activeProfileId.value, String(sequenceCounter.value));
      showToast(`Updated next sequence to #${sequenceCounter.value} (${formatControlCode(prefix, dateStr, sequenceCounter.value)})`);
    }

    function saveSessionDateForStore() {
      sessionDate.value = getFormattedSessionDate(sessionDate.value);
      const prefix = getStorePrefix(activeProfile.value);
      sequenceCounter.value = getNextUniqueSequenceNumber(sequenceCounter.value, allMines.value, prefix, sessionDate.value);
      safeSetItem('live_pos_session_date_' + activeProfileId.value, sessionDate.value);
      safeSetItem('live_pos_sequence_counter_' + activeProfileId.value, String(sequenceCounter.value));
      showToast(`Updated session date to ${sessionDate.value}`);
    }

    function onSettingsStoreChange(newId: string) {
      if (!newId || newId === activeProfileId.value) return;
      switchProfile(newId);
      syncActiveStoreForm();
    }

    function playTestBeep() {
      playBeep('success', settings.value.soundEnabled);
      showToast('Playing audio test chime...');
    }

    // Live Mining Form State
    const form = reactive<LiveMiningForm>({
      tag: '',
      description: '',
      price: '',
      buyer: '',
      photo: ''
    });

    const photoInputRef = ref<HTMLInputElement | null>(null);

    // In-flight photo upload tracker to link R2 CDN URLs if user logs mine while upload is still processing
    const currentUploadJob = ref<{
      id: string;
      base64: string;
      r2Url: string | null;
      isDone: boolean;
      assignedMineId: string | null;
    } | null>(null);

    function triggerPhotoCapture() {
      if (photoInputRef.value) {
        photoInputRef.value.click();
      }
    }

    function clearFormPhoto() {
      form.photo = '';
      currentUploadJob.value = null;
      if (photoInputRef.value) {
        photoInputRef.value.value = '';
      }
    }

    function handlePhotoUpload(event: Event) {
      const target = event.target as HTMLInputElement;
      const file = target.files && target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const rawUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const maxDim = 640;
          let w = img.width;
          let h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, w, h);
            const compressed = canvas.toDataURL('image/jpeg', 0.8);
            form.photo = compressed;
            showToast('Photo attached! 📸');
            playBeep('success', settings.value.soundEnabled);

            const uploadId = 'upl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
            currentUploadJob.value = {
              id: uploadId,
              base64: compressed,
              r2Url: null,
              isDone: false,
              assignedMineId: null
            };

            // Direct upload to Cloudflare R2 if configured (via .env or in-app settings)
            if (isR2Ready.value) {
              r2Status.value = 'uploading';
              r2StatusMessage.value = 'Uploading photo to Cloudflare R2...';
              const cleanSession = (sessionDate.value || 'live').replace(/[^a-zA-Z0-9_-]/g, '');
              const cleanStore = (activeProfile.value.id || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
              const fileKey = `${cleanStore}/${cleanSession}/item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}.jpg`;
              
              uploadToCloudflareR2(fileKey, compressed, r2Form).then((res) => {
                if (res.success && res.url) {
                  r2Status.value = 'connected';
                  r2StatusMessage.value = 'Photo uploaded to Cloudflare R2!';

                  if (currentUploadJob.value && currentUploadJob.value.id === uploadId) {
                    currentUploadJob.value.isDone = true;
                    currentUploadJob.value.r2Url = res.url;

                    // If form is still holding the thumbnail, upgrade to CDN URL
                    if (form.photo === compressed) {
                      form.photo = res.url;
                    }

                    // If user already clicked "Log Mine" before R2 finished, upgrade the saved mine and sync to Supabase!
                    if (currentUploadJob.value.assignedMineId) {
                      const mineId = currentUploadJob.value.assignedMineId;
                      const targetMine = allMines.value.find(m => m.id === mineId);
                      if (targetMine) {
                        targetMine.photo = res.url;
                        saveAll();
                        pushSingleMineToSupabase(targetMine, activeProfileId.value, sessionDate.value);
                      }
                    }
                  }
                } else {
                  console.warn('R2 direct upload notice:', res.error);
                  r2Status.value = 'idle';
                }
              }).catch(err => {
                console.warn('R2 direct upload error:', err);
                r2Status.value = 'idle';
              });
            }
          }
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(file);
    }

    // Customer Notes / Comments Store (for Notion Database Comment column)
    const customerNotes = ref<Record<string, string>>(
      safeParseJson(safeGetItem('live_pos_customer_notes'), {})
    );

    function updateCustomerNote(handle: string, note: string) {
      customerNotes.value[handle] = note;
      safeSetItem('live_pos_customer_notes', customerNotes.value);
      pushCustomerNoteToSupabase(handle, note, activeProfileId.value);
    }

    const descriptionInputRef = ref<any>(null);
    const tagInputRef = ref<any>(null);
    const priceInputRef = ref<any>(null);
    const buyerInputRef = ref<any>(null);

    function setDescriptionInputRef(el: any) {
      descriptionInputRef.value = el;
    }
    function setPriceInputRef(el: any) {
      priceInputRef.value = el;
    }
    function setBuyerInputRef(el: any) {
      buyerInputRef.value = el;
    }

    function getInputElement(refVal: any): HTMLElement | null {
      if (!refVal) return null;
      const raw = (refVal && refVal.value !== undefined) ? refVal.value : refVal;
      if (!raw) return null;
      if (Array.isArray(raw)) {
        return raw[0] || null;
      }
      return raw;
    }

    function focusInput(targetRef: any) {
      const el = getInputElement(targetRef);
      if (el && typeof el.focus === 'function') {
        try {
          el.focus();
        } catch (e) {
          console.warn('Could not focus element:', e);
        }
      }
    }

    // Auto-suggest state
    const buyerSuggestionsOpen = ref(false);

    // Toast notification state
    const toastMessage = ref('');
    let toastTimer: any = null;
    function showToast(msg: string) {
      toastMessage.value = msg;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastMessage.value = '';
      }, 3000);
    }

    // Supabase State
    const supabaseStatus = ref('disconnected'); // 'connected' | 'syncing' | 'error' | 'disconnected'
    const supabaseSyncMessage = ref('');
    const lastSyncedAt = ref<string | null>(localStorage.getItem('live_pos_last_synced') || null);

    async function pushAllToSupabase() {
      const client = getSupabaseClient();
      if (!client) {
        showToast('Supabase client unavailable');
        return;
      }
      if (!navigator.onLine) {
        showToast('Cannot push: device is offline');
        return;
      }
      supabaseStatus.value = 'syncing';
      supabaseSyncMessage.value = 'Pushing all stores & records to Supabase...';

      try {
        const profilePayloads = profiles.value.map(p => ({
          id: p.id,
          name: p.name,
          category: p.category || 'Retail',
          currency: p.currency || '₱',
          color: p.color || 'emerald',
          quick_prefixes: p.quickPrefixes || [],
          default_categories: p.defaultCategories || [],
          payment_details: p.paymentDetails || ''
        }));
        await client.from('business_profiles').upsert(profilePayloads);

        await pushActiveProfileToSupabase(activeProfileId.value);
        for (const p of profiles.value) {
          await client.from('customer_notes').upsert([{
            profile_id: p.id,
            buyer: '__store_meta__',
            notes: JSON.stringify({
              codePrefix: (p.codePrefix !== undefined && p.codePrefix !== null && p.codePrefix !== '') ? p.codePrefix : '#',
              sequence: Number(safeGetItem('live_pos_sequence_counter_' + p.id)) || 1,
              sessionDate: safeGetItem('live_pos_session_date_' + p.id) || sessionDate.value
            })
          }]);
        }

        // Filter out any locally or cloud deleted mines so they are never pushed back
        const currentDeletedMineIds = new Set<string>(safeParseJson(safeGetItem('live_pos_deleted_mine_ids'), []));
        const activeMines = allMines.value.filter(m => !currentDeletedMineIds.has(m.id));

        if (activeMines.length > 0) {
          const minePayloads = activeMines.map(m => ({
            id: m.id,
            profile_id: activeProfileId.value,
            session_date: m.date || sessionDate.value,
            control_code: m.controlCode,
            tag: m.tag,
            price: m.price,
            buyer: m.buyer,
            timestamp: String(m.timestamp || Date.now())
          }));
          await client.from('mined_items').upsert(minePayloads);

          // Back up and sync all photos to customer_notes table for multi-device cross-sync
          const photosToPush = activeMines
            .filter(m => m.photo && m.photo.trim() !== '')
            .map(m => ({ mineId: m.id, photo: m.photo! }));
          if (photosToPush.length > 0) {
            await batchPushPhotosToSupabase(photosToPush, activeProfileId.value);
          }
        }

        if (allPayments.value.length > 0) {
          const payPayloads = allPayments.value.map(p => ({
            id: p.id,
            profile_id: activeProfileId.value,
            buyer: p.buyer,
            amount: p.amount,
            method: p.method,
            reference: p.ref || '',
            timestamp: String(p.timestamp || Date.now())
          }));
          await client.from('customer_payments').upsert(payPayloads);
        }

        const notePayloads = Object.entries(customerNotes.value)
          .filter(([buyer]) => !buyer.startsWith('__'))
          .map(([buyer, notes]) => ({
            profile_id: activeProfileId.value,
            buyer,
            notes
          }));
        if (notePayloads.length > 0) {
          await client.from('customer_notes').upsert(notePayloads);
        }

        const customLabelProfiles = savedLabelProfiles.value.filter(p => !p.isBuiltIn);
        if (customLabelProfiles.length > 0) {
          await syncLabelProfilesToSupabase(JSON.stringify(customLabelProfiles));
        }

        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lastSyncedAt.value = nowTime;
        localStorage.setItem('live_pos_last_synced', nowTime);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = `Backed up ${profiles.value.length} stores, ${allMines.value.length} items & ${allPayments.value.length} payments`;
        playBeep('success', settings.value.soundEnabled);
        showToast('All business profiles & records backed up to Supabase Cloud!');
      } catch (err: any) {
        console.error('Supabase push error:', err);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = 'Push notice: ' + (err.message || 'Error pushing');
        showToast('Cloud sync notice: ' + (err.message || 'Check connection'));
      }
    }

    async function syncAllWithSupabase(showNotification = true) {
      const client = getSupabaseClient();
      if (!client) {
        supabaseStatus.value = 'disconnected';
        return;
      }
      if (!navigator.onLine) {
        supabaseStatus.value = 'disconnected';
        if (showNotification) showToast('Offline: will sync when internet restores');
        return;
      }

      supabaseStatus.value = 'syncing';
      supabaseSyncMessage.value = 'Syncing profiles & data with cloud...';

      try {
        // 1. Synchronize cloud deletion tombstones across devices (Profiles)
        const cloudDeleted = await fetchCloudDeletedProfiles();
        const localDeleted = safeParseJson(safeGetItem('live_pos_deleted_profile_ids'), []);
        const deletedIds = new Set<string>([...localDeleted, ...cloudDeleted]);
        safeSetItem('live_pos_deleted_profile_ids', Array.from(deletedIds));

        // 2. Synchronize cloud deletion tombstones across devices (Mined Items)
        const cloudDeletedMines = await fetchCloudDeletedMines();
        const localDeletedMines = safeParseJson(safeGetItem('live_pos_deleted_mine_ids'), []);
        const deletedMineIds = new Set<string>([...localDeletedMines, ...cloudDeletedMines]);
        safeSetItem('live_pos_deleted_mine_ids', Array.from(deletedMineIds));

        // Immediately purge any deleted mines from local state
        const remainingLocalMines = allMines.value.filter(m => !deletedMineIds.has(m.id));
        if (remainingLocalMines.length !== allMines.value.length) {
          allMines.value = remainingLocalMines;
          safeSetItem('live_pos_mines_' + activeProfileId.value, allMines.value);
        }

        // 3. Immediately purge any deleted profiles from local state
        const remainingLocal = profiles.value.filter(p => !deletedIds.has(p.id));
        if (remainingLocal.length !== profiles.value.length) {
          profiles.value = remainingLocal.length > 0 ? remainingLocal : [defaultProfiles[0]];
          safeSetItem('live_pos_profiles', profiles.value);
          if (deletedIds.has(activeProfileId.value)) {
            activeProfileId.value = profiles.value[0].id;
            safeSetItem('live_pos_active_profile_id', activeProfileId.value);
            loadProfileData(activeProfileId.value);
          }
        }

        const { data: remoteProfiles, error: profErr } = await client
          .from('business_profiles')
          .select('*')
          .order('created_at', { ascending: true });

        if (remoteProfiles && !profErr && remoteProfiles.length > 0) {
          // Immediately purge any remote profiles that match deleted tombstones
          for (const rp of remoteProfiles) {
            if (deletedIds.has(rp.id)) {
              deleteProfileFromSupabase(rp.id);
            }
          }

          const validRemote = remoteProfiles.filter((rp: any) => !deletedIds.has(rp.id));

          if (validRemote.length > 0) {
            const localMap = new Map(profiles.value.map(p => [p.id, p]));
            const merged: Profile[] = [];

            for (const rp of validRemote) {
              const local = localMap.get(rp.id);
              merged.push({
                id: rp.id,
                name: rp.name || (local ? local.name : 'Business'),
                category: rp.category || (local ? local.category : 'Retail'),
                currency: rp.currency || (local ? local.currency : '₱'),
                color: rp.color || (local ? local.color : 'emerald'),
                codePrefix: (local && local.codePrefix) ? local.codePrefix : '#',
                quickPrefixes: Array.isArray(rp.quick_prefixes) && rp.quick_prefixes.length > 0 
                  ? rp.quick_prefixes 
                  : (local?.quickPrefixes || ['A', 'B', 'C', 'D', 'VIP']),
                defaultCategories: Array.isArray(rp.default_categories) && rp.default_categories.length > 0 
                  ? rp.default_categories 
                  : (local?.defaultCategories || ['General']),
                paymentDetails: rp.payment_details !== undefined && rp.payment_details !== null 
                  ? rp.payment_details 
                  : (local?.paymentDetails || '')
              });
              localMap.delete(rp.id);
            }

            // Only push local profiles that were never deleted and are truly new custom profiles
            for (const [, localProf] of localMap.entries()) {
              if (!deletedIds.has(localProf.id)) {
                merged.push(localProf);
                await pushProfileToSupabase(localProf, sequenceCounter.value, sessionDate.value);
              }
            }

            if (merged.length > 0) {
              profiles.value = merged;
              safeSetItem('live_pos_profiles', profiles.value);
            }
          }
        }

        const { data: activeMeta } = await client
          .from('customer_notes')
          .select('notes')
          .eq('profile_id', '_meta_')
          .eq('buyer', '__last_active_profile__')
          .limit(1);

        if (activeMeta && activeMeta.length > 0 && activeMeta[0].notes) {
          const remoteActiveId = activeMeta[0].notes.trim();
          if (profiles.value.some(p => p.id === remoteActiveId)) {
            if (activeProfileId.value !== remoteActiveId) {
              activeProfileId.value = remoteActiveId;
              safeSetItem('live_pos_active_profile_id', remoteActiveId);
              loadProfileData(remoteActiveId);
            }
          }
        }

        const { data: storeMeta } = await client
          .from('customer_notes')
          .select('notes')
          .eq('profile_id', activeProfileId.value)
          .eq('buyer', '__store_meta__')
          .limit(1);

        if (storeMeta && storeMeta.length > 0 && storeMeta[0].notes) {
          try {
            const parsedMeta = JSON.parse(storeMeta[0].notes);
            if (parsedMeta.codePrefix) {
              const targetProf = profiles.value.find(p => p.id === activeProfileId.value);
              if (targetProf) {
                targetProf.codePrefix = parsedMeta.codePrefix;
                safeSetItem('live_pos_profiles', profiles.value);
              }
            }
            if (parsedMeta.sequence && !safeGetItem('live_pos_sequence_counter_' + activeProfileId.value)) {
              sequenceCounter.value = Number(parsedMeta.sequence) || 1;
            }
            if (parsedMeta.sessionDate && !safeGetItem('live_pos_session_date_' + activeProfileId.value)) {
              sessionDate.value = parsedMeta.sessionDate;
            }
          } catch (e) {}
        }

        syncActiveStoreForm();

        const { data: remoteMines, error: mErr } = await client
          .from('mined_items')
          .select('*')
          .eq('profile_id', activeProfileId.value);

        // Fetch cloud-persisted photos from customer_notes for this profile
        const cloudPhotos = await fetchCloudPhotosForProfile(activeProfileId.value);

        if (remoteMines && !mErr) {
          // Immediately purge remote items matching deleted tombstones
          for (const rm of remoteMines) {
            if (deletedMineIds.has(rm.id)) {
              deleteSingleMineFromSupabase(rm.id);
            }
          }

          const validRemote = remoteMines.filter((rm: any) => !deletedMineIds.has(rm.id));
          const localMap = new Map(allMines.value.map(m => [m.id, m]));
          const mergedMines: MinedItem[] = [];

          for (const rm of validRemote) {
            const local = localMap.get(rm.id);
            const remoteTag = rm.tag || '';
            const remoteIsDescription = remoteTag && remoteTag !== rm.control_code && remoteTag !== 'Decor';
            const cleanRemoteDesc = remoteIsDescription ? remoteTag : '';

            const cloudPhoto = cloudPhotos[rm.id] || '';
            const localPhoto = local ? (local.photo || '') : '';

            // Synchronize photo across devices:
            // Prefer CDN URL or available photo from cloud if local is empty;
            // keep local photo if present.
            let resolvedPhoto = localPhoto;
            if (cloudPhoto) {
              if (!localPhoto || cloudPhoto.startsWith('http')) {
                resolvedPhoto = cloudPhoto;
              }
            } else if (!resolvedPhoto) {
              resolvedPhoto = cloudPhoto;
            }

            // Auto-heal / cross-upload: If this device has a photo locally that hasn't made it to cloud yet,
            // push it to Supabase customer_notes immediately so all other connected devices receive it!
            if (localPhoto && !cloudPhoto) {
              pushSinglePhotoToSupabase(rm.id, localPhoto, activeProfileId.value);
            }

            if (local) {
              const localCleanDesc = (local.description && local.description !== 'Decor') ? local.description : cleanRemoteDesc;
              mergedMines.push({
                ...local,
                controlCode: rm.control_code || local.controlCode,
                tag: rm.tag || local.tag,
                description: localCleanDesc,
                price: Number(rm.price) || local.price,
                buyer: rm.buyer || local.buyer,
                photo: resolvedPhoto,
                date: rm.session_date || local.date || sessionDate.value
              });
              localMap.delete(rm.id);
            } else {
              mergedMines.push({
                id: rm.id,
                controlCode: rm.control_code || '',
                controlNum: 0,
                tag: rm.tag || '',
                description: cleanRemoteDesc,
                price: Number(rm.price) || 0,
                buyer: rm.buyer || '',
                photo: resolvedPhoto,
                date: rm.session_date || sessionDate.value,
                time: '',
                timestamp: Number(rm.timestamp) || Date.now()
              });
            }
          }

          // Retain recent offline items created on this device within the last 5 minutes
          const nowTs = Date.now();
          for (const [, localMine] of localMap.entries()) {
            if (!deletedMineIds.has(localMine.id)) {
              const isRecentOffline = (nowTs - (localMine.timestamp || 0)) < 300000;
              if (isRecentOffline) {
                mergedMines.push(localMine);
                pushSingleMineToSupabase(localMine, activeProfileId.value, sessionDate.value);
              }
            }
          }

          allMines.value = mergedMines.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          saveProfileData(activeProfileId.value);
          saveAll();
        }

        const { data: remotePayments, error: pErr } = await client
          .from('customer_payments')
          .select('*')
          .eq('profile_id', activeProfileId.value);

        if (remotePayments && !pErr) {
          const payMap = new Map(allPayments.value.map(p => [p.id, p]));
          for (const rp of remotePayments) {
            if (!payMap.has(rp.id)) {
              payMap.set(rp.id, {
                id: rp.id,
                buyer: rp.buyer,
                amount: Number(rp.amount) || 0,
                method: rp.method || 'GCash',
                ref: rp.reference || '',
                date: '',
                time: '',
                timestamp: Number(rp.timestamp) || Date.now()
              });
            }
          }
          allPayments.value = Array.from(payMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }

        const { data: remoteNotes, error: nErr } = await client
          .from('customer_notes')
          .select('*')
          .eq('profile_id', activeProfileId.value);

        if (remoteNotes && !nErr) {
          for (const rn of remoteNotes) {
            if (rn.buyer === '__r2_config__') {
              try {
                const parsedR2 = JSON.parse(rn.notes || '{}');
                if (parsedR2.accountId && !r2Form.accountId) {
                  r2Form.accountId = parsedR2.accountId || '';
                  r2Form.accessKeyId = parsedR2.accessKeyId || '';
                  r2Form.secretAccessKey = parsedR2.secretAccessKey || '';
                  r2Form.bucketName = parsedR2.bucketName || '';
                  r2Form.publicDomain = parsedR2.publicDomain || '';
                  setStoredR2Config(r2Form);
                }
              } catch (e) {
                console.warn('Could not parse remote R2 config sync:', e);
              }
            } else if (rn.buyer && !rn.buyer.startsWith('__')) {
              if (!customerNotes.value[rn.buyer]) {
                customerNotes.value[rn.buyer] = rn.notes || '';
              }
            }
          }
        }

        saveProfileData(activeProfileId.value);

        // Sync app settings (including photo retention & auto-cleanup) across devices
        try {
          const cloudSettingsJson = await fetchAppSettingsFromSupabase();
          if (cloudSettingsJson) {
            const parsed = JSON.parse(cloudSettingsJson);
            if (parsed && typeof parsed === 'object') {
              let changed = false;
              if (parsed.photoRetention && parsed.photoRetention !== settings.value.photoRetention) {
                settings.value.photoRetention = parsed.photoRetention;
                changed = true;
              }
              if (parsed.autoCleanOldPhotos !== undefined && parsed.autoCleanOldPhotos !== settings.value.autoCleanOldPhotos) {
                settings.value.autoCleanOldPhotos = parsed.autoCleanOldPhotos;
                changed = true;
              }
              if (parsed.printerPaperWidth && parsed.printerPaperWidth !== settings.value.printerPaperWidth) {
                settings.value.printerPaperWidth = parsed.printerPaperWidth;
                changed = true;
              }
              if (parsed.escPosDirectPrint !== undefined && parsed.escPosDirectPrint !== settings.value.escPosDirectPrint) {
                settings.value.escPosDirectPrint = parsed.escPosDirectPrint;
                changed = true;
              }
              if (parsed.autoPrint !== undefined && parsed.autoPrint !== settings.value.autoPrint) {
                settings.value.autoPrint = parsed.autoPrint;
                changed = true;
              }
              if (parsed.soundEnabled !== undefined && parsed.soundEnabled !== settings.value.soundEnabled) {
                settings.value.soundEnabled = parsed.soundEnabled;
                changed = true;
              }
              if (parsed.miningFieldsOrder && Array.isArray(parsed.miningFieldsOrder)) {
                settings.value.miningFieldsOrder = parsed.miningFieldsOrder;
                changed = true;
              }
              if (parsed.labelLayout && typeof parsed.labelLayout === 'object') {
                settings.value.labelLayout = { ...defaultLabelLayout, ...parsed.labelLayout };
                changed = true;
              }
              if (parsed.receiptLayout && typeof parsed.receiptLayout === 'object') {
                settings.value.receiptLayout = { ...defaultReceiptLayout, ...parsed.receiptLayout };
                changed = true;
              }
              if (parsed.labelPrinterName && parsed.labelPrinterName !== settings.value.labelPrinterName) {
                settings.value.labelPrinterName = parsed.labelPrinterName;
                changed = true;
              }
              if (parsed.receiptPrinterName && parsed.receiptPrinterName !== settings.value.receiptPrinterName) {
                settings.value.receiptPrinterName = parsed.receiptPrinterName;
                changed = true;
              }
              if (parsed.activePrinterType && parsed.activePrinterType !== settings.value.activePrinterType) {
                settings.value.activePrinterType = parsed.activePrinterType;
                changed = true;
              }
              if (parsed.activeLabelProfileId && parsed.activeLabelProfileId !== settings.value.activeLabelProfileId) {
                settings.value.activeLabelProfileId = parsed.activeLabelProfileId;
                activeLabelProfileId.value = parsed.activeLabelProfileId;
                localStorage.setItem('pos_active_label_profile_id', parsed.activeLabelProfileId);
                changed = true;
              }
              if (parsed.securityPin && parsed.securityPin.trim() !== '' && parsed.securityPin !== settings.value.securityPin) {
                const cloudPin = parsed.securityPin.trim();
                settings.value.securityPin = cloudPin;
                adminPin.value = cloudPin;
                localStorage.setItem('live_pos_admin_pin', cloudPin);
                changed = true;
              }
              if (changed) {
                safeSetItem('live_pos_settings', settings.value);
              }
            }
          }
        } catch (settingsSyncErr) {
          console.warn('App settings sync notice:', settingsSyncErr);
        }

        // Dedicated cross-device security PIN sync from Supabase
        try {
          const directCloudPin = await fetchSecurityPinFromSupabase();
          if (directCloudPin && directCloudPin.trim() !== '') {
            const cleanPin = directCloudPin.trim();
            if (cleanPin !== adminPin.value || cleanPin !== settings.value.securityPin) {
              adminPin.value = cleanPin;
              settings.value.securityPin = cleanPin;
              localStorage.setItem('live_pos_admin_pin', cleanPin);
              safeSetItem('live_pos_settings', settings.value);
            }
          }
        } catch (pinSyncErr) {
          console.warn('Dedicated security PIN cloud sync notice:', pinSyncErr);
        }

        // Sync saved custom label profiles from database
        try {
          const cloudLabelProfilesJson = await fetchLabelProfilesFromSupabase();
          if (cloudLabelProfilesJson) {
            const parsed = JSON.parse(cloudLabelProfilesJson);
            mergeCloudLabelProfiles(parsed);
          }
        } catch (labelSyncErr) {
          console.warn('Label profiles cloud sync notice:', labelSyncErr);
        }

        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lastSyncedAt.value = nowTime;
        localStorage.setItem('live_pos_last_synced', nowTime);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = `${profiles.value.length} profiles, ${allMines.value.length} items (${totalPhotosCount.value} photos) & ${allPayments.value.length} payments in sync`;

        if (showNotification) {
          playBeep('success', settings.value.soundEnabled);
          showToast(`Supabase synced: ${profiles.value.length} profiles, ${allMines.value.length} items (${totalPhotosCount.value} photos), ${allPayments.value.length} payments`);
        }
      } catch (err) {
        console.error('Supabase sync error:', err);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = 'Sync active (auto-retrying)';
        if (showNotification) showToast('Sync notice: check connection');
      }
    }

    // Cloudflare R2 Direct Photo Storage State & Methods
    const initialR2Config = getStoredR2Config();
    const r2Form = reactive<R2Config>({
      accountId: initialR2Config.accountId || '',
      accessKeyId: initialR2Config.accessKeyId || '',
      secretAccessKey: initialR2Config.secretAccessKey || '',
      bucketName: initialR2Config.bucketName || '',
      publicDomain: initialR2Config.publicDomain || ''
    });
    const r2Status = ref<'idle' | 'connected' | 'uploading' | 'error'>('idle');
    const r2StatusMessage = ref('');
    const r2GuideModalOpen = ref(false);
    const r2Testing = ref(false);
    const serverR2Configured = ref(false);
    const serverR2Bucket = ref('');
    const serverR2PublicDomain = ref('');

    const isR2Ready = computed(() => isR2Configured(r2Form) || serverR2Configured.value);

    const currentAppOrigin = computed(() => {
      try {
        return window.location.origin;
      } catch {
        return 'https://...';
      }
    });

    const totalPhotosCount = computed(() => {
      return allMines.value.filter(m => m.photo && m.photo.trim() !== '').length;
    });

    const legacyBase64PhotosCount = computed(() => {
      return allMines.value.filter(m => m.photo && m.photo.trim().startsWith('data:image')).length;
    });

    async function saveR2Settings() {
      setStoredR2Config(r2Form);
      await syncR2ConfigToSupabase(JSON.stringify(r2Form));
      showToast('Cloudflare R2 configuration saved & synced to all devices! ☁️');
      playBeep('success', settings.value.soundEnabled);
    }

    async function testR2Connection() {
      if (!isR2Ready.value) {
        showToast('Please configure R2 in .env or fill in Account ID, Access Key ID, Secret Key, and Bucket Name');
        return;
      }
      r2Testing.value = true;
      r2Status.value = 'uploading';
      r2StatusMessage.value = 'Testing connection to Cloudflare R2 bucket...';

      try {
        // Create a 1x1 transparent PNG data URL to test upload
        const testDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const testKey = `_test/connection_test_${Date.now()}.png`;

        const res = await uploadToCloudflareR2(testKey, testDataUrl, r2Form);
        if (res.success && res.url) {
          r2Status.value = 'connected';
          r2StatusMessage.value = `✓ Connected successfully to R2! Uploaded & verified: ${res.url.substring(0, 45)}...`;
          showToast('Cloudflare R2 connection successful! ⚡');
          playBeep('success', settings.value.soundEnabled);
          if (isR2Configured(r2Form)) {
            saveR2Settings();
          }
        } else {
          r2Status.value = 'error';
          r2StatusMessage.value = 'Connection failed: ' + (res.error || 'Check CORS or credentials');
          showToast('R2 connection error: ' + (res.error || 'Check CORS and credentials'));
        }
      } catch (err: any) {
        r2Status.value = 'error';
        r2StatusMessage.value = 'Connection test failed: ' + (err.message || 'Unknown error');
        showToast('R2 test error: ' + (err.message || 'Failed'));
      } finally {
        r2Testing.value = false;
      }
    }

    async function migrateLegacyPhotosToR2() {
      if (!isR2Ready.value) {
        showToast('Please configure Cloudflare R2 in .env or Settings first');
        return;
      }
      const legacyItems = allMines.value.filter(m => m.photo && m.photo.trim().startsWith('data:image'));
      if (legacyItems.length === 0) {
        showToast('No legacy base64 photos to migrate');
        return;
      }

      r2Status.value = 'uploading';
      r2StatusMessage.value = `Migrating ${legacyItems.length} photos to Cloudflare R2...`;

      let migratedCount = 0;
      for (const item of legacyItems) {
        try {
          const cleanSession = (sessionDate.value || 'live').replace(/[^a-zA-Z0-9_-]/g, '');
          const cleanStore = (activeProfile.value.id || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
          const fileKey = `${cleanStore}/${cleanSession}/item_${item.id}.jpg`;

          const res = await uploadToCloudflareR2(fileKey, item.photo!, r2Form);
          if (res.success && res.url) {
            item.photo = res.url;
            migratedCount++;
            r2StatusMessage.value = `Migrated ${migratedCount}/${legacyItems.length} photos to Cloudflare R2...`;
          }
        } catch (e) {
          console.warn('Migration error for item', item.id, e);
        }
      }

      saveProfileData(activeProfileId.value);
      r2Status.value = 'connected';
      r2StatusMessage.value = `✓ Successfully migrated ${migratedCount} photos to Cloudflare R2!`;
      showToast(`Migrated ${migratedCount} photos directly to Cloudflare R2!`);
      playBeep('success', settings.value.soundEnabled);
      syncAllWithSupabase(false);
    }

    let isAutoMigrating = false;
    async function autoMigrateBase64Photos() {
      if (isAutoMigrating || !isR2Ready.value) return;
      const legacyItems = allMines.value.filter(m => m.photo && m.photo.trim().startsWith('data:image'));
      if (legacyItems.length === 0) return;

      isAutoMigrating = true;
      for (const item of legacyItems) {
        try {
          const cleanSession = (sessionDate.value || 'live').replace(/[^a-zA-Z0-9_-]/g, '');
          const cleanStore = (activeProfile.value.id || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
          const fileKey = `${cleanStore}/${cleanSession}/item_${item.id}.jpg`;
          const res = await uploadToCloudflareR2(fileKey, item.photo!, r2Form);
          if (res.success && res.url) {
            item.photo = res.url;
            saveAll();
            pushSingleMineToSupabase(item, activeProfileId.value, sessionDate.value);
          }
        } catch (e) {
          console.warn('Auto-migration background error for item', item.id, e);
        }
      }
      isAutoMigrating = false;
    }

    // PHOTO RETENTION & EXPIRATION CLEANUP LOGIC
    const photoRetentionDays = computed(() => {
      const mode = settings.value.photoRetention || '6_months';
      if (mode === '1_month') return 30;
      if (mode === '3_months') return 90;
      if (mode === '6_months') return 180;
      if (mode === '1_year') return 365;
      return 0; // 'never'
    });

    const oldPhotosList = computed(() => {
      const days = photoRetentionDays.value;
      if (days <= 0) return [];
      const cutoffMs = Date.now() - (days * 24 * 60 * 60 * 1000);
      return allMines.value.filter(m => {
        if (!m.photo || m.photo.trim() === '') return false;
        const ts = m.timestamp || 0;
        return ts > 0 && ts < cutoffMs;
      });
    });

    const oldPhotosCount = computed(() => oldPhotosList.value.length);

    async function cleanupOldPhotos(promptConfirm = true) {
      const targets = oldPhotosList.value;
      if (targets.length === 0) {
        if (promptConfirm) {
          showToast('No photos older than the selected retention period found');
        }
        return;
      }

      const retentionLabel = settings.value.photoRetention === '1_month' ? '1 month (30 days)'
        : settings.value.photoRetention === '3_months' ? '3 months (90 days)'
        : settings.value.photoRetention === '6_months' ? '6 months (180 days)'
        : settings.value.photoRetention === '1_year' ? '1 year (365 days)' : 'retention period';

      if (promptConfirm) {
        if (!confirm(`Clean up and remove ${targets.length} photo(s) older than ${retentionLabel}? Item records, tags, prices, and buyer balances will remain 100% safe.`)) {
          return;
        }
      }

      let cleaned = 0;
      for (const item of targets) {
        item.photo = '';
        cleaned++;
        pushSingleMineToSupabase(item, activeProfileId.value, sessionDate.value);
      }

      saveProfileData(activeProfileId.value);
      saveAll();
      showToast(`Cleaned up ${cleaned} photo(s) older than ${retentionLabel}`);
      playBeep('undo', settings.value.soundEnabled);
    }

    function toggleSound() {
      settings.value.soundEnabled = !settings.value.soundEnabled;
      saveSettings();
      if (settings.value.soundEnabled) {
        playBeep('success', true);
        showToast('Audio feedback enabled');
      } else {
        showToast('Audio feedback muted');
      }
    }

    const nextControlCode = computed(() => {
      const p = activeProfile.value;
      const prefix = getStorePrefix(p);
      const dateStr = sessionDate.value || defaultSessionDate;
      const uniqueSeq = getNextUniqueSequenceNumber(sequenceCounter.value, allMines.value, prefix, dateStr);
      return formatControlCode(prefix, dateStr, uniqueSeq);
    });

    const recentMines = computed(() => {
      return [...allMines.value].reverse();
    });

    const existingBuyers = computed(() => {
      const buyersMap: Record<string, { handle: string; itemCount: number; totalSpent: number }> = {};
      for (const m of allMines.value) {
        if (!buyersMap[m.buyer]) {
          buyersMap[m.buyer] = { handle: m.buyer, itemCount: 0, totalSpent: 0 };
        }
        buyersMap[m.buyer].itemCount += 1;
        buyersMap[m.buyer].totalSpent += m.price;
      }
      return Object.values(buyersMap);
    });

    const filteredBuyerSuggestions = computed(() => {
      const raw = form.buyer.trim().toLowerCase().replace(/^@+/, '');
      if (!raw) return existingBuyers.value.slice(0, 6);
      return existingBuyers.value
        .filter(b => b.handle.toLowerCase().replace(/^@+/, '').includes(raw))
        .slice(0, 6);
    });

    const frequentBuyers = computed(() => {
      return [...existingBuyers.value]
        .sort((a, b) => b.itemCount - a.itemCount)
        .map(b => b.handle)
        .slice(0, 6);
    });

    function handleBuyerInput() {
      if (form.buyer && form.buyer.includes('@')) {
        form.buyer = form.buyer.replace(/^@+/, '');
      }
      buyerSuggestionsOpen.value = true;
    }

    function selectBuyer(handle: string) {
      form.buyer = (handle || '').replace(/^@+/, '');
      buyerSuggestionsOpen.value = false;
      handleFieldEnter('customer');
    }

    function quickPrefix(prefix: string) {
      if (!form.tag) {
        form.tag = `${prefix}01`;
      } else {
        const numPart = form.tag.replace(/^[A-Za-z]+/, '') || '01';
        form.tag = `${prefix}${numPart}`;
      }
      focusPriceInput();
    }

    function incrementTagNumber() {
      if (!form.tag) {
        form.tag = 'A01';
        return;
      }
      const match = form.tag.match(/^([A-Za-z]+)(\d+)$/);
      if (match) {
        const letters = match[1];
        const nextNum = String(parseInt(match[2], 10) + 1).padStart(match[2].length, '0');
        form.tag = `${letters}${nextNum}`;
      } else {
        form.tag = `${form.tag}-1`;
      }
    }

    function focusDescriptionInput() {
      focusInput(descriptionInputRef);
    }
    function focusPriceInput() {
      focusInput(priceInputRef);
    }
    function focusBuyerInput() {
      focusInput(buyerInputRef);
    }

    function focusFirstMiningField() {
      const order = settings.value.miningFieldsOrder || ['customer', 'description', 'price'];
      const firstKey = order[0];
      if (firstKey === 'customer') {
        focusBuyerInput();
      } else if (firstKey === 'description') {
        focusDescriptionInput();
      } else if (firstKey === 'price') {
        focusPriceInput();
      } else {
        focusBuyerInput();
      }
    }

    function handleFieldEnter(currentFieldKey: string) {
      const order = settings.value.miningFieldsOrder || ['customer', 'description', 'price'];
      const currentIndex = order.indexOf(currentFieldKey);
      if (currentIndex !== -1 && currentIndex < order.length - 1) {
        const nextKey = order[currentIndex + 1];
        if (nextKey === 'customer') {
          focusBuyerInput();
        } else if (nextKey === 'description') {
          focusDescriptionInput();
        } else if (nextKey === 'price') {
          focusPriceInput();
        }
      } else {
        // Last field in sequence: Never auto-submit or print.
        // Dismiss keyboard or clear focus so user can review details and explicitly click "LOG MINE"
        if (currentFieldKey === 'price' && priceInputRef.value && typeof priceInputRef.value.blur === 'function') {
          priceInputRef.value.blur();
        } else if (currentFieldKey === 'description' && descriptionInputRef.value && typeof descriptionInputRef.value.blur === 'function') {
          descriptionInputRef.value.blur();
        } else if (currentFieldKey === 'customer' && buyerInputRef.value && typeof buyerInputRef.value.blur === 'function') {
          buyerInputRef.value.blur();
        }
      }
    }

    function getMiningFieldLabel(key: string) {
      switch (key) {
        case 'customer': return 'Customer Name';
        case 'description': return 'Item Name / Description';
        case 'price': return `Amount / Price (${activeProfile.value.currency})`;
        default: return key;
      }
    }

    function moveMiningField(index: number, direction: number) {
      const arr = [...(settings.value.miningFieldsOrder || ['customer', 'description', 'price'])];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= arr.length) return;
      const temp = arr[index];
      arr[index] = arr[targetIndex];
      arr[targetIndex] = temp;
      settings.value.miningFieldsOrder = arr;
      saveSettings();
      showToast(`Moved ${getMiningFieldLabel(arr[targetIndex])}`);
    }

    function resetMiningFieldOrder() {
      settings.value.miningFieldsOrder = ['customer', 'description', 'price'];
      saveSettings();
      showToast('Field order reset to default');
    }

    // Print Targets
    const activeStickerToPrint = ref<MinedItem | null>(null);
    const activePackingSlipToPrint = ref<BuyerBasket | null>(null);
    const activeInvoiceToPrint = ref<BuyerBasket | null>(null);

    // Bluetooth Connection Handlers
    async function connectBluetooth() {
      if (!isWebBluetoothSupported()) {
        showToast('Web Bluetooth is not supported on this browser. Use Chrome on Android.');
        return;
      }
      btPrinterConnecting.value = true;
      try {
        const res = await connectBluetoothPrinter(() => {
          btPrinterConnected.value = false;
          btPrinterName.value = '';
          showToast('Bluetooth printer disconnected');
        });
        if (res.success) {
          btPrinterConnected.value = true;
          btPrinterName.value = res.deviceName;
          showToast(`Connected to ${res.deviceName}! Direct ESC/POS printing active.`);
        } else if (res.error) {
          showToast(`Bluetooth: ${res.error}`);
        }
      } catch (err: any) {
        showToast(`Bluetooth error: ${err.message || err}`);
      } finally {
        btPrinterConnecting.value = false;
      }
    }

    function disconnectBluetooth() {
      disconnectBluetoothPrinter();
      btPrinterConnected.value = false;
      btPrinterName.value = '';
      showToast('Bluetooth printer disconnected');
    }

    // Layout & Printer Designer Modal State
    const printerLayoutModalOpen = ref(false);
    const activeLayoutTab = ref<'label' | 'receipt' | 'printers'>('label');

    function openPrinterLayoutModal(tab: 'label' | 'receipt' | 'printers' = 'label') {
      activeLayoutTab.value = tab;
      printerLayoutModalOpen.value = true;
      appMenuOpen.value = false;
    }

    function closePrinterLayoutModal() {
      printerLayoutModalOpen.value = false;
    }

    // Dynamic Live Preview Sample Data
    const samplePreviewItem = computed(() => {
      if (allMines.value.length > 0) {
        return allMines.value[allMines.value.length - 1];
      }
      const prefix = getStorePrefix(activeProfile.value) || 'L';
      const sDate = sessionDate.value || '0911';
      return {
        id: 'preview_sample_1',
        controlCode: `${prefix}${sDate}-002`,
        controlNum: 2,
        tag: 'Pumice',
        description: '',
        price: 500,
        buyer: 'Screamcheese',
        date: 'Today',
        time: '13:02',
        timestamp: Date.now()
      };
    });

    const samplePreviewQrDataUrl = ref('');
    async function updateSamplePreviewQr() {
      try {
        const item = samplePreviewItem.value;
        const text = item.controlCode || (item.controlNum ? `#${item.controlNum}` : '001');
        samplePreviewQrDataUrl.value = await QRCode.toDataURL(text, {
          width: 140,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
      } catch (err) {
        console.warn('QR preview generation error:', err);
      }
    }

    function applyReferenceLabelPreset() {
      if (!settings.value.labelLayout) {
        settings.value.labelLayout = { ...defaultLabelLayout };
      }
      settings.value.labelLayout.showControlCode = true;
      settings.value.labelLayout.codeSize = 'xl';
      settings.value.labelLayout.showTime = true;
      settings.value.labelLayout.showBuyer = true;
      settings.value.labelLayout.buyerSize = 'lg';
      settings.value.labelLayout.showTag = true;
      settings.value.labelLayout.showDescription = false;
      settings.value.labelLayout.showPrice = true;
      settings.value.labelLayout.priceSize = 'lg';
      settings.value.labelLayout.showQrCode = true;
      settings.value.labelLayout.qrPosition = 'right';
      settings.value.labelLayout.qrSize = 'md';
      settings.value.labelLayout.showStoreName = false;
      settings.value.labelLayout.showSessionDate = false;
      settings.value.labelLayout.showBarcode = false;
      settings.value.labelLayout.footerText = '';
      settings.value.labelLayout.renderMode = 'canvas_bitmap';
      saveSettings(false);
      updateSamplePreviewQr();
      showToast('Applied 30x20mm QR Side-by-Side Reference Layout!');
    }

    watch(() => [samplePreviewItem.value.controlCode, settings.value.labelLayout?.qrSize, settings.value.labelLayout?.showQrCode], () => {
      updateSamplePreviewQr();
    }, { immediate: true });

    const samplePreviewBasket = computed(() => {
      if (buyerBasketsList.value.length > 0) {
        return buyerBasketsList.value[0];
      }
      const prefix = getStorePrefix(activeProfile.value);
      return {
        handle: 'sarah_styles',
        displayName: 'sarah_styles',
        dateIssued: 'Today',
        paymentDate: '',
        items: [
          { id: 'p1', controlCode: `${prefix}${sessionDate.value}-001`, controlNum: 1, tag: 'Denim Jacket', description: 'Size M', price: 350, buyer: 'sarah_styles', date: 'Today', time: '14:30', timestamp: Date.now() },
          { id: 'p2', controlCode: `${prefix}${sessionDate.value}-002`, controlNum: 2, tag: 'Cropped Top', description: 'White Ribbed', price: 180, buyer: 'sarah_styles', date: 'Today', time: '14:35', timestamp: Date.now() }
        ],
        totalAmount: 530,
        totalPaid: 200,
        balance: 330,
        status: 'Partial' as const,
        payments: []
      };
    });

    async function testBluetoothPrint() {
      if (!btPrinterConnected.value) {
        showToast('Please connect your PT-210 Bluetooth printer first');
        return;
      }
      try {
        const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
        await printDirectTest(activeProfile.value.name || settings.value.storeName, cols);
        showToast('PT-210 test receipt printed!');
      } catch (e: any) {
        showToast(`Print error: ${e.message || e}`);
      }
    }

    async function testLabelPrint() {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) {
          showToast('Please connect PT-265 via Bluetooth first');
          return;
        }
      }
      try {
        const item = samplePreviewItem.value;
        const is30x20 = settings.value.labelLayout?.labelSize === '30x20mm';
        const cols = is30x20 ? 16 : (settings.value.printerPaperWidth === '80mm' ? 48 : 32);
        await printDirectSticker(item, activeProfile.value, sessionDate.value, cols, settings.value.labelLayout);
        showToast(`Label test sent to ${btPrinterName.value || 'PT-265'}`);
      } catch (e: any) {
        showToast(`Label print error: ${e.message || e}`);
      }
    }

    async function calibratePt265Gap() {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) {
          showToast('Please connect PT-265 via Bluetooth first');
          return;
        }
      }
      try {
        const protocol = (settings.value.labelLayout?.renderMode === 'tspl_hardware' || settings.value.labelLayout?.protocol === 'tspl') ? 'tspl' : 'escpos';
        await feedToNextLabelGap(protocol, settings.value.labelLayout);
        showToast('PT-265: Fed precisely to sticker cutoff gap!');
      } catch (e: any) {
        showToast(`Gap feed error: ${e.message || e}`);
      }
    }

    async function testReceiptPrint() {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) {
          showToast('Please connect PT-210 via Bluetooth first');
          return;
        }
      }
      try {
        const basket = samplePreviewBasket.value;
        const cols = settings.value.receiptLayout?.paperWidth === '80mm' ? 48 : 32;
        await printDirectPackingSlip(basket, activeProfile.value, sessionDate.value, cols, settings.value.receiptLayout);
        showToast(`Receipt test sent to ${btPrinterName.value || 'PT-210'}`);
      } catch (e: any) {
        showToast(`Receipt print error: ${e.message || e}`);
      }
    }

    function resetLabelLayout() {
      settings.value.labelLayout = { ...defaultLabelLayout };
      saveSettings(true);
      showToast('Sticker layout reset to PT-265 (30x20mm) default');
    }

    function resetReceiptLayout() {
      settings.value.receiptLayout = { ...defaultReceiptLayout };
      saveSettings(true);
      showToast('Receipt layout reset to PT-210 (58mm) default');
    }

    // =========================================================================
    // INTERACTIVE VISUAL DESIGNER STATE & HANDLERS (PT-265 & PT-210)
    // =========================================================================
    const designerMode = ref<'label' | 'receipt'>('label');
    const designerSelectedId = ref<string>('controlCode');
    const designerCanvasZoom = ref<number>(200); // 100, 150, 200, 250, 300%
    const designerShowGrid = ref<boolean>(true);
    const designerSnapGrid = ref<boolean>(true);
    const designerShowSampleData = ref<boolean>(true);
    const designerIsDragging = ref<boolean>(false);
    const designerDragStart = ref<{ startX: number; startY: number; origX: number; origY: number; zoom: number }>({
      startX: 0,
      startY: 0,
      origX: 0,
      origY: 0,
      zoom: 2
    });

    const designerCanvasWidth = computed(() => {
      const is30x20 = (settings.value.labelLayout?.labelSize || '30x20mm') === '30x20mm';
      return is30x20 ? 240 : 320;
    });
    const designerCanvasHeight = computed(() => {
      const is30x20 = (settings.value.labelLayout?.labelSize || '30x20mm') === '30x20mm';
      return is30x20 ? 160 : 240;
    });

    const labelElementsList = computed(() => {
      if (!settings.value.labelLayout) {
        settings.value.labelLayout = { ...defaultLabelLayout };
      }
      if (!settings.value.labelLayout.customElements || settings.value.labelLayout.customElements.length === 0) {
        settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(defaultLabelElements));
      }
      return settings.value.labelLayout.customElements;
    });

    const selectedLabelElement = computed(() => {
      return labelElementsList.value.find(e => e.id === designerSelectedId.value) || null;
    });

    const receiptSectionsList = computed(() => {
      if (!settings.value.receiptLayout) {
        settings.value.receiptLayout = { ...defaultReceiptLayout };
      }
      if (!settings.value.receiptLayout.customSections || settings.value.receiptLayout.customSections.length === 0) {
        settings.value.receiptLayout.customSections = JSON.parse(JSON.stringify(defaultReceiptSections));
      }
      return settings.value.receiptLayout.customSections;
    });

    const selectedReceiptSection = computed(() => {
      return receiptSectionsList.value.find(s => s.id === designerSelectedId.value) || null;
    });

    function selectDesignerElement(id: string) {
      designerSelectedId.value = id;
    }

    const savedLabelProfiles = ref<SavedLabelProfile[]>([]);
    const activeLabelProfileId = ref<string>(
      initialSettings.activeLabelProfileId || 
      (safeGetItem('pos_active_label_profile_id') as string) || 
      'reference_qr'
    );
    const showSaveProfileModal = ref<boolean>(false);
    const newProfileName = ref<string>('');
    const showPasteCoordinatesModal = ref<boolean>(false);
    const pasteCoordinatesText = ref<string>('');

    function getBuiltInLabelProfiles(): SavedLabelProfile[] {
      const qrRefElements: VisualLabelElement[] = JSON.parse(JSON.stringify(defaultLabelElements));

      const barCenterElements: VisualLabelElement[] = JSON.parse(JSON.stringify(defaultLabelElements));
      const qrB = barCenterElements.find(e => e.id === 'qrCode'); if (qrB) qrB.visible = false;
      const barB = barCenterElements.find(e => e.id === 'barcode'); if (barB) { barB.visible = true; barB.x = 16; barB.y = 36; barB.width = 208; barB.height = 36; }
      const codeB = barCenterElements.find(e => e.id === 'controlCode'); if (codeB) { codeB.x = 120; codeB.y = 10; codeB.align = 'center'; }
      const buyerB = barCenterElements.find(e => e.id === 'buyer'); if (buyerB) { buyerB.x = 10; buyerB.y = 86; }
      const tagB = barCenterElements.find(e => e.id === 'tag'); if (tagB) { tagB.x = 10; tagB.y = 110; }
      const priceB = barCenterElements.find(e => e.id === 'price'); if (priceB) { priceB.x = 10; priceB.y = 132; priceB.fontSize = 18; }
      const timeB = barCenterElements.find(e => e.id === 'time'); if (timeB) { timeB.x = 232; timeB.y = 10; timeB.align = 'right'; }

      const minimalElements: VisualLabelElement[] = JSON.parse(JSON.stringify(defaultLabelElements));
      const qrM = minimalElements.find(e => e.id === 'qrCode'); if (qrM) qrM.visible = false;
      const barM = minimalElements.find(e => e.id === 'barcode'); if (barM) barM.visible = false;
      const codeM = minimalElements.find(e => e.id === 'controlCode'); if (codeM) { codeM.x = 10; codeM.y = 10; codeM.fontSize = 18; }
      const timeM = minimalElements.find(e => e.id === 'time'); if (timeM) { timeM.x = 232; timeM.y = 10; timeM.align = 'right'; }
      const buyerM = minimalElements.find(e => e.id === 'buyer'); if (buyerM) { buyerM.x = 10; buyerM.y = 44; buyerM.fontSize = 22; buyerM.fontWeight = 'black'; }
      const tagM = minimalElements.find(e => e.id === 'tag'); if (tagM) { tagM.x = 10; tagM.y = 82; tagM.fontSize = 16; }
      const priceM = minimalElements.find(e => e.id === 'price'); if (priceM) { priceM.x = 10; priceM.y = 116; priceM.fontSize = 24; priceM.fontWeight = 'black'; }

      const verticalElements: VisualLabelElement[] = JSON.parse(JSON.stringify(defaultLabelElements));
      const codeV = verticalElements.find(e => e.id === 'controlCode'); if (codeV) { codeV.x = 120; codeV.y = 6; codeV.align = 'center'; }
      const timeV = verticalElements.find(e => e.id === 'time'); if (timeV) { timeV.visible = false; }
      const buyerV = verticalElements.find(e => e.id === 'buyer'); if (buyerV) { buyerV.x = 120; buyerV.y = 26; buyerV.align = 'center'; }
      const qrV = verticalElements.find(e => e.id === 'qrCode'); if (qrV) { qrV.x = 76; qrV.y = 48; qrV.width = 88; qrV.height = 88; qrV.visible = true; }
      const priceV = verticalElements.find(e => e.id === 'price'); if (priceV) { priceV.x = 120; priceV.y = 138; priceV.align = 'center'; priceV.fontSize = 16; }
      const tagV = verticalElements.find(e => e.id === 'tag'); if (tagV) { tagV.visible = false; }

      return [
        { id: 'reference_qr', name: '⭐ 30x20 QR Side (Default)', createdAt: 1, labelSize: '30x20mm', isBuiltIn: true, elements: qrRefElements, description: 'QR on right, customer & price on left' },
        { id: 'barcode_center', name: '||| 1D Barcode Centered', createdAt: 2, labelSize: '30x20mm', isBuiltIn: true, elements: barCenterElements, description: 'Centered linear barcode with info stack' },
        { id: 'minimal_text', name: '🔤 Bold Text Only', createdAt: 3, labelSize: '30x20mm', isBuiltIn: true, elements: minimalElements, description: 'Maximized typography without QR or barcode' },
        { id: 'vertical_qr', name: '📱 Stacked QR Center', createdAt: 4, labelSize: '30x20mm', isBuiltIn: true, elements: verticalElements, description: 'Symmetrical center-stacked QR layout' }
      ];
    }

    function mergeCloudLabelProfiles(cloudData: any) {
      if (!cloudData) return;
      let cloudProfiles: SavedLabelProfile[] = [];
      let cloudActiveProfileId: string | undefined;

      if (Array.isArray(cloudData)) {
        cloudProfiles = cloudData;
      } else if (typeof cloudData === 'object') {
        if (Array.isArray(cloudData.profiles)) {
          cloudProfiles = cloudData.profiles;
        }
        if (cloudData.activeProfileId) {
          cloudActiveProfileId = cloudData.activeProfileId;
        } else if (cloudData.activeLabelProfileId) {
          cloudActiveProfileId = cloudData.activeLabelProfileId;
        }
      }

      if (cloudProfiles.length === 0 && !cloudActiveProfileId) return;

      const builtIns = getBuiltInLabelProfiles();
      const currentCustom = savedLabelProfiles.value.filter(p => !p.isBuiltIn);
      const profileMap = new Map<string, SavedLabelProfile>();

      // Preserve local custom profiles
      for (const p of currentCustom) {
        profileMap.set(p.id, p);
      }

      // Merge in cloud profiles
      for (const cp of cloudProfiles) {
        if (!cp || !cp.id) continue;
        if (Array.isArray(cp.elements)) {
          for (const el of cp.elements) {
            if (el.id === 'price' && (el.prefix === 'P' || el.prefix === 'PHP' || !el.prefix)) {
              el.prefix = '₱';
            }
          }
        }
        profileMap.set(cp.id, cp);
      }

      const mergedCustom = Array.from(profileMap.values());
      savedLabelProfiles.value = [...builtIns, ...mergedCustom];
      const jsonStr = JSON.stringify(mergedCustom);
      localStorage.setItem('pos_saved_label_profiles_v1', jsonStr);

      if (cloudActiveProfileId) {
        activeLabelProfileId.value = cloudActiveProfileId;
        settings.value.activeLabelProfileId = cloudActiveProfileId;
        localStorage.setItem('pos_active_label_profile_id', cloudActiveProfileId);
        safeSetItem('live_pos_settings', settings.value);

        const matched = savedLabelProfiles.value.find(p => p.id === cloudActiveProfileId);
        if (matched && matched.elements) {
          if (!settings.value.labelLayout) settings.value.labelLayout = { ...defaultLabelLayout };
          settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(matched.elements));
          if (matched.labelSize) settings.value.labelLayout.labelSize = matched.labelSize as any;
          safeSetItem('live_pos_settings', settings.value);
          updateSamplePreviewQr();
        }
      }
    }

    function initSavedLabelProfiles() {
      try {
        const raw = localStorage.getItem('pos_saved_label_profiles_v1');
        const builtIns = getBuiltInLabelProfiles();
        if (raw) {
          const userProfiles: SavedLabelProfile[] = JSON.parse(raw);
          for (const up of userProfiles) {
            if (Array.isArray(up.elements)) {
              for (const el of up.elements) {
                if (el.id === 'price' && (el.prefix === 'P' || el.prefix === 'PHP' || !el.prefix)) {
                  el.prefix = '₱';
                }
              }
            }
          }
          const merged = [...builtIns];
          for (const up of userProfiles) {
            if (!merged.some(m => m.id === up.id)) {
              merged.push(up);
            }
          }
          savedLabelProfiles.value = merged;
        } else {
          savedLabelProfiles.value = builtIns;
        }
      } catch (err) {
        console.warn('Failed to load label profiles from localStorage:', err);
        savedLabelProfiles.value = getBuiltInLabelProfiles();
      }

      const savedActive = settings.value.activeLabelProfileId || localStorage.getItem('pos_active_label_profile_id');
      if (savedActive) {
        activeLabelProfileId.value = savedActive;
        const matched = savedLabelProfiles.value.find(p => p.id === savedActive);
        if (matched && (!settings.value.labelLayout?.customElements || settings.value.labelLayout.customElements.length === 0)) {
          if (!settings.value.labelLayout) settings.value.labelLayout = { ...defaultLabelLayout };
          settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(matched.elements));
          if (matched.labelSize) settings.value.labelLayout.labelSize = matched.labelSize as any;
        }
      }

      // Automatically fetch and merge custom label profiles from Supabase database
      fetchLabelProfilesFromSupabase().then(cloudJson => {
        if (cloudJson) {
          try {
            const parsed = JSON.parse(cloudJson);
            mergeCloudLabelProfiles(parsed);
          } catch (e) {
            console.warn('Failed parsing cloud label profiles:', e);
          }
        }
      }).catch(err => {
        console.warn('Supabase label profile initial fetch notice:', err);
      });
    }

    function persistUserLabelProfiles() {
      const customOnly = savedLabelProfiles.value.filter(p => !p.isBuiltIn);
      const payload = {
        profiles: customOnly,
        activeProfileId: activeLabelProfileId.value,
        timestamp: Date.now()
      };
      const jsonStr = JSON.stringify(customOnly);
      const payloadJson = JSON.stringify(payload);
      localStorage.setItem('pos_saved_label_profiles_v1', jsonStr);
      localStorage.setItem('pos_active_label_profile_id', activeLabelProfileId.value);
      if (settings.value) {
        settings.value.activeLabelProfileId = activeLabelProfileId.value;
        safeSetItem('live_pos_settings', settings.value);
      }
      // Persist to Supabase database so profiles and active selection are permanently saved in cloud
      syncLabelProfilesToSupabase(payloadJson).catch(err => {
        console.warn('Supabase label profile sync notice:', err);
      });
      syncAppSettingsToSupabase(JSON.stringify(settings.value)).catch(err => {
        console.warn('Supabase settings sync notice:', err);
      });
    }

    function loadLabelProfile(profileId: string) {
      const profile = savedLabelProfiles.value.find(p => p.id === profileId);
      if (!profile) return;
      activeLabelProfileId.value = profile.id;
      if (!settings.value.labelLayout) {
        settings.value.labelLayout = { ...defaultLabelLayout };
      }
      settings.value.activeLabelProfileId = profile.id;
      settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(profile.elements));
      if (Array.isArray(settings.value.labelLayout.customElements)) {
        for (const el of settings.value.labelLayout.customElements) {
          if (el.id === 'price' && (el.prefix === 'P' || el.prefix === 'PHP' || !el.prefix)) {
            el.prefix = '₱';
          }
        }
      }
      if (profile.labelSize) {
        settings.value.labelLayout.labelSize = profile.labelSize as any;
      }
      localStorage.setItem('pos_active_label_profile_id', profile.id);
      saveSettings(true);
      persistUserLabelProfiles();
      updateSamplePreviewQr();
      showToast(`Loaded label profile: "${profile.name}" (synced across devices)`);
    }

    function openSaveProfileModal() {
      newProfileName.value = `My Label Profile ${savedLabelProfiles.value.filter(p => !p.isBuiltIn).length + 1}`;
      showSaveProfileModal.value = true;
    }

    function confirmSaveCurrentLabelProfile() {
      const name = newProfileName.value.trim();
      if (!name) {
        showToast('Please enter a profile name');
        return;
      }
      const elements = JSON.parse(JSON.stringify(labelElementsList.value));
      const newProfile: SavedLabelProfile = {
        id: 'prof_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: name,
        createdAt: Date.now(),
        labelSize: settings.value.labelLayout?.labelSize || '30x20mm',
        isBuiltIn: false,
        elements: elements,
        description: `Custom layout with ${elements.filter((e: any) => e.visible).length} elements`
      };
      savedLabelProfiles.value.push(newProfile);
      activeLabelProfileId.value = newProfile.id;
      settings.value.activeLabelProfileId = newProfile.id;
      localStorage.setItem('pos_active_label_profile_id', newProfile.id);
      saveSettings(false);
      persistUserLabelProfiles();
      showSaveProfileModal.value = false;
      showToast(`Profile "${name}" saved to database & device! Ready for 1-click loading.`);
    }

    function deleteUserLabelProfile(profileId: string) {
      const prof = savedLabelProfiles.value.find(p => p.id === profileId);
      if (!prof || prof.isBuiltIn) return;
      savedLabelProfiles.value = savedLabelProfiles.value.filter(p => p.id !== profileId);
      if (activeLabelProfileId.value === profileId) {
        activeLabelProfileId.value = 'reference_qr';
        settings.value.activeLabelProfileId = 'reference_qr';
        localStorage.setItem('pos_active_label_profile_id', 'reference_qr');
        if (settings.value.labelLayout) {
          settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(defaultLabelElements));
        }
        saveSettings(false);
      }
      persistUserLabelProfiles();
      showToast(`Profile "${prof.name}" deleted from database & device.`);
    }

    function downloadLabelCoordinates() {
      const elements = labelElementsList.value;
      const labelSize = settings.value.labelLayout?.labelSize || '30x20mm';
      const widthDots = designerCanvasWidth.value;
      const heightDots = designerCanvasHeight.value;
      const activeProfileObj = savedLabelProfiles.value.find(p => p.id === activeLabelProfileId.value);
      const profileTitle = activeProfileObj ? activeProfileObj.name : 'Custom Layout';

      const exportData = {
        appName: 'LiveSeller POS',
        fileType: 'label_profile_coordinates',
        version: 1,
        profileName: profileTitle,
        labelSize: labelSize,
        canvasDots: {
          width: widthDots,
          height: heightDots,
          dpi: 203,
          dotsPerMm: 8
        },
        exportedAt: new Date().toISOString(),
        elements: elements.map(el => ({
          id: el.id,
          name: el.name,
          visible: el.visible,
          x: el.x,
          y: el.y,
          x_mm: Math.round((el.x / 8) * 10) / 10,
          y_mm: Math.round((el.y / 8) * 10) / 10,
          width: el.width,
          height: el.height,
          fontSize: el.fontSize,
          fontWeight: el.fontWeight,
          align: el.align,
          fontFamily: el.fontFamily || 'sans',
          prefix: el.prefix || '',
          suffix: el.suffix || '',
          customText: el.customText || ''
        }))
      };

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = profileTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'label_profile';
      a.href = url;
      a.download = `${safeName}_coordinates.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Downloaded coordinates for "${profileTitle}"!`);
    }

    function copyLabelCoordinatesJson() {
      const exportData = {
        appName: 'LiveSeller POS',
        fileType: 'label_profile_coordinates',
        profileName: 'Label Layout Coordinates',
        labelSize: settings.value.labelLayout?.labelSize || '30x20mm',
        canvasDots: {
          width: designerCanvasWidth.value,
          height: designerCanvasHeight.value
        },
        elements: labelElementsList.value
      };
      const jsonStr = JSON.stringify(exportData, null, 2);
      navigator.clipboard.writeText(jsonStr).then(() => {
        showToast('Coordinates JSON copied to clipboard!');
      }).catch(() => {
        showToast('Failed to copy. Please use Download button.');
      });
    }

    function handleProfileFileImport(file: File) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          loadCoordinatesFromJsonString(text, file.name.replace(/\.json$/i, ''));
        } catch (err: any) {
          showToast(`Invalid coordinates file: ${err.message || err}`);
        }
      };
      reader.readAsText(file);
    }

    function onProfileFileInputChange(event: Event) {
      const target = event.target as HTMLInputElement;
      const file = target?.files?.[0];
      if (file) {
        handleProfileFileImport(file);
        target.value = '';
      }
    }

    function onProfileFileDrop(event: DragEvent) {
      const file = event.dataTransfer?.files?.[0];
      if (file) {
        handleProfileFileImport(file);
      }
    }

    function loadCoordinatesFromJsonString(jsonStr: string, defaultName = 'Imported Profile') {
      const parsed = JSON.parse(jsonStr);
      let elements: VisualLabelElement[] | null = null;
      let importedName = defaultName;
      let importedSize = '30x20mm';

      if (Array.isArray(parsed)) {
        elements = parsed;
      } else if (parsed && Array.isArray(parsed.elements)) {
        elements = parsed.elements;
        if (parsed.profileName) importedName = parsed.profileName;
        if (parsed.labelSize) importedSize = parsed.labelSize;
      } else if (parsed && Array.isArray(parsed.customElements)) {
        elements = parsed.customElements;
        if (parsed.profileName) importedName = parsed.profileName;
        if (parsed.labelSize) importedSize = parsed.labelSize;
      }

      if (!elements || elements.length === 0) {
        throw new Error('No valid label elements or coordinates found in JSON.');
      }

      const mergedElements = defaultLabelElements.map(def => {
        const found = elements!.find(e => e.id === def.id);
        if (found) {
          return {
            ...def,
            ...found,
            x: typeof found.x === 'number' ? found.x : def.x,
            y: typeof found.y === 'number' ? found.y : def.y,
            visible: typeof found.visible === 'boolean' ? found.visible : def.visible,
            fontSize: found.fontSize || def.fontSize,
            fontWeight: found.fontWeight || def.fontWeight,
            align: found.align || def.align,
            fontFamily: found.fontFamily || def.fontFamily
          };
        }
        return { ...def };
      });

      for (const el of mergedElements) {
        if (el.id === 'price' && (el.prefix === 'P' || el.prefix === 'PHP' || !el.prefix)) {
          el.prefix = '₱';
        }
      }

      if (!settings.value.labelLayout) settings.value.labelLayout = { ...defaultLabelLayout };
      settings.value.labelLayout.customElements = mergedElements;
      if (importedSize) settings.value.labelLayout.labelSize = importedSize as any;
      saveSettings(true);
      updateSamplePreviewQr();

      const newProf: SavedLabelProfile = {
        id: 'prof_' + Date.now(),
        name: importedName,
        createdAt: Date.now(),
        labelSize: importedSize,
        isBuiltIn: false,
        elements: mergedElements,
        description: `Imported with ${mergedElements.filter(e => e.visible).length} active elements`
      };
      savedLabelProfiles.value.push(newProf);
      activeLabelProfileId.value = newProf.id;
      persistUserLabelProfiles();

      showToast(`Successfully loaded coordinates: "${importedName}"!`);
    }

    function setElementAlign(elem: VisualLabelElement, newAlign: 'left' | 'center' | 'right') {
      if (!elem || elem.align === newAlign) return;
      const canvasW = designerCanvasWidth.value;
      const elW = elem.width || (elem.id === 'qrCode' ? 88 : 40);

      if (!elem.width) {
        let visualLeft = elem.x;
        if (elem.align === 'right') visualLeft = elem.x - elW;
        else if (elem.align === 'center') visualLeft = elem.x - Math.round(elW / 2);

        if (newAlign === 'left') {
          elem.x = Math.max(0, Math.min(canvasW - elW, visualLeft));
        } else if (newAlign === 'center') {
          elem.x = Math.max(Math.round(elW / 2), Math.min(canvasW - Math.round(elW / 2), visualLeft + Math.round(elW / 2)));
        } else if (newAlign === 'right') {
          elem.x = Math.max(elW, Math.min(canvasW, visualLeft + elW));
        }
      }
      elem.align = newAlign;
      saveSettings(true);
    }

    function onElementPointerDown(elemId: string, event: MouseEvent | TouchEvent) {
      designerSelectedId.value = elemId;
      designerIsDragging.value = true;
      const elem = labelElementsList.value.find(e => e.id === elemId);
      if (!elem) return;

      const clientX = 'touches' in event ? event.touches[0].clientX : (event as MouseEvent).clientX;
      const clientY = 'touches' in event ? event.touches[0].clientY : (event as MouseEvent).clientY;

      designerDragStart.value = {
        startX: clientX,
        startY: clientY,
        origX: elem.x,
        origY: elem.y,
        zoom: designerCanvasZoom.value / 100
      };

      const onMove = (e: MouseEvent | TouchEvent) => {
        if (!designerIsDragging.value) return;
        const curX = 'touches' in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
        const curY = 'touches' in e ? e.touches[0].clientY : (e as MouseEvent).clientY;

        const deltaX = (curX - designerDragStart.value.startX) / designerDragStart.value.zoom;
        const deltaY = (curY - designerDragStart.value.startY) / designerDragStart.value.zoom;

        let targetX = Math.round(designerDragStart.value.origX + deltaX);
        let targetY = Math.round(designerDragStart.value.origY + deltaY);

        if (designerSnapGrid.value) {
          targetX = Math.round(targetX / 4) * 4;
          targetY = Math.round(targetY / 4) * 4;
        }

        const maxW = designerCanvasWidth.value;
        const maxH = designerCanvasHeight.value;
        const elW = elem.width || (elem.id === 'qrCode' ? 88 : 40);
        const elH = elem.height || (elem.id === 'qrCode' ? 88 : 18);

        if (elem.align === 'right' && !elem.width) {
          elem.x = Math.max(elW, Math.min(maxW, targetX));
        } else if (elem.align === 'center' && !elem.width) {
          elem.x = Math.max(Math.round(elW / 2), Math.min(maxW - Math.round(elW / 2), targetX));
        } else {
          elem.x = Math.max(0, Math.min(maxW - elW, targetX));
        }
        elem.y = Math.max(0, Math.min(maxH - elH, targetY));
        saveSettings(false);
      };

      const onUp = () => {
        designerIsDragging.value = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        saveSettings(true);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    }

    function alignSelectedElement(alignment: 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom') {
      const elem = selectedLabelElement.value;
      if (!elem) return;
      const canvasW = designerCanvasWidth.value;
      const canvasH = designerCanvasHeight.value;
      const elW = elem.width || (elem.id === 'qrCode' ? 88 : 40);
      const elH = elem.height || (elem.id === 'qrCode' ? 88 : 18);

      if (alignment === 'left') {
        elem.x = (elem.align === 'right' && !elem.width) ? elW + 8 : (elem.align === 'center' && !elem.width ? Math.round(elW / 2) + 8 : 8);
      } else if (alignment === 'center-h') {
        elem.x = (elem.align === 'center' && !elem.width) ? Math.round(canvasW / 2) : Math.max(0, Math.round((canvasW - elW) / 2));
      } else if (alignment === 'right') {
        elem.x = (elem.align === 'right' && !elem.width) ? canvasW - 8 : Math.max(0, canvasW - elW - 8);
      } else if (alignment === 'top') {
        elem.y = 8;
      } else if (alignment === 'center-v') {
        elem.y = Math.max(0, Math.round((canvasH - elH) / 2));
      } else if (alignment === 'bottom') {
        elem.y = Math.max(0, canvasH - elH - 8);
      }

      saveSettings(true);
      showToast(`Aligned ${elem.name} to ${alignment}`);
    }

    function nudgeSelectedElement(dx: number, dy: number) {
      const elem = selectedLabelElement.value;
      if (!elem) return;
      const canvasW = designerCanvasWidth.value;
      const canvasH = designerCanvasHeight.value;
      const elW = elem.width || (elem.id === 'qrCode' ? 88 : 40);
      const elH = elem.height || (elem.id === 'qrCode' ? 88 : 18);

      if (elem.align === 'right' && !elem.width) {
        elem.x = Math.max(elW, Math.min(canvasW, elem.x + dx));
      } else if (elem.align === 'center' && !elem.width) {
        elem.x = Math.max(Math.round(elW / 2), Math.min(canvasW - Math.round(elW / 2), elem.x + dx));
      } else {
        elem.x = Math.max(0, Math.min(canvasW - elW, elem.x + dx));
      }
      elem.y = Math.max(0, Math.min(canvasH - elH, elem.y + dy));
      saveSettings(false);
    }

    function toggleElementVisibility(elemId: string) {
      const elem = labelElementsList.value.find(e => e.id === elemId);
      if (elem) {
        elem.visible = !elem.visible;
        saveSettings(true);
      }
    }

    function applyDesignerLabelPreset(presetName: string) {
      if (!settings.value.labelLayout) settings.value.labelLayout = { ...defaultLabelLayout };

      activeLabelProfileId.value = presetName;
      settings.value.activeLabelProfileId = presetName;
      localStorage.setItem('pos_active_label_profile_id', presetName);

      if (presetName === 'reference_qr') {
        settings.value.labelLayout.customElements = JSON.parse(JSON.stringify(defaultLabelElements));
        showToast('Applied 30x20mm QR Reference Layout!');
      } else if (presetName === 'barcode_center') {
        const elems = JSON.parse(JSON.stringify(defaultLabelElements));
        const qr = elems.find((e: any) => e.id === 'qrCode');
        if (qr) qr.visible = false;
        const bar = elems.find((e: any) => e.id === 'barcode');
        if (bar) { bar.visible = true; bar.x = 16; bar.y = 36; bar.width = 208; bar.height = 36; }
        const code = elems.find((e: any) => e.id === 'controlCode');
        if (code) { code.x = 120; code.y = 10; code.align = 'center'; }
        const buyer = elems.find((e: any) => e.id === 'buyer');
        if (buyer) { buyer.x = 10; buyer.y = 86; }
        const tag = elems.find((e: any) => e.id === 'tag');
        if (tag) { tag.x = 10; tag.y = 110; }
        const price = elems.find((e: any) => e.id === 'price');
        if (price) { price.x = 10; price.y = 132; price.fontSize = 18; }
        const time = elems.find((e: any) => e.id === 'time');
        if (time) { time.x = 232; time.y = 10; time.align = 'right'; }
        settings.value.labelLayout.customElements = elems;
        showToast('Applied Centered Barcode Layout!');
      } else if (presetName === 'minimal_text') {
        const elems = JSON.parse(JSON.stringify(defaultLabelElements));
        const qr = elems.find((e: any) => e.id === 'qrCode');
        if (qr) qr.visible = false;
        const bar = elems.find((e: any) => e.id === 'barcode');
        if (bar) bar.visible = false;
        const code = elems.find((e: any) => e.id === 'controlCode');
        if (code) { code.x = 10; code.y = 10; code.fontSize = 18; }
        const time = elems.find((e: any) => e.id === 'time');
        if (time) { time.x = 232; time.y = 10; time.align = 'right'; }
        const buyer = elems.find((e: any) => e.id === 'buyer');
        if (buyer) { buyer.x = 10; buyer.y = 44; buyer.fontSize = 22; buyer.fontWeight = 'black'; }
        const tag = elems.find((e: any) => e.id === 'tag');
        if (tag) { tag.x = 10; tag.y = 82; tag.fontSize = 16; }
        const price = elems.find((e: any) => e.id === 'price');
        if (price) { price.x = 10; price.y = 116; price.fontSize = 24; price.fontWeight = 'black'; }
        settings.value.labelLayout.customElements = elems;
        showToast('Applied Bold Minimalist Text Layout!');
      } else if (presetName === 'vertical_qr') {
        const elems = JSON.parse(JSON.stringify(defaultLabelElements));
        const code = elems.find((e: any) => e.id === 'controlCode');
        if (code) { code.x = 120; code.y = 6; code.align = 'center'; }
        const time = elems.find((e: any) => e.id === 'time');
        if (time) { time.visible = false; }
        const buyer = elems.find((e: any) => e.id === 'buyer');
        if (buyer) { buyer.x = 120; buyer.y = 26; buyer.align = 'center'; }
        const qr = elems.find((e: any) => e.id === 'qrCode');
        if (qr) { qr.x = 76; qr.y = 48; qr.width = 88; qr.height = 88; qr.visible = true; }
        const price = elems.find((e: any) => e.id === 'price');
        if (price) { price.x = 120; price.y = 138; price.align = 'center'; price.fontSize = 16; }
        const tag = elems.find((e: any) => e.id === 'tag');
        if (tag) { tag.visible = false; }
        settings.value.labelLayout.customElements = elems;
        showToast('Applied Centered Stacked QR Layout!');
      }

      saveSettings(true);
      persistUserLabelProfiles();
      updateSamplePreviewQr();
    }

    function moveReceiptSection(index: number, direction: number) {
      const list = receiptSectionsList.value;
      const target = index + direction;
      if (target < 0 || target >= list.length) return;
      const tmp = list[index];
      list[index] = list[target];
      list[target] = tmp;
      list.forEach((sec, idx) => { sec.order = idx + 1; });
      saveSettings(true);
    }

    function toggleReceiptSectionVisibility(secId: string) {
      const sec = receiptSectionsList.value.find(s => s.id === secId);
      if (sec) {
        sec.visible = !sec.visible;
        saveSettings(true);
      }
    }

    function toggleReceiptDivider(secId: string) {
      const sec = receiptSectionsList.value.find(s => s.id === secId);
      if (sec) {
        sec.showDividerBelow = !sec.showDividerBelow;
        saveSettings(true);
      }
    }

    function resetReceiptDesigner() {
      if (settings.value.receiptLayout) {
        settings.value.receiptLayout.customSections = JSON.parse(JSON.stringify(defaultReceiptSections));
        saveSettings(true);
        showToast('Receipt layout reset to default sections');
      }
    }

    async function directPrintStickerBt(mine: MinedItem) {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const is30x20 = settings.value.labelLayout?.labelSize === '30x20mm';
        const cols = is30x20 ? 16 : (settings.value.printerPaperWidth === '80mm' ? 48 : 32);
        await printDirectSticker(mine, activeProfile.value, sessionDate.value, cols, settings.value.labelLayout);
        showToast(`Sticker printed to ${btPrinterName.value || 'PT-265'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    async function directPrintPackingSlipBt(basket: BuyerBasket) {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const cols = settings.value.receiptLayout?.paperWidth === '80mm' ? 48 : 32;
        await printDirectPackingSlip(basket, activeProfile.value, sessionDate.value, cols, settings.value.receiptLayout);
        showToast(`Packing slip printed to ${btPrinterName.value || 'PT-210'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    async function directPrintInvoiceBt(buyer: BuyerBasket) {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const cols = settings.value.receiptLayout?.paperWidth === '80mm' ? 48 : 32;
        await printDirectInvoice(buyer, activeProfile.value, sessionDate.value, cols, settings.value.receiptLayout);
        showToast(`Invoice printed to ${btPrinterName.value || 'PT-210'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    const customerViewMode = ref('cards'); // 'cards' | 'table'
    const allExpanded = ref(true);

    function toggleAllCustomerItems() {
      allExpanded.value = !allExpanded.value;
      for (const b of filteredBuyerBaskets.value) {
        b.isExpanded = allExpanded.value;
      }
    }

    const invoiceModalOpen = ref(false);
    const activeInvoiceBuyer = ref<BuyerBasket | null>(null);

    function openInvoiceModal(buyer: BuyerBasket) {
      activeInvoiceBuyer.value = buyer;
      invoiceModalOpen.value = true;
    }

    function closeInvoiceModal() {
      invoiceModalOpen.value = false;
      activeInvoiceBuyer.value = null;
    }

    async function triggerInvoicePrint(buyer: BuyerBasket) {
      if (!buyer) return;
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const cols = settings.value.receiptLayout?.paperWidth === '80mm' ? 48 : 32;
        await printDirectInvoice(buyer, activeProfile.value, sessionDate.value, cols, settings.value.receiptLayout);
        showToast(`Invoice printed to ${btPrinterName.value || 'PT-210'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    function logMine() {
      checkAndApplyDailyRollover();
      const description = (form.description || '').trim();
      const price = parseFloat(String(form.price));
      const buyer = form.buyer.trim().replace(/^@+/, '');

      if (isNaN(price) || price <= 0) {
        showToast(`Please enter a valid Price (${activeProfile.value.currency})`);
        focusPriceInput();
        return;
      }
      if (!buyer) {
        showToast('Please enter Customer Name');
        focusBuyerInput();
        return;
      }

      const prefix = getStorePrefix(activeProfile.value);
      const dateStr = sessionDate.value || defaultSessionDate;
      const currentControlNum = getNextUniqueSequenceNumber(sequenceCounter.value, allMines.value, prefix, dateStr);
      const controlCode = formatControlCode(prefix, dateStr, currentControlNum);
      const tag = controlCode;
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const todayDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      const finalPhotoUrl = (currentUploadJob.value && currentUploadJob.value.r2Url) 
        ? currentUploadJob.value.r2Url 
        : (form.photo || '');

      const newMine: MinedItem = {
        id: 'mine_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        controlCode: controlCode,
        controlNum: currentControlNum,
        tag: tag,
        description: description,
        price: price,
        buyer: buyer,
        photo: finalPhotoUrl,
        date: todayDate,
        time: timeStr,
        timestamp: Date.now()
      };

      // Link current in-flight upload to this mine ID so the R2 URL upgrades and syncs upon completion
      if (currentUploadJob.value && !currentUploadJob.value.isDone) {
        currentUploadJob.value.assignedMineId = newMine.id;
      }

      allMines.value.push(newMine);
      // Advance counter to next guaranteed unique slot
      sequenceCounter.value = getNextUniqueSequenceNumber(currentControlNum + 1, allMines.value, prefix, dateStr);
      saveAll();
      pushSingleMineToSupabase(newMine, activeProfileId.value, sessionDate.value);

      // If photo was saved as base64 (upload was not finished or offline), queue auto-migration
      if (newMine.photo && newMine.photo.startsWith('data:image') && isR2Ready.value) {
        const mineId = newMine.id;
        const cleanSession = (sessionDate.value || 'live').replace(/[^a-zA-Z0-9_-]/g, '');
        const cleanStore = (activeProfile.value.id || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
        const fileKey = `${cleanStore}/${cleanSession}/item_${mineId}.jpg`;
        uploadToCloudflareR2(fileKey, newMine.photo, r2Form).then(res => {
          if (res.success && res.url) {
            const m = allMines.value.find(x => x.id === mineId);
            if (m) {
              m.photo = res.url;
              saveAll();
              pushSingleMineToSupabase(m, activeProfileId.value, sessionDate.value);
            }
          }
        }).catch(err => console.warn('Background mine photo upload notice:', err));
      }

      playBeep('success', settings.value.soundEnabled);

      const descSummary = description ? ` • ${description}` : '';
      const photoIndicator = form.photo ? ' 📸' : '';
      showToast(`Logged ${controlCode}${descSummary}${photoIndicator} • ${buyer} (${activeProfile.value.currency}${price.toLocaleString()})`);

      if (settings.value.autoPrint) {
        triggerStickerPrint(newMine);
      }

      // Clear all mining input fields
      form.buyer = '';
      form.price = '';
      form.description = '';
      form.tag = '';
      form.photo = '';
      if (photoInputRef.value) {
        photoInputRef.value.value = '';
      }

      buyerSuggestionsOpen.value = false;
      focusFirstMiningField();
    }

    function undoMine(mine: MinedItem) {
      const itemLabel = mine.description ? `${mine.controlCode} (${mine.description})` : mine.controlCode;
      if (!confirm(`Cancel and delete ${itemLabel} for ${mine.buyer} - ${activeProfile.value.currency}${mine.price}?`)) {
        return;
      }
      // 1. Add to local deleted mine tombstones so it is never re-added on sync
      const localDeletedMines = safeParseJson(safeGetItem('live_pos_deleted_mine_ids'), []);
      if (!localDeletedMines.includes(mine.id)) {
        localDeletedMines.push(mine.id);
        safeSetItem('live_pos_deleted_mine_ids', localDeletedMines);
      }

      // 2. Remove locally and persist
      allMines.value = allMines.value.filter(m => m.id !== mine.id);
      saveAll();

      // 3. Delete from Supabase database and update cloud tombstone
      deleteSingleMineFromSupabase(mine.id);

      playBeep('undo', settings.value.soundEnabled);
      showToast(`Removed ${itemLabel}`);
    }

    async function triggerStickerPrint(mine: MinedItem) {
      if (!mine) return;
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const is30x20 = settings.value.labelLayout?.labelSize === '30x20mm';
        const cols = is30x20 ? 16 : (settings.value.printerPaperWidth === '80mm' ? 48 : 32);
        await printDirectSticker(mine, activeProfile.value, sessionDate.value, cols, settings.value.labelLayout);
        showToast(`Sticker printed to ${btPrinterName.value || 'PT-265'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    async function triggerPackingSlipPrint(basket: BuyerBasket) {
      if (!basket) return;
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const cols = settings.value.receiptLayout?.paperWidth === '80mm' ? 48 : 32;
        await printDirectPackingSlip(basket, activeProfile.value, sessionDate.value, cols, settings.value.receiptLayout);
        showToast(`Packing slip printed to ${btPrinterName.value || 'PT-210'}`);
      } catch (err: any) {
        showToast(`Print failed: ${err.message || err}`);
      }
    }

    const buyerSearchQuery = ref('');
    const buyerFilterStatus = ref('all'); // 'all', 'owing', 'settled', 'credit'

    const buyerBasketsList = computed<BuyerBasket[]>(() => {
      const map: Record<string, BuyerBasket> = {};
      for (const m of allMines.value) {
        if (!map[m.buyer]) {
          const cleanName = m.buyer.startsWith('@') ? m.buyer.slice(1) : m.buyer;
          map[m.buyer] = {
            handle: m.buyer,
            displayName: cleanName,
            dateIssued: m.date || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            paymentDate: '',
            items: [],
            totalAmount: 0,
            totalPaid: 0,
            balance: 0,
            status: 'Unpaid',
            payments: [],
            isExpanded: allExpanded.value
          };
        }
        map[m.buyer].items.push(m);
        map[m.buyer].totalAmount += m.price;
      }

      for (const p of allPayments.value) {
        if (!map[p.buyer]) {
          const cleanName = p.buyer.startsWith('@') ? p.buyer.slice(1) : p.buyer;
          map[p.buyer] = {
            handle: p.buyer,
            displayName: cleanName,
            dateIssued: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            paymentDate: '',
            items: [],
            totalAmount: 0,
            totalPaid: 0,
            balance: 0,
            status: 'Unpaid',
            payments: [],
            isExpanded: allExpanded.value
          };
        }
        map[p.buyer].payments.push(p);
        map[p.buyer].totalPaid += p.amount;
        map[p.buyer].paymentDate = p.date || p.time || new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }

      const list = Object.values(map).map(b => {
        b.balance = b.totalAmount - b.totalPaid;
        b.status = b.balance <= 0 ? 'Paid' : (b.totalPaid > 0 ? 'Partial' : 'Unpaid');
        return b;
      });

      return list.sort((a, b) => b.balance - a.balance || b.items.length - a.items.length);
    });

    const filteredBuyerBaskets = computed(() => {
      let list = buyerBasketsList.value;
      const q = buyerSearchQuery.value.trim().toLowerCase();
      if (q) {
        list = list.filter(b => b.handle.toLowerCase().includes(q) || (b.displayName && b.displayName.toLowerCase().includes(q)));
      }
      if (buyerFilterStatus.value === 'owing') {
        list = list.filter(b => b.balance > 0);
      } else if (buyerFilterStatus.value === 'settled') {
        list = list.filter(b => b.balance === 0);
      } else if (buyerFilterStatus.value === 'credit') {
        list = list.filter(b => b.balance < 0);
      }
      return list;
    });

    const minedItemsSearchQuery = ref('');
    const minedItemsFilterCategory = ref('All');
    const minedItemsFilterDate = ref('all'); // 'all', 'today', 'yesterday', 'custom', or specific date string
    const minedItemsCustomDate = ref('');

    function getItemDateNormalized(item: MinedItem): string {
      if (item.timestamp) {
        const d = new Date(item.timestamp);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
      }
      if (item.date) {
        const d = new Date(item.date);
        if (!isNaN(d.getTime())) {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }
      }
      return '';
    }

    const uniqueMinedDates = computed(() => {
      const dates = new Set<string>();
      for (const m of allMines.value) {
        if (m.date) {
          dates.add(m.date);
        } else if (m.timestamp) {
          const d = new Date(m.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          dates.add(d);
        }
      }
      return Array.from(dates);
    });

    const filteredMinedItems = computed(() => {
      let list = [...allMines.value].reverse();
      const q = minedItemsSearchQuery.value.trim().toLowerCase();
      if (q) {
        list = list.filter(item => {
          const handle = (item.buyer || '').toLowerCase();
          const tag = (item.tag || '').toLowerCase();
          const desc = (item.description || '').toLowerCase();
          const code = (item.controlCode || '').toLowerCase();
          const num = String(item.controlNum || '');
          return handle.includes(q) || tag.includes(q) || desc.includes(q) || code.includes(q) || num.includes(q);
        });
      }
      if (minedItemsFilterCategory.value && minedItemsFilterCategory.value !== 'All') {
        const cat = minedItemsFilterCategory.value.toLowerCase();
        list = list.filter(item => (item.description || '').toLowerCase() === cat);
      }
      if (minedItemsFilterDate.value && minedItemsFilterDate.value !== 'all') {
        const now = new Date();
        const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        
        const yest = new Date();
        yest.setDate(yest.getDate() - 1);
        const yestIso = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;

        if (minedItemsFilterDate.value === 'today') {
          list = list.filter(item => {
            const itemIso = getItemDateNormalized(item);
            return itemIso === todayIso;
          });
        } else if (minedItemsFilterDate.value === 'yesterday') {
          list = list.filter(item => {
            const itemIso = getItemDateNormalized(item);
            return itemIso === yestIso;
          });
        } else if (minedItemsFilterDate.value === 'custom' && minedItemsCustomDate.value) {
          list = list.filter(item => {
            const itemIso = getItemDateNormalized(item);
            return itemIso === minedItemsCustomDate.value;
          });
        } else if (minedItemsFilterDate.value) {
          list = list.filter(item => {
            const itemIso = getItemDateNormalized(item);
            return item.date === minedItemsFilterDate.value || itemIso === minedItemsFilterDate.value;
          });
        }
      }
      return list;
    });

    function openInvoiceForBuyer(handle: string) {
      const basket = buyerBasketsList.value.find(b => b.handle === handle || b.displayName === handle);
      if (basket) {
        openInvoiceModal(basket);
      } else {
        showToast(`Invoice opened for ${handle}`);
      }
    }

    const owingBuyersCount = computed(() => buyerBasketsList.value.filter(b => b.balance > 0).length);
    const settledBuyersCount = computed(() => buyerBasketsList.value.filter(b => b.balance === 0).length);
    const creditBuyersCount = computed(() => buyerBasketsList.value.filter(b => b.balance < 0).length);

    const profilesOverview = computed(() => {
      return profiles.value.map(p => {
        const isActive = p.id === activeProfileId.value;
        let mines: MinedItem[] = [];
        if (isActive) {
          mines = allMines.value;
        } else {
          const stored = safeGetItem('live_pos_mines_' + p.id);
          mines = stored ? safeParseJson(stored as string, []) : [];
        }
        const totalSales = mines.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
        return {
          ...p,
          isActive,
          minesCount: mines.length,
          totalSales
        };
      });
    });

    function saveProfileData(profId: string) {
      if (!profId) return;
      try {
        safeSetItem('live_pos_mines_' + profId, allMines.value);
        safeSetItem('live_pos_payments_' + profId, allPayments.value);
        safeSetItem('live_pos_customer_notes_' + profId, customerNotes.value);
        safeSetItem('live_pos_sequence_counter_' + profId, String(sequenceCounter.value));
        safeSetItem('live_pos_session_date_' + profId, sessionDate.value);
        safeSetItem('live_pos_session_start_' + profId, sessionStartTime.value);

        safeSetItem('live_pos_mines', allMines.value);
        safeSetItem('live_pos_payments', allPayments.value);
        safeSetItem('live_pos_customer_notes', customerNotes.value);
        safeSetItem('live_pos_sequence_counter', String(sequenceCounter.value));
        safeSetItem('live_pos_session_date', sessionDate.value);
        safeSetItem('live_pos_session_start', sessionStartTime.value);
        safeSetItem('live_pos_profiles', profiles.value);
        safeSetItem('live_pos_active_profile_id', activeProfileId.value);
      } catch (e) {
        console.error('Error saving profile data:', e);
      }
    }

    function loadProfileData(profId: string) {
      try {
        const deletedMineIds = new Set<string>(safeParseJson(safeGetItem('live_pos_deleted_mine_ids'), []));
        const storedMines = safeGetItem('live_pos_mines_' + profId);
        if (storedMines) {
          allMines.value = safeParseJson(storedMines as string, []).filter((m: MinedItem) => m && m.id && !deletedMineIds.has(m.id));
        } else if (profId === 'prof_main') {
          const legacyMines = safeGetItem('live_pos_mines');
          allMines.value = legacyMines ? safeParseJson(legacyMines as string, []).filter((m: MinedItem) => m && m.id && !deletedMineIds.has(m.id)) : [];
        } else {
          allMines.value = [];
        }

        const storedPayments = safeGetItem('live_pos_payments_' + profId);
        if (storedPayments) {
          allPayments.value = safeParseJson(storedPayments as string, []);
        } else if (profId === 'prof_main') {
          const legacyPayments = safeGetItem('live_pos_payments');
          allPayments.value = legacyPayments ? safeParseJson(legacyPayments as string, []) : [];
        } else {
          allPayments.value = [];
        }

        const storedNotes = safeGetItem('live_pos_customer_notes_' + profId);
        if (storedNotes) {
          customerNotes.value = safeParseJson(storedNotes as string, {});
        } else if (profId === 'prof_main') {
          const legacyNotes = safeGetItem('live_pos_customer_notes');
          customerNotes.value = legacyNotes ? safeParseJson(legacyNotes as string, {}) : {};
        } else {
          customerNotes.value = {};
        }

        const today = getTodaySessionDate();
        const storedDate = safeGetItem('live_pos_session_date_' + profId);
        const storedDateFormatted = storedDate ? getFormattedSessionDate(storedDate as string) : '';
        const isSameDay = storedDateFormatted === today;

        sessionDate.value = today;

        const storedSeq = safeGetItem('live_pos_sequence_counter_' + profId);
        let parsedSeq = 1;
        if (storedSeq && isSameDay) {
          parsedSeq = Number(storedSeq) || 1;
        }

        sequenceCounter.value = computeSequenceForDate(today, activeProfile.value, allMines.value, parsedSeq);
        safeSetItem('live_pos_session_date_' + profId, today);
        safeSetItem('live_pos_sequence_counter_' + profId, String(sequenceCounter.value));

        const storedStart = safeGetItem('live_pos_session_start_' + profId);
        if (storedStart) {
          sessionStartTime.value = storedStart as string;
        } else if (profId === 'prof_main') {
          sessionStartTime.value = (safeGetItem('live_pos_session_start') || now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })) as string;
        } else {
          sessionStartTime.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        if (activeProfile.value) {
          settings.value.storeName = activeProfile.value.name;
          settings.value.paymentDetails = activeProfile.value.paymentDetails;
        }
      } catch (e) {
        console.error('Error loading profile data:', e);
      }
    }

    function switchProfile(id: string) {
      if (id === activeProfileId.value) return;
      saveProfileData(activeProfileId.value);
      activeProfileId.value = id;
      localStorage.setItem('live_pos_active_profile_id', id);
      loadProfileData(id);
      syncActiveStoreForm();
      profileModalOpen.value = false;
      showToast(`Switched to business: ${activeProfile.value.name}`);
      pushActiveProfileToSupabase(id);
      if (navigator.onLine) {
        syncAllWithSupabase(false);
      }
    }

    const profileModalOpen = ref(false);
    const profileEditModalOpen = ref(false);

    const editingProfileForm = reactive({
      id: '',
      isNew: false,
      name: '',
      category: '',
      currency: '₱',
      codePrefix: 'L',
      color: 'emerald',
      quickPrefixesText: '',
      defaultCategoriesText: '',
      paymentDetails: ''
    });

    function openProfileModal() {
      profileModalOpen.value = true;
    }
    function closeProfileModal() {
      profileModalOpen.value = false;
    }

    function openAddProfileModal() {
      profileModalOpen.value = false;
      editingProfileForm.isNew = true;
      editingProfileForm.id = 'prof_' + Date.now();
      editingProfileForm.name = '';
      editingProfileForm.category = 'General Retail';
      editingProfileForm.currency = activeProfile.value.currency || '₱';
      editingProfileForm.codePrefix = '';
      editingProfileForm.color = 'blue';
      editingProfileForm.quickPrefixesText = 'A, B, C, D, VIP';
      editingProfileForm.defaultCategoriesText = 'Tops, Dresses, Bottoms, Jackets, Accessories';
      editingProfileForm.paymentDetails = 'GCash: 09XX-XXX-XXXX\nMaya: 09XX-XXX-XXXX';
      profileEditModalOpen.value = true;
    }

    function openEditProfileModal(p: Profile) {
      profileModalOpen.value = false;
      editingProfileForm.isNew = false;
      editingProfileForm.id = p.id;
      editingProfileForm.name = p.name;
      editingProfileForm.category = p.category || 'Retail';
      editingProfileForm.currency = p.currency || '₱';
      editingProfileForm.codePrefix = getStorePrefix(p);
      editingProfileForm.color = p.color || 'emerald';
      editingProfileForm.quickPrefixesText = (p.quickPrefixes || []).join(', ');
      editingProfileForm.defaultCategoriesText = (p.defaultCategories || []).join(', ');
      editingProfileForm.paymentDetails = p.paymentDetails || '';
      profileEditModalOpen.value = true;
    }

    function saveProfile() {
      const name = editingProfileForm.name.trim();
      if (!name) {
        showToast('Please enter a business name');
        return;
      }
      const prefixes = editingProfileForm.quickPrefixesText
        .split(',')
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      const categories = editingProfileForm.defaultCategoriesText
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      const rawPrefix = editingProfileForm.codePrefix.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const firstLetter = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || 'L';
      const finalPrefix = (rawPrefix && rawPrefix !== '#') ? rawPrefix : firstLetter;

      const profileData: Profile = {
        id: editingProfileForm.id,
        name: name,
        category: editingProfileForm.category.trim() || 'Retail',
        currency: editingProfileForm.currency.trim() || '₱',
        codePrefix: finalPrefix,
        color: editingProfileForm.color || 'emerald',
        quickPrefixes: prefixes.length ? prefixes : ['A', 'B', 'C'],
        defaultCategories: categories.length ? categories : ['General'],
        paymentDetails: editingProfileForm.paymentDetails.trim()
      };

      // If creating or updating a profile, remove it from the deleted set and cloud tombstones
      const deletedIds = new Set<string>(safeParseJson(safeGetItem('live_pos_deleted_profile_ids'), []));
      if (deletedIds.has(profileData.id)) {
        deletedIds.delete(profileData.id);
        safeSetItem('live_pos_deleted_profile_ids', Array.from(deletedIds));
      }
      removeDeletedProfileTombstone(profileData.id);

      if (editingProfileForm.isNew) {
        profiles.value.push(profileData);
        saveAll();
        pushProfileToSupabase(profileData, sequenceCounter.value, sessionDate.value);
        pushActiveProfileToSupabase(profileData.id);
        switchProfile(profileData.id);
        showToast(`Created new business: ${name}`);
      } else {
        const idx = profiles.value.findIndex(p => p.id === profileData.id);
        if (idx !== -1) {
          profiles.value[idx] = profileData;
        }
        saveAll();
        pushProfileToSupabase(profileData, sequenceCounter.value, sessionDate.value);
        showToast(`Updated business: ${name}`);
      }
      profileEditModalOpen.value = false;
    }

    async function deleteProfile(id: string) {
      if (profiles.value.length <= 1) {
        showToast('You must keep at least one business profile.');
        return;
      }
      const target = profiles.value.find(p => p.id === id);
      if (!confirm(`Delete profile "${target?.name}"? All logs for this business will be removed across all devices.`)) {
        return;
      }

      // Add to deleted profile tombstone registry so it is never recreated by defaults or cloud sync
      const deletedIds = new Set<string>(safeParseJson(safeGetItem('live_pos_deleted_profile_ids'), []));
      deletedIds.add(id);
      safeSetItem('live_pos_deleted_profile_ids', Array.from(deletedIds));

      localStorage.removeItem('live_pos_mines_' + id);
      localStorage.removeItem('live_pos_payments_' + id);
      localStorage.removeItem('live_pos_customer_notes_' + id);
      localStorage.removeItem('live_pos_sequence_counter_' + id);
      localStorage.removeItem('live_pos_session_date_' + id);
      localStorage.removeItem('live_pos_session_start_' + id);
      localStorage.removeItem('live_pos_settings_' + id);

      profiles.value = profiles.value.filter(p => p.id !== id);
      safeSetItem('live_pos_profiles', profiles.value);

      if (activeProfileId.value === id) {
        activeProfileId.value = profiles.value[0].id;
        safeSetItem('live_pos_active_profile_id', activeProfileId.value);
        loadProfileData(activeProfileId.value);
        pushActiveProfileToSupabase(activeProfileId.value);
      }
      saveAll();
      profileEditModalOpen.value = false;
      showToast('Deleting business profile from cloud...');

      await deleteProfileFromSupabase(id);
      showToast('Business profile deleted across all devices');
    }

    function goToMining() {
      currentTab.value = 'mining';
      nextTick(() => {
        focusFirstMiningField();
      });
    }

    function printLastMinedSticker() {
      if (allMines.value.length === 0) {
        showToast('No mined items yet to reprint');
        return;
      }
      triggerStickerPrint(allMines.value[allMines.value.length - 1]);
    }

    const topBuyersList = computed(() => {
      return [...buyerBasketsList.value].sort((a, b) => b.totalAmount - a.totalAmount || b.items.length - a.items.length);
    });

    const avgMinePrice = computed(() => {
      if (allMines.value.length === 0) return 0;
      return Math.round(sessionStats.value.totalSales / allMines.value.length);
    });

    // PAYMENT MODAL STATE
    const paymentModalOpen = ref(false);
    const activePaymentBuyer = ref<BuyerBasket | null>(null);
    const paymentForm = reactive({
      amount: '' as string | number,
      method: 'GCash',
      ref: ''
    });

    function openPaymentModal(buyer: BuyerBasket) {
      activePaymentBuyer.value = buyer;
      paymentForm.amount = buyer.balance > 0 ? buyer.balance : '';
      paymentForm.method = 'GCash';
      paymentForm.ref = '';
      paymentModalOpen.value = true;
    }

    function closePaymentModal() {
      paymentModalOpen.value = false;
      activePaymentBuyer.value = null;
    }

    function recordPayment() {
      const amt = parseFloat(String(paymentForm.amount));
      if (isNaN(amt) || amt <= 0) {
        showToast('Please enter a valid payment amount');
        return;
      }
      if (!activePaymentBuyer.value) return;

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const todayDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const newPayment: PaymentRecord = {
        id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        buyer: activePaymentBuyer.value.handle,
        amount: amt,
        method: paymentForm.method,
        ref: paymentForm.ref.trim(),
        date: todayDate,
        time: timeStr,
        timestamp: Date.now()
      };

      allPayments.value.push(newPayment);
      saveAll();
      pushSinglePaymentToSupabase(newPayment, activeProfileId.value);
      playBeep('payment', settings.value.soundEnabled);
      showToast(`Recorded ₱${amt.toLocaleString()} (${paymentForm.method}) for ${activePaymentBuyer.value.handle}`);
      closePaymentModal();
    }

    function copyMessengerReceipt(buyer: BuyerBasket) {
      const lines: string[] = [];
      lines.push(`LIVE SALE INVOICE & RECEIPT`);
      lines.push(`----------------------------------------`);
      lines.push(`Customer: ${buyer.handle}`);
      lines.push(`Date: ${sessionDate.value} | ${activeProfile.value.name || settings.value.storeName}`);
      lines.push(`----------------------------------------`);
      lines.push(`MINED ITEMS (${buyer.items.length} pcs):`);
      buyer.items.forEach((item, i) => {
        const itemCode = item.controlCode || (item.controlNum ? '#' + item.controlNum : '');
        const desc = (item.description && item.description !== item.controlCode && item.description !== 'Decor') ? ` • ${item.description}` : '';
        lines.push(`  ${i + 1}. ${itemCode}${desc} - ${activeProfile.value.currency}${item.price.toLocaleString()}`);
      });
      lines.push(`----------------------------------------`);
      lines.push(`Subtotal: ${activeProfile.value.currency}${buyer.totalAmount.toLocaleString()}`);
      if (buyer.totalPaid > 0) {
        lines.push(`Payments Made: ${activeProfile.value.currency}${buyer.totalPaid.toLocaleString()}`);
      }
      if (buyer.balance > 0) {
        lines.push(`REMAINING BALANCE: ${activeProfile.value.currency}${buyer.balance.toLocaleString()} (OWING)`);
      } else if (buyer.balance < 0) {
        lines.push(`ACCOUNT CREDIT: ${activeProfile.value.currency}${Math.abs(buyer.balance).toLocaleString()}`);
      } else {
        lines.push(`STATUS: FULLY SETTLED / PAID`);
      }
      lines.push(`----------------------------------------`);
      lines.push(`PAYMENT ACCOUNTS:`);
      lines.push(activeProfile.value.paymentDetails || settings.value.paymentDetails);
      lines.push(`\nPlease send payment screenshot to confirm your parcel.`);
      lines.push(`Thank you!`);

      const receiptText = lines.join('\n');
      fallbackCopyText(receiptText, `Receipt copied for ${buyer.handle}`);
    }

    // PHOTO ZOOM MODAL
    const zoomModalOpen = ref(false);
    const zoomPhotoUrl = ref('');
    const zoomPhotoTitle = ref('');

    function openPhotoZoom(url: string, title = 'Item Photo Preview') {
      if (!url) return;
      zoomPhotoUrl.value = url;
      zoomPhotoTitle.value = title;
      zoomModalOpen.value = true;
    }

    function closePhotoZoom() {
      zoomModalOpen.value = false;
      zoomPhotoUrl.value = '';
      zoomPhotoTitle.value = '';
    }

    // CUSTOMER PUBLIC CHECKOUT VIEW & INVOICE LINK SHARING
    const isCustomerCheckoutView = ref(false);
    const customerCheckoutData = ref<BuyerBasket | null>(null);
    const customerCheckoutLoading = ref(false);
    const customerCheckoutError = ref('');

    function previewCustomerPage(buyer: BuyerBasket | string) {
      if (!buyer) return;
      let basket: BuyerBasket | undefined = typeof buyer === 'string'
        ? buyerBasketsList.value.find(b => b.handle === buyer || b.displayName === buyer)
        : buyer;

      if (!basket || !basket.items) {
        const handle = (typeof buyer === 'string') ? buyer : (buyer.handle || buyer.displayName || 'Customer');
        const matchingMines = allMines.value.filter(m => m.buyer === handle);
        const matchingPayments = allPayments.value.filter(p => p.buyer === handle);
        const totalAmt = matchingMines.reduce((sum, m) => sum + m.price, 0);
        const totalPaid = matchingPayments.reduce((sum, p) => sum + p.amount, 0);
        basket = {
          handle: handle,
          displayName: handle.replace(/^@+/, ''),
          items: matchingMines,
          payments: matchingPayments,
          totalAmount: totalAmt,
          totalPaid: totalPaid,
          balance: totalAmt - totalPaid,
          status: (totalAmt - totalPaid) <= 0 ? 'Paid' : 'Unpaid'
        };
      }
      customerCheckoutData.value = basket;
      isCustomerCheckoutView.value = true;
      invoiceModalOpen.value = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function copyInvoiceLink(buyer: BuyerBasket) {
      if (!buyer) return;
      const cleanName = (buyer.displayName || buyer.handle || 'customer').replace(/^@+/, '').trim();
      const itemCount = (buyer.items && buyer.items.length) ? buyer.items.length : 1;
      const sessionCode = sessionDate.value || '0911';
      const invoiceSlug = `INV-${sessionCode}-${cleanName.toUpperCase().replace(/\s+/g, '_')}`;
      const profileId = activeProfileId.value || 'prof_main';
      
      const origin = (window.location.origin && window.location.origin !== 'null' && !window.location.origin.includes('file:')) 
        ? window.location.origin 
        : window.location.href.split('#')[0].split('?')[0];

      const pathname = window.location.pathname || '/';
      // Include both query params AND hash for 100% compatibility across TikTok chat, Instagram, Safari, and Chrome
      const checkoutUrl = `${origin}${pathname}?buyer=${encodeURIComponent(cleanName)}&profile=${encodeURIComponent(profileId)}#/order/${invoiceSlug}`;

      const message = `Hi ${cleanName}! Thank you for mining with us tonight! 🎉 Here is your checkout link with all ${itemCount} item photos, total breakdown, and GCash details: ${checkoutUrl}. Please settle within 24 hours!`;

      fallbackCopyText(message, `Copied checkout link message for ${cleanName}!`);
    }

    async function resolveCustomerCheckoutFromUrl(forceFetch = false) {
      const urlParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash || '';

      let queryBuyer = urlParams.get('buyer') || urlParams.get('b') || urlParams.get('customer') || '';
      let queryProfile = urlParams.get('profile') || urlParams.get('p') || '';
      let queryOrder = urlParams.get('order') || urlParams.get('invoice') || '';

      if (!queryBuyer && !queryOrder && (hash.includes('/order/') || hash.includes('/invoice/'))) {
        const slug = hash.split('/order/')[1] || hash.split('/invoice/')[1] || '';
        queryOrder = decodeURIComponent(slug).trim();
      }

      if (!queryBuyer && !queryOrder) {
        return;
      }

      // Set customer view immediately to suppress merchant dashboard
      isCustomerCheckoutView.value = true;
      customerCheckoutLoading.value = true;
      customerCheckoutError.value = '';

      const normalize = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      let targetBuyerName = queryBuyer ? queryBuyer.trim().replace(/^@+/, '') : '';
      if (!targetBuyerName && queryOrder) {
        // INV-0911-MARIA_SANTOS -> MARIA_SANTOS -> Maria Santos
        const cleaned = queryOrder.replace(/^INV-[0-9]+-?/i, '');
        targetBuyerName = cleaned.replace(/_/g, ' ').trim();
      }

      const targetNormalized = normalize(targetBuyerName);

      // If target profile is specified, switch active profile
      if (queryProfile && profiles.value.some(p => p.id === queryProfile)) {
        if (activeProfileId.value !== queryProfile) {
          activeProfileId.value = queryProfile;
          loadProfileData(queryProfile);
        }
      }

      // 1. Try finding in local memory if already populated and not forceFetch
      if (!forceFetch) {
        const found = buyerBasketsList.value.find(b => {
          const bNormHandle = normalize(b.handle);
          const bNormName = normalize(b.displayName);
          return (
            (targetNormalized && (bNormHandle.includes(targetNormalized) || targetNormalized.includes(bNormHandle))) ||
            (targetNormalized && (bNormName.includes(targetNormalized) || targetNormalized.includes(bNormName)))
          );
        });

        if (found && found.items && found.items.length > 0) {
          customerCheckoutData.value = found;
          customerCheckoutLoading.value = false;
          return;
        }
      }

      // 2. Fetch directly from Supabase Cloud (essential when customer opens link from TikTok or fresh device)
      const targetProf = queryProfile || activeProfileId.value || 'prof_main';
      try {
        const client = getSupabaseClient();
        if (client && navigator.onLine) {
          const { data: remoteMines } = await client
            .from('mined_items')
            .select('*')
            .eq('profile_id', targetProf);

          const { data: remotePayments } = await client
            .from('customer_payments')
            .select('*')
            .eq('profile_id', targetProf);

          const cloudPhotos = await fetchCloudPhotosForProfile(targetProf);

          if (remoteMines && Array.isArray(remoteMines)) {
            const matchingMines: MinedItem[] = [];
            for (const rm of remoteMines) {
              const rowBuyerNorm = normalize(rm.buyer);
              if (rowBuyerNorm && (rowBuyerNorm.includes(targetNormalized) || targetNormalized.includes(rowBuyerNorm))) {
                const photo = cloudPhotos[rm.id] || rm.photo || '';
                const tag = rm.tag || '';
                const desc = (tag && tag !== rm.control_code && tag !== 'Decor') ? tag : (rm.description || '');
                matchingMines.push({
                  id: rm.id,
                  controlCode: rm.control_code || '',
                  controlNum: 0,
                  tag: tag,
                  description: desc,
                  price: Number(rm.price) || 0,
                  buyer: rm.buyer || '',
                  photo: photo,
                  date: rm.session_date || sessionDate.value,
                  time: '',
                  timestamp: Number(rm.timestamp) || Date.now()
                });
              }
            }

            if (matchingMines.length > 0) {
              const matchingPayments: PaymentRecord[] = [];
              if (remotePayments && Array.isArray(remotePayments)) {
                for (const rp of remotePayments) {
                  const pBuyerNorm = normalize(rp.buyer);
                  if (pBuyerNorm && (pBuyerNorm.includes(targetNormalized) || targetNormalized.includes(pBuyerNorm))) {
                    matchingPayments.push({
                      id: rp.id,
                      buyer: rp.buyer,
                      amount: Number(rp.amount) || 0,
                      method: rp.method || 'GCash',
                      ref: rp.reference || '',
                      date: '',
                      time: '',
                      timestamp: Number(rp.timestamp) || Date.now()
                    });
                  }
                }
              }

              const totalAmt = matchingMines.reduce((sum, m) => sum + m.price, 0);
              const totalPaid = matchingPayments.reduce((sum, p) => sum + p.amount, 0);
              const buyerHandle = matchingMines[0].buyer;

              customerCheckoutData.value = {
                handle: buyerHandle,
                displayName: buyerHandle.replace(/^@+/, ''),
                items: matchingMines,
                payments: matchingPayments,
                totalAmount: totalAmt,
                totalPaid: totalPaid,
                balance: totalAmt - totalPaid,
                status: (totalAmt - totalPaid) <= 0 ? 'Paid' : 'Unpaid'
              };
              customerCheckoutLoading.value = false;
              return;
            }
          }
        }
      } catch (cloudErr) {
        console.error('Error fetching customer checkout from Supabase:', cloudErr);
      }

      // 3. Fallback to local memory if Supabase returned no match or failed
      const fallback = buyerBasketsList.value.find(b => {
        const bNormHandle = normalize(b.handle);
        const bNormName = normalize(b.displayName);
        return (
          (targetNormalized && (bNormHandle.includes(targetNormalized) || targetNormalized.includes(bNormHandle))) ||
          (targetNormalized && (bNormName.includes(targetNormalized) || targetNormalized.includes(bNormName)))
        );
      });

      if (fallback && fallback.items && fallback.items.length > 0) {
        customerCheckoutData.value = fallback;
      } else {
        customerCheckoutError.value = `No mined items found for "${targetBuyerName}". If you mined during this live stream, please notify the seller to refresh your invoice.`;
      }
      customerCheckoutLoading.value = false;
    }

    function copyGcashInstructions() {
      const details = activeProfile.value.paymentDetails || settings.value.paymentDetails || 'GCash: 0917-123-4567 (Maria Santos)\nBDO: 1234-5678-9012 (Maria Santos)\nPlease send screenshot of proof of payment within 24 hours!';
      fallbackCopyText(details, 'GCash payment details copied!');
    }

    function fallbackCopyText(text: string, successToast = 'Copied to clipboard!') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          playBeep('success', settings.value.soundEnabled);
          showToast(successToast);
        }).catch(() => {
          execCommandCopy(text, successToast);
        });
      } else {
        execCommandCopy(text, successToast);
      }
    }

    function execCommandCopy(text: string, successToast: string) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        playBeep('success', settings.value.soundEnabled);
        showToast(successToast);
      } catch (e) {
        showToast('Text copied to clipboard');
      }
    }

    // 1-TAP PHOTO COLLAGE GENERATOR (HTML5 CANVAS)
    const collageModalOpen = ref(false);
    const collageBuyer = ref<BuyerBasket | null>(null);
    const collageDataUrl = ref('');
    const isGeneratingCollage = ref(false);

    async function generatePhotoCollage(buyer: BuyerBasket | string) {
      if (!buyer) return;
      let target: BuyerBasket | undefined = typeof buyer === 'string'
        ? buyerBasketsList.value.find(b => b.handle === buyer || b.displayName === buyer)
        : buyer;
      if (!target) return;

      collageBuyer.value = target;
      isGeneratingCollage.value = true;
      collageModalOpen.value = true;
      collageDataUrl.value = '';

      await nextTick();

      try {
        const url = await createPhotoCollageCanvas(target, activeProfile.value, sessionDate.value);
        collageDataUrl.value = url;
        isGeneratingCollage.value = false;
      } catch (err) {
        console.error('Collage generation error:', err);
        isGeneratingCollage.value = false;
        showToast('Could not compile collage');
      }
    }

    function downloadCollageImage() {
      if (!collageDataUrl.value || !collageBuyer.value) return;
      const cleanName = (collageBuyer.value.displayName || collageBuyer.value.handle || 'customer').replace(/^@+/, '');
      const link = document.createElement('a');
      link.download = `Mined_Photos_${cleanName}_${sessionDate.value}.png`;
      link.href = collageDataUrl.value;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      playBeep('success', settings.value.soundEnabled);
      showToast(`Downloaded photo collage for @${cleanName}`);
    }

    async function copyCollageImage() {
      if (!collageDataUrl.value) return;
      try {
        const res = await fetch(collageDataUrl.value);
        const blob = await res.blob();
        if (navigator.clipboard && (window as any).ClipboardItem) {
          await navigator.clipboard.write([new (window as any).ClipboardItem({ 'image/png': blob })]);
          playBeep('success', settings.value.soundEnabled);
          showToast('Photo collage image copied to clipboard!');
          return;
        }
      } catch (e) {
        console.warn('Direct image clipboard copy failed:', e);
      }
      downloadCollageImage();
    }

    // Overall Session Statistics
    const sessionStats = computed(() => {
      let totalSales = 0;
      for (const m of allMines.value) {
        totalSales += m.price;
      }
      let totalPayments = 0;
      for (const p of allPayments.value) {
        totalPayments += p.amount;
      }
      const totalBalance = totalSales - totalPayments;
      const uniqueBuyers = new Set(allMines.value.map(m => m.buyer)).size;

      return {
        totalMines: allMines.value.length,
        uniqueBuyers: uniqueBuyers,
        totalSales: totalSales,
        totalPayments: totalPayments,
        totalBalance: totalBalance
      };
    });

    const settingsModalOpen = ref(false);
    const appMenuOpen = ref(false);
    function openSettingsModal() {
      syncActiveStoreForm();
      settingsModalOpen.value = true;
      appMenuOpen.value = false;
    }
    async function saveSettings(showToastMessage = false) {
      safeSetItem('live_pos_settings', settings.value);
      try {
        await syncAppSettingsToSupabase(JSON.stringify(settings.value));
        if (settings.value.securityPin) {
          await syncSecurityPinToSupabase(settings.value.securityPin);
        }
      } catch (e) {
        console.warn('Sync settings error:', e);
      }
      if (showToastMessage) {
        showToast('Settings saved & synced across devices');
      }
    }

    function exportToCsv() {
      if (allMines.value.length === 0) {
        showToast('No mine records to export');
        return;
      }
      exportRawMinesUtil(allMines.value, sessionDate.value);
      showToast('Raw CSV exported');
    }

    function exportNotionCustomerBalancesCsv() {
      if (buyerBasketsList.value.length === 0) {
        showToast('No customer records to export');
        return;
      }
      exportNotionBalancesUtil(buyerBasketsList.value, customerNotes.value, sessionDate.value);
      showToast('Customer Balances CSV exported for Notion');
    }

    function exportNotionMinedItemsCsv() {
      if (allMines.value.length === 0) {
        showToast('No mined items to export');
        return;
      }
      exportNotionMinesUtil(allMines.value, sessionDate.value);
      showToast('Mined Items CSV exported for Notion');
    }

    function confirmNewSession() {
      if (!confirm('Start a new Live Selling session? This resets item counter and archives current session.')) {
        return;
      }
      const enteredDate = prompt('Enter Session Code (MMDD):', defaultSessionDate) || defaultSessionDate;
      const cleanDate = getFormattedSessionDate(enteredDate);
      sessionDate.value = cleanDate;
      sessionStartTime.value = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      sequenceCounter.value = 1;
      allMines.value = [];
      allPayments.value = [];
      customerNotes.value = {};
      saveAll();
      showToast(`Started new session #${cleanDate}`);
    }

    function clearAllData() {
      if (!confirm('Are you sure you want to clear all data in this browser?')) {
        return;
      }
      allMines.value = [];
      allPayments.value = [];
      customerNotes.value = {};
      sequenceCounter.value = 1;
      saveAll();
      showToast('All data cleared');
    }

    function loadSampleData() {
      allMines.value = getSampleMines(sessionDate.value);
      allPayments.value = getSamplePayments();
      customerNotes.value = { ...sampleCustomerNotes };
      sequenceCounter.value = 154;
      saveAll();
      showToast('Sample live selling data loaded with item photos!');
      settingsModalOpen.value = false;
    }

    // OFFLINE & PWA
    const isOnline = ref(navigator.onLine);
    const deferredPrompt = ref<any>(null);
    const isInstallable = ref(false);
    const isInstalled = ref(
      window.matchMedia('(display-mode: standalone)').matches || 
      ((window.navigator as any).standalone === true)
    );
    const isIOS = ref(/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()));
    const showIOSGuide = ref(false);

    window.addEventListener('online', () => {
      isOnline.value = true;
      showToast('Connection restored: Online');
    });

    window.addEventListener('offline', () => {
      isOnline.value = false;
      showToast('Offline Mode: All logs saved to device storage');
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt.value = e;
      isInstallable.value = true;
    });

    window.addEventListener('appinstalled', () => {
      isInstalled.value = true;
      isInstallable.value = false;
      deferredPrompt.value = null;
      showToast('Live POS installed successfully!');
    });

    async function promptPWAInstall() {
      if (!deferredPrompt.value) return;
      deferredPrompt.value.prompt();
      const { outcome } = await deferredPrompt.value.userChoice;
      if (outcome === 'accepted') {
        isInstalled.value = true;
        isInstallable.value = false;
        deferredPrompt.value = null;
        showToast('App installed to your home screen!');
      }
    }

    function downloadJsonBackup() {
      const backupData = {
        appName: 'Live Mining Web POS',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        profiles: profiles.value,
        activeProfileId: activeProfileId.value,
        sessionDate: sessionDate.value,
        sequenceCounter: sequenceCounter.value,
        sessionStartTime: sessionStartTime.value,
        settings: settings.value,
        customerNotes: customerNotes.value,
        allMines: allMines.value,
        allPayments: allPayments.value
      };
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backupData, null, 2));
      const dlAnchorElem = document.createElement('a');
      dlAnchorElem.setAttribute('href', dataStr);
      dlAnchorElem.setAttribute('download', `LivePOS_Backup_${sessionDate.value}_${Date.now()}.json`);
      document.body.appendChild(dlAnchorElem);
      dlAnchorElem.click();
      document.body.removeChild(dlAnchorElem);
      showToast('Offline backup JSON saved');
    }

    function restoreJsonBackup(event: Event) {
      const target = event.target as HTMLInputElement;
      const file = target.files && target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (Array.isArray(data.profiles) && data.profiles.length > 0) {
            profiles.value = data.profiles;
          }
          if (data.activeProfileId) {
            activeProfileId.value = data.activeProfileId;
          }
          if (Array.isArray(data.allMines)) {
            allMines.value = data.allMines;
          }
          if (Array.isArray(data.allPayments)) {
            allPayments.value = data.allPayments;
          }
          if (data.customerNotes && typeof data.customerNotes === 'object') {
            customerNotes.value = data.customerNotes;
          }
          if (data.sessionDate) {
            sessionDate.value = data.sessionDate;
          }
          if (data.sequenceCounter) {
            sequenceCounter.value = Number(data.sequenceCounter);
          }
          if (data.settings) {
            settings.value = { ...settings.value, ...data.settings };
          }
          saveAll();
          showToast(`Restored backup with ${allMines.value.length} items!`);
          settingsModalOpen.value = false;
        } catch (err) {
          alert('Invalid backup file. Could not restore.');
        }
      };
      reader.readAsText(file);
      target.value = '';
    }

    function saveAll() {
      saveProfileData(activeProfileId.value);
      localStorage.setItem('live_pos_profiles', JSON.stringify(profiles.value));
      localStorage.setItem('live_pos_active_profile_id', activeProfileId.value);
      saveSettings();
    }

    let autoSyncTimer: any = null;
    function restartAutoSync() {
      if (autoSyncTimer) {
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
      }
      const intervalVal = settings.value.syncInterval || '30s';
      const sec = intervalVal === '60s' ? 60 : (intervalVal === 'off' ? 0 : 30);
      if (sec > 0) {
        autoSyncTimer = setInterval(() => {
          if (navigator.onLine && supabaseStatus.value !== 'syncing' && document.visibilityState === 'visible') {
            syncAllWithSupabase(false);
          }
        }, sec * 1000);
      }
    }

    // =========================================================================
    // ANDROID HARDWARE / GESTURE BACK BUTTON & HISTORY NAVIGATION MANAGER
    // =========================================================================
    let isHandlingBackNav = false;
    let lastRootBackPressTime = 0;
    const tabHistory: string[] = [];
    let pushedOverlayCount = 0;
    let pushedTabCount = 0;

    function finishBackNav() {
      setTimeout(() => {
        isHandlingBackNav = false;
      }, 120);
    }

    function closeTopmostOverlay(): boolean {
      if (zoomModalOpen.value) {
        closePhotoZoom();
        return true;
      }
      if (showSaveProfileModal.value) {
        showSaveProfileModal.value = false;
        return true;
      }
      if (showPasteCoordinatesModal.value) {
        showPasteCoordinatesModal.value = false;
        return true;
      }
      if (showIOSGuide.value) {
        showIOSGuide.value = false;
        return true;
      }
      if (r2GuideModalOpen.value) {
        r2GuideModalOpen.value = false;
        return true;
      }
      if (collageModalOpen.value) {
        collageModalOpen.value = false;
        return true;
      }
      if (printerLayoutModalOpen.value) {
        printerLayoutModalOpen.value = false;
        return true;
      }
      if (paymentModalOpen.value) {
        paymentModalOpen.value = false;
        return true;
      }
      if (invoiceModalOpen.value) {
        invoiceModalOpen.value = false;
        return true;
      }
      if (profileEditModalOpen.value) {
        profileEditModalOpen.value = false;
        return true;
      }
      if (profileModalOpen.value) {
        profileModalOpen.value = false;
        return true;
      }
      if (settingsModalOpen.value) {
        settingsModalOpen.value = false;
        return true;
      }
      if (appMenuOpen.value) {
        appMenuOpen.value = false;
        return true;
      }
      if (isCustomerCheckoutView.value) {
        isCustomerCheckoutView.value = false;
        return true;
      }
      return false;
    }

    const openOverlayCount = computed(() => {
      let count = 0;
      if (zoomModalOpen.value) count++;
      if (showSaveProfileModal.value) count++;
      if (showPasteCoordinatesModal.value) count++;
      if (showIOSGuide.value) count++;
      if (r2GuideModalOpen.value) count++;
      if (collageModalOpen.value) count++;
      if (printerLayoutModalOpen.value) count++;
      if (paymentModalOpen.value) count++;
      if (invoiceModalOpen.value) count++;
      if (profileEditModalOpen.value) count++;
      if (profileModalOpen.value) count++;
      if (settingsModalOpen.value) count++;
      if (appMenuOpen.value) count++;
      if (isCustomerCheckoutView.value) count++;
      return count;
    });

    function setupAndroidBackNavigation() {
      if (typeof window === 'undefined' || !window.history || typeof window.history.pushState !== 'function') {
        return;
      }

      // Initialize base history state so pressing Android back doesn't immediately close the webview/app
      window.history.replaceState({ app: 'live_pos', isBase: true }, '');
      window.history.pushState({ app: 'live_pos', root: true, tab: currentTab.value }, '');

      // Watch modal overlays to push history entries or sync UI closes
      watch(openOverlayCount, (newCount, oldCount) => {
        if (isHandlingBackNav) return;
        if (newCount > oldCount) {
          const diff = newCount - oldCount;
          for (let i = 0; i < diff; i++) {
            pushedOverlayCount++;
            window.history.pushState({ app: 'live_pos', overlayLevel: pushedOverlayCount }, '');
          }
        } else if (newCount < oldCount) {
          // Overlays closed via UI buttons or backdrop clicks
          const diff = oldCount - newCount;
          const toPop = Math.min(diff, pushedOverlayCount);
          if (toPop > 0) {
            pushedOverlayCount -= toPop;
            isHandlingBackNav = true;
            for (let i = 0; i < toPop; i++) {
              window.history.back();
            }
            finishBackNav();
          }
        }
      });

      // Watch tab changes to remember previous tab in navigation history
      watch(currentTab, (newTab, oldTab) => {
        if (isHandlingBackNav) return;
        if (newTab !== oldTab) {
          if (oldTab && oldTab !== newTab) {
            if (tabHistory.length === 0 || tabHistory[tabHistory.length - 1] !== oldTab) {
              tabHistory.push(oldTab);
              if (tabHistory.length > 8) tabHistory.shift();
            }
          }
          if (newTab === 'dashboard') {
            tabHistory.length = 0;
            pushedTabCount = 0;
          } else {
            pushedTabCount++;
            window.history.pushState({ app: 'live_pos', tab: newTab }, '');
          }
        }
      });

      // Unified back button handler for Android popstate
      function handleBackAction() {
        if (isHandlingBackNav) {
          isHandlingBackNav = false;
          return;
        }

        isHandlingBackNav = true;

        // 1. Close any open modal overlay or subview first
        if (closeTopmostOverlay()) {
          if (pushedOverlayCount > 0) pushedOverlayCount--;
          finishBackNav();
          return;
        }

        // 2. If in Visual Designer Studio, exit back to previous tab
        if (currentTab.value === 'designer') {
          exitDesigner();
          if (pushedTabCount > 0) pushedTabCount--;
          finishBackNav();
          return;
        }

        // 3. Return to the previous tab if available
        if (tabHistory.length > 0) {
          const prev = tabHistory.pop();
          if (prev && prev !== currentTab.value) {
            currentTab.value = prev;
            if (pushedTabCount > 0) pushedTabCount--;
            finishBackNav();
            return;
          }
        } else if (currentTab.value !== 'dashboard') {
          currentTab.value = 'dashboard';
          pushedTabCount = 0;
          finishBackNav();
          return;
        }

        // 4. Root Screen (Dashboard with all modals closed):
        // Prevent accidental app closure: require double-tap back within 2 seconds
        finishBackNav();
        const now = Date.now();
        if (now - lastRootBackPressTime < 2000) {
          // Double-back confirmed: allow Android to exit app
          window.history.back();
        } else {
          lastRootBackPressTime = now;
          showToast('Press back again to exit LiveSeller POS');
          window.history.pushState({ app: 'live_pos', root: true, tab: 'dashboard' }, '');
        }
      }

      window.addEventListener('popstate', handleBackAction);

      // Support Cordova / Capacitor / WebView hardware backbutton event if present
      document.addEventListener('backbutton', (e: any) => {
        if (e && typeof e.preventDefault === 'function') {
          e.preventDefault();
        }
        handleBackAction();
      }, false);
    }

    onMounted(() => {
      initSavedLabelProfiles();
      setupAndroidBackNavigation();
      checkAndApplyDailyRollover();
      syncActiveStoreForm();
      nextTick(() => {
        focusFirstMiningField();
      });

      document.addEventListener('click', (e: any) => {
        if (!e.target.closest('.relative')) {
          buyerSuggestionsOpen.value = false;
        }
      });

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkAndApplyDailyRollover();
          if (navigator.onLine && supabaseStatus.value !== 'syncing') {
            syncAllWithSupabase(false);
          }
        }
      });

      window.addEventListener('online', () => {
        checkAndApplyDailyRollover();
        syncAllWithSupabase(false);
      });

      // Periodically check if midnight passed to roll date over smoothly
      setInterval(() => {
        checkAndApplyDailyRollover();
      }, 60000);

      restartAutoSync();

      resolveCustomerCheckoutFromUrl();
      window.addEventListener('hashchange', () => resolveCustomerCheckoutFromUrl());
      window.addEventListener('popstate', () => resolveCustomerCheckoutFromUrl());

      window.addEventListener('keydown', (e: KeyboardEvent) => {
        if (!isAdminAuthenticated.value && !isCustomerCheckoutView.value) {
          if (e.key >= '0' && e.key <= '9') {
            onKeypadPress(e.key);
          } else if (e.key === 'Backspace') {
            loginPinInput.value = loginPinInput.value.slice(0, -1);
          } else if (e.key === 'Enter') {
            verifyAdminPin();
          }
        }
      });

      if (navigator.onLine) {
        syncAllWithSupabase(false);
        fetchSecurityPinFromSupabase().then(cloudPin => {
          if (cloudPin && cloudPin.trim() !== '') {
            const clean = cloudPin.trim();
            adminPin.value = clean;
            settings.value.securityPin = clean;
            localStorage.setItem('live_pos_admin_pin', clean);
            safeSetItem('live_pos_settings', settings.value);
          }
        }).catch(() => {});
      }

      // Check if Cloudflare R2 is configured via server environment (.env)
      checkServerR2Status().then(status => {
        if (status.hasEnv) {
          serverR2Configured.value = true;
          serverR2Bucket.value = status.bucketName || '';
          serverR2PublicDomain.value = status.publicDomain || '';
        }
        if (isR2Ready.value) {
          autoMigrateBase64Photos();
        }
      }).catch(e => {
        console.warn('R2 server status check notice:', e);
      });

      // If auto-clean expired photos is enabled, run retention cleanup silently
      if (settings.value.autoCleanOldPhotos && settings.value.photoRetention && settings.value.photoRetention !== 'never') {
        setTimeout(() => {
          cleanupOldPhotos(false);
        }, 3000);
      }

      // Realtime subscription: sync immediately when any device undos or logs an item
      try {
        const client = getSupabaseClient();
        if (client && typeof client.channel === 'function') {
          client
            .channel('live_pos_realtime_sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'mined_items' }, () => {
              syncAllWithSupabase(false);
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_notes' }, () => {
              syncAllWithSupabase(false);
            })
            .subscribe();
        }
      } catch (e) {
        console.warn('Realtime subscription notice:', e);
      }
    });

    return {
      currentTab,
      profiles,
      activeProfileId,
      activeProfile,
      getProfileDotClass,
      getProfileBadgeClass,
      profilesOverview,
      switchProfile,
      profileModalOpen,
      profileEditModalOpen,
      editingProfileForm,
      openProfileModal,
      closeProfileModal,
      openAddProfileModal,
      openEditProfileModal,
      saveProfile,
      deleteProfile,
      goToMining,
      printLastMinedSticker,
      topBuyersList,
      avgMinePrice,
      sessionDate,
      sessionStartTime,
      sequenceCounter,
      nextControlCode,
      allMines,
      allPayments,
      settings,
      settingsTab,
      activeStoreForm,
      syncActiveStoreForm,
      saveActiveStoreSettings,
      saveSequenceForStore,
      saveSessionDateForStore,
      onSettingsStoreChange,
      playTestBeep,
      form,
      photoInputRef,
      triggerPhotoCapture,
      clearFormPhoto,
      handlePhotoUpload,
      zoomModalOpen,
      zoomPhotoUrl,
      zoomPhotoTitle,
      openPhotoZoom,
      closePhotoZoom,
      isCustomerCheckoutView,
      customerCheckoutData,
      customerCheckoutLoading,
      customerCheckoutError,
      resolveCustomerCheckoutFromUrl,
      isAdminAuthenticated,
      adminPin,
      showStaffLoginModal,
      loginPinInput,
      loginErrorMsg,
      rememberDevice,
      onKeypadPress,
      verifyAdminPin,
      lockPos,
      logout,
      changePinCurrent,
      changePinNew,
      changePinConfirm,
      changePinError,
      changePinSuccess,
      isSavingPin,
      showPinInSettings,
      changeStorePin,
      updateStorePasscode,
      previewCustomerPage,
      copyInvoiceLink,
      copyGcashInstructions,
      collageModalOpen,
      collageBuyer,
      collageDataUrl,
      isGeneratingCollage,
      generatePhotoCollage,
      downloadCollageImage,
      copyCollageImage,
      customerNotes,
      updateCustomerNote,
      descriptionInputRef,
      tagInputRef,
      priceInputRef,
      buyerInputRef,
      setDescriptionInputRef,
      setPriceInputRef,
      setBuyerInputRef,
      buyerSuggestionsOpen,
      filteredBuyerSuggestions,
      frequentBuyers,
      recentMines,
      toastMessage,
      toggleSound,
      quickPrefix,
      incrementTagNumber,
      focusDescriptionInput,
      focusPriceInput,
      focusBuyerInput,
      focusFirstMiningField,
      handleFieldEnter,
      getMiningFieldLabel,
      moveMiningField,
      resetMiningFieldOrder,
      handleBuyerInput,
      selectBuyer,
      logMine,
      undoMine,
      triggerStickerPrint,
      triggerPackingSlipPrint,
      directPrintStickerBt,
      directPrintPackingSlipBt,
      directPrintInvoiceBt,
      isWebBluetoothAvailable,
      btPrinterConnected,
      btPrinterConnecting,
      btPrinterName,
      connectBluetooth,
      disconnectBluetooth,
      testBluetoothPrint,
      printerLayoutModalOpen,
      activeLayoutTab,
      openPrinterLayoutModal,
      closePrinterLayoutModal,
      samplePreviewItem,
      samplePreviewBasket,
      testLabelPrint,
      calibratePt265Gap,
      testReceiptPrint,
      resetLabelLayout,
      resetReceiptLayout,
      activeStickerToPrint,
      activePackingSlipToPrint,
      activeInvoiceToPrint,
      customerViewMode,
      allExpanded,
      toggleAllCustomerItems,
      invoiceModalOpen,
      activeInvoiceBuyer,
      openInvoiceModal,
      closeInvoiceModal,
      triggerInvoicePrint,
      buyerSearchQuery,
      buyerFilterStatus,
      buyerBasketsList,
      filteredBuyerBaskets,
      minedItemsSearchQuery,
      minedItemsFilterCategory,
      minedItemsFilterDate,
      minedItemsCustomDate,
      uniqueMinedDates,
      filteredMinedItems,
      openInvoiceForBuyer,
      owingBuyersCount,
      settledBuyersCount,
      creditBuyersCount,
      getStatusText,
      getStatusBadgeClass,
      getBalanceColorClass,
      paymentModalOpen,
      activePaymentBuyer,
      paymentForm,
      openPaymentModal,
      closePaymentModal,
      recordPayment,
      copyMessengerReceipt,
      sessionStats,
      settingsModalOpen,
      appMenuOpen,
      openSettingsModal,
      saveSettings,
      exportToCsv,
      exportNotionCustomerBalancesCsv,
      exportNotionMinedItemsCsv,
      confirmNewSession,
      clearAllData,
      loadSampleData,
      isOnline,
      isInstallable,
      isInstalled,
      isIOS,
      showIOSGuide,
      promptPWAInstall,
      downloadJsonBackup,
      restoreJsonBackup,
      supabaseStatus,
      supabaseSyncMessage,
      lastSyncedAt,
      syncAllWithSupabase,
      pushAllToSupabase,
      restartAutoSync,
      pushProfileToSupabase,
      pushActiveProfileToSupabase,
      r2Form,
      r2Status,
      r2StatusMessage,
      r2GuideModalOpen,
      r2Testing,
      isR2Ready,
      serverR2Configured,
      serverR2Bucket,
      serverR2PublicDomain,
      currentAppOrigin,
      totalPhotosCount,
      legacyBase64PhotosCount,
      saveR2Settings,
      testR2Connection,
      migrateLegacyPhotosToR2,
      autoMigrateBase64Photos,
      photoRetentionDays,
      oldPhotosCount,
      cleanupOldPhotos,
      samplePreviewQrDataUrl,
      updateSamplePreviewQr,
      applyReferenceLabelPreset,
      designerMode,
      designerSelectedId,
      designerCanvasZoom,
      designerShowGrid,
      designerSnapGrid,
      designerShowSampleData,
      designerIsDragging,
      designerCanvasWidth,
      designerCanvasHeight,
      labelElementsList,
      selectedLabelElement,
      receiptSectionsList,
      selectedReceiptSection,
      selectDesignerElement,
      onElementPointerDown,
      alignSelectedElement,
      nudgeSelectedElement,
      toggleElementVisibility,
      applyDesignerLabelPreset,
      moveReceiptSection,
      toggleReceiptSectionVisibility,
      toggleReceiptDivider,
      resetReceiptDesigner,
      previousTab,
      openDesigner,
      exitDesigner,
      savedLabelProfiles,
      activeLabelProfileId,
      showSaveProfileModal,
      newProfileName,
      showPasteCoordinatesModal,
      pasteCoordinatesText,
      loadLabelProfile,
      openSaveProfileModal,
      confirmSaveCurrentLabelProfile,
      deleteUserLabelProfile,
      downloadLabelCoordinates,
      copyLabelCoordinatesJson,
      handleProfileFileImport,
      onProfileFileInputChange,
      onProfileFileDrop,
      loadCoordinatesFromJsonString,
      setElementAlign
    };
  }
});

try {
  (window as any).posApp = app.mount('#app');
} catch (mountErr) {
  console.error('Fatal Vue mount error:', mountErr);
  const appEl = document.getElementById('app');
  if (appEl) appEl.removeAttribute('v-cloak');
}

export default app;
