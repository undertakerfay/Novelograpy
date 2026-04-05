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

export interface Story {
  id: string;
  title: string;
  subtitle?: string;
  lastModified: number;
  characters: Character[];
  chapters: Chapter[];
  skillsAndWeapons?: SkillOrWeapon[];
  summary?: string;
  isDeleted?: boolean;
  deletedAt?: number;
  isPinned?: boolean;
  ownerId: string;
}

export type AppView = 'dashboard' | 'editor';
