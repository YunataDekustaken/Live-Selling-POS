import { createApp, ref, reactive, computed, onMounted, nextTick } from 'vue';
import type { Profile, MinedItem, PaymentRecord, BuyerBasket, AppSettings, ActiveStoreForm, LiveMiningForm } from './types';
import { defaultProfiles } from './data/defaultProfiles';
import { defaultSettings } from './data/defaultSettings';
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
  pushSinglePaymentToSupabase,
  pushCustomerNoteToSupabase
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
  getConnectedPrinterName
} from './utils/bluetoothPrinter';

const app = createApp({
  setup() {
    // App Navigation: Default to Home Dashboard
    const currentTab = ref('dashboard'); // 'dashboard', 'mining', 'balances', 'mined_items'

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
          defaultCategories: Array.isArray(found.defaultCategories) && found.defaultCategories.length > 0 ? found.defaultCategories : ['General', 'Decor']
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
          defaultCategories: Array.isArray(first.defaultCategories) && first.defaultCategories.length > 0 ? first.defaultCategories : ['General', 'Decor']
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

    // Core Data Stores (Profile-isolated)
    const allMines = ref<MinedItem[]>(
      safeParseJson(safeGetItem('live_pos_mines_' + activeProfileId.value) || safeGetItem('live_pos_mines'), [])
    );
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
    const settings = ref<AppSettings>(initialSettings);

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
      activeStoreForm.defaultCategoriesText = Array.isArray(p.defaultCategories) ? p.defaultCategories.join(', ') : 'General, Decor';
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

    function triggerPhotoCapture() {
      if (photoInputRef.value) {
        photoInputRef.value.click();
      }
    }

    function clearFormPhoto() {
      form.photo = '';
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
          const maxDim = 800;
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
            form.photo = canvas.toDataURL('image/jpeg', 0.80);
            showToast('Photo attached for this item! 📸');
            playBeep('success', settings.value.soundEnabled);
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

        if (allMines.value.length > 0) {
          const minePayloads = allMines.value.map(m => ({
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
        // 1. Synchronize cloud deletion tombstones across devices
        const cloudDeleted = await fetchCloudDeletedProfiles();
        const localDeleted = safeParseJson(safeGetItem('live_pos_deleted_profile_ids'), []);
        const deletedIds = new Set<string>([...localDeleted, ...cloudDeleted]);
        safeSetItem('live_pos_deleted_profile_ids', Array.from(deletedIds));

        // 2. Immediately purge any deleted profiles from local state
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

        if (remoteMines && !mErr) {
          const localMap = new Map(allMines.value.map(m => [m.id, m]));
          for (const rm of remoteMines) {
            if (!localMap.has(rm.id)) {
              localMap.set(rm.id, {
                id: rm.id,
                controlCode: rm.control_code || '',
                controlNum: 0,
                tag: rm.tag || '',
                description: 'Decor',
                price: Number(rm.price) || 0,
                buyer: rm.buyer || '',
                date: rm.session_date || sessionDate.value,
                time: '',
                timestamp: Number(rm.timestamp) || Date.now()
              });
            }
          }
          allMines.value = Array.from(localMap.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
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
            if (rn.buyer && !rn.buyer.startsWith('__')) {
              if (!customerNotes.value[rn.buyer]) {
                customerNotes.value[rn.buyer] = rn.notes || '';
              }
            }
          }
        }

        saveProfileData(activeProfileId.value);

        const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        lastSyncedAt.value = nowTime;
        localStorage.setItem('live_pos_last_synced', nowTime);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = `${profiles.value.length} profiles, ${allMines.value.length} items & ${allPayments.value.length} payments in sync`;

        if (showNotification) {
          playBeep('success', settings.value.soundEnabled);
          showToast(`Supabase synced: ${profiles.value.length} profiles, ${allMines.value.length} items, ${allPayments.value.length} payments`);
        }
      } catch (err) {
        console.error('Supabase sync error:', err);
        supabaseStatus.value = 'connected';
        supabaseSyncMessage.value = 'Sync active (auto-retrying)';
        if (showNotification) showToast('Sync notice: check connection');
      }
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
        logMine();
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

    async function directPrintStickerBt(mine: MinedItem) {
      if (!btPrinterConnected.value) {
        await connectBluetooth();
        if (!btPrinterConnected.value) return;
      }
      try {
        const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
        await printDirectSticker(mine, activeProfile.value, sessionDate.value, cols);
        showToast(`Sticker printed to PT-210`);
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
        const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
        await printDirectPackingSlip(basket, activeProfile.value, sessionDate.value, cols);
        showToast(`Packing slip printed to PT-210`);
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
        const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
        await printDirectInvoice(buyer, activeProfile.value, sessionDate.value, cols);
        showToast(`Invoice printed to PT-210`);
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
      if (settings.value.escPosDirectPrint && btPrinterConnected.value) {
        try {
          const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
          await printDirectInvoice(buyer, activeProfile.value, sessionDate.value, cols);
          showToast(`Invoice printed to PT-210`);
          return;
        } catch (err: any) {
          console.warn('Bluetooth invoice print notice, falling back to system print:', err);
        }
      }
      activeInvoiceToPrint.value = buyer;
      activeStickerToPrint.value = null;
      activePackingSlipToPrint.value = null;
      document.body.classList.remove('printing-packing-slip');
      nextTick(() => {
        window.print();
      });
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

      const newMine: MinedItem = {
        id: 'mine_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        controlCode: controlCode,
        controlNum: currentControlNum,
        tag: tag,
        description: description,
        price: price,
        buyer: buyer,
        photo: form.photo || '',
        date: todayDate,
        time: timeStr,
        timestamp: Date.now()
      };

      allMines.value.push(newMine);
      // Advance counter to next guaranteed unique slot
      sequenceCounter.value = getNextUniqueSequenceNumber(currentControlNum + 1, allMines.value, prefix, dateStr);
      saveAll();
      pushSingleMineToSupabase(newMine, activeProfileId.value, sessionDate.value);

      playBeep('success', settings.value.soundEnabled);

      const descSummary = description ? ` • ${description}` : '';
      const photoIndicator = form.photo ? ' 📸' : '';
      showToast(`Logged ${controlCode}${descSummary}${photoIndicator} • ${buyer} (${activeProfile.value.currency}${price.toLocaleString()})`);

      if (settings.value.autoPrint) {
        triggerStickerPrint(newMine);
      }

      form.description = '';
      form.photo = '';
      if (photoInputRef.value) {
        photoInputRef.value.value = '';
      }

      buyerSuggestionsOpen.value = false;
      const order = settings.value.miningFieldsOrder || ['customer', 'description', 'price'];
      const nonCustomerField = order.find(k => k !== 'customer') || order[0];
      if (nonCustomerField === 'description') {
        focusDescriptionInput();
      } else if (nonCustomerField === 'price') {
        focusPriceInput();
      } else {
        focusFirstMiningField();
      }
    }

    function undoMine(mine: MinedItem) {
      const itemLabel = mine.description ? `${mine.controlCode} (${mine.description})` : mine.controlCode;
      if (!confirm(`Cancel and delete ${itemLabel} for ${mine.buyer} - ${activeProfile.value.currency}${mine.price}?`)) {
        return;
      }
      allMines.value = allMines.value.filter(m => m.id !== mine.id);
      saveAll();
      deleteSingleMineFromSupabase(mine.id);
      playBeep('undo', settings.value.soundEnabled);
      showToast(`Removed ${itemLabel}`);
    }

    async function triggerStickerPrint(mine: MinedItem) {
      if (settings.value.escPosDirectPrint && btPrinterConnected.value) {
        try {
          const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
          await printDirectSticker(mine, activeProfile.value, sessionDate.value, cols);
          showToast(`Sticker printed to PT-210`);
          return;
        } catch (err: any) {
          console.warn('Bluetooth sticker print notice, falling back to system print:', err);
        }
      }
      activeStickerToPrint.value = mine;
      activePackingSlipToPrint.value = null;
      activeInvoiceToPrint.value = null;
      document.body.classList.remove('printing-packing-slip');
      nextTick(() => {
        window.print();
      });
    }

    async function triggerPackingSlipPrint(basket: BuyerBasket) {
      if (settings.value.escPosDirectPrint && btPrinterConnected.value) {
        try {
          const cols = settings.value.printerPaperWidth === '80mm' ? 48 : 32;
          await printDirectPackingSlip(basket, activeProfile.value, sessionDate.value, cols);
          showToast(`Packing slip printed to PT-210`);
          return;
        } catch (err: any) {
          console.warn('Bluetooth packing slip print notice, falling back to system print:', err);
        }
      }
      activePackingSlipToPrint.value = basket;
      activeStickerToPrint.value = null;
      activeInvoiceToPrint.value = null;
      document.body.classList.add('printing-packing-slip');
      nextTick(() => {
        window.print();
      });
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
        list = list.filter(item => (item.description || 'Decor').toLowerCase() === cat);
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
        const storedMines = safeGetItem('live_pos_mines_' + profId);
        if (storedMines) {
          allMines.value = safeParseJson(storedMines as string, []);
        } else if (profId === 'prof_main') {
          const legacyMines = safeGetItem('live_pos_mines');
          allMines.value = legacyMines ? safeParseJson(legacyMines as string, []) : [];
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
        const desc = item.description ? ` (${item.description})` : '';
        lines.push(`  ${i + 1}. ${item.controlCode} • Tag: ${item.tag}${desc} - ${activeProfile.value.currency}${item.price.toLocaleString()}`);
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
      const sessionCode = sessionDate.value || '0905';
      const invoiceSlug = `INV-${sessionCode}-${cleanName.toUpperCase().replace(/\s+/g, '_')}`;
      
      const origin = (window.location.origin && window.location.origin !== 'null' && !window.location.origin.includes('file:')) 
        ? window.location.origin 
        : 'https://yourapp.vercel.app';
      const checkoutUrl = `${origin}${window.location.pathname}#/order/${invoiceSlug}`;

      const message = `Hi ${cleanName}! Thank you for mining with us tonight! 🎉 Here is your checkout link with all ${itemCount} item photos, total breakdown, and GCash details: ${checkoutUrl}. Please settle within 24 hours!`;

      fallbackCopyText(message, `Copied checkout link message for ${cleanName}!`);
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
    function saveSettings(showToastMessage = false) {
      safeSetItem('live_pos_settings', settings.value);
      if (showToastMessage) {
        showToast('Overall settings saved');
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

    onMounted(() => {
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

      function checkUrlHashForCheckout() {
        const hash = window.location.hash || '';
        if (hash.includes('/order/') || hash.includes('/invoice/')) {
          const parts = hash.split('/order/')[1] || hash.split('/invoice/')[1] || '';
          const code = decodeURIComponent(parts).trim();
          if (code) {
            const found = buyerBasketsList.value.find(b => {
              const clean = (b.displayName || b.handle).replace(/^@+/, '').toLowerCase();
              return code.toLowerCase().includes(clean) || clean.includes(code.toLowerCase());
            });
            if (found) {
              previewCustomerPage(found);
            }
          }
        }
      }

      checkUrlHashForCheckout();
      window.addEventListener('hashchange', checkUrlHashForCheckout);

      if (navigator.onLine) {
        syncAllWithSupabase(false);
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
      pushActiveProfileToSupabase
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
