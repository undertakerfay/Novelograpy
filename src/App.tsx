import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Book, Trash2, ChevronLeft, Search, Wand2, User, ListTodo, FileText, RotateCcw, XCircle, Pin, PinOff, Sword, Zap, ExternalLink, Bookmark, Venus, Mars, HelpCircle, Eye, X, List, Sparkles, MessageSquare, Anchor, BookOpen, Send, GripVertical } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Story, AppView, Character, PlotPoint, Chapter, SkillOrWeapon } from './types';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc } from 'firebase/firestore';

// Utility for word count
const getWordCount = (text: string) => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

// Utility for page count (assuming 300 words per page)
const getPageCount = (text: string) => {
  const words = getWordCount(text);
  return Math.max(1, Math.ceil(words / 300));
};

// Initial empty novel template
const createNewStory = (ownerId: string): Partial<Story> => ({
  title: 'Untitled Novel',
  subtitle: '',
  lastModified: Date.now(),
  characters: [],
  skillsAndWeapons: [],
  chapters: [
    {
      id: crypto.randomUUID(),
      title: 'Chapter 1',
      content: '',
      plotPoints: [],
      order: 0
    }
  ],
  isPublished: false,
  isDeleted: false,
  ownerId
});

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsedError = JSON.parse(this.state.error?.message || "{}");
        if (parsedError.error) {
          errorMessage = `Firebase Error: ${parsedError.error} (${parsedError.operationType} at ${parsedError.path})`;
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-brand-50">
          <div className="max-w-md w-full bg-white p-8 rounded-3xl border-2 border-red-100 shadow-xl text-center">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <XCircle size={32} />
            </div>
            <h2 className="text-2xl font-bold font-serif text-brand-900 mb-2">Oops!</h2>
            <p className="text-brand-500 text-sm mb-6">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-brand-800 text-brand-50 py-3 rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}

