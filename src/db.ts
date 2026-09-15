import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
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
import { DEFAULT_DAILY_CONTENT_COUNTS, type LearningEvent, type LearningAction } from './types';
import { applyLearningAction, ensureTodayPlan } from './learning';
import { calculateWallet, localDateKey, regenerateDailyPlanForSettings } from './logic';
import { assertContent, validateBackup, validateContentPack, validateSettings } from './validation';

interface LexueDB extends DBSchema {
  learningEvents: { key: string; value: LearningEvent };
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
  childAge: 4,
  mathStartStage: 1,
  englishStart: 'letters',
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
    databasePromise = openDB<LexueDB>(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 2) db.createObjectStore('learningEvents', { keyPath: 'id' });
        if (oldVersion >= 1) return;
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
  if (currentSettings && (
    !currentSettings.dailyContentCounts
    || Object.keys(DEFAULT_DAILY_CONTENT_COUNTS).some((module) => currentSettings.dailyContentCounts?.[module as keyof typeof DEFAULT_DAILY_CONTENT_COUNTS] === undefined)
    || currentSettings.childAge === undefined
    || currentSettings.mathStartStage === undefined
    || currentSettings.englishStart === undefined
  )) {
    await db.put('settings', {
      ...currentSettings,
      dailyContentCounts: { ...DEFAULT_DAILY_CONTENT_COUNTS, ...currentSettings.dailyContentCounts },
      childAge: currentSettings.childAge ?? 4,
      mathStartStage: currentSettings.mathStartStage ?? 1,
      englishStart: currentSettings.englishStart ?? 'letters'
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

const STORES = ['settings', 'content', 'plans', 'completions', 'ledger', 'pet', 'redemptions', 'reports', 'contentPacks', 'rewardDefinitions', 'learningEvents'] as const;
type DataTransaction = IDBPTransaction<LexueDB, typeof STORES, 'readwrite'>;

async function snapshot(tx: DataTransaction): Promise<AppData> {
  const [settings, content, plans, completions, ledger, pet, redemptions, reports, contentPacks, rewardDefinitions, learningEvents] = await Promise.all([
    tx.objectStore('settings').get('parent'), tx.objectStore('content').getAll(), tx.objectStore('plans').getAll(),
    tx.objectStore('completions').getAll(), tx.objectStore('ledger').getAll(), tx.objectStore('pet').get('current'),
    tx.objectStore('redemptions').getAll(), tx.objectStore('reports').getAll(), tx.objectStore('contentPacks').getAll(),
    tx.objectStore('rewardDefinitions').getAll(), tx.objectStore('learningEvents').getAll()
  ]);
  return { settings: settings ?? DEFAULT_SETTINGS, content, plans, completions, ledger,
    pet: pet ?? { id: 'current', selected: 'stella', mood: 80, fedCount: 0 }, redemptions, reports, contentPacks, rewardDefinitions, learningEvents };
}

async function persistSnapshot(tx: DataTransaction, next: AppData, previous?: AppData) {
  if (next.settings !== previous?.settings) await tx.objectStore('settings').put(next.settings, 'parent');
  if (next.pet !== previous?.pet) await tx.objectStore('pet').put(next.pet);
  for (const store of ['content', 'plans', 'completions', 'ledger', 'redemptions', 'reports', 'contentPacks', 'rewardDefinitions', 'learningEvents'] as const) {
    if (next[store] === previous?.[store]) continue;
    const old = new Set<unknown>(previous?.[store] ?? []);
    for (const value of next[store] ?? []) if (!old.has(value)) await tx.objectStore(store).put(value);
  }
}

// 在同一事务中读取最新状态并写入，避免连点和多标签页用旧余额覆盖新数据。
export async function mutateAppData(update: (data: AppData) => AppData): Promise<AppData> {
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    const previous = await snapshot(tx);
    const next = update(previous);
    await persistSnapshot(tx, next, previous);
    await tx.done;
    return next;
  } catch (error) {
    try { tx.abort(); } catch { /* 事务可能已经自动中止。 */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function loadAppData(date = localDateKey()): Promise<AppData> {
  await seedDatabase();
  return mutateAppData(data => ensureTodayPlan(data, date));
}

export async function recordLearning(taskId: string, itemId: string, action: LearningAction): Promise<AppData> {
  return mutateAppData(data => applyLearningAction(data, taskId, itemId, action));
}

export async function updateLearningSettings(settings: ParentSettings): Promise<AppData> {
  if (!validateSettings(settings)) throw new Error('学习设置无效，请检查年龄和学习起点');
  return mutateAppData(data => {
    const date = localDateKey();
    const prepared = ensureTodayPlan(data, date);
    const plan = regenerateDailyPlanForSettings(date, settings, data.content, data.completions,
      prepared.plans.find(plan => plan.date === date), data.settings, prepared.learningEvents);
    return { ...prepared, settings, pet: { ...data.pet, selected: settings.petId },
      plans: [...prepared.plans.filter(plan => plan.date !== date), plan] };
  });
}

export async function resolveReward(id: string, approved: boolean): Promise<AppData> {
  return mutateAppData(data => {
    const redemption = data.redemptions.find(entry => entry.id === id);
    if (!redemption || redemption.status !== 'pending') return data;
    const definition = data.rewardDefinitions.find(entry => entry.id === redemption.rewardId);
    let ledger = data.ledger;
    if (approved) {
      if (!definition) throw new Error('兑换奖励已不存在');
      if (calculateWallet(ledger)[definition.currency] < definition.cost) throw new Error('余额不足，尚未扣款');
      const entry: RewardLedgerEntry = { id: `${id}-cost`, date: localDateKey(), createdAt: new Date().toISOString(),
        sourceId: id, reason: `兑换：${redemption.rewardTitle}`, currency: definition.currency, delta: -definition.cost };
      ledger = [...ledger, entry];
    }
    return { ...data, ledger, redemptions: data.redemptions.map(entry => entry.id === id
      ? { ...entry, status: approved ? 'approved' : 'rejected', resolvedAt: new Date().toISOString() } : entry) };
  });
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
  assertContent(item);
  await (await database()).put('content', ensureContentAge(item));
}

export async function deleteContentItem(id: string): Promise<void> {
  await (await database()).delete('content', id);
}

export async function importContentPack(pack: ContentPackV1): Promise<ContentPackRecord> {
  const result = validateContentPack(pack);
  if (!result.ok) throw new Error(result.errors.join('；'));
  const record: ContentPackRecord = { id: pack.id, title: pack.title, contentVersion: pack.contentVersion,
    importedAt: new Date().toISOString(), itemCount: pack.items.length };
  await mutateAppData(data => {
    if (data.contentPacks.some(entry => entry.id === pack.id)) throw new Error('内容包 id 已存在');
    const duplicate = pack.items.find(item => data.content.some(entry => entry.id === item.id));
    if (duplicate) throw new Error(`内容 id 已存在：${duplicate.id}`);
    return { ...data, content: [...data.content, ...pack.items.map(item => ensureContentAge({ ...item, source: 'imported' }))],
      contentPacks: [...data.contentPacks, record] };
  });
  return record;
}

export function createBackup(data: AppData): BackupEnvelopeV1 {
  return { schemaVersion: 1, app: 'lexue-workbench', exportedAt: new Date().toISOString(), data };
}

export async function restoreBackup(backup: BackupEnvelopeV1): Promise<void> {
  const validation = validateBackup(backup);
  if (!validation.ok) throw new Error(validation.error);
  // 先完成所有纯数据校验与迁移，再进入覆盖事务。
  const restored = validation.backup.data;
  const next = ensureTodayPlan({ ...restored, settings: {
    ...restored.settings,
    dailyContentCounts: { ...DEFAULT_DAILY_CONTENT_COUNTS, ...restored.settings.dailyContentCounts },
    childAge: restored.settings.childAge ?? 4,
    mathStartStage: restored.settings.mathStartStage ?? 1,
    englishStart: restored.settings.englishStart ?? 'letters'
  } });
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    for (const store of STORES) await tx.objectStore(store).clear();
    await persistSnapshot(tx, next);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* 自动中止的事务无需再次处理。 */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function clearUserData(): Promise<void> {
  const tx = (await database()).transaction(STORES, 'readwrite');
  try {
    const data = await snapshot(tx);
    for (const store of ['plans', 'completions', 'ledger', 'redemptions', 'reports', 'learningEvents'] as const) await tx.objectStore(store).clear();
    const next = ensureTodayPlan({ ...data, plans: [], completions: [], ledger: [], redemptions: [], reports: [], learningEvents: [],
      pet: { id: 'current', selected: data.settings.petId, mood: 80, fedCount: 0 } });
    await persistSnapshot(tx, next, data);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* 自动中止的事务无需再次处理。 */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
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
