import type { StoryListenEvent, StoryProgress, StorySettings } from './story-types';

export type ModuleId = 'guoxue' | 'literacy' | 'math' | 'english' | 'writing' | 'science';

export type ContentKind =
  | 'poem'
  | 'classic'
  | 'character'
  | 'letter'
  | 'math-choice'
  | 'word'
  | 'reader'
  | 'trace'
  | 'science';

export interface ContentItem {
  id: string;
  module: ModuleId;
  kind: ContentKind;
  title: string;
  subtitle?: string;
  body?: string;
  prompt?: string;
  answer?: string;
  options?: string[];
  stage?: number;
  ageMin?: number;
  ageMax?: number;
  url?: string;
  tags?: string[];
  source?: 'builtin' | 'imported';
}

export interface ContentPackV1 {
  schemaVersion: 1;
  id: string;
  title: string;
  contentVersion: string;
  items: ContentItem[];
}

export interface ParentSettings {
  childName: string;
  childAge?: number;
  mathStartStage?: number;
  englishStart?: 'letters' | 'words';
  activeWeekdays: number[];
  enabledModules: ModuleId[];
  dailyContentCounts?: Partial<Record<ModuleId, number>>;
  soundEnabled: boolean;
  reduceMotion: boolean;
  petId: 'stella' | 'archie' | 'marie';
  storySettings?: StorySettings;
  pinPolicyVersion?: number;
  pinSalt?: string;
  pinHash?: string;
}

export interface DailyItem {
  id: string;
  contentId: string;
  title: string;
  detail?: string;
  kind: ContentKind;
  prompt?: string;
  answer?: string;
  options?: string[];
  isReview?: boolean;
}

export interface DailyModuleTask {
  id: string;
  module: ModuleId;
  title: string;
  items: DailyItem[];
  doneItemIds: string[];
  collectedAt?: string;
}

export interface DailyPlan {
  date: string;
  generatedAt: string;
  curriculumVersion?: number;
  isActiveDay: boolean;
  modules: DailyModuleTask[];
  completedAt?: string;
  weeklyBonusGranted?: boolean;
}

export interface CompletionEvent {
  id: string;
  date: string;
  module: ModuleId;
  taskId: string;
  completedAt: string;
  contentIds: string[];
}

export type LearningOutcome = 'independent' | 'assisted' | 'practice' | 'unknown';

export interface LearningEvent {
  id: string;
  date: string;
  module: ModuleId;
  taskId: string;
  contentId: string;
  title: string;
  kind: ContentKind;
  isReview: boolean;
  outcome: LearningOutcome;
  attempts: number;
  wrongAttempts: number;
  firstAnswerCorrect?: boolean;
  completedAt?: string;
  updatedAt: string;
  legacy?: boolean;
}

export type LearningAction = { type: 'answer'; answer: string } | { type: 'complete'; outcome: Exclude<LearningOutcome, 'unknown'> };

export type Currency = 'stars' | 'foodHalfUnits' | 'xp' | 'gems' | 'badges';

export interface RewardLedgerEntry {
  id: string;
  date: string;
  createdAt: string;
  reason: string;
  sourceId: string;
  currency: Currency;
  delta: number;
}

export interface Wallet {
  stars: number;
  foodHalfUnits: number;
  xp: number;
  gems: number;
  badges: number;
}

export interface PetState {
  id: 'current';
  selected: 'stella' | 'archie' | 'marie';
  mood: number;
  fedCount: number;
  lastInteractionAt?: string;
}

export interface RewardDefinition {
  id: string;
  title: string;
  icon: string;
  currency: 'stars' | 'badges';
  cost: number;
  enabled: boolean;
}

export interface Redemption {
  id: string;
  rewardId: string;
  rewardTitle: string;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  resolvedAt?: string;
}

export interface DailyReport {
  date: string;
  completedModules: ModuleId[];
  contentIds: string[];
  earnedStars: number;
  earnedFoodHalfUnits: number;
  note: string;
}

export interface ContentPackRecord {
  id: string;
  title: string;
  contentVersion: string;
  importedAt: string;
  itemCount: number;
}

export interface BackupEnvelopeV1 {
  schemaVersion: 1;
  app: 'lexue-workbench';
  exportedAt: string;
  data: {
    learningEvents?: LearningEvent[];
    settings: ParentSettings;
    content: ContentItem[];
    plans: DailyPlan[];
    completions: CompletionEvent[];
    ledger: RewardLedgerEntry[];
    pet: PetState;
    redemptions: Redemption[];
    reports: DailyReport[];
    contentPacks: ContentPackRecord[];
    rewardDefinitions: RewardDefinition[];
    storyProgress?: StoryProgress[];
    storyListenEvents?: StoryListenEvent[];
  };
}

export type AppData = BackupEnvelopeV1['data'];

export const MODULE_META: Record<ModuleId, { title: string; icon: string; color: string; target: number }> = {
  guoxue: { title: '国学', icon: '📜', color: '#ff9f7c', target: 169 },
  literacy: { title: '识字', icon: '🀄', color: '#ffbf58', target: 2000 },
  math: { title: '数学', icon: '🧩', color: '#62c6a8', target: 240 },
  english: { title: '英语', icon: '🔤', color: '#6cb6ee', target: 500 },
  writing: { title: '控笔', icon: '✍️', color: '#ae8deb', target: 300 },
  science: { title: '科学', icon: '🔬', color: '#ef81a9', target: 100 }
};

export const DEFAULT_DAILY_CONTENT_COUNTS: Record<ModuleId, number> = {
  guoxue: 1,
  literacy: 2,
  math: 2,
  english: 2,
  writing: 4,
  science: 1
};

export function dailyContentCount(settings: Pick<ParentSettings, 'dailyContentCounts'>, module: ModuleId): number {
  const value = settings.dailyContentCounts?.[module] ?? DEFAULT_DAILY_CONTENT_COUNTS[module];
  return Number.isInteger(value) ? Math.max(1, Math.min(10, value)) : DEFAULT_DAILY_CONTENT_COUNTS[module];
}
