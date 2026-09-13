import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { BUILTIN_CONTENT, BUILTIN_CONTENT_VERSION, DEFAULT_REWARDS } from './content';
import { ensureContentAge } from './content-library';
import type {
  AppData,
  BackupEnvelopeV1,
  CompletionEvent,
  ContentItem,
  ContentPackRecord,
  ContentPackV1,
  DailyPlan,
  DailyReport,
  ParentSettings,
  PetState,
  Redemption,
  RewardDefinition,
  RewardLedgerEntry
} from './types';
import { DEFAULT_DAILY_CONTENT_COUNTS } from './types';

interface LexueDB extends DBSchema {
  settings: { key: string; value: ParentSettings };
  content: { key: string; value: ContentItem; indexes: { 'by-module': string } };
  plans: { key: string; value: DailyPlan };
  completions: { key: string; value: CompletionEvent; indexes: { 'by-date': string; 'by-module': string } };
  ledger: { key: string; value: RewardLedgerEntry; indexes: { 'by-date': string; 'by-source': string } };
  pet: { key: string; value: PetState };
  redemptions: { key: string; value: Redemption; indexes: { 'by-status': string } };
  reports: { key: string; value: DailyReport };
  contentPacks: { key: string; value: ContentPackRecord };
  rewardDefinitions: { key: string; value: RewardDefinition };
}

export const DEFAULT_SETTINGS: ParentSettings = {
  childName: '乐乐',
  activeWeekdays: [1, 2, 3, 4, 5],
  enabledModules: ['guoxue', 'literacy', 'math', 'english', 'writing', 'science'],
  dailyContentCounts: DEFAULT_DAILY_CONTENT_COUNTS,
  soundEnabled: true,
  reduceMotion: false,
  petId: 'stella'
};

export const DEFAULT_PARENT_PIN = '2580';
const PIN_POLICY_VERSION = 1;

const DB_NAME = 'lexue-workbench';
let databasePromise: Promise<IDBPDatabase<LexueDB>> | undefined;

function database(): Promise<IDBPDatabase<LexueDB>> {
  if (!databasePromise) {
    databasePromise = openDB<LexueDB>(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore('settings');
        const content = db.createObjectStore('content', { keyPath: 'id' });
        content.createIndex('by-module', 'module');
        db.createObjectStore('plans', { keyPath: 'date' });
        const completions = db.createObjectStore('completions', { keyPath: 'id' });
        completions.createIndex('by-date', 'date');
        completions.createIndex('by-module', 'module');
        const ledger = db.createObjectStore('ledger', { keyPath: 'id' });
        ledger.createIndex('by-date', 'date');
        ledger.createIndex('by-source', 'sourceId');
        db.createObjectStore('pet', { keyPath: 'id' });
        const redemptions = db.createObjectStore('redemptions', { keyPath: 'id' });
        redemptions.createIndex('by-status', 'status');
        db.createObjectStore('reports', { keyPath: 'date' });
        db.createObjectStore('contentPacks', { keyPath: 'id' });
        db.createObjectStore('rewardDefinitions', { keyPath: 'id' });
      }
    });
  }
  return databasePromise;
}

export async function seedDatabase(): Promise<void> {
  const db = await database();
  const storedSettings = await db.get('settings', 'parent');
  if (!storedSettings || storedSettings.pinPolicyVersion !== PIN_POLICY_VERSION) {
    const salt = randomSalt();
    await db.put('settings', {
      ...DEFAULT_SETTINGS,
      ...storedSettings,
      pinPolicyVersion: PIN_POLICY_VERSION,
      pinSalt: salt,
      pinHash: await hashPin(DEFAULT_PARENT_PIN, salt)
    }, 'parent');
  }
  const currentSettings = await db.get('settings', 'parent');
  if (currentSettings && (!currentSettings.dailyContentCounts || Object.keys(DEFAULT_DAILY_CONTENT_COUNTS).some((module) => currentSettings.dailyContentCounts?.[module as keyof typeof DEFAULT_DAILY_CONTENT_COUNTS] === undefined))) {
    await db.put('settings', {
      ...currentSettings,
      dailyContentCounts: { ...DEFAULT_DAILY_CONTENT_COUNTS, ...currentSettings.dailyContentCounts }
    }, 'parent');
  }
  const builtInPack = await db.get('contentPacks', 'builtin-curriculum');
  if (builtInPack?.contentVersion !== BUILTIN_CONTENT_VERSION) {
    const tx = db.transaction(['content', 'contentPacks'], 'readwrite');
    for (const item of BUILTIN_CONTENT) await tx.objectStore('content').put(item);
    await tx.objectStore('contentPacks').put({
      id: 'builtin-curriculum',
      title: '乐学内置扩展课程',
      contentVersion: BUILTIN_CONTENT_VERSION,
      importedAt: new Date().toISOString(),
      itemCount: BUILTIN_CONTENT.length
    });
    await tx.done;
  }
  const contentWithoutAge = (await db.getAll('content')).filter((item) => !item.ageMin || !item.ageMax);
  if (contentWithoutAge.length) {
    const tx = db.transaction('content', 'readwrite');
    for (const item of contentWithoutAge) await tx.store.put(ensureContentAge(item));
    await tx.done;
  }
  if ((await db.count('rewardDefinitions')) === 0) {
    const tx = db.transaction('rewardDefinitions', 'readwrite');
    await Promise.all([...DEFAULT_REWARDS.map((reward) => tx.store.put(reward)), tx.done]);
  }
  if (!(await db.get('pet', 'current'))) {
    await db.put('pet', { id: 'current', selected: 'stella', mood: 80, fedCount: 0 });
  }
}

