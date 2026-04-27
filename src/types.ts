export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  traits: string[];
  isPinned?: boolean;
  gender?: 'male' | 'female' | 'other';
  imageUrl?: string;
}

export interface PlotPoint {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  plotPoints: PlotPoint[];
  order: number;
  isDeleted?: boolean;
  deletedAt?: number;
  completions?: number;
  isPublished?: boolean;
  imageUrl?: string;
}

export interface Creature {
  id: string;
  name: string;
  species: string;
  habitat: string;
  abilities: string;
  threatLevel: 'low' | 'medium' | 'high' | 'calamity';
  description: string;
  imageUrl?: string;
}

export interface Location {
  id: string;
  name: string;
  climate: string;
  rulingPower: string;
  lore: string;
  description: string;
  imageUrl?: string;
}

export interface Faction {
  id: string;
  name: string;
  leader: string;
  influence: string;
  alignment: 'ally' | 'neutral' | 'enemy';
  description: string;
  imageUrl?: string;
}

export interface Skill {
  id: string;
  name: string;
  category: 'Common' | 'Extra' | 'Unique' | 'Ultimate' | 'Ancient' | 'Legendary';
  description: string;
  imageUrl?: string;
}

export interface Weapon {
  id: string;
  name: string;
  rarity: 'Common' | 'Rare' | 'Super Rare' | 'Legendary' | 'Mythical';
  description: string;
  imageUrl?: string;
}

export interface Story {
  id: string;
  title: string;
  subtitle?: string;
  genres: string[];
  lastModified: number;
  characters: Character[];
  chapters: Chapter[];
  creatures?: Creature[];
  locations?: Location[];
  factions?: Faction[];
  skills?: Skill[];
  weapons?: Weapon[];
  summary?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  isPinned?: boolean;
  isPublished?: boolean;
  ownerId: string;
  lockVersion?: number;
  imageUrl?: string;
}

export interface Suggestion {
  id: string;
  storyId: string;
  storyOwnerId: string;
  chapterId: string;
  readerId: string;
  readerEmail?: string;
  selectedText: string;
  suggestedText: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: number;
  resolvedAt?: number;
}

export type AppView = 'dashboard' | 'editor';
