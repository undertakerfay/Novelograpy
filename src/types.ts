export interface Character {
  id: string;
  name: string;
  role: string;
  description: string;
  traits: string[];
  isPinned?: boolean;
  gender?: 'male' | 'female' | 'other';
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
}

export interface SkillOrWeapon {
  id: string;
  type: 'skill' | 'weapon';
  name: string;
  description: string;
}

export interface Creature {
  id: string;
  name: string;
  species: string;
  habitat: string;
  abilities: string;
  threatLevel: 'low' | 'medium' | 'high' | 'calamity';
  description: string;
}

export interface Location {
  id: string;
  name: string;
  climate: string;
  rulingPower: string;
  lore: string;
  description: string;
}

export interface Story {
  id: string;
  title: string;
  subtitle?: string;
  genres: string[];
  lastModified: number;
  characters: Character[];
  chapters: Chapter[];
  skillsAndWeapons?: SkillOrWeapon[];
  creatures?: Creature[];
  locations?: Location[];
  summary?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  isPinned?: boolean;
  isPublished?: boolean;
  ownerId: string;
}

export type AppView = 'dashboard' | 'editor';