export async function loadAppData(): Promise<AppData> {
  await seedDatabase();
  const db = await database();
  const [settings, content, plans, completions, ledger, pet, redemptions, reports, contentPacks, rewardDefinitions] = await Promise.all([
    db.get('settings', 'parent'), db.getAll('content'), db.getAll('plans'), db.getAll('completions'), db.getAll('ledger'),
    db.get('pet', 'current'), db.getAll('redemptions'), db.getAll('reports'), db.getAll('contentPacks'), db.getAll('rewardDefinitions')
  ]);
  return {
    settings: settings ?? DEFAULT_SETTINGS,
    content,
    plans,
    completions,
    ledger,
    pet: pet ?? { id: 'current', selected: 'stella', mood: 80, fedCount: 0 },
    redemptions,
    reports,
    contentPacks,
    rewardDefinitions
  };
}

export async function saveSettings(settings: ParentSettings): Promise<void> {
  await (await database()).put('settings', settings, 'parent');
}

export async function savePlan(plan: DailyPlan): Promise<void> {
  await (await database()).put('plans', plan);
}

export async function saveCompletion(event: CompletionEvent, rewards: RewardLedgerEntry[]): Promise<void> {
  const db = await database();
  const tx = db.transaction(['completions', 'ledger'], 'readwrite');
  await tx.objectStore('completions').put(event);
  for (const reward of rewards) await tx.objectStore('ledger').put(reward);
  await tx.done;
}

export async function saveLedgerEntries(entries: RewardLedgerEntry[]): Promise<void> {
  const tx = (await database()).transaction('ledger', 'readwrite');
  for (const entry of entries) await tx.store.put(entry);
  await tx.done;
}

export async function savePet(pet: PetState): Promise<void> {
  await (await database()).put('pet', pet);
}

export async function saveRedemption(redemption: Redemption): Promise<void> {
  await (await database()).put('redemptions', redemption);
}

export async function saveRewardDefinition(reward: RewardDefinition): Promise<void> {
  await (await database()).put('rewardDefinitions', reward);
}

export async function saveReport(report: DailyReport): Promise<void> {
  await (await database()).put('reports', report);
}

export async function saveContentItem(item: ContentItem): Promise<void> {
  await (await database()).put('content', ensureContentAge(item));
}

export async function deleteContentItem(id: string): Promise<void> {
  await (await database()).delete('content', id);
}

export async function importContentPack(pack: ContentPackV1): Promise<ContentPackRecord> {
  const db = await database();
  const existingIds = new Set((await db.getAllKeys('content')).map(String));
  const duplicate = pack.items.find((item) => existingIds.has(item.id));
  if (duplicate) throw new Error(`内容 id 已存在：${duplicate.id}`);
  const record: ContentPackRecord = {
    id: pack.id, title: pack.title, contentVersion: pack.contentVersion,
    importedAt: new Date().toISOString(), itemCount: pack.items.length
  };
  const tx = db.transaction(['content', 'contentPacks'], 'readwrite');
  for (const item of pack.items) await tx.objectStore('content').put(ensureContentAge({ ...item, source: 'imported' }));
  await tx.objectStore('contentPacks').put(record);
  await tx.done;
  return record;
}

export function createBackup(data: AppData): BackupEnvelopeV1 {
  return { schemaVersion: 1, app: 'lexue-workbench', exportedAt: new Date().toISOString(), data };
}

export async function restoreBackup(backup: BackupEnvelopeV1): Promise<void> {
  const db = await database();
  const tx = db.transaction([
    'settings', 'content', 'plans', 'completions', 'ledger', 'pet', 'redemptions', 'reports', 'contentPacks', 'rewardDefinitions'
  ], 'readwrite');
  await Promise.all([
    tx.objectStore('settings').clear(), tx.objectStore('content').clear(), tx.objectStore('plans').clear(),
    tx.objectStore('completions').clear(), tx.objectStore('ledger').clear(), tx.objectStore('pet').clear(),
    tx.objectStore('redemptions').clear(), tx.objectStore('reports').clear(), tx.objectStore('contentPacks').clear(),
    tx.objectStore('rewardDefinitions').clear()
  ]);
  await tx.objectStore('settings').put(backup.data.settings, 'parent');
  for (const value of backup.data.content) await tx.objectStore('content').put(ensureContentAge(value));
  for (const value of backup.data.plans) await tx.objectStore('plans').put(value);
  for (const value of backup.data.completions) await tx.objectStore('completions').put(value);
  for (const value of backup.data.ledger) await tx.objectStore('ledger').put(value);
  await tx.objectStore('pet').put(backup.data.pet);
  for (const value of backup.data.redemptions) await tx.objectStore('redemptions').put(value);
  for (const value of backup.data.reports) await tx.objectStore('reports').put(value);
  for (const value of backup.data.contentPacks) await tx.objectStore('contentPacks').put(value);
  for (const value of backup.data.rewardDefinitions) await tx.objectStore('rewardDefinitions').put(value);
  await tx.done;
}

export async function clearUserData(): Promise<void> {
  const db = await database();
  for (const store of ['plans', 'completions', 'ledger', 'redemptions', 'reports'] as const) await db.clear(store);
  await db.put('pet', { id: 'current', selected: 'stella', mood: 80, fedCount: 0 });
}

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

export function randomSalt(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100_000, hash: 'SHA-256' },
    material,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}