function AppContent() {
  const [stories, setStories] = useState<Story[]>([]);
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [view, setView] = useState<AppView | 'login'>('dashboard');
  const [dashboardTab, setDashboardTab] = useState<'my' | 'public'>('my');
  const [searchTerm, setSearchTerm] = useState('');
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'welcome' | 'goodbye' } | null>(null);

  const welcomeMessages = [
    "Welcome back, Master Fay. The worlds await your command.",
    "Greetings, Master. Shall we continue the chronicle?",
    "The ink flows once more. Welcome, Master Fay.",
    "The chosen master has returned. Novelograpy is at your service."
  ];

  const goodbyeMessages = [
    "Farewell, Master. The worlds will wait for your return.",
    "Rest well, Master Fay. Your stories are safe.",
    "Until next time, Master. The ink remains ready.",
    "The master departs, but the legends live on. Goodbye."
  ];

  const showNotification = (type: 'welcome' | 'goodbye') => {
    const messages = type === 'welcome' ? welcomeMessages : goodbyeMessages;
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    setNotification({ message: randomMessage, type });
    setTimeout(() => setNotification(null), 4000);
  };

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsLoggedIn(!!firebaseUser);
      setIsAuthReady(true);
      if (!firebaseUser) {
        setDashboardTab('public');
      } else {
        setDashboardTab('my');
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore connection test
  useEffect(() => {
    if (!isAuthReady) return;
    
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        }
        // Other errors are expected if the document doesn't exist, so we only log specific connection issues
      }
    };
    testConnection();
  }, [isAuthReady]);

  // Firestore Stories Listener
  useEffect(() => {
    if (!isAuthReady) return;

    const storiesRef = collection(db, 'stories');
    // For readers or public tab, show all published stories. For writers in 'my' tab, show their own.
    const q = isLoggedIn && user && dashboardTab === 'my'
      ? query(storiesRef, where('ownerId', '==', user.uid))
      : query(storiesRef, where('isPublished', '==', true));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedStories = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(fetchedStories);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'stories');
    });

    return () => unsubscribe();
  }, [isAuthReady, isLoggedIn, user]);

  // Test Connection
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      showNotification('goodbye');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  const handleLogin = () => {
    setView('dashboard');
    showNotification('welcome');
  };

  const currentStory = stories.find(s => s.id === currentStoryId);

  const handleCreateStory = async () => {
    if (!isLoggedIn || !user) return;
    try {
      const newStoryData = createNewStory(user.uid);
      const docRef = await addDoc(collection(db, 'stories'), newStoryData);
      setCurrentStoryId(docRef.id);
      setView('editor');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'stories');
    }
  };

  const moveToRecycleBin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    try {
      await updateDoc(doc(db, 'stories', id), {
        isDeleted: true,
        deletedAt: Date.now()
      });
      if (currentStoryId === id) setCurrentStoryId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stories/${id}`);
    }
  };

  const restoreStory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    try {
      await updateDoc(doc(db, 'stories', id), {
        isDeleted: false,
        deletedAt: null
      });
      setNotification({ message: "Novel restored from recycle bin.", type: 'welcome' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stories/${id}`);
    }
  };

  const permanentlyDeleteStory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    if (confirm('Permanently delete this novel? This cannot be undone.')) {
      try {
        await deleteDoc(doc(db, 'stories', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `stories/${id}`);
      }
    }
  };

  const togglePinStory = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    const story = stories.find(s => s.id === id);
    if (!story) return;
    try {
      await updateDoc(doc(db, 'stories', id), {
        isPinned: !story.isPinned
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stories/${id}`);
    }
  };

  const restoreChapter = async (storyId: string, chapterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    const story = stories.find(s => s.id === storyId);
    if (!story) return;
    try {
      let updatedChapters = story.chapters.map(c => 
        c.id === chapterId ? { ...c, isDeleted: false, deletedAt: null } : c
      );
      
      // Re-sort and re-number after restoration
      const active = updatedChapters.filter(c => !c.isDeleted).sort((a, b) => a.order - b.order);
      const deleted = updatedChapters.filter(c => c.isDeleted);
      
      const renumberedActive = active.map((c, index) => {
        const newTitle = c.title.match(/^Chapter \d+$/) ? `Chapter ${index + 1}` : c.title;
        return { ...c, order: index, title: newTitle };
      });
      
      await updateDoc(doc(db, 'stories', storyId), {
        chapters: [...renumberedActive, ...deleted]
      });
      setNotification({ message: "Chapter restored successfully.", type: 'welcome' });
      setTimeout(() => setNotification(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stories/${storyId}`);
    }
  };

  const permanentlyDeleteChapter = async (storyId: string, chapterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isLoggedIn) return;
    if (confirm('Permanently delete this chapter? This cannot be undone.')) {
      const story = stories.find(s => s.id === storyId);
      if (!story) return;
      try {
        const updatedChapters = story.chapters.filter(c => c.id !== chapterId);
        await updateDoc(doc(db, 'stories', storyId), {
          chapters: updatedChapters
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `stories/${storyId}`);
      }
    }
  };

  const updateStory = async (updates: Partial<Story>) => {
    if (!currentStoryId || !isLoggedIn) return;
    try {
      await updateDoc(doc(db, 'stories', currentStoryId), {
        ...updates,
        lastModified: Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `stories/${currentStoryId}`);
    }
  };

  const filteredStories = useMemo(() => {
    const filtered = stories.filter(s => {
      const matchesSearch = s.title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTab = (dashboardTab === 'public' || !isLoggedIn) ? s.isPublished : (showRecycleBin ? s.isDeleted : !s.isDeleted);
      return matchesSearch && matchesTab;
    });
    
    return [...filtered].sort((a, b) => {
      if (a.isPinned === b.isPinned) return b.lastModified - a.lastModified;
      return a.isPinned ? -1 : 1;
    });
  }, [stories, searchTerm, showRecycleBin, isLoggedIn, dashboardTab]);

  return (
    <div className="min-h-screen bg-brand-50 text-brand-900 font-sans selection:bg-brand-200">
      <AnimatePresence mode="wait">
        {view === 'dashboard' ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-5xl mx-auto px-4 md:px-6 py-8 md:py-12"
          >
            <header className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 md:mb-12 gap-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-brand-900 mb-2 font-serif">Novelograpy</h1>
                <p className="text-brand-600 text-sm md:text-base">Where {isLoggedIn ? "your" : "my"} worlds come to life.</p>
              </div>
              <div className="flex items-center justify-end gap-3 md:gap-4 w-full sm:w-auto">
                {isLoggedIn && (
                  <div className="flex bg-brand-100 p-1 rounded-2xl mr-2">
                    <button
                      onClick={() => { setDashboardTab('my'); setShowRecycleBin(false); }}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                        dashboardTab === 'my' ? "bg-white text-brand-900 shadow-sm" : "text-brand-500 hover:text-brand-700"
                      )}
                    >
                      My Library
                    </button>
                    <button
                      onClick={() => { setDashboardTab('public'); setShowRecycleBin(false); }}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                        dashboardTab === 'public' ? "bg-white text-brand-900 shadow-sm" : "text-brand-500 hover:text-brand-700"
                      )}
                    >
                      Public Library
                    </button>
                  </div>
                )}
                {!showRecycleBin && isLoggedIn && dashboardTab === 'my' && (
                  <button
                    onClick={handleCreateStory}
                    title="New Novel"
                    className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-brand-800 text-brand-50 rounded-full font-medium hover:bg-brand-700 transition-all shadow-lg hover:shadow-xl active:scale-95"
                  >
                    <Plus size={24} />
                  </button>
                )}
                {isLoggedIn && (
                  <a
                    href="https://www.fantasynamegenerators.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Fantasy Name Generator"
                    className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 bg-white border-2 border-brand-100 text-brand-600 rounded-full font-medium hover:border-brand-300 transition-all shadow-sm"
                  >
                    <Search size={20} />
                  </a>
                )}
                {isLoggedIn && (
                  <button
                    onClick={() => setShowRecycleBin(!showRecycleBin)}
                    title={showRecycleBin ? "Back to Library" : "Recycle Bin"}
                    className={cn(
                      "flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full font-medium transition-all shadow-sm",
                      showRecycleBin ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-brand-100 text-brand-700 hover:bg-brand-200"
                    )}
                  >
                    {showRecycleBin ? <ChevronLeft size={24} /> : <Trash2 size={24} />}
                  </button>
                )}
                <button
                  onClick={() => isLoggedIn ? handleLogout() : setView('login')}
                  title={isLoggedIn ? "Log Out" : "Log In"}
                  className={cn(
                    "flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full font-medium transition-all shadow-sm",
                    isLoggedIn ? "bg-brand-800 text-brand-50 hover:bg-brand-700" : "bg-white border-2 border-brand-100 text-brand-700 hover:border-brand-300"
                  )}
                >
                  {isLoggedIn ? <XCircle size={24} /> : <User size={24} />}
                </button>
              </div>
            </header>

            <div className="relative mb-6 md:mb-8">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={20} />
              <input
                type="text"
                placeholder="Search your novels..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-white border-2 border-brand-100 rounded-2xl py-3 md:py-4 pl-12 pr-4 focus:outline-none focus:border-brand-300 transition-colors shadow-sm text-sm md:text-base"
              />
            </div>

            {filteredStories.length > 0 || (showRecycleBin && stories.some(s => s.chapters.some(c => c.isDeleted))) ? (
              <div className="space-y-12">
                {filteredStories.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredStories.map((story) => (
                      <motion.div
                        layoutId={story.id}
                        key={story.id}
                        onClick={() => {
                          if (!story.isDeleted) {
                            setCurrentStoryId(story.id);
                            setView('editor');
                          }
                        }}
                        className={cn(
                          "group bg-white p-6 rounded-3xl border-2 transition-all shadow-sm hover:shadow-md relative overflow-hidden",
                          story.isPinned ? "border-brand-300 ring-2 ring-brand-100" : "border-transparent",
                          !story.isDeleted && "hover:border-brand-200 cursor-pointer"
                        )}
                      >
                        {story.isPinned && (
                          <div className="absolute top-0 left-0 bg-brand-800 text-brand-50 p-1 rounded-br-xl">
                            <Pin size={12} fill="currentColor" />
                          </div>
                        )}
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex gap-2 order-2">
                            {story.isPublished && !story.isDeleted && (
                              <div className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                                <Eye size={12} /> Published
                              </div>
                            )}
                            {story.isDeleted ? (
                              <>
                                <button
                                  onClick={(e) => restoreStory(story.id, e)}
                                  className="p-2 text-brand-300 hover:text-green-500 transition-colors"
                                  title="Restore"
                                >
                                  <RotateCcw size={18} />
                                </button>
                                <button
                                  onClick={(e) => permanentlyDeleteStory(story.id, e)}
                                  className="p-2 text-brand-300 hover:text-red-500 transition-colors"
                                  title="Permanently Delete"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={(e) => togglePinStory(story.id, e)}
                                  className={cn(
                                    "p-2 transition-colors",
                                    story.isPinned ? "text-brand-800" : "text-brand-200 hover:text-brand-400 opacity-0 group-hover:opacity-100",
                                    !isLoggedIn && "hidden"
                                  )}
                                  title={story.isPinned ? "Unpin Novel" : "Pin Novel"}
                                >
                                  {story.isPinned ? <PinOff size={18} /> : <Pin size={18} />}
                                </button>
                                <button
                                  onClick={(e) => moveToRecycleBin(story.id, e)}
                                  className={cn(
                                    "p-2 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100",
                                    !isLoggedIn && "hidden"
                                  )}
                                  title="Move to Recycle Bin"
                                >
                                  <Trash2 size={18} />
                                </button>
                              </>
                            )}
                          </div>
                          <div className="p-3 bg-brand-100 rounded-2xl text-brand-700 group-hover:bg-brand-800 group-hover:text-brand-50 transition-colors order-1">
                            <Book size={24} />
                          </div>
                        </div>
                        <h3 className="text-xl font-bold mb-1 group-hover:text-brand-800 transition-colors line-clamp-1">
                          {story.title}
                        </h3>
                        {story.subtitle && (
                          <p className="text-brand-400 text-sm mb-2 line-clamp-1 italic">{story.subtitle}</p>
                        )}
                        <p className="text-brand-500 text-sm mb-4 line-clamp-2">
                          {story.chapters.filter(c => !c.isDeleted).length} Chapters • {Math.max(1, Math.ceil(story.chapters.filter(c => !c.isDeleted).reduce((acc, c) => acc + getWordCount(c.content), 0) / 300))} Pages
                        </p>
                        <div className="flex items-center gap-4 text-xs text-brand-400 font-medium">
                          <span className="flex items-center gap-1">
                            <User size={12} /> {story.characters.length}
                          </span>
                          <span className="flex items-center gap-1">
                            <FileText size={12} /> {story.chapters.filter(c => !c.isDeleted).length}
                          </span>
                          <span className="ml-auto">
                            {new Date(story.lastModified).toLocaleDateString()}
                          </span>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {showRecycleBin && stories.some(s => s.chapters.some(c => c.isDeleted)) && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-brand-100 pb-4">
                      <h2 className="text-2xl font-bold font-serif text-brand-800">Deleted Chapters</h2>
                      <Trash2 className="text-brand-400" size={24} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {stories.flatMap(s => 
                        s.chapters.filter(c => c.isDeleted).map(c => ({ ...c, storyId: s.id, storyTitle: s.title }))
                      ).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0)).map(chapter => (
                        <div key={chapter.id} className="bg-white p-4 rounded-2xl border border-brand-100 shadow-sm flex items-center justify-between group">
                          <div className="flex flex-col truncate">
                            <span className="font-bold text-brand-800 truncate">{chapter.title}</span>
                            <span className="text-xs text-brand-400">From: {chapter.storyTitle}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => restoreChapter(chapter.storyId, chapter.id, e)}
                              className="p-2 text-brand-300 hover:text-green-500 transition-colors"
                              title="Restore Chapter"
                            >
                              <RotateCcw size={18} />
                            </button>
                            <button
                              onClick={(e) => permanentlyDeleteChapter(chapter.storyId, chapter.id, e)}
                              className="p-2 text-brand-300 hover:text-red-500 transition-colors"
                              title="Permanently Delete Chapter"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-brand-200">
                <Book className="mx-auto text-brand-200 mb-4" size={48} />
                <h3 className="text-xl font-medium text-brand-400">
                  {showRecycleBin ? "Recycle bin is empty" : (dashboardTab === 'public' ? "No published novels yet" : "No novels found")}
                </h3>
                {!showRecycleBin && (
                  <div className="text-center">
                    {isLoggedIn && (
                      <button
                        onClick={handleCreateStory}
                        className="mt-4 text-brand-600 hover:text-brand-800 font-medium underline underline-offset-4"
                      >
                        Start your first novel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ) : view === 'login' ? (
          <LoginView 
            onLogin={handleLogin} 
            onBack={() => setView('dashboard')} 
          />
        ) : (
          <EditorView
            story={currentStory!}
            onBack={() => setView('dashboard')}
            onUpdate={updateStory}
            isLoggedIn={isLoggedIn}
          />
        )}
      </AnimatePresence>

      {/* Notification Toast */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 20, x: '-50%' }}
            className={cn(
              "fixed bottom-8 left-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl font-medium text-center min-w-[300px]",
              notification.type === 'welcome' ? "bg-brand-800 text-brand-50" : "bg-white border-2 border-brand-100 text-brand-800"
            )}
          >
            {notification.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LoginView({ onLogin, onBack }: { onLogin: () => void; onBack: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    
    if (username !== 'Fay' || password !== 'monica') {
      setError('Invalid credentials. Only the master Fay can enter.');
      setIsLoading(false);
      return;
    }

    // Map "Fay" to the admin email
    const email = 'mdalaminsifat2022@gmail.com';

    try {
      await signInWithEmailAndPassword(auth, email, password);
      onLogin();
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Account not found or incorrect password. Please ensure the master account is initialized.');
      } else {
        setError(err.message || 'Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="min-h-screen flex items-center justify-center p-6"
    >
      <div className="w-full max-w-md bg-white p-8 rounded-3xl border-2 border-brand-100 shadow-xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-brand-100 text-brand-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <User size={32} />
          </div>
          <h2 className="text-2xl font-bold font-serif text-brand-900">Log In</h2>
          <p className="text-brand-500 text-sm">Only the chosen master can edit the worlds of Novelograpy</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-bold text-brand-700 ml-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-brand-50 border-2 border-transparent focus:border-brand-200 focus:bg-white rounded-2xl py-3 px-4 outline-none transition-all"
              placeholder="Enter username"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-brand-700 ml-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-brand-50 border-2 border-transparent focus:border-brand-200 focus:bg-white rounded-2xl py-3 px-4 outline-none transition-all"
              placeholder="Enter password"
              required
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-500 text-sm font-medium text-center"
            >
              {error}
            </motion.p>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-brand-800 text-brand-50 py-4 rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : 'Log In'}
            </button>

            <button
              type="button"
              onClick={onBack}
              className="w-full text-brand-500 py-2 text-sm font-medium hover:text-brand-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function EditorView({ story, onBack, onUpdate, isLoggedIn }: { 
  story: Story; 
  onBack: () => void; 
  onUpdate: (updates: Partial<Story>) => void;
  isLoggedIn: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'write' | 'characters' | 'skills_weapons' | 'plot'>('write');
  const [currentChapterId, setCurrentChapterId] = useState<string>(story.chapters[0]?.id || '');
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  const activeChapters = useMemo(() => 
    story.chapters.filter(c => !c.isDeleted).sort((a, b) => a.order - b.order),
    [story.chapters]
  );

  const handleReorderChapters = (reorderedActive: Chapter[]) => {
    if (!isLoggedIn) return;
    
    // Maintain the deleted chapters in the full list
    const deletedChapters = story.chapters.filter(c => c.isDeleted);
    
    // Renumber the reordered active chapters
    const renumberedActive = reorderedActive.map((c, index) => {
      // Only auto-rename if it follows the "Chapter N" pattern
      const newTitle = c.title.match(/^Chapter \d+$/) ? `Chapter ${index + 1}` : c.title;
      return { ...c, order: index, title: newTitle };
    });
    
    onUpdate({
      chapters: [...renumberedActive, ...deletedChapters]
    });
  };

  const currentChapter = story.chapters.find(c => c.id === currentChapterId && !c.isDeleted) || activeChapters[0];

  const updateChapter = (chapterId: string, updates: Partial<Chapter>) => {
    onUpdate({
      chapters: story.chapters.map(c => c.id === chapterId ? { ...c, ...updates } : c)
    });
  };

  const addChapter = () => {
    if (!isLoggedIn) return;
    const activeCount = story.chapters.filter(c => !c.isDeleted).length;
    const newChapter: Chapter = {
      id: crypto.randomUUID(),
      title: `Chapter ${activeCount + 1}`,
      content: '',
      plotPoints: [],
      order: activeCount
    };
    onUpdate({ chapters: [...story.chapters, newChapter] });
    setCurrentChapterId(newChapter.id);
  };

  const deleteChapter = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeChapters.length <= 1) {
      alert("You need at least one chapter!");
      return;
    }
    if (confirm('Delete this chapter? It will be moved to the recycle bin.')) {
      const updatedChapters = story.chapters.map(c => 
        c.id === id ? { ...c, isDeleted: true, deletedAt: Date.now() } : c
      );
      
      // Re-number remaining active chapters
      const active = updatedChapters.filter(c => !c.isDeleted).sort((a, b) => a.order - b.order);
      const deleted = updatedChapters.filter(c => c.isDeleted);
      
      const renumberedActive = active.map((c, index) => {
        const newTitle = c.title.match(/^Chapter \d+$/) ? `Chapter ${index + 1}` : c.title;
        return { ...c, order: index, title: newTitle };
      });
      
      onUpdate({ chapters: [...renumberedActive, ...deleted] });
      
      if (currentChapterId === id) {
        setCurrentChapterId(renumberedActive[0].id);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Editor Header */}
      <header className="bg-white border-b border-brand-100 px-4 md:px-6 py-3 md:py-4 flex items-center justify-between z-30 sticky top-0">
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          <button
            onClick={onBack}
            className="p-2 hover:bg-brand-50 rounded-full text-brand-600 transition-colors shrink-0"
            title="Back to Dashboard"
          >
            <ChevronLeft size={24} />
          </button>
          <div className="flex flex-col flex-1 min-w-0">
            <button 
              onClick={onBack}
              className="w-fit text-brand-400 hover:text-brand-800 text-[10px] font-bold uppercase tracking-widest transition-colors mb-0.5"
            >
              Dashboard
            </button>
            <div className="flex flex-col">
              <input
                type="text"
                value={story.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                readOnly={!isLoggedIn}
                className={cn(
                  "text-lg md:text-xl font-bold bg-transparent border-none focus:outline-none text-brand-900 placeholder:text-brand-200 truncate",
                  !isLoggedIn && "cursor-default"
                )}
                placeholder="Novel Title"
              />
              <input
                type="text"
                value={story.subtitle || ''}
                onChange={(e) => onUpdate({ subtitle: e.target.value })}
                readOnly={!isLoggedIn}
                className={cn(
                  "text-xs md:text-sm italic bg-transparent border-none focus:outline-none text-brand-400 placeholder:text-brand-200 truncate",
                  !isLoggedIn && "cursor-default"
                )}
                placeholder="Novel Subtitle"
              />
            </div>
          </div>
          {!isLoggedIn && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-brand-100 text-brand-600 rounded-full text-[10px] font-bold uppercase tracking-wider mx-2">
              <Eye size={12} /> Read Only
            </div>
          )}
        </div>
        
        <div className="hidden lg:flex items-center gap-1 bg-brand-50 p-1 rounded-2xl mx-4">
          <TabButton 
            active={activeTab === 'write'} 
            onClick={() => setActiveTab('write')} 
            icon={<Bookmark size={18} />} 
            label="Write" 
          />
          <TabButton 
            active={activeTab === 'characters'} 
            onClick={() => setActiveTab('characters')} 
            icon={<User size={18} />} 
            label="Characters" 
          />
          <TabButton 
            active={activeTab === 'skills_weapons'} 
            onClick={() => setActiveTab('skills_weapons')} 
            icon={<Sword size={18} />} 
            label="Skills & Weapons" 
          />
          {isLoggedIn && (
            <TabButton 
              active={activeTab === 'plot'} 
              onClick={() => setActiveTab('plot')} 
              icon={<ListTodo size={18} />} 
              label="Plot" 
            />
          )}
        </div>

        <div className="flex items-center gap-2">
          {activeTab !== 'characters' && (
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="lg:hidden p-2 hover:bg-brand-50 rounded-full text-brand-600 transition-colors shrink-0"
              title="Toggle Chapters"
            >
              <List size={24} />
            </button>
          )}
          {isLoggedIn && (
            <button
              onClick={() => onUpdate({ isPublished: !story.isPublished })}
              title={story.isPublished ? "Unpublish Novel" : "Publish Novel"}
              className={cn(
                "flex items-center gap-2 px-3 md:px-4 py-2 rounded-full font-medium transition-all shadow-sm border-2",
                story.isPublished 
                  ? "bg-green-50 border-green-200 text-green-700 hover:bg-green-100 hover:border-green-300" 
                  : "bg-brand-800 border-brand-800 text-brand-50 hover:bg-brand-700"
              )}
            >
              {story.isPublished ? <Eye size={18} /> : <Sparkles size={18} />}
              <span className="hidden sm:inline">{story.isPublished ? "Published" : "Publish"}</span>
            </button>
          )}
          {isLoggedIn && (
            <button
              onClick={() => setShowAiHelper(!showAiHelper)}
              className={cn(
                "flex items-center gap-2 px-3 md:px-4 py-2 rounded-full font-medium transition-all",
                showAiHelper 
                  ? "bg-brand-800 text-brand-50 shadow-inner" 
                  : "bg-white border-2 border-brand-100 text-brand-700 hover:border-brand-300"
              )}
            >
              <Wand2 size={18} />
              <span className="hidden md:inline">AI Muse</span>
            </button>
          )}
        </div>
      </header>

      {/* Mobile Tab Navigation */}
      <div className="lg:hidden bg-white border-b border-brand-100 px-4 py-2 flex items-center justify-around overflow-x-auto no-scrollbar">
        <TabButton 
          active={activeTab === 'write'} 
          onClick={() => setActiveTab('write')} 
          icon={<Bookmark size={18} />} 
          label="Write" 
        />
        <TabButton 
          active={activeTab === 'characters'} 
          onClick={() => setActiveTab('characters')} 
          icon={<User size={18} />} 
          label="Characters" 
        />
        <TabButton 
          active={activeTab === 'skills_weapons'} 
          onClick={() => setActiveTab('skills_weapons')} 
          icon={<Sword size={18} />} 
          label="Skills" 
        />
        {isLoggedIn && (
          <TabButton 
            active={activeTab === 'plot'} 
            onClick={() => setActiveTab('plot')} 
            icon={<ListTodo size={18} />} 
            label="Plot" 
          />
        )}
      </div>

      <main className="flex-1 flex overflow-hidden relative">
        {/* Sidebar for Chapters */}
        {activeTab !== 'characters' && (
          <>
            <AnimatePresence>
              {showSidebar && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowSidebar(false)}
                  className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
                />
              )}
            </AnimatePresence>
            <aside className={cn(
              "fixed inset-y-0 left-0 w-72 bg-white border-r border-brand-100 z-50 lg:relative lg:z-0 lg:translate-x-0 transition-transform duration-300 flex flex-col",
              showSidebar ? "translate-x-0" : "-translate-x-full"
            )}>
              <div className="p-4 border-b border-brand-100 flex items-center justify-between">
                <h3 className="font-bold text-brand-800">Chapters</h3>
                <div className="flex items-center gap-2">
                  {isLoggedIn && (
                    <button onClick={addChapter} className="p-1 hover:bg-brand-50 rounded-lg text-brand-600">
                      <Plus size={18} />
                    </button>
                  )}
                  <button onClick={() => setShowSidebar(false)} className="lg:hidden p-1 hover:bg-brand-50 rounded-lg text-brand-600">
                    <XCircle size={18} />
                  </button>
                </div>
              </div>
              <Reorder.Group 
                axis="y" 
                values={activeChapters} 
                onReorder={handleReorderChapters}
                className="flex-1 p-2 space-y-1 overflow-y-auto"
              >
                {activeChapters.map((chapter) => (
                  <Reorder.Item
                    key={chapter.id}
                    value={chapter}
                    onClick={() => {
                      setCurrentChapterId(chapter.id);
                      if (window.innerWidth < 1024) setShowSidebar(false);
                    }}
                    className={cn(
                      "group flex items-center gap-2 p-3 rounded-xl cursor-pointer transition-all",
                      currentChapterId === chapter.id 
                        ? "bg-brand-100 text-brand-900 font-medium" 
                        : "hover:bg-brand-50 text-brand-600"
                    )}
                  >
                    {isLoggedIn && (
                      <div className="cursor-grab active:cursor-grabbing text-brand-300 group-hover:text-brand-400">
                        <GripVertical size={16} />
                      </div>
                    )}
                    <div className="flex flex-col truncate flex-1">
                      <span className="truncate">{chapter.title}</span>
                      <span className="text-[10px] text-brand-400 font-normal">
                        {getWordCount(chapter.content)} words
                      </span>
                    </div>
                    <button 
                      onClick={(e) => deleteChapter(chapter.id, e)}
                      className={cn(
                        "opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity",
                        !isLoggedIn && "hidden"
                      )}
                    >
                      <Trash2 size={14} />
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </aside>
          </>
        )}

        {/* Main Content Area */}
        <div className={cn(
          "flex-1 overflow-y-auto transition-all duration-500 relative",
          showAiHelper ? "lg:mr-[350px]" : "mr-0"
        )}>
          {/* Chapter Sidebar Toggle Button (Mobile) */}
          {activeTab !== 'characters' && (
            <button
              onClick={() => setShowSidebar(true)}
              className="lg:hidden fixed bottom-6 left-6 w-12 h-12 bg-brand-800 text-brand-50 rounded-full shadow-lg flex items-center justify-center z-30"
            >
              <FileText size={24} />
            </button>
          )}

          <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 md:py-12 min-h-full">
            {activeTab === 'write' && currentChapter && (
              <div className="h-full flex flex-col space-y-6">
                <input
                  type="text"
                  value={currentChapter.title}
                  onChange={(e) => updateChapter(currentChapter.id, { title: e.target.value })}
                  readOnly={!isLoggedIn}
                  className={cn(
                    "text-2xl md:text-3xl font-bold font-serif bg-transparent border-none focus:outline-none text-brand-900 placeholder:text-brand-200",
                    !isLoggedIn && "cursor-default"
                  )}
                  placeholder="Chapter Title"
                />
                <textarea
                  value={currentChapter.content}
                  onChange={(e) => updateChapter(currentChapter.id, { content: e.target.value })}
                  readOnly={!isLoggedIn}
                  className={cn(
                    "w-full flex-1 min-h-[60vh] bg-transparent border-none focus:outline-none resize-none writing-area placeholder:text-brand-200",
                    !isLoggedIn && "cursor-default"
                  )}
                  placeholder={isLoggedIn ? "Start writing your chapter..." : "No content yet."}
                  autoFocus={isLoggedIn}
                />
                <div className="flex justify-end text-xs text-brand-400 font-medium pt-4 border-t border-brand-100">
                  {getWordCount(currentChapter.content)} words in this chapter
                </div>
              </div>
            )}

            {activeTab === 'characters' && (
              <CharacterManager 
                storyTitle={story.title}
                characters={story.characters} 
                onUpdate={(chars) => onUpdate({ characters: chars })} 
                isLoggedIn={isLoggedIn}
              />
            )}

            {activeTab === 'skills_weapons' && (
              <SkillsWeaponsManager 
                storyTitle={story.title}
                items={story.skillsAndWeapons || []} 
                onUpdate={(items) => onUpdate({ skillsAndWeapons: items })} 
                isLoggedIn={isLoggedIn}
              />
            )}

            {activeTab === 'plot' && currentChapter && (
              <PlotManager 
                storyTitle={currentChapter.title}
                plotPoints={currentChapter.plotPoints} 
                onUpdate={(points) => updateChapter(currentChapter.id, { plotPoints: points })} 
                isLoggedIn={isLoggedIn}
              />
            )}
          </div>
        </div>

        {/* AI Helper Sidebar */}
        <AnimatePresence>
          {showAiHelper && isLoggedIn && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowAiHelper(false)}
                className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 lg:hidden"
              />
              <motion.aside
                initial={{ x: 350 }}
                animate={{ x: 0 }}
                exit={{ x: 350 }}
                className="fixed lg:absolute right-0 top-0 bottom-0 w-full sm:w-[350px] bg-white border-l border-brand-100 shadow-2xl z-50 flex flex-col"
              >
                <div className="flex justify-end p-2 lg:hidden">
                  <button onClick={() => setShowAiHelper(false)} className="p-2 text-brand-400 hover:text-brand-600">
                    <XCircle size={24} />
                  </button>
                </div>
                <AiMuse story={story} currentChapter={currentChapter} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap",
        active ? "bg-white text-brand-900 shadow-sm" : "text-brand-500 hover:text-brand-700"
      )}
    >
      <span className="hidden md:inline">{label}</span>
      {icon}
    </button>
  );
}

function CharacterManager({ storyTitle, characters, onUpdate, isLoggedIn }: { storyTitle: string; characters: Character[]; onUpdate: (chars: Character[]) => void; isLoggedIn: boolean }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showGenderSelector, setShowGenderSelector] = useState(false);

  const sortedCharacters = useMemo(() => {
    const filtered = characters.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.role.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    return [...filtered].sort((a, b) => {
      if (a.isPinned === b.isPinned) return 0;
      return a.isPinned ? -1 : 1;
    });
  }, [characters, searchTerm]);

  const addCharacter = (gender: 'male' | 'female' | 'other') => {
    const newChar: Character = {
      id: crypto.randomUUID(),
      name: '',
      role: '',
      description: '',
      traits: [],
      isPinned: false,
      gender
    };
    onUpdate([newChar, ...characters]);
    setShowGenderSelector(false);
  };

  const updateChar = (id: string, updates: Partial<Character>) => {
    onUpdate(characters.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const removeChar = (id: string) => {
    onUpdate(characters.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl md:text-2xl font-bold font-serif">{storyTitle}: Characters</h2>
        {isLoggedIn && (
          <div className="relative flex justify-end">
            <button 
              onClick={() => setShowGenderSelector(!showGenderSelector)} 
              className="w-full sm:w-auto flex items-center justify-center gap-2 bg-brand-800 text-brand-50 px-4 py-2.5 rounded-xl font-medium hover:bg-brand-700 transition-all"
            >
              <Plus size={18} /> Add Character
            </button>

            <AnimatePresence>
              {showGenderSelector && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute right-0 sm:right-0 mt-2 w-full sm:w-48 bg-white border border-brand-100 rounded-2xl shadow-xl z-30 overflow-hidden"
                >
                  <button 
                    onClick={() => addCharacter('male')}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 text-brand-700 transition-colors text-left"
                  >
                    <Mars size={18} className="text-blue-500" />
                    <span>Male Character</span>
                  </button>
                  <button 
                    onClick={() => addCharacter('female')}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 text-brand-700 transition-colors border-t border-brand-50 text-left"
                  >
                    <Venus size={18} className="text-pink-500" />
                    <span>Female Character</span>
                  </button>
                  <button 
                    onClick={() => addCharacter('other')}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 text-brand-700 transition-colors border-t border-brand-50 text-left"
                  >
                    <HelpCircle size={18} className="text-brand-400" />
                    <span>Other / Non-binary</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
        <input
          type="text"
          placeholder="Filter by name or role..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border-2 border-brand-100 rounded-2xl py-2.5 md:py-3 pl-12 pr-4 focus:outline-none focus:border-brand-300 transition-colors shadow-sm text-sm md:text-base"
        />
      </div>
      
      <div className="grid grid-cols-1 gap-4 md:gap-6">
        {sortedCharacters.map((char, index) => (
          <div key={char.id} className={cn(
            "bg-white p-4 md:p-6 rounded-3xl border-2 transition-all shadow-sm space-y-4 relative overflow-hidden",
            char.isPinned ? "border-brand-300 ring-2 ring-brand-100" : "border-brand-100"
          )}>
            <div className="absolute top-0 right-0 bg-brand-100 text-brand-600 text-[10px] font-bold px-2 py-1 rounded-bl-xl">
              #{index + 1}
            </div>
            <div className="flex flex-col sm:flex-row gap-4 pt-2">
              <div className="flex-1 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                    <div className="flex-1 flex flex-col gap-3 w-full">
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <input
                          placeholder="Name"
                          value={char.name}
                          onChange={(e) => updateChar(char.id, { name: e.target.value })}
                          readOnly={!isLoggedIn}
                          className={cn(
                            "flex-1 text-lg md:text-xl font-bold border-b-2 border-transparent focus:border-brand-200 focus:outline-none",
                            !isLoggedIn && "cursor-default"
                          )}
                        />
                        <div className="flex items-center gap-2">
                          <input
                            placeholder="Role (e.g. Protagonist)"
                            value={char.role}
                            onChange={(e) => updateChar(char.id, { role: e.target.value })}
                            readOnly={!isLoggedIn}
                            className={cn(
                              "flex-1 text-sm md:text-base text-brand-500 border-b-2 border-transparent focus:border-brand-200 focus:outline-none",
                              !isLoggedIn && "cursor-default"
                            )}
                          />
                          {!char.gender ? (
                            <div className="flex flex-col gap-1 w-full sm:w-auto">
                              <div className="flex bg-brand-100 p-1 rounded-xl shrink-0">
                                {(['male', 'female', 'other'] as const).map((g) => (
                                  <button
                                    key={g}
                                    onClick={() => updateChar(char.id, { gender: g })}
                                    className="flex-1 sm:flex-none p-2 rounded-lg text-brand-400 hover:text-brand-600 hover:bg-white transition-all flex justify-center"
                                    title={g.charAt(0).toUpperCase() + g.slice(1)}
                                  >
                                    {g === 'male' ? <Mars size={16} /> : g === 'female' ? <Venus size={16} /> : <HelpCircle size={16} />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className={cn(
                              "p-1.5 rounded-lg shrink-0",
                              char.gender === 'male' ? "bg-blue-50 text-blue-600" : 
                              char.gender === 'female' ? "bg-pink-50 text-pink-600" : 
                              "bg-brand-50 text-brand-400"
                            )}>
                              {char.gender === 'male' ? <Mars size={16} /> : char.gender === 'female' ? <Venus size={16} /> : <HelpCircle size={16} />}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                <textarea
                  placeholder={isLoggedIn ? "Description, backstory, motivations..." : "No description provided."}
                  value={char.description}
                  onChange={(e) => updateChar(char.id, { description: e.target.value })}
                  readOnly={!isLoggedIn}
                  className={cn(
                    "w-full h-24 bg-brand-50 rounded-2xl p-4 focus:outline-none focus:ring-2 ring-brand-200 resize-none text-sm md:text-base",
                    !isLoggedIn && "cursor-default"
                  )}
                />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-brand-400 uppercase tracking-wider px-1">Character Traits</span>
                    {isLoggedIn && (
                      <button
                        onClick={() => {
                          const newTraits = [...(char.traits || []), ''];
                          updateChar(char.id, { traits: newTraits });
                        }}
                        className="text-[10px] font-bold text-brand-600 hover:text-brand-800 flex items-center gap-1 transition-colors"
                      >
                        <Plus size={12} /> Add Trait
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(char.traits || []).map((trait, tIndex) => (
                      <div key={tIndex} className="flex items-center gap-1 bg-brand-50 border border-brand-100 rounded-full px-3 py-1 group/trait">
                        <input
                          type="text"
                          value={trait}
                          onChange={(e) => {
                            const newTraits = [...char.traits];
                            newTraits[tIndex] = e.target.value;
                            updateChar(char.id, { traits: newTraits });
                          }}
                          readOnly={!isLoggedIn}
                          placeholder="Trait"
                          className={cn(
                            "bg-transparent border-none focus:outline-none text-xs font-medium text-brand-700 w-20 sm:w-24 placeholder:text-brand-300",
                            !isLoggedIn && "cursor-default"
                          )}
                        />
                        {isLoggedIn && (
                          <button
                            onClick={() => {
                              const newTraits = char.traits.filter((_, i) => i !== tIndex);
                              updateChar(char.id, { traits: newTraits });
                            }}
                            className="text-brand-300 hover:text-red-500 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {isLoggedIn && char.traits?.length === 0 && (
                      <p className="text-[10px] text-brand-300 italic px-1">No traits added yet.</p>
                    )}
                    {!isLoggedIn && char.traits?.length === 0 && (
                      <p className="text-[10px] text-brand-300 italic px-1">No traits listed.</p>
                    )}
                  </div>
                </div>
              </div>
              {isLoggedIn && (
                <div className="flex flex-row sm:flex-col gap-2 justify-end sm:justify-start border-t sm:border-t-0 pt-3 sm:pt-0">
                  <button 
                    onClick={() => updateChar(char.id, { isPinned: !char.isPinned })} 
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      char.isPinned ? "text-brand-800 bg-brand-100" : "text-brand-200 hover:text-brand-400"
                    )}
                    title={char.isPinned ? "Unpin Character" : "Pin Character"}
                  >
                    {char.isPinned ? <PinOff size={20} /> : <Pin size={20} />}
                  </button>
                  <button onClick={() => removeChar(char.id)} className="text-brand-200 hover:text-red-400 p-2">
                    <Trash2 size={20} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {sortedCharacters.length === 0 && (
          <div className="text-center py-12 text-brand-400">
            {searchTerm ? "No characters match your search." : "No characters yet. Add your hero!"}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillsWeaponsManager({ storyTitle, items, onUpdate, isLoggedIn }: { 
  storyTitle: string; 
  items: SkillOrWeapon[]; 
  onUpdate: (items: SkillOrWeapon[]) => void;
  isLoggedIn: boolean;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'skill' | 'weapon'>('all');

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          item.type.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesType = filterType === 'all' || item.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [items, searchTerm, filterType]);

  const addItem = (type: 'skill' | 'weapon') => {
    const newItem: SkillOrWeapon = {
      id: crypto.randomUUID(),
      type,
      name: '',
      description: ''
    };
    onUpdate([newItem, ...items]);
    setShowTypeSelector(false);
  };

  const updateItem = (id: string, updates: Partial<SkillOrWeapon>) => {
    onUpdate(items.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const removeItem = (id: string) => {
    onUpdate(items.filter(item => item.id !== id));
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl md:text-2xl font-bold font-serif">{storyTitle}: Skills & Weapons</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex bg-brand-100 p-1 rounded-xl overflow-x-auto no-scrollbar">
            {(['all', 'skill', 'weapon'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  "flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all whitespace-nowrap",
                  filterType === type ? "bg-white text-brand-900 shadow-sm" : "text-brand-500 hover:text-brand-700"
                )}
              >
                {type}
              </button>
            ))}
          </div>
          {isLoggedIn && (
            <div className="relative flex justify-end">
              <button 
                onClick={() => setShowTypeSelector(!showTypeSelector)} 
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-brand-800 text-brand-50 px-4 py-2.5 rounded-xl font-medium hover:bg-brand-700 transition-all"
              >
                <Plus size={18} /> Add New
              </button>
              
              <AnimatePresence>
                {showTypeSelector && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 sm:right-0 mt-2 w-full sm:w-48 bg-white border border-brand-100 rounded-2xl shadow-xl z-30 overflow-hidden"
                  >
                    <button 
                      onClick={() => addItem('skill')}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 text-brand-700 transition-colors text-left"
                    >
                      <Zap size={18} className="text-yellow-500" />
                      <span>Add Skill</span>
                    </button>
                    <button 
                      onClick={() => addItem('weapon')}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 text-brand-700 transition-colors border-t border-brand-50 text-left"
                    >
                      <Sword size={18} className="text-red-500" />
                      <span>Add Weapon</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={18} />
        <input
          type="text"
          placeholder="Filter by name or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white border-2 border-brand-100 rounded-2xl py-2.5 md:py-3 pl-12 pr-4 focus:outline-none focus:border-brand-300 transition-colors shadow-sm text-sm md:text-base"
        />
      </div>
      
      <div className="grid grid-cols-1 gap-8">
        {filterType === 'all' ? (
          <>
            {['skill', 'weapon'].map((type) => {
              const typeItems = filteredItems.filter(i => i.type === type);
              if (typeItems.length === 0) return null;
              return (
                <div key={type} className="space-y-4">
                  <div className="flex items-center gap-2 px-2">
                    {type === 'skill' ? <Zap size={16} className="text-yellow-500" /> : <Sword size={16} className="text-red-500" />}
                    <h3 className="text-sm font-bold uppercase tracking-widest text-brand-400">{type}s</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-6">
                    {typeItems.map((item) => (
                      <SkillWeaponCard key={item.id} item={item} updateItem={updateItem} removeItem={removeItem} isLoggedIn={isLoggedIn} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {filteredItems.map((item) => (
              <SkillWeaponCard key={item.id} item={item} updateItem={updateItem} removeItem={removeItem} isLoggedIn={isLoggedIn} />
            ))}
          </div>
        )}
        {filteredItems.length === 0 && (
          <div className="text-center py-12 text-brand-400">
            {searchTerm ? "No items match your search." : "No skills or weapons yet. Add something powerful!"}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillWeaponCard({ item, updateItem, removeItem, isLoggedIn }: { 
  item: SkillOrWeapon; 
  updateItem: (id: string, updates: Partial<SkillOrWeapon>) => void; 
  removeItem: (id: string) => void;
  isLoggedIn: boolean;
}) {
  return (
    <div className="bg-white p-4 md:p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative overflow-hidden">
      <div className={cn(
        "absolute top-0 right-0 text-[10px] font-bold px-3 py-1 rounded-bl-xl uppercase tracking-wider",
        item.type === 'skill' ? "bg-yellow-100 text-yellow-700" : "bg-red-100 text-red-700"
      )}>
        {item.type}
      </div>
      <div className="flex flex-col sm:flex-row gap-4 pt-4">
        <div className="flex-1 space-y-4">
          <div className="flex gap-4 items-center">
            <input
              placeholder={`${item.type === 'skill' ? 'Skill' : 'Weapon'} Name`}
              value={item.name}
              onChange={(e) => updateItem(item.id, { name: e.target.value })}
              readOnly={!isLoggedIn}
              className={cn(
                "flex-1 text-lg md:text-xl font-bold border-b-2 border-transparent focus:border-brand-200 focus:outline-none",
                !isLoggedIn && "cursor-default"
              )}
            />
            <div className={cn(
              "p-2 rounded-xl shrink-0",
              item.type === 'skill' ? "bg-yellow-50 text-yellow-600" : "bg-red-50 text-red-600"
            )}>
              {item.type === 'skill' ? <Zap size={20} /> : <Sword size={20} />}
            </div>
          </div>
          <textarea
            placeholder={isLoggedIn ? `Describe this ${item.type}...` : `No description for this ${item.type}.`}
            value={item.description}
            onChange={(e) => updateItem(item.id, { description: e.target.value })}
            readOnly={!isLoggedIn}
            className={cn(
              "w-full h-24 bg-brand-50 rounded-2xl p-4 focus:outline-none focus:ring-2 ring-brand-200 resize-none text-sm md:text-base",
              !isLoggedIn && "cursor-default"
            )}
          />
        </div>
        {isLoggedIn && (
          <button onClick={() => removeItem(item.id)} className="text-brand-200 hover:text-red-400 self-end sm:self-start p-2">
            <Trash2 size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

function PlotManager({ storyTitle, plotPoints, onUpdate, isLoggedIn }: { storyTitle: string; plotPoints: PlotPoint[]; onUpdate: (points: PlotPoint[]) => void; isLoggedIn: boolean }) {
  const sortedPlotPoints = useMemo(() => {
    return [...plotPoints].sort((a, b) => {
      if (a.isCompleted === b.isCompleted) return 0;
      return a.isCompleted ? 1 : -1;
    });
  }, [plotPoints]);

  const addPoint = () => {
    const newPoint: PlotPoint = {
      id: crypto.randomUUID(),
      title: '',
      description: '',
      isCompleted: false
    };
    onUpdate([...plotPoints, newPoint]);
  };

  const updatePoint = (id: string, updates: Partial<PlotPoint>) => {
    onUpdate(plotPoints.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const removePoint = (id: string) => {
    onUpdate(plotPoints.filter(p => p.id !== id));
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl md:text-2xl font-bold font-serif">{storyTitle}: Plot Points</h2>
        {isLoggedIn && (
          <button onClick={addPoint} className="flex items-center gap-2 text-brand-600 hover:text-brand-800 font-medium text-sm md:text-base whitespace-nowrap">
            <Plus size={20} /> <span className="hidden sm:inline">Add Plot Point</span><span className="sm:hidden">Add</span>
          </button>
        )}
      </div>
      
      <div className="space-y-4">
        {sortedPlotPoints.map(point => (
          <div key={point.id} className="flex gap-3 md:gap-4 items-start bg-white p-4 md:p-6 rounded-3xl border-2 border-brand-100 shadow-sm transition-all">
            <div className="flex-1 space-y-2 min-w-0">
              <input
                placeholder="Plot Event Title"
                value={point.title}
                onChange={(e) => updatePoint(point.id, { title: e.target.value })}
                readOnly={!isLoggedIn}
                className={cn(
                  "w-full font-bold focus:outline-none text-sm md:text-base",
                  point.isCompleted && "line-through text-brand-300",
                  !isLoggedIn && "cursor-default"
                )}
              />
              <textarea
                placeholder={isLoggedIn ? "Details about this event..." : "No details provided."}
                value={point.description}
                onChange={(e) => updatePoint(point.id, { description: e.target.value })}
                readOnly={!isLoggedIn}
                className={cn(
                  "w-full bg-transparent focus:outline-none text-xs md:text-sm text-brand-600 resize-none",
                  !isLoggedIn && "cursor-default"
                )}
              />
            </div>
            <input 
              type="checkbox" 
              checked={point.isCompleted} 
              onChange={(e) => updatePoint(point.id, { isCompleted: e.target.checked })}
              disabled={!isLoggedIn}
              className={cn(
                "mt-1.5 w-5 h-5 rounded-full border-2 border-brand-300 text-brand-800 focus:ring-brand-800 shrink-0",
                !isLoggedIn && "cursor-default opacity-50"
              )}
            />
            {isLoggedIn && (
              <button onClick={() => removePoint(point.id)} className="text-brand-200 hover:text-red-400 p-2 shrink-0">
                <Trash2 size={18} />
              </button>
            )}
          </div>
        ))}
        {plotPoints.length === 0 && (
          <div className="text-center py-12 text-brand-400 text-sm md:text-base">
            No plot points yet for this chapter. What happens next?
          </div>
        )}
      </div>
    </div>
  );
}

function AiMuse({ story, currentChapter }: { story: Story; currentChapter?: Chapter }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);

  const quickActions = [
    { id: 'scene', label: 'Generate Scene', icon: <Sparkles size={14} />, prompt: "Based on the current plot points and characters, draft a full, vivid scene for this chapter." },
    { id: 'show', label: "Show, Don't Tell", icon: <Eye size={14} />, prompt: "Analyze the current chapter content. Identify 'telling' and suggest 'showing' alternatives to make it more immersive." },
    { id: 'consistency', label: 'Check Consistency', icon: <Search size={14} />, prompt: "Check the current chapter against the character descriptions and skills/weapons list. Are there any contradictions?" },
    { id: 'dialogue', label: 'Dialogue Assistant', icon: <MessageSquare size={14} />, prompt: "Review the dialogue in this chapter. Suggest ways to make it more distinct for each character's personality." },
    { id: 'hook', label: 'Chapter Hook', icon: <Anchor size={14} />, prompt: "Suggest 3 dramatic hooks or cliffhangers to end this chapter with." },
    { id: 'lore', label: 'Expand Lore', icon: <BookOpen size={14} />, prompt: "Based on the story so far, suggest more detailed history or mechanics for one of the skills or weapons mentioned." },
  ];

  const askMuse = async (customPrompt?: string) => {
    const userMsg = customPrompt || query;
    if (!userMsg.trim()) return;
    
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    if (!customPrompt) setQuery('');
    setLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const model = "gemini-3-flash-preview";
      
      // Get previous chapters for context
      const currentChapterIndex = story.chapters.findIndex(c => c.id === currentChapter?.id);
      const previousChaptersContext = story.chapters
        .slice(0, currentChapterIndex)
        .map(c => `Chapter: ${c.title}\nContent: ${c.content.slice(0, 1000)}...`)
        .join('\n\n');

      const context = `
        You are a helpful writing assistant for a novelist named Master Fay. 
        Current Novel: "${story.title}"
        Subtitle: "${story.subtitle || 'None'}"
        Characters: ${story.characters.map(c => `${c.name} (${c.role}): ${c.description}`).join(', ')}
        Skills & Weapons: ${story.skillsAndWeapons?.map(i => `${i.name} (${i.type}): ${i.description}`).join(', ') || 'None'}
        
        PREVIOUS CHAPTERS CONTEXT:
        ${previousChaptersContext || 'This is the first chapter.'}
        
        CURRENT CHAPTER: "${currentChapter?.title}"
        CURRENT CHAPTER PLOT POINTS: ${currentChapter?.plotPoints.map(p => p.title).join(', ')}
        CURRENT CHAPTER CONTENT: ${currentChapter?.content || 'Empty'}
        
        The user might ask questions about their own novel, characters, or plot to help them remember or brainstorm.
        Be friendly, encouraging, and specific to their story context. Use the previous chapters to ensure consistency in your suggestions.
        Always address the user as "Master Fay" or "Master".
      `;

      const response = await ai.models.generateContent({
        model,
        contents: [
          { role: 'user', parts: [{ text: context }] },
          { role: 'user', parts: [{ text: userMsg }] }
        ]
      });

      setMessages(prev => [...prev, { role: 'ai', text: response.text || "I'm not sure, but keep writing!" }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'ai', text: "Sorry, my creative spark flickered. Try again?" }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-4 md:p-6">
      <div className="flex items-center gap-2 mb-4 md:mb-6">
        <Wand2 className="text-brand-800" size={24} />
        <h2 className="text-lg md:text-xl font-bold font-serif">AI Muse</h2>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 gap-2 mb-6">
        {quickActions.map(action => (
          <button
            key={action.id}
            onClick={() => askMuse(action.prompt)}
            disabled={loading}
            className="flex items-center gap-2 p-2 bg-white border border-brand-100 rounded-xl text-[10px] font-bold text-brand-700 hover:bg-brand-50 hover:border-brand-200 transition-all text-left disabled:opacity-50"
          >
            <span className="text-brand-500">{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
      
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2 no-scrollbar">
        {messages.length === 0 && (
          <div className="text-center py-10 text-brand-400 text-sm">
            <p className="mb-2">Greetings, Master Fay.</p>
            <p>Ask me about your characters, plot, or use a quick action above!</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn(
            "p-3 md:p-4 rounded-2xl text-sm",
            m.role === 'user' ? "bg-brand-100 ml-4" : "bg-brand-50 mr-4 border border-brand-100"
          )}>
            <div className="prose prose-sm prose-brand max-w-none">
              <Markdown>{m.text}</Markdown>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-1 p-4 bg-brand-50 rounded-2xl mr-4 border border-brand-100 animate-pulse">
            <div className="w-2 h-2 bg-brand-300 rounded-full" />
            <div className="w-2 h-2 bg-brand-300 rounded-full" />
            <div className="w-2 h-2 bg-brand-300 rounded-full" />
          </div>
        )}
      </div>

      <div className="relative mt-auto">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), askMuse())}
          placeholder="Ask your Muse..."
          className="w-full bg-brand-50 rounded-2xl p-3 md:p-4 pr-12 focus:outline-none focus:ring-2 ring-brand-200 resize-none text-sm"
          rows={3}
        />
        <button
          onClick={() => askMuse()}
          disabled={loading || !query.trim()}
          className="absolute right-3 bottom-3 p-2 bg-brand-800 text-brand-50 rounded-xl disabled:opacity-50"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
