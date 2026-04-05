import React, { useState, useEffect } from 'react';
import { Novel, Character, PlotPoint } from '../types';
import { Save, ArrowLeft, Users, Map, BookOpen, Trash2, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NovelEditorProps {
  novel: Novel;
  characters: Character[];
  plotPoints: PlotPoint[];
  onSave: (novel: Novel) => void;
  onBack: () => void;
  onAddCharacter: (character: Partial<Character>) => void;
  onDeleteCharacter: (id: string) => void;
  onAddPlotPoint: (plotPoint: Partial<PlotPoint>) => void;
  onDeletePlotPoint: (id: string) => void;
}

export const NovelEditor: React.FC<NovelEditorProps> = ({
  novel,
  characters,
  plotPoints,
  onSave,
  onBack,
  onAddCharacter,
  onDeleteCharacter,
  onAddPlotPoint,
  onDeletePlotPoint,
}) => {
  const [title, setTitle] = useState(novel.title);
  const [description, setDescription] = useState(novel.description);
  const [activeTab, setActiveTab] = useState<'details' | 'characters' | 'plot'>('details');

  const [editingCharacter, setEditingCharacter] = useState<Character | null>(null);
  const [editingPlotPoint, setEditingPlotPoint] = useState<PlotPoint | null>(null);

  useEffect(() => {
    setTitle(novel.title);
    setDescription(novel.description);
  }, [novel]);

  const handleSave = () => {
    onSave({
      ...novel,
      title,
      description,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-serif font-bold text-brand-900">{title || 'Untitled'}</h2>
          <p className="text-xs text-brand-400 uppercase tracking-widest">Last edited {new Date(novel.updatedAt).toLocaleDateString()}</p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-6 py-2 bg-brand-900 text-brand-50 rounded-full hover:bg-brand-800 transition-all shadow-md active:scale-95"
        >
          <Save size={18} />
          <span className="font-medium">Save Manuscript</span>
        </button>
      </div>

      <div className="flex items-center gap-6 border-b border-brand-100">
        <button
          onClick={() => { setActiveTab('details'); setEditingCharacter(null); setEditingPlotPoint(null); }}
          className={`pb-4 px-1 flex items-center gap-2 transition-all relative ${
            activeTab === 'details'
              ? 'text-brand-900 font-bold'
              : 'text-brand-400 hover:text-brand-600'
          }`}
        >
          <BookOpen size={16} />
          <span>Manuscript</span>
          {activeTab === 'details' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-900" />}
        </button>
        <button
          onClick={() => { setActiveTab('characters'); setEditingCharacter(null); setEditingPlotPoint(null); }}
          className={`pb-4 px-1 flex items-center gap-2 transition-all relative ${
            activeTab === 'characters'
              ? 'text-brand-900 font-bold'
              : 'text-brand-400 hover:text-brand-600'
          }`}
        >
          <Users size={16} />
          <span>Dramatis Personae</span>
          {activeTab === 'characters' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-900" />}
        </button>
        <button
          onClick={() => { setActiveTab('plot'); setEditingCharacter(null); setEditingPlotPoint(null); }}
          className={`pb-4 px-1 flex items-center gap-2 transition-all relative ${
            activeTab === 'plot'
              ? 'text-brand-900 font-bold'
              : 'text-brand-400 hover:text-brand-600'
          }`}
        >
          <Map size={16} />
          <span>Story Arc</span>
          {activeTab === 'plot' && <motion.div layoutId="tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-900" />}
        </button>
      </div>

      <div className="bg-white shadow-xl rounded-sm border border-brand-100 min-h-[600px] p-12 relative overflow-hidden">
        {/* Paper texture/lines effect */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:20px_20px]" />
        
        <AnimatePresence mode="wait">
          {activeTab === 'details' && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8 relative z-10"
            >
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-4xl font-serif font-bold bg-transparent border-none outline-none placeholder:text-brand-100 text-brand-900"
                placeholder="Title of your work..."
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full min-h-[400px] bg-transparent border-none outline-none resize-none writing-area placeholder:text-brand-100"
                placeholder="Begin your story here..."
              />
            </motion.div>
          )}

          {activeTab === 'characters' && (
            <motion.div
              key="characters"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 relative z-10"
            >
              <div className="flex items-center justify-between border-b border-brand-50 pb-4">
                <h3 className="text-xl font-serif font-bold text-brand-900">Characters</h3>
                <button
                  onClick={() => onAddCharacter({ novelId: novel.id, name: 'New Character' })}
                  className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-900 transition-colors"
                >
                  <Plus size={16} />
                  <span>Add Character</span>
                </button>
              </div>

              {editingCharacter ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-brand-900">Character Details</h4>
                    <button onClick={() => setEditingCharacter(null)} className="text-sm text-brand-400 hover:text-brand-600">Close</button>
                  </div>
                  <div className="grid gap-4">
                    <input
                      type="text"
                      value={editingCharacter.name}
                      onChange={(e) => setEditingCharacter({ ...editingCharacter, name: e.target.value })}
                      className="w-full p-2 border-b border-brand-100 outline-none focus:border-brand-600 font-serif text-lg"
                      placeholder="Character Name"
                    />
                    <input
                      type="text"
                      value={editingCharacter.role}
                      onChange={(e) => setEditingCharacter({ ...editingCharacter, role: e.target.value })}
                      className="w-full p-2 border-b border-brand-100 outline-none focus:border-brand-600 text-sm italic"
                      placeholder="Role (e.g. Protagonist)"
                    />
                    <textarea
                      value={editingCharacter.description}
                      onChange={(e) => setEditingCharacter({ ...editingCharacter, description: e.target.value })}
                      className="w-full p-2 border border-brand-50 rounded bg-brand-50/30 outline-none focus:border-brand-600 min-h-[150px]"
                      placeholder="Backstory, appearance, motivations..."
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {characters.map((char) => (
                    <div
                      key={char.id}
                      onClick={() => setEditingCharacter(char)}
                      className="p-4 border border-brand-50 rounded-lg hover:border-brand-200 hover:bg-brand-50/30 transition-all cursor-pointer group"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="font-serif font-bold text-brand-900">{char.name}</h4>
                          <p className="text-xs text-brand-400 italic">{char.role}</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); onDeleteCharacter(char.id); }}
                          className="p-1 text-brand-200 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-brand-600 line-clamp-2 italic">{char.description}</p>
                    </div>
                  ))}
                  {characters.length === 0 && (
                    <p className="text-center py-12 text-brand-300 italic">No characters defined yet.</p>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'plot' && (
            <motion.div
              key="plot"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6 relative z-10"
            >
              <div className="flex items-center justify-between border-b border-brand-50 pb-4">
                <h3 className="text-xl font-serif font-bold text-brand-900">Story Arc</h3>
                <button
                  onClick={() => onAddPlotPoint({ novelId: novel.id, title: 'New Plot Point' })}
                  className="flex items-center gap-2 text-sm font-medium text-brand-600 hover:text-brand-900 transition-colors"
                >
                  <Plus size={16} />
                  <span>Add Plot Point</span>
                </button>
              </div>

              {editingPlotPoint ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-brand-900">Plot Point Details</h4>
                    <button onClick={() => setEditingPlotPoint(null)} className="text-sm text-brand-400 hover:text-brand-600">Close</button>
                  </div>
                  <div className="grid gap-4">
                    <input
                      type="text"
                      value={editingPlotPoint.title}
                      onChange={(e) => setEditingPlotPoint({ ...editingPlotPoint, title: e.target.value })}
                      className="w-full p-2 border-b border-brand-100 outline-none focus:border-brand-600 font-serif text-lg"
                      placeholder="Plot Point Title"
                    />
                    <textarea
                      value={editingPlotPoint.description}
                      onChange={(e) => setEditingPlotPoint({ ...editingPlotPoint, description: e.target.value })}
                      className="w-full p-2 border border-brand-50 rounded bg-brand-50/30 outline-none focus:border-brand-600 min-h-[150px]"
                      placeholder="What happens in this scene?"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {plotPoints.map((point) => (
                    <div
                      key={point.id}
                      onClick={() => setEditingPlotPoint(point)}
                      className="flex gap-6 group cursor-pointer"
                    >
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full border-2 border-brand-200 flex items-center justify-center text-xs font-bold text-brand-400 group-hover:border-brand-600 group-hover:text-brand-600 transition-colors bg-white">
                          {point.order}
                        </div>
                        <div className="flex-grow w-0.5 bg-brand-50 mt-2" />
                      </div>
                      <div className="flex-grow pb-8">
                        <div className="flex items-start justify-between">
                          <h4 className="font-serif font-bold text-brand-900 group-hover:text-brand-600 transition-colors">{point.title}</h4>
                          <button
                            onClick={(e) => { e.stopPropagation(); onDeletePlotPoint(point.id); }}
                            className="p-1 text-brand-200 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <p className="mt-1 text-sm text-brand-500 line-clamp-2">{point.description}</p>
                      </div>
                    </div>
                  ))}
                  {plotPoints.length === 0 && (
                    <p className="text-center py-12 text-brand-300 italic">No plot points defined yet.</p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
