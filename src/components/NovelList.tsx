import React from 'react';
import { Novel } from '../types';
import { Plus, Book, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';

interface NovelListProps {
  novels: Novel[];
  onSelectNovel: (novel: Novel) => void;
  onAddNovel: () => void;
  onDeleteNovel: (id: string) => void;
}

export const NovelList: React.FC<NovelListProps> = ({
  novels,
  onSelectNovel,
  onAddNovel,
  onDeleteNovel,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold font-serif tracking-tight text-brand-900">Your Novels</h2>
        <button
          onClick={onAddNovel}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors shadow-sm"
        >
          <Plus size={20} />
          <span>New Novel</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {novels.map((novel) => (
          <motion.div
            key={novel.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 bg-white border border-brand-100 rounded-xl shadow-sm hover:shadow-md transition-all cursor-pointer group relative hover:-translate-y-1"
            onClick={() => onSelectNovel(novel)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-brand-50 text-brand-600 rounded-lg">
                  <Book size={24} />
                </div>
                <div>
                  <h3 className="font-serif font-semibold text-lg text-brand-900 group-hover:text-brand-600 transition-colors">
                    {novel.title}
                  </h3>
                  <p className="text-sm text-brand-600 line-clamp-2">{novel.description}</p>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNovel(novel.id);
                }}
                className="p-2 text-brand-300 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={18} />
              </button>
            </div>
            <div className="mt-4 flex items-center gap-4 text-xs text-brand-400">
              <span>Updated {new Date(novel.updatedAt).toLocaleDateString()}</span>
            </div>
          </motion.div>
        ))}
      </div>

      {novels.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border-2 border-dashed border-brand-100">
          <Book className="mx-auto text-brand-200 mb-4" size={48} />
          <p className="text-brand-600">No novels yet. Start your journey by creating one!</p>
        </div>
      )}
    </div>
  );
};
