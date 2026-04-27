import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Book, Trash2, ChevronLeft, Search, Wand2, User, ListTodo, FileText, RotateCcw, XCircle, Pin, PinOff, Sword, Zap, ExternalLink, Bookmark, Venus, Mars, HelpCircle, Eye, X, List, Sparkles, MessageSquare, Anchor, BookOpen, Send, GripVertical, Globe, MapPin, Ghost, ShieldAlert, Cloud, Check, Star, Bell, MessageCircle, Image as ImageIcon } from 'lucide-react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Story, AppView, Character, PlotPoint, Chapter, Creature, Location, Faction, Skill, Weapon, Suggestion } from './types';
import { cn } from './lib/utils';
import { GoogleGenAI } from "@google/genai";
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, signInAnonymously, User as FirebaseUser } from 'firebase/auth';
import { collection, onSnapshot, query, where, addDoc, updateDoc, deleteDoc, doc, getDocFromServer, serverTimestamp, setDoc, getDoc } from 'firebase/firestore';

// Utility for word count
const getWordCount = (text: string) => {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
};

// Reusable Debounced Input
function DebouncedInput({ 
  value, 
  onChange, 
  placeholder, 
  className, 
  readOnly,
  type = "text"
}: { 
  value: string; 
  onChange: (val: string) => void; 
  placeholder?: string; 
  className?: string; 
  readOnly?: boolean;
  type?: string;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (localValue === value) return;
    const timeoutId = setTimeout(() => {
      onChange(localValue);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [localValue, onChange, value]);

  return (
    <input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder={placeholder}
      className={className}
      readOnly={readOnly}
    />
  );
}

// Reusable Debounced Textarea
function DebouncedTextarea({ 
  value, 
  onChange, 
  placeholder, 
  className, 
  readOnly,
  rows
}: { 
  value: string; 
  onChange: (val: string) => void; 
  placeholder?: string; 
  className?: string; 
  readOnly?: boolean;
  rows?: number;
}) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  useEffect(() => {
    if (localValue === value) return;
    const timeoutId = setTimeout(() => {
      onChange(localValue);
    }, 1000);
    return () => clearTimeout(timeoutId);
  }, [localValue, onChange, value]);

  return (
    <textarea
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder={placeholder}
      className={className}
      readOnly={readOnly}
      rows={rows}
    />
  );
}

// Genre Constants
const GENRES = [
  'Fantasy', 'Epic Fantasy', 'Grimdark', 'Urban Fantasy', 'High Fantasy', 
  'Sci-Fi', 'Cyberpunk', 'Space Opera', 'Steampunk', 
  'Mystery', 'Thriller', 'Horror', 'Romance', 'Historical', 
  'Adventure', 'Action', 'Cultivation', 'LitRPG', 'Isekai'
];

// Hook for Reader Progression
const useReaderProgression = (storyId: string, chapters: Chapter[], isWriter: boolean, currentLockVersion: number = 0) => {
  const [unlockedIds, setUnlockedIds] = useState<string[]>([]);

  useEffect(() => {
    if (isWriter || !storyId) return;
    const idKey = `unlocked_chapters_${storyId}`;
    const versionKey = `lock_version_${storyId}`;
    
    const savedVersion = localStorage.getItem(versionKey);
    const savedChapters = localStorage.getItem(idKey);

    // If version mismatch, reset progress
    if (savedVersion !== currentLockVersion.toString()) {
      const firstId = chapters[0]?.id;
      const initialList = firstId ? [firstId] : [];
      setUnlockedIds(initialList);
      localStorage.setItem(idKey, JSON.stringify(initialList));
      localStorage.setItem(versionKey, currentLockVersion.toString());
      return;
    }

    if (savedChapters) {
      try {
        setUnlockedIds(JSON.parse(savedChapters));
      } catch (e) {
        setUnlockedIds([chapters[0]?.id].filter(Boolean));
      }
    } else if (chapters.length > 0) {
      const firstId = chapters[0].id;
      setUnlockedIds([firstId]);
      localStorage.setItem(idKey, JSON.stringify([firstId]));
    }
  }, [storyId, chapters.length, isWriter, currentLockVersion]);

  const unlockNext = (currentId: string) => {
    if (isWriter) return null;
    const activeChapters = chapters.filter(c => !c.isDeleted);
    const currentIndex = activeChapters.findIndex(c => c.id === currentId);
    if (currentIndex !== -1 && currentIndex < activeChapters.length - 1) {
      const nextId = activeChapters[currentIndex + 1].id;
      if (!unlockedIds.includes(nextId)) {
        const newList = [...unlockedIds, nextId];
        setUnlockedIds(newList);
        localStorage.setItem(`unlocked_chapters_${storyId}`, JSON.stringify(newList));
        return nextId;
      }
    }
    return null;
  };

  const isUnlocked = (chapterId: string) => {
    if (isWriter) return true;
    return unlockedIds.includes(chapterId);
  };

  return { unlockedIds, unlockNext, isUnlocked };
};

// Initial empty novel template
const createNewStory = (ownerId: string): Partial<Story> => ({
  title: 'Untitled Novel',
  subtitle: '',
  genres: [],
  lastModified: Date.now(),
  characters: [],
  creatures: [],
  locations: [],
  factions: [],
  skills: [],
  weapons: [],
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
  ownerId,
  imageUrl: '',
  lockVersion: 0
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
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'welcome' | 'goodbye' | 'error' } | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'online' | 'offline' | 'error'>('connecting');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestionsInbox, setShowSuggestionsInbox] = useState(false);

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
    let mounting = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!mounting) return;

      if (!firebaseUser) {
        try {
          // Attempt anonymous sign in for readers
          // NOTE: This requires "Anonymous" to be enabled in your Firebase Console (Authentication > Sign-in method)
          await signInAnonymously(auth);
        } catch (e: any) {
          if (e.code === 'auth/admin-restricted-operation') {
            console.warn("Reader features require Anonymous Authentication to be enabled. Please enable 'Anonymous' in your Firebase console (Authentication -> Sign-in Method).");
          } else {
            console.warn("Anonymous auth failed:", e.message);
          }
          // If anonymous failed (restricted), we stay in unauthenticated mode
          setUser(null);
          setIsLoggedIn(false);
          setDashboardTab('public');
          setIsAuthReady(true);
        }
      } else {
        setUser(firebaseUser);
        const isMaster = firebaseUser.email === 'mdalaminsifat2022@gmail.com' && !firebaseUser.isAnonymous;
        setIsLoggedIn(isMaster);
        setIsAuthReady(true);
        if (firebaseUser.isAnonymous || !isMaster) {
          setDashboardTab('public');
        } else {
          setDashboardTab('my');
        }
      }
    });
    return () => { mounting = false; unsubscribe(); };
  }, []);

  // Firestore connection test
  const testConnection = async (isRetry = false) => {
    if (isRetry) setConnectionStatus('connecting');
    try {
      await getDocFromServer(doc(db, 'test', 'connection'));
      setConnectionStatus('online');
    } catch (error: any) {
      const isOfflineStatus = error?.code === 'unavailable' || 
                              error?.message?.includes('the client is offline') || 
                              error?.message?.includes('unavailable');
      
      if (isOfflineStatus) {
        setConnectionStatus('offline');
        console.warn("Firestore connection check: Offline mode.");
      } else {
        setConnectionStatus('error');
        console.error("Firestore connection check: Unrecoverable error.", error);
      }
    }
  };

  useEffect(() => {
    if (!isAuthReady) return;
    testConnection();
  }, [isAuthReady]);

  // Firestore Stories Listener
  useEffect(() => {
    if (!isAuthReady) return;

    const storiesRef = collection(db, 'stories');
    // For readers or public tab, show all published stories. For writers in 'my' tab, show their own.
    const q = isLoggedIn && user && dashboardTab === 'my'
      ? query(storiesRef, where('ownerId', '==', user.uid), where('isDeleted', '==', false))
      : query(storiesRef, where('isPublished', '==', true), where('isDeleted', '==', false));

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

  // Firestore Suggestions Listener
  useEffect(() => {
    if (!isAuthReady || !user) {
      setSuggestions([]);
      return;
    }

    const suggestionsRef = collection(db, 'suggestions');
    
    // Define queries - we always check both paths but they are naturally restricted by uid
    // As Master (Owner of stories)
    const qMaster = query(suggestionsRef, where('storyOwnerId', '==', user.uid));
    // As Reader (Person who made highlights)
    const qReader = query(suggestionsRef, where('readerId', '==', user.uid));

    const handleSnapshot = (snapshot: any, type: 'master' | 'reader') => {
      const sugs = snapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      })) as Suggestion[];
      
      setSuggestions(prev => {
        const otherType = prev.filter(s => type === 'master' ? s.readerId !== user.uid : s.storyOwnerId !== user.uid);
        // Merge and avoid duplicates (if master is reading their own story)
        const combined = [...otherType, ...sugs];
        const unique = combined.reduce((acc, current) => {
          const x = acc.find(item => item.id === current.id);
          if (!x) return acc.concat([current]);
          else return acc;
        }, [] as Suggestion[]);
        return unique;
      });
    };

    const unsubMaster = (isLoggedIn && user) ? onSnapshot(qMaster, (snap) => handleSnapshot(snap, 'master'), (err) => {
      handleFirestoreError(err, OperationType.GET, 'suggestions');
    }) : () => {};

    const unsubReader = (user) ? onSnapshot(qReader, (snap) => handleSnapshot(snap, 'reader'), (err) => {
       handleFirestoreError(err, OperationType.GET, 'suggestions');
    }) : () => {};

    return () => { unsubMaster(); unsubReader(); };
  }, [isAuthReady, isLoggedIn, user]);

  const pendingSuggestionsCount = useMemo(() => {
    if (!isLoggedIn || !user) return 0;
    return suggestions.filter(s => s.storyOwnerId === user.uid && s.status === 'pending').length;
  }, [suggestions, isLoggedIn, user]);

  const updateSuggestionStatus = async (id: string, status: 'pending' | 'accepted' | 'dismissed') => {
    try {
      await updateDoc(doc(db, 'suggestions', id), {
        status,
        resolvedAt: status === 'pending' ? null : Date.now()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `suggestions/${id}`);
    }
  };

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

  const incrementChapterCompletion = async (storyId: string, chapterId: string) => {
    try {
      const storyRef = doc(db, 'stories', storyId);
      const storyDoc = await getDoc(storyRef);
      if (storyDoc.exists()) {
        const data = storyDoc.data() as Story;
        const updatedChapters = data.chapters.map(c => 
          c.id === chapterId ? { ...c, completions: (c.completions || 0) + 1 } : c
        );
        await updateDoc(storyRef, { chapters: updatedChapters });
      }
    } catch (error) {
      console.error("Failed to increment completion", error);
    }
  };

  const toggleChapterPublish = async (storyId: string, chapterId: string) => {
    try {
      const storyRef = doc(db, 'stories', storyId);
      const storyDoc = await getDoc(storyRef);
      if (storyDoc.exists()) {
        const data = storyDoc.data() as Story;
        const updatedChapters = data.chapters.map(c => 
          c.id === chapterId ? { ...c, isPublished: !c.isPublished } : c
        );
        await updateDoc(storyRef, { chapters: updatedChapters });
      }
    } catch (error) {
      console.error("Failed to toggle chapter publish status", error);
    }
  };

  const filteredStories = useMemo(() => {
    const filtered = stories.filter(s => {
      const matchesSearch = s.title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTab = (dashboardTab === 'public' || !isLoggedIn) ? s.isPublished : (showRecycleBin ? s.isDeleted : !s.isDeleted);
      const matchesGenre = !selectedGenre || (s.genres && s.genres.includes(selectedGenre));
      return matchesSearch && matchesTab && matchesGenre;
    });
    
    return [...filtered].sort((a, b) => {
      if (a.isPinned === b.isPinned) return b.lastModified - a.lastModified;
      return a.isPinned ? -1 : 1;
    });
  }, [stories, searchTerm, showRecycleBin, isLoggedIn, dashboardTab, selectedGenre]);

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
                <div className="flex items-center gap-2 mr-2">
                  <div className={cn(
                    "w-2 h-2 rounded-full",
                    connectionStatus === 'online' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" :
                    connectionStatus === 'connecting' ? "bg-amber-400 animate-pulse" :
                    connectionStatus === 'offline' ? "bg-brand-300" : "bg-red-500"
                  )} />
                  <span className="text-[10px] font-bold text-brand-400 uppercase tracking-tighter">
                    {connectionStatus}
                  </span>
                  {connectionStatus === 'offline' && (
                    <button 
                      onClick={() => testConnection(true)}
                      className="text-[10px] bg-brand-100 px-2 py-0.5 rounded-full hover:bg-brand-200 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>
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
                {isLoggedIn && (
                  <button
                    onClick={() => setShowSuggestionsInbox(true)}
                    title="Suggestions from Readers"
                    className={cn(
                      "flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full font-medium transition-all shadow-sm relative",
                      pendingSuggestionsCount > 0 ? "bg-amber-100 text-amber-700 animate-pulse border-2 border-amber-200" : "bg-brand-100 text-brand-700 hover:bg-brand-200"
                    )}
                  >
                    <Bell size={24} />
                    {pendingSuggestionsCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                        {pendingSuggestionsCount}
                      </span>
                    )}
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

            <div className="relative mb-6 md:mb-8 flex flex-col gap-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-400" size={20} />
                <input
                  type="text"
                  placeholder="Search your novels..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full bg-white border-2 border-brand-100 rounded-2xl py-3 md:py-4 pl-12 pr-4 focus:outline-none focus:border-brand-300 transition-colors shadow-sm text-sm md:text-base"
                />
              </div>
              
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2">
                <button
                  onClick={() => setSelectedGenre(null)}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap border-2",
                    !selectedGenre 
                      ? "bg-brand-800 border-brand-800 text-brand-50 shadow-md" 
                      : "bg-white border-brand-100 text-brand-500 hover:border-brand-200"
                  )}
                >
                  All Genres
                </button>
                {GENRES.map(genre => (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(selectedGenre === genre ? null : genre)}
                    className={cn(
                      "px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap border-2",
                      selectedGenre === genre 
                        ? "bg-brand-800 border-brand-800 text-brand-50 shadow-md" 
                        : "bg-white border-brand-100 text-brand-500 hover:border-brand-200"
                    )}
                  >
                    {genre}
                  </button>
                ))}
              </div>
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
                          "group bg-white p-0 rounded-3xl border-2 transition-all shadow-sm hover:shadow-md relative overflow-hidden flex flex-col h-full",
                          story.isPinned ? "border-brand-300 ring-2 ring-brand-100" : "border-transparent",
                          !story.isDeleted && "hover:border-brand-200 cursor-pointer"
                        )}
                      >
                        {/* Cover Image */}
                        {story.imageUrl ? (
                          <div className="w-full h-40 relative group-hover:h-44 transition-all duration-500 overflow-hidden">
                            <img 
                              src={story.imageUrl} 
                              alt={story.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                                const parent = e.currentTarget.parentElement;
                                if (parent) {
                                  const fallback = document.createElement('div');
                                  fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-4 text-center bg-brand-50";
                                  fallback.innerHTML = `
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                                    <span class="text-[10px] font-bold">Image Failed</span>
                                    <p class="text-[8px] mt-1 text-brand-400">If using Pinterest, "Copy Image Address" instead of the Page URL.</p>
                                  `;
                                  parent.appendChild(fallback);
                                }
                              }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
                          </div>
                        ) : (
                          <div className="w-full h-24 bg-brand-50/50 flex items-center justify-center text-brand-200">
                             <Book size={40} />
                          </div>
                        )}

                        <div className="p-6 pt-2 flex-1 flex flex-col">
                          {story.isPinned && (
                            <div className="absolute top-0 left-0 bg-brand-800 text-brand-50 p-1 rounded-br-xl z-10">
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
                          <div className={cn(
                            "p-3 bg-brand-100 rounded-2xl text-brand-700 group-hover:bg-brand-800 group-hover:text-brand-50 transition-colors order-1",
                            story.imageUrl && "shadow-lg bg-white/80 backdrop-blur-sm"
                          )}>
                            <Book size={24} />
                          </div>
                        </div>
                        <h3 className="text-xl font-bold mb-1 group-hover:text-brand-800 transition-colors line-clamp-1">
                          {story.title}
                        </h3>
                        {story.subtitle && (
                          <p className="text-brand-400 text-sm mb-2 line-clamp-1 italic">{story.subtitle}</p>
                        )}
                        
                        {story.genres && story.genres.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {story.genres.map(g => (
                              <span key={g} className="px-2 py-0.5 bg-brand-50 text-brand-500 rounded-md text-[10px] font-bold">
                                {g}
                              </span>
                            ))}
                          </div>
                        )}
                        <p className="text-brand-500 text-sm mb-4 line-clamp-2">
                          {story.chapters.filter(c => !c.isDeleted).length} Chapters • {Math.max(1, Math.ceil(story.chapters.filter(c => !c.isDeleted).reduce((acc, c) => acc + getWordCount(c.content), 0) / 300))} Pages
                        </p>
                        <div className="flex items-center gap-4 text-xs text-brand-400 font-medium">
                          <span className="flex items-center gap-1" title="Characters">
                            <User size={12} /> {story.characters.length}
                          </span>
                          <span className="flex items-center gap-1" title="Chapters">
                            <FileText size={12} /> {story.chapters.filter(c => !c.isDeleted).length}
                          </span>
                          {isLoggedIn && story.chapters.some(c => c.completions) && (
                            <span className="flex items-center gap-1 text-green-600 font-bold" title="Total Readers">
                              <Zap size={12} fill="currentColor" /> {story.chapters.filter(c => !c.isDeleted).reduce((acc, c) => acc + (c.completions || 0), 0)}
                            </span>
                          )}
                          <span className="ml-auto">
                            {new Date(story.lastModified).toLocaleDateString()}
                          </span>
                        </div>
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
            user={user}
            suggestions={suggestions}
            onUpdateSuggestionStatus={updateSuggestionStatus}
            onOpenSuggestions={() => setShowSuggestionsInbox(true)}
            pendingSuggestionsCount={pendingSuggestionsCount}
            onIncrementCompletion={incrementChapterCompletion}
            onToggleChapterPublish={toggleChapterPublish}
          />
        )}
      </AnimatePresence>

      <SuggestionsInbox 
        isOpen={showSuggestionsInbox} 
        onClose={() => setShowSuggestionsInbox(false)}
        suggestions={suggestions.filter(s => s.storyOwnerId === (user?.uid || ''))}
        onResolve={updateSuggestionStatus}
        stories={stories}
      />

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

// Star Rating Component
// Finish Chapter Button
function FinishChapterButton({ onFinish, isFinished }: { onFinish: () => void; isFinished: boolean }) {
  if (isFinished) {
    return (
      <div className="flex items-center gap-2 text-green-500 font-bold bg-green-50 px-6 py-4 rounded-3xl border-2 border-green-100 mt-12 animate-in fade-in slide-in-from-bottom-4">
        <Check size={20} />
        <span>Chapter Read & Unlocked</span>
      </div>
    );
  }

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onFinish}
      className="flex items-center gap-3 bg-brand-800 text-brand-50 px-8 py-4 rounded-3xl font-bold shadow-xl hover:bg-brand-700 transition-all mt-12 group overflow-hidden relative"
    >
      <div className="relative z-10 flex items-center gap-3">
        <Zap size={20} className="group-hover:animate-pulse" />
        <span>Finish Chapter & Unlock Next</span>
      </div>
      <motion.div 
        className="absolute inset-0 bg-brand-600/50"
        initial={{ x: '-100%' }}
        whileHover={{ x: '100%' }}
        transition={{ duration: 0.6, repeat: Infinity }}
      />
    </motion.button>
  );
}

function EditorView({ 
  story, 
  onBack, 
  onUpdate, 
  isLoggedIn, 
  user,
  suggestions,
  onUpdateSuggestionStatus,
  onOpenSuggestions,
  pendingSuggestionsCount,
  onIncrementCompletion, 
  onToggleChapterPublish 
}: { 
  story: Story; 
  onBack: () => void; 
  onUpdate: (updates: Partial<Story>) => void;
  isLoggedIn: boolean;
  user: FirebaseUser | null;
  suggestions: Suggestion[];
  onUpdateSuggestionStatus: (id: string, status: 'accepted' | 'dismissed') => Promise<void>;
  onOpenSuggestions: () => void;
  pendingSuggestionsCount: number;
  onIncrementCompletion: (storyId: string, chapterId: string) => Promise<void>;
  onToggleChapterPublish: (storyId: string, chapterId: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'write' | 'characters' | 'plot' | 'world'>('write');
  const [showGenreSelector, setShowGenreSelector] = useState(false);
  const [currentChapterId, setCurrentChapterId] = useState<string>(story.chapters[0]?.id || '');
  const [showAiHelper, setShowAiHelper] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);

  // For readers, only show published chapters
  const activeChapters = useMemo(() => 
    story.chapters
      .filter(c => !c.isDeleted && (isLoggedIn || c.isPublished))
      .sort((a, b) => a.order - b.order),
    [story.chapters, isLoggedIn]
  );

  const { isUnlocked, unlockNext } = useReaderProgression(story.id, activeChapters, isLoggedIn, story.lockVersion);

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
  const [localContent, setLocalContent] = useState(currentChapter?.content || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewMode, setIsReviewMode] = useState(false);

  useEffect(() => {
    setLocalContent(currentChapter?.content || '');
    setIsReviewMode(false);
  }, [currentChapter?.id]);

  // Debounced update for Firestore
  useEffect(() => {
    if (!isLoggedIn || !currentChapter) return;
    
    // Don't save if content hasn't changed from the story's version
    if (localContent === currentChapter.content) return;

    setIsSaving(true);
    const timeoutId = setTimeout(() => {
      updateChapter(currentChapter.id, { content: localContent });
      setIsSaving(false);
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeoutId);
  }, [localContent, currentChapter?.id, isLoggedIn]);

  const updateChapter = (chapterId: string, updates: Partial<Chapter>) => {
    onUpdate({
      chapters: story.chapters.map(c => c.id === chapterId ? { ...c, ...updates } : c)
    });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setLocalContent(newContent);
    // Removed immediate updateChapter call to rely on debounced useEffect
  };

  const addChapter = () => {
    if (!isLoggedIn) return;
    const activeCount = story.chapters.filter(c => !c.isDeleted).length;
    const newChapter: Chapter = {
      id: crypto.randomUUID(),
      title: `Chapter ${activeCount + 1}`,
      content: '',
      imageUrl: '',
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
              <DebouncedInput
                type="text"
                value={story.title}
                onChange={(val) => onUpdate({ title: val })}
                readOnly={!isLoggedIn}
                className={cn(
                  "text-lg md:text-xl font-bold bg-transparent border-none focus:outline-none text-brand-900 placeholder:text-brand-200 truncate",
                  !isLoggedIn && "cursor-default"
                )}
                placeholder="Novel Title"
              />
              <DebouncedInput
                type="text"
                value={story.subtitle || ''}
                onChange={(val) => onUpdate({ subtitle: val })}
                readOnly={!isLoggedIn}
                className={cn(
                  "text-xs md:text-sm italic bg-transparent border-none focus:outline-none text-brand-400 placeholder:text-brand-200 truncate",
                  !isLoggedIn && "cursor-default"
                )}
                placeholder="Novel Subtitle"
              />

              {isLoggedIn && (
                <div className="flex items-center gap-2 mt-1 max-w-xs">
                  <div className="p-1.5 bg-brand-50 rounded-lg text-brand-400">
                    <ImageIcon size={14} />
                  </div>
                  <div className="flex flex-col flex-1">
                    <DebouncedInput
                      type="text"
                      value={story.imageUrl || ''}
                      onChange={(val) => onUpdate({ imageUrl: val })}
                      className="text-[10px] bg-transparent border-none focus:outline-none text-brand-400 placeholder:text-brand-200 truncate"
                      placeholder="Cover Photo URL (Paste Pinterest Link)"
                    />
                    {story.imageUrl && !story.imageUrl.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)/i) && !story.imageUrl.includes('pinimg.com') && (
                      <span className="text-[8px] text-amber-600 font-medium px-1 leading-none mt-0.5">
                        Tip: Right-click image and "Copy Image Address" for Best results
                      </span>
                    )}
                  </div>
                </div>
              )}
              
              <div className="flex flex-wrap gap-1 mt-1">
                {story.genres && story.genres.map(g => (
                  <span key={g} className="flex items-center gap-1 px-2 py-0.5 bg-brand-100 text-brand-600 rounded-md text-[10px] font-bold">
                    {g}
                    {isLoggedIn && (
                      <button 
                        onClick={() => onUpdate({ genres: story.genres.filter(genre => genre !== g) })}
                        className="hover:text-red-500"
                      >
                        <X size={10} />
                      </button>
                    )}
                  </span>
                ))}
                {isLoggedIn && (
                  <div className="relative">
                    <button 
                      onClick={() => setShowGenreSelector(!showGenreSelector)}
                      className="px-2 py-0.5 bg-brand-50 text-brand-400 rounded-md text-[10px] font-bold hover:bg-brand-100 transition-colors"
                    >
                      + Add Genre
                    </button>
                    <AnimatePresence>
                      {showGenreSelector && (
                        <motion.div 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute left-0 top-full mt-1 w-40 bg-white border border-brand-100 rounded-xl shadow-xl z-50 p-2 max-h-48 overflow-y-auto no-scrollbar"
                        >
                          {GENRES.filter(g => !story.genres?.includes(g)).map(genre => (
                            <button
                              key={genre}
                              onClick={() => {
                                onUpdate({ genres: [...(story.genres || []), genre] });
                                setShowGenreSelector(false);
                              }}
                              className="w-full text-left px-3 py-1.5 text-[10px] font-bold text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
                            >
                              {genre}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          </div>
          {!isLoggedIn && (
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-brand-100 text-brand-600 rounded-full text-[10px] font-bold uppercase tracking-wider mx-2">
              <Eye size={12} /> Read Only
            </div>
          )}
        </div>
        
        <div className="hidden lg:flex items-center gap-1 bg-brand-50 p-1 rounded-2xl mx-4">
          {isLoggedIn && (
            <button
              onClick={() => {
                if (confirm("Master Fay, do you truly wish to wipe the memories of all who have tread these paths? (Reset all chapter completion counts and relock chapters for everyone)")) {
                  onUpdate({ 
                    chapters: story.chapters.map(c => ({ ...c, completions: 0 })), 
                    lockVersion: (story.lockVersion || 0) + 1
                  });
                }
              }}
              className="p-2 text-brand-300 hover:text-amber-500 transition-colors mx-1"
              title="Master Key: Reset All View Counts"
            >
              <ShieldAlert size={18} />
            </button>
          )}
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
          {isLoggedIn && (
            <TabButton 
              active={activeTab === 'plot'} 
              onClick={() => setActiveTab('plot')} 
              icon={<ListTodo size={18} />} 
              label="Plot" 
            />
          )}
          <TabButton 
            active={activeTab === 'world'} 
            onClick={() => setActiveTab('world')} 
            icon={<Globe size={18} />} 
            label="World" 
          />
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
            <>
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
            </>
          )}
        </div>
      </header>

      {/* Mobile Tab Navigation */}
      <div className="lg:hidden bg-white border-b border-brand-100 px-4 py-2 flex items-center justify-around overflow-x-auto no-scrollbar">
        {isLoggedIn && (
          <button
            onClick={() => {
              if (confirm("Master Fay, do you truly wish to wipe the memories of all who have tread these paths? (Reset all chapter completion counts and relock chapters for everyone)")) {
                onUpdate({ 
                  chapters: story.chapters.map(c => ({ ...c, completions: 0 })), 
                  lockVersion: (story.lockVersion || 0) + 1
                });
              }
            }}
            className="p-2 text-brand-300 hover:text-amber-500 transition-colors mx-1 shrink-0"
            title="Master Key: Reset All View Counts"
          >
            <ShieldAlert size={18} />
          </button>
        )}
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
        {isLoggedIn && (
          <TabButton 
            active={activeTab === 'plot'} 
            onClick={() => setActiveTab('plot')} 
            icon={<ListTodo size={18} />} 
            label="Plot" 
          />
        )}
        <TabButton 
          active={activeTab === 'world'} 
          onClick={() => setActiveTab('world')} 
          icon={<Globe size={18} />} 
          label="World" 
        />
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
                {activeChapters.map((chapter) => {
                  const locked = !isUnlocked(chapter.id);
                  return (
                    <Reorder.Item
                      key={chapter.id}
                      value={chapter}
                      dragListener={isLoggedIn}
                      onClick={() => {
                        if (locked) return;
                        setCurrentChapterId(chapter.id);
                        if (window.innerWidth < 1024) setShowSidebar(false);
                      }}
                      className={cn(
                        "group flex items-center gap-2 p-3 rounded-xl transition-all",
                        locked ? "opacity-50 cursor-not-allowed grayscale" : "cursor-pointer",
                        currentChapterId === chapter.id 
                          ? "bg-brand-100 text-brand-900 font-medium" 
                          : locked ? "text-brand-300" : "hover:bg-brand-50 text-brand-600"
                      )}
                    >
                      {isLoggedIn ? (
                        <div className="cursor-grab active:cursor-grabbing text-brand-300 group-hover:text-brand-400">
                          <GripVertical size={16} />
                        </div>
                      ) : (
                        locked ? <Pin size={14} className="text-brand-400" /> : <BookOpen size={14} className="text-brand-500" />
                      )}
                      <div className="flex flex-col truncate flex-1">
                        <div className="flex items-center gap-2 truncate">
                          <span className="truncate">{chapter.title}</span>
                          {isLoggedIn && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleChapterPublish(story.id, chapter.id);
                              }}
                              className={cn(
                                "flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full transition-colors",
                                chapter.isPublished 
                                  ? "bg-green-100 text-green-700 hover:bg-green-200" 
                                  : "bg-brand-100 text-brand-400 hover:bg-brand-200"
                              )}
                              title={chapter.isPublished ? "Published" : "Click to Publish"}
                            >
                              {chapter.isPublished ? <Eye size={8} /> : <Book size={8} />}
                              {chapter.isPublished ? "Live" : "Draft"}
                            </button>
                          )}
                          {isLoggedIn && (chapter.completions || 0) > 0 && (
                            <span className="flex items-center gap-0.5 bg-brand-200 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full">
                              <User size={8} /> {chapter.completions}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-brand-400 font-normal">
                          {getWordCount(chapter.content)} words
                        </span>
                      </div>
                      {isLoggedIn && (
                        <button 
                          onClick={(e) => deleteChapter(chapter.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </Reorder.Item>
                  );
                })}
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
                {/* Chapter Cover Hero Section */}
                {currentChapter.imageUrl && (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-full h-48 md:h-64 rounded-3xl overflow-hidden shadow-2xl relative group mb-2"
                  >
                    <img 
                      src={currentChapter.imageUrl} 
                      alt={currentChapter.title} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = "w-full h-full flex flex-col items-center justify-center text-white/50 p-4 text-center bg-brand-900";
                          fallback.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mb-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                            <span class="text-sm font-bold">Image Failed to Load</span>
                            <p class="text-xs mt-1 text-white/40">Try "Copy Image Address" instead of pasting the page URL.</p>
                          `;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-brand-900/60 to-transparent" />
                    <div className="absolute bottom-6 left-6 right-6">
                       <h2 className="text-white text-lg font-serif italic opacity-80">{currentChapter.title}</h2>
                    </div>
                  </motion.div>
                )}
                
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <input
                      type="text"
                      value={currentChapter.title}
                      onChange={(e) => updateChapter(currentChapter.id, { title: e.target.value })}
                      readOnly={!isLoggedIn}
                      className={cn(
                        "text-2xl md:text-3xl font-bold font-serif bg-transparent border-none focus:outline-none text-brand-900 placeholder:text-brand-200 w-full",
                        !isLoggedIn && "cursor-default"
                      )}
                      placeholder="Chapter Title"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-2 px-1 opacity-40 hover:opacity-100 transition-opacity">
                        <ImageIcon size={14} className="text-brand-400 shrink-0" />
                        <input
                          type="text"
                          value={currentChapter.imageUrl || ''}
                          onChange={(e) => updateChapter(currentChapter.id, { imageUrl: e.target.value })}
                          className="text-[10px] bg-transparent border-none focus:outline-none text-brand-400 placeholder:text-brand-200 w-full"
                          placeholder="Chapter Cover Image URL (Pinterest Link)"
                        />
                      </div>
                    )}
                  </div>
                </div>
                {isLoggedIn && !isReviewMode ? (
                  <textarea
                    value={localContent}
                    onChange={handleContentChange}
                    className="w-full flex-1 min-h-[60vh] bg-transparent border-none focus:outline-none resize-none writing-area placeholder:text-brand-200"
                    placeholder="Start writing your chapter..."
                    autoFocus
                  />
                ) : (
                  <ReaderContentView
                    content={localContent}
                    chapterId={currentChapter.id}
                    storyId={story.id}
                    storyOwnerId={story.ownerId}
                    suggestions={suggestions.filter(s => s.chapterId === currentChapter.id)}
                    user={user}
                    onUpdateSuggestionStatus={onUpdateSuggestionStatus}
                  />
                )}
                <div className="flex justify-between items-center text-xs text-brand-400 font-medium pt-4 border-t border-brand-100">
                  <div className="flex items-center gap-2">
                    {getWordCount(localContent)} words in this chapter
                    {isSaving && (
                      <span className="flex items-center gap-1 text-brand-300 italic animate-pulse">
                        <Cloud size={12} /> Saving...
                      </span>
                    )}
                    {!isSaving && localContent !== currentChapter.content && (
                      <span className="flex items-center gap-1 text-brand-300 italic">
                        <Check size={12} /> Changes pending...
                      </span>
                    )}
                    {!isSaving && localContent === currentChapter.content && (
                      <span className="flex items-center gap-1 text-green-400 italic">
                        <Check size={12} /> Saved to cloud
                      </span>
                    )}
                  </div>
                </div>

                {!isLoggedIn && (
                  <div className="flex flex-col items-center">
                    {activeChapters.findIndex(c => c.id === currentChapter.id) < activeChapters.length - 1 && (
                      <FinishChapterButton 
                        isFinished={isUnlocked(activeChapters[activeChapters.findIndex(c => c.id === currentChapter.id) + 1]?.id || '')}
                        onFinish={async () => {
                          const nextId = unlockNext(currentChapter.id);
                          await onIncrementCompletion(story.id, currentChapter.id);
                          if (nextId) setCurrentChapterId(nextId);
                        }}
                      />
                    )}
                    
                    {activeChapters.findIndex(c => c.id === currentChapter.id) === activeChapters.length - 1 && (
                      <div className="text-center mt-12 p-8 border-t border-brand-100 w-full mb-8">
                        <Sparkles size={32} className="mx-auto text-amber-500 mb-4" />
                        <h4 className="text-xl font-bold font-serif text-brand-900">You've reached the end of the current chapters!</h4>
                        <p className="text-brand-500 mt-2 text-sm">Return soon as the Master inks more worlds.</p>
                      </div>
                    )}
                  </div>
                )}
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

            {activeTab === 'plot' && currentChapter && (
              <PlotManager 
                storyTitle={currentChapter.title}
                plotPoints={currentChapter.plotPoints} 
                onUpdate={(points) => updateChapter(currentChapter.id, { plotPoints: points })} 
                isLoggedIn={isLoggedIn}
              />
            )}

            {activeTab === 'world' && (
              <WorldManager 
                storyTitle={story.title}
                creatures={story.creatures || []}
                locations={story.locations || []}
                factions={story.factions || []}
                skills={story.skills || []}
                weapons={story.weapons || []}
                onUpdateCreatures={(creatures) => onUpdate({ creatures })}
                onUpdateLocations={(locations) => onUpdate({ locations })}
                onUpdateFactions={(factions) => onUpdate({ factions })}
                onUpdateSkills={(skills) => onUpdate({ skills })}
                onUpdateWeapons={(weapons) => onUpdate({ weapons })}
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
            <div className="absolute top-0 right-0 bg-brand-100 text-brand-600 text-[10px] font-bold px-2 py-1 rounded-bl-xl z-10">
              #{index + 1}
            </div>
            <div className="flex flex-col gap-6 pt-2">
              {/* Character Image Preview */}
              {char.imageUrl && (
                <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border-2 border-brand-100 relative group/img">
                  <img 
                    src={char.imageUrl} 
                    alt={char.name} 
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      const parent = e.currentTarget.parentElement;
                      if (parent) {
                        const fallback = document.createElement('div');
                        fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-2 text-center bg-brand-50";
                        fallback.innerHTML = `
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          <span class="text-[8px] mt-2 font-medium">Image failed. Right-click Pinterest image and "Copy Image Address" instead of pasting the page URL</span>
                        `;
                        parent.appendChild(fallback);
                      }
                    }}
                  />
                  {isLoggedIn && (
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex flex-col items-center justify-center p-2 text-center pointer-events-none">
                      <ImageIcon size={24} className="text-white mb-2" />
                      <span className="text-xs text-white font-bold leading-tight">Paste URL in the Link field below</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 space-y-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                    <div className="flex-1 flex flex-col gap-3 w-full">
                      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <div className="flex-1 flex flex-col gap-1">
                          <DebouncedInput
                            placeholder="Name"
                            value={char.name}
                            onChange={(val) => updateChar(char.id, { name: val })}
                            readOnly={!isLoggedIn}
                            className={cn(
                              "text-lg md:text-xl font-bold border-b-2 border-transparent focus:border-brand-200 focus:outline-none bg-transparent",
                              !isLoggedIn && "cursor-default"
                            )}
                          />
                          {isLoggedIn && (
                            <div className="flex flex-col gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                              <div className="flex items-center gap-1">
                                <ImageIcon size={10} className="text-brand-400" />
                                <DebouncedInput
                                  placeholder="Image URL (Pinterest Link)"
                                  value={char.imageUrl || ''}
                                  onChange={(val) => updateChar(char.id, { imageUrl: val })}
                                  className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                                />
                              </div>
                              {char.imageUrl && !char.imageUrl.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)/i) && !char.imageUrl.includes('pinimg.com') && (
                                <span className="text-[7px] text-amber-600 font-medium leading-none">
                                  Use "Copy Image Address" for best results
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <DebouncedInput
                            placeholder="Role (e.g. Protagonist)"
                            value={char.role}
                            onChange={(val) => updateChar(char.id, { role: val })}
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
                <DebouncedTextarea
                  placeholder={isLoggedIn ? "Description, backstory, motivations..." : "No description provided."}
                  value={char.description}
                  onChange={(val) => updateChar(char.id, { description: val })}
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
                        <DebouncedInput
                          type="text"
                          value={trait}
                          onChange={(val) => {
                            const newTraits = [...char.traits];
                            newTraits[tIndex] = val;
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
              <DebouncedInput
                placeholder="Plot Event Title"
                value={point.title}
                onChange={(val) => updatePoint(point.id, { title: val })}
                readOnly={!isLoggedIn}
                className={cn(
                  "w-full font-bold focus:outline-none text-sm md:text-base",
                  point.isCompleted && "line-through text-brand-300",
                  !isLoggedIn && "cursor-default"
                )}
              />
              <DebouncedTextarea
                placeholder={isLoggedIn ? "Details about this event..." : "No details provided."}
                value={point.description}
                onChange={(val) => updatePoint(point.id, { description: val })}
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

function HighlightedMarkdown({ 
  content, 
  suggestions,
  onOpenSuggestion
}: { 
  content: string; 
  suggestions: Suggestion[];
  onOpenSuggestion?: (s: Suggestion) => void;
}) {
  // Only highlight pending suggestions
  const activeSuggestions = suggestions.filter(s => s.status === 'pending');
  
  if (activeSuggestions.length === 0) {
    return <>{content}</>;
  }

  // Pre-process content to inject highlights
  // Note: This is a simple implementation that matches exact strings.
  // In a more robust system, we would use offsets, but for this app's scale, text matching works.
  let highlightedContent = content;
  
  // We sort by length descending to avoid nested replacement issues if one suggestion is a subset of another
  const sortedSuggestions = [...activeSuggestions].sort((a, b) => b.selectedText.length - a.selectedText.length);

  // We use a temporary tokenization strategy to avoid replacing within already replaced blocks
  sortedSuggestions.forEach((s, idx) => {
    const token = `__SUGGESTION_${idx}__`;
    // Escape regex special chars
    const escaped = s.selectedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    
    if (highlightedContent.includes(s.selectedText)) {
      highlightedContent = highlightedContent.replace(regex, token);
    }
  });

  // Split tokens to render JSX spans for highlights and raw text strings for the rest
  const parts = highlightedContent.split(/(__SUGGESTION_\d+__)/);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('__SUGGESTION_')) {
          const sugIdx = parseInt(part.match(/\d+/)![0]);
          const sug = sortedSuggestions[sugIdx];
          return (
            <span 
              key={i} 
              onClick={() => onOpenSuggestion?.(sug)}
              className="bg-amber-100 border-b-2 border-amber-400 cursor-pointer hover:bg-amber-200 transition-colors px-0.5 rounded-sm relative group decoration-clone"
              title="Click to view suggestion"
            >
              {sug.selectedText}
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-brand-800 text-white text-[10px] py-1 px-2 rounded opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50">
                Reader Suggestion
              </span>
            </span>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </>
  );
}

function ReaderContentView({ 
  content, 
  chapterId, 
  storyId, 
  storyOwnerId, 
  suggestions,
  user,
  onUpdateSuggestionStatus
}: { 
  content: string; 
  chapterId: string; 
  storyId: string; 
  storyOwnerId: string; 
  suggestions: Suggestion[];
  user: FirebaseUser | null;
  onUpdateSuggestionStatus?: (id: string, status: 'accepted' | 'dismissed' | 'pending') => Promise<void>;
}) {
  const [selection, setSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [suggestionText, setSuggestionText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const [viewingSuggestion, setViewingSuggestion] = useState<Suggestion | null>(null);

  const handleMouseUp = () => {
    if (viewingSuggestion) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim().length > 0) {
      const range = sel.getRangeAt(0);
      if (contentRef.current?.contains(range.commonAncestorContainer)) {
        const rect = range.getBoundingClientRect();
        setSelection({ text: sel.toString(), rect });
      } else {
        setSelection(null);
      }
    } else {
      setSelection(null);
    }
  };

  const submitSuggestion = async () => {
    if (!selection || !user) return;
    try {
      await addDoc(collection(db, 'suggestions'), {
        storyId,
        storyOwnerId,
        chapterId,
        readerId: user.uid,
        readerEmail: user.email || 'Anonymous Reader',
        selectedText: selection.text,
        suggestedText: suggestionText,
        status: 'pending',
        createdAt: Date.now()
      });
      setShowSuggestModal(false);
      setSuggestionText('');
      setSelection(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'suggestions');
    }
  };

  return (
    <div className="relative" onMouseUp={handleMouseUp}>
      <div ref={contentRef} className="writing-area whitespace-pre-wrap text-brand-900 leading-relaxed min-h-[60vh] selection:bg-amber-200">
        <HighlightedMarkdown 
          content={content} 
          suggestions={suggestions.filter(s => s.readerId === user?.uid || s.storyOwnerId === user?.uid)}
          onOpenSuggestion={(s) => setViewingSuggestion(s)}
        />
      </div>
      
      {selection && !showSuggestModal && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ 
            position: 'fixed', 
            top: selection.rect.top - 50, 
            left: Math.max(20, selection.rect.left + (selection.rect.width / 2) - 60)
          }}
          onClick={() => setShowSuggestModal(true)}
          className="z-[100] bg-brand-800 text-white px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2 hover:bg-brand-700 transition-all"
        >
          <Sparkles size={14} className="text-amber-400" /> Suggest Better Word
        </motion.button>
      )}

      <AnimatePresence>
        {showSuggestModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl space-y-6"
            >
              <div>
                <h3 className="text-xl font-bold font-serif text-brand-900 mb-1">Make a Suggestion</h3>
                <p className="text-xs text-brand-400">Your insight will be shared privately with Master Fay.</p>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">Original Text:</p>
                <div className="p-4 bg-brand-50 rounded-2xl text-sm italic text-brand-600 border-l-4 border-brand-200">
                  "{selection?.text}"
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">Your Suggestion:</p>
                <textarea
                  autoFocus
                  value={suggestionText}
                  onChange={(e) => setSuggestionText(e.target.value)}
                  className="w-full bg-brand-50 border-2 border-transparent focus:border-brand-200 focus:bg-white rounded-2xl py-4 px-5 outline-none transition-all text-sm h-32 resize-none"
                  placeholder="How would you rewrite this part?"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={submitSuggestion}
                  disabled={!suggestionText.trim()}
                  className="flex-1 bg-brand-800 text-brand-50 py-4 rounded-2xl font-bold hover:bg-brand-700 transition-all disabled:opacity-50 shadow-lg"
                >
                  Send to Master
                </button>
                <button
                  onClick={() => { setShowSuggestModal(false); setSelection(null); }}
                  className="px-6 py-4 rounded-2xl font-bold text-brand-400 hover:text-brand-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {viewingSuggestion && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-xl font-bold font-serif text-brand-900 mb-1">Your Suggestion</h3>
                  <p className="text-xs text-brand-400">Status: <span className="capitalize font-bold text-brand-600">{viewingSuggestion.status}</span></p>
                </div>
                <button onClick={() => setViewingSuggestion(null)} className="p-2 hover:bg-brand-50 rounded-full">
                  <XCircle size={20} className="text-brand-300" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-brand-400 uppercase">Selected Part:</p>
                  <p className="text-sm italic text-brand-600 bg-brand-50 p-4 rounded-xl border-l-4 border-brand-200">"{viewingSuggestion.selectedText}"</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-brand-400 uppercase">Suggested Rewrite:</p>
                  <div className="text-sm text-brand-800 bg-brand-50 p-4 rounded-xl border border-brand-100 italic">
                    {viewingSuggestion.suggestedText}
                  </div>
                </div>
              </div>

              {user?.uid === storyOwnerId ? (
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      if (onUpdateSuggestionStatus) await onUpdateSuggestionStatus(viewingSuggestion.id, 'accepted');
                      setViewingSuggestion(null);
                    }}
                    className="flex-1 bg-brand-800 text-brand-50 py-4 rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg text-xs"
                  >
                    Keep Idea
                  </button>
                  <button
                    onClick={async () => {
                      if (onUpdateSuggestionStatus) await onUpdateSuggestionStatus(viewingSuggestion.id, 'dismissed');
                      setViewingSuggestion(null);
                    }}
                    className="flex-1 bg-white text-brand-500 py-4 rounded-2xl font-bold border border-brand-100 hover:bg-brand-50 transition-all text-xs"
                  >
                    Unhighlight
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setViewingSuggestion(null)}
                  className="w-full bg-brand-800 text-brand-50 py-4 rounded-2xl font-bold hover:bg-brand-700 transition-all shadow-lg"
                >
                  Close View
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SuggestionsInbox({ 
  isOpen, 
  onClose, 
  suggestions, 
  onResolve,
  stories
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  suggestions: Suggestion[];
  onResolve: (id: string, status: 'pending' | 'accepted' | 'dismissed') => Promise<void>;
  stories: Story[];
}) {
  const pending = suggestions.filter(s => s.status === 'pending').sort((a, b) => b.createdAt - a.createdAt);
  const resolved = suggestions.filter(s => s.status !== 'pending').sort((a, b) => (b.resolvedAt || 0) - (a.resolvedAt || 0));

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-brand-900/40 backdrop-blur-sm z-[110]"
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 bottom-0 w-full sm:w-[450px] bg-white shadow-2xl z-[120] flex flex-col border-l border-brand-100"
          >
            <div className="p-6 border-b border-brand-100 flex items-center justify-between bg-brand-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
                  <Bell size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-bold font-serif text-brand-900">Reader Suggestions</h3>
                  <p className="text-xs text-brand-500 font-medium">{pending.length} pending insights</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-brand-100 rounded-full text-brand-400 hover:text-brand-600 transition-all"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
              {pending.length > 0 ? (
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold text-brand-400 uppercase tracking-widest px-1">New Submissions</h4>
                  {pending.map(s => {
                    const story = stories.find(st => st.id === s.storyId);
                    const chapter = story?.chapters.find(c => c.id === s.chapterId);
                    return (
                      <div key={s.id} className="bg-brand-50/50 border border-brand-100 rounded-2xl p-5 space-y-4 hover:border-brand-200 transition-colors shadow-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] bg-white px-2 py-0.5 rounded-full border border-brand-100 font-bold text-brand-400 uppercase">
                            {story?.title || 'Unknown Novel'} : {chapter?.title || 'Chapter'}
                          </span>
                          <span className="text-[10px] font-medium text-brand-300">
                            {new Date(s.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-brand-400 uppercase tracking-tighter">Your Original Text:</p>
                          <blockquote className="text-xs italic text-brand-500 bg-white p-3 rounded-xl border-l-2 border-brand-200 line-clamp-3">
                            "{s.selectedText}"
                          </blockquote>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[10px] font-bold text-brand-700 uppercase tracking-tighter flex items-center gap-1">
                            <MessageCircle size={10} /> Reader's Suggestion:
                          </p>
                          <div className="text-sm text-brand-800 bg-white p-4 rounded-xl border border-brand-100 shadow-sm leading-relaxed">
                            {s.suggestedText}
                          </div>
                        </div>

                        <div className="flex gap-2 pt-2">
                          <button
                            onClick={() => onResolve(s.id, 'accepted')}
                            className="flex-1 bg-brand-800 text-brand-50 py-2 rounded-xl text-xs font-bold hover:bg-brand-700 transition-all shadow-sm"
                          >
                            Keep in Mind
                          </button>
                          <button
                            onClick={() => onResolve(s.id, 'dismissed')}
                            className="flex-1 bg-white text-brand-500 py-2 rounded-xl text-xs font-bold border border-brand-100 hover:bg-brand-50 transition-all"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-20 text-center space-y-4 opacity-40">
                  <BookOpen size={48} className="mx-auto text-brand-200" />
                  <p className="text-brand-500 font-medium">No new suggestions yet, Master.</p>
                </div>
              )}

              {resolved.length > 0 && (
                <div className="space-y-4 pt-8 opacity-60">
                  <h4 className="text-[10px] font-bold text-brand-400 uppercase tracking-widest px-1">Archive</h4>
                  {resolved.slice(0, 5).map(s => (
                    <div key={s.id} className="bg-white border border-brand-50 rounded-xl p-4 flex items-center justify-between">
                      <div className="truncate flex-1">
                        <p className="text-xs font-bold text-brand-900 truncate">"{s.selectedText}"</p>
                        <p className="text-[10px] text-brand-400">Status: {s.status}</p>
                      </div>
                      <RotateCcw 
                        size={14} 
                        className="text-brand-300 cursor-pointer hover:text-brand-600 ml-4"
                        onClick={() => onResolve(s.id, 'pending')}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function WorldManager({ 
  storyTitle, 
  creatures, 
  locations, 
  factions,
  skills,
  weapons,
  onUpdateCreatures, 
  onUpdateLocations, 
  onUpdateFactions,
  onUpdateSkills,
  onUpdateWeapons,
  isLoggedIn 
}: { 
  storyTitle: string; 
  creatures: Creature[]; 
  locations: Location[]; 
  factions: Faction[];
  skills: Skill[];
  weapons: Weapon[];
  onUpdateCreatures: (creatures: Creature[]) => void; 
  onUpdateLocations: (locations: Location[]) => void; 
  onUpdateFactions: (factions: Faction[]) => void;
  onUpdateSkills: (skills: Skill[]) => void;
  onUpdateWeapons: (weapons: Weapon[]) => void;
  isLoggedIn: boolean;
}) {
  const addCreature = () => {
    const newCreature: Creature = {
      id: crypto.randomUUID(),
      name: 'New Creature',
      species: 'Unknown',
      habitat: 'Unknown',
      abilities: '',
      threatLevel: 'low',
      description: ''
    };
    onUpdateCreatures([...creatures, newCreature]);
  };

  const updateCreature = (id: string, updates: Partial<Creature>) => {
    onUpdateCreatures(creatures.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const removeCreature = (id: string) => {
    onUpdateCreatures(creatures.filter(c => c.id !== id));
  };

  const addLocation = () => {
    const newLocation: Location = {
      id: crypto.randomUUID(),
      name: 'New Location',
      climate: 'Unknown',
      rulingPower: 'Unknown',
      lore: '',
      description: ''
    };
    onUpdateLocations([...locations, newLocation]);
  };

  const updateLocation = (id: string, updates: Partial<Location>) => {
    onUpdateLocations(locations.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeLocation = (id: string) => {
    onUpdateLocations(locations.filter(l => l.id !== id));
  };

  const addFaction = () => {
    const newFaction: Faction = {
      id: crypto.randomUUID(),
      name: 'New Faction',
      leader: 'Unknown',
      influence: 'Low',
      alignment: 'neutral',
      description: ''
    };
    onUpdateFactions([...factions, newFaction]);
  };

  const updateFaction = (id: string, updates: Partial<Faction>) => {
    onUpdateFactions(factions.map(f => f.id === id ? { ...f, ...updates } : f));
  };

  const removeFaction = (id: string) => {
    onUpdateFactions(factions.filter(f => f.id !== id));
  };

  const addSkill = () => {
    const newSkill: Skill = {
      id: crypto.randomUUID(),
      name: 'New Skill',
      category: 'Common',
      description: ''
    };
    onUpdateSkills([...skills, newSkill]);
  };

  const updateSkill = (id: string, updates: Partial<Skill>) => {
    onUpdateSkills(skills.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const removeSkill = (id: string) => {
    onUpdateSkills(skills.filter(s => s.id !== id));
  };

  const addWeapon = () => {
    const newWeapon: Weapon = {
      id: crypto.randomUUID(),
      name: 'New Weapon',
      rarity: 'Common',
      description: ''
    };
    onUpdateWeapons([...weapons, newWeapon]);
  };

  const updateWeapon = (id: string, updates: Partial<Weapon>) => {
    onUpdateWeapons(weapons.map(w => w.id === id ? { ...w, ...updates } : w));
  };

  const removeWeapon = (id: string) => {
    onUpdateWeapons(weapons.filter(w => w.id !== id));
  };

  return (
    <div className="space-y-12 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-brand-100 pb-6">
        <div>
          <h2 className="text-2xl md:text-3xl font-bold font-serif text-brand-900">{storyTitle}: World Codex</h2>
          <p className="text-brand-500 text-sm mt-1">Manage all aspects of your world in one place.</p>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">
          <a href="#bestiary" className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-bold hover:bg-brand-100 transition-colors whitespace-nowrap flex items-center gap-1.5">
            <Ghost size={12} /> Bestiary
          </a>
          <a href="#locations" className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-bold hover:bg-brand-100 transition-colors whitespace-nowrap flex items-center gap-1.5">
            <MapPin size={12} /> Locations
          </a>
          <a href="#factions" className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-bold hover:bg-brand-100 transition-colors whitespace-nowrap flex items-center gap-1.5">
            <ShieldAlert size={12} /> Factions
          </a>
          <a href="#skills" className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-bold hover:bg-brand-100 transition-colors whitespace-nowrap flex items-center gap-1.5">
            <Zap size={12} /> Skills
          </a>
          <a href="#weapons" className="px-3 py-1.5 bg-brand-50 text-brand-700 rounded-full text-xs font-bold hover:bg-brand-100 transition-colors whitespace-nowrap flex items-center gap-1.5">
            <Sword size={12} /> Weapons
          </a>
        </div>
      </div>

      {/* Bestiary Section */}
      <section id="bestiary" className="space-y-6 scroll-mt-24">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-brand-800 flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-xl text-brand-600">
              <Ghost size={24} />
            </div>
            The Bestiary
          </h3>
          {isLoggedIn && (
            <button onClick={addCreature} className="bg-brand-800 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-brand-700 transition-all shadow-sm">
              <Plus size={18} /> Add Creature
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {creatures.map(creature => (
            <div key={creature.id} className="bg-white p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative group hover:border-brand-300 transition-all">
              {isLoggedIn && (
                <button 
                  onClick={() => removeCreature(creature.id)}
                  className="absolute top-4 right-4 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
              <div className="flex flex-col gap-6">
                {/* Creature Image */}
                {creature.imageUrl && (
                  <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border border-brand-100 relative group/img">
                    <img 
                      src={creature.imageUrl} 
                      alt={creature.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-2 text-center bg-brand-50";
                          fallback.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          `;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex-1 space-y-4">
                  <div className="flex flex-col gap-1">
                    <DebouncedInput
                      placeholder="Creature Name"
                      value={creature.name}
                      onChange={(val) => updateCreature(creature.id, { name: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xl font-bold bg-transparent focus:outline-none placeholder:text-brand-200"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-brand-400" />
                        <DebouncedInput
                          placeholder="Image URL"
                          value={creature.imageUrl || ''}
                          onChange={(val) => updateCreature(creature.id, { imageUrl: val })}
                          className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                        />
                      </div>
                    )}
                  </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Species</label>
                    <DebouncedInput
                      placeholder="e.g. Dragon"
                      value={creature.species}
                      onChange={(val) => updateCreature(creature.id, { species: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Habitat</label>
                    <DebouncedInput
                      placeholder="e.g. Volcanic Peaks"
                      value={creature.habitat}
                      onChange={(val) => updateCreature(creature.id, { habitat: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Threat Level</label>
                  <div className="flex gap-2">
                    {(['low', 'medium', 'high', 'calamity'] as const).map(level => (
                      <button
                        key={level}
                        onClick={() => updateCreature(creature.id, { threatLevel: level })}
                        disabled={!isLoggedIn}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all",
                          creature.threatLevel === level 
                            ? level === 'low' ? "bg-green-500 text-white shadow-md shadow-green-100" :
                              level === 'medium' ? "bg-yellow-500 text-white shadow-md shadow-yellow-100" :
                              level === 'high' ? "bg-orange-500 text-white shadow-md shadow-orange-100" :
                              "bg-red-600 text-white shadow-md shadow-red-100"
                            : "bg-brand-50 text-brand-400 hover:bg-brand-100"
                        )}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Abilities</label>
                  <DebouncedTextarea
                    placeholder="Magical powers, physical traits..."
                    value={creature.abilities}
                    onChange={(val) => updateCreature(creature.id, { abilities: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Description/Lore</label>
                  <DebouncedTextarea
                    placeholder="History, behavior, weaknesses..."
                    value={creature.description}
                    onChange={(val) => updateCreature(creature.id, { description: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-28"
                  />
                </div>
              </div>
            </div>
          </div>
          ))}
          {creatures.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-3xl border-2 border-dashed border-brand-100 text-brand-400">
              <Ghost size={40} className="mx-auto mb-4 opacity-20" />
              No creatures discovered yet. What lurks in the shadows?
            </div>
          )}
        </div>
      </section>

      {/* Locations Section */}
      <section id="locations" className="space-y-6 scroll-mt-24 pt-12 border-t border-brand-50">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-brand-800 flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-xl text-brand-600">
              <MapPin size={24} />
            </div>
            Locations
          </h3>
          {isLoggedIn && (
            <button onClick={addLocation} className="bg-brand-800 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-brand-700 transition-all shadow-sm">
              <Plus size={18} /> Add Location
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {locations.map(location => (
            <div key={location.id} className="bg-white p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative group hover:border-brand-300 transition-all">
              {isLoggedIn && (
                <button 
                  onClick={() => removeLocation(location.id)}
                  className="absolute top-4 right-4 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
              <div className="flex flex-col gap-6">
                {/* Location Image */}
                {location.imageUrl && (
                  <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border border-brand-100 relative group/img">
                    <img 
                      src={location.imageUrl} 
                      alt={location.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-2 text-center bg-brand-50";
                          fallback.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          `;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex-1 space-y-4">
                  <div className="flex flex-col gap-1">
                    <DebouncedInput
                      placeholder="Location Name"
                      value={location.name}
                      onChange={(val) => updateLocation(location.id, { name: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xl font-bold bg-transparent focus:outline-none placeholder:text-brand-200"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-brand-400" />
                        <DebouncedInput
                          placeholder="Image URL"
                          value={location.imageUrl || ''}
                          onChange={(val) => updateLocation(location.id, { imageUrl: val })}
                          className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                        />
                      </div>
                    )}
                  </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Climate</label>
                    <DebouncedInput
                      placeholder="e.g. Tropical"
                      value={location.climate}
                      onChange={(val) => updateLocation(location.id, { climate: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Ruling Power</label>
                    <DebouncedInput
                      placeholder="e.g. The Sun Empire"
                      value={location.rulingPower}
                      onChange={(val) => updateLocation(location.id, { rulingPower: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Lore/History</label>
                  <DebouncedTextarea
                    placeholder="Ancient legends, historical events..."
                    value={location.lore}
                    onChange={(val) => updateLocation(location.id, { lore: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-24"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Description</label>
                  <DebouncedTextarea
                    placeholder="Geography, atmosphere, landmarks..."
                    value={location.description}
                    onChange={(val) => updateLocation(location.id, { description: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-28"
                  />
                </div>
              </div>
            </div>
          </div>
          ))}
          {locations.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-3xl border-2 border-dashed border-brand-100 text-brand-400">
              <MapPin size={40} className="mx-auto mb-4 opacity-20" />
              The map is blank. Where does the journey begin?
            </div>
          )}
        </div>
      </section>

      {/* Factions Section */}
      <section id="factions" className="space-y-6 scroll-mt-24 pt-12 border-t border-brand-50">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-brand-800 flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-xl text-brand-600">
              <ShieldAlert size={24} />
            </div>
            Factions & Empires
          </h3>
          {isLoggedIn && (
            <button onClick={addFaction} className="bg-brand-800 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-brand-700 transition-all shadow-sm">
              <Plus size={18} /> Add Faction
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {factions.map(faction => (
            <div key={faction.id} className="bg-white p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative group hover:border-brand-300 transition-all">
              {isLoggedIn && (
                <button 
                  onClick={() => removeFaction(faction.id)}
                  className="absolute top-4 right-4 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
              <div className="flex flex-col gap-6">
                {/* Faction Image */}
                {faction.imageUrl && (
                  <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border border-brand-100 relative group/img">
                    <img 
                      src={faction.imageUrl} 
                      alt={faction.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-2 text-center bg-brand-50";
                          fallback.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          `;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex-1 space-y-4">
                  <div className="flex flex-col gap-1">
                    <DebouncedInput
                      placeholder="Faction Name"
                      value={faction.name}
                      onChange={(val) => updateFaction(faction.id, { name: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xl font-bold bg-transparent focus:outline-none placeholder:text-brand-200"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-brand-400" />
                        <DebouncedInput
                          placeholder="Image URL"
                          value={faction.imageUrl || ''}
                          onChange={(val) => updateFaction(faction.id, { imageUrl: val })}
                          className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                        />
                      </div>
                    )}
                  </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Leader</label>
                    <DebouncedInput
                      placeholder="e.g. Emperor Sol"
                      value={faction.leader}
                      onChange={(val) => updateFaction(faction.id, { leader: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Influence</label>
                    <DebouncedInput
                      placeholder="e.g. Continental"
                      value={faction.influence}
                      onChange={(val) => updateFaction(faction.id, { influence: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Alignment</label>
                  <div className="flex gap-2">
                    {(['ally', 'neutral', 'enemy'] as const).map(align => (
                      <button
                        key={align}
                        onClick={() => updateFaction(faction.id, { alignment: align })}
                        disabled={!isLoggedIn}
                        className={cn(
                          "flex-1 py-2 rounded-xl text-[10px] font-bold uppercase transition-all",
                          faction.alignment === align 
                            ? align === 'ally' ? "bg-blue-500 text-white shadow-md shadow-blue-100" :
                              align === 'neutral' ? "bg-gray-500 text-white shadow-md shadow-gray-100" :
                              "bg-red-500 text-white shadow-md shadow-red-100"
                            : "bg-brand-50 text-brand-400 hover:bg-brand-100"
                        )}
                      >
                        {align}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Description & Goals</label>
                  <DebouncedTextarea
                    placeholder="Their agenda, history, and relationship with the protagonist..."
                    value={faction.description}
                    onChange={(val) => updateFaction(faction.id, { description: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-28"
                  />
                </div>
              </div>
            </div>
          </div>
          ))}
          {factions.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-3xl border-2 border-dashed border-brand-100 text-brand-400">
              <ShieldAlert size={40} className="mx-auto mb-4 opacity-20" />
              No factions recorded. Who holds the power in this world?
            </div>
          )}
        </div>
      </section>

      {/* Skills Section */}
      <section id="skills" className="space-y-6 scroll-mt-24 pt-12 border-t border-brand-50">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-brand-800 flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-xl text-brand-600">
              <Zap size={24} />
            </div>
            Skills & Magic
          </h3>
          {isLoggedIn && (
            <button onClick={addSkill} className="bg-brand-800 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-brand-700 transition-all shadow-sm">
              <Plus size={18} /> Add Skill
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {skills.map(skill => (
            <div key={skill.id} className="bg-white p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative group hover:border-brand-300 transition-all">
              {isLoggedIn && (
                <button 
                  onClick={() => removeSkill(skill.id)}
                  className="absolute top-4 right-4 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
              <div className="flex flex-col gap-6">
                {/* Skill Image */}
                {skill.imageUrl && (
                  <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border border-brand-100 relative group/img">
                    <img 
                      src={skill.imageUrl} 
                      alt={skill.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <div className="flex-1 space-y-4">
                  <div className="flex flex-col gap-1">
                    <DebouncedInput
                      placeholder="Skill Name"
                      value={skill.name}
                      onChange={(val) => updateSkill(skill.id, { name: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xl font-bold bg-transparent focus:outline-none placeholder:text-brand-200"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-brand-400" />
                        <DebouncedInput
                          placeholder="Image URL"
                          value={skill.imageUrl || ''}
                          onChange={(val) => updateSkill(skill.id, { imageUrl: val })}
                          className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                        />
                      </div>
                    )}
                  </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Category</label>
                  <div className="flex flex-wrap gap-2">
                    {(['Common', 'Extra', 'Unique', 'Ultimate', 'Ancient', 'Legendary'] as const).map(cat => (
                      <button
                        key={cat}
                        onClick={() => updateSkill(skill.id, { category: cat })}
                        disabled={!isLoggedIn}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all",
                          skill.category === cat 
                            ? "bg-brand-800 text-white shadow-md shadow-brand-200" 
                            : "bg-brand-50 text-brand-400 hover:bg-brand-100"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Description & Effects</label>
                  <DebouncedTextarea
                    placeholder="What does this skill do? How is it activated?"
                    value={skill.description}
                    onChange={(val) => updateSkill(skill.id, { description: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-28"
                  />
                </div>
              </div>
            </div>
          </div>
          ))}
          {skills.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-3xl border-2 border-dashed border-brand-100 text-brand-400">
              <Zap size={40} className="mx-auto mb-4 opacity-20" />
              No skills documented. What powers do your characters possess?
            </div>
          )}
        </div>
      </section>

      {/* Weapons Section */}
      <section id="weapons" className="space-y-6 scroll-mt-24 pt-12 border-t border-brand-50">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold text-brand-800 flex items-center gap-3">
            <div className="p-2 bg-brand-100 rounded-xl text-brand-600">
              <Sword size={24} />
            </div>
            Legendary Weapons
          </h3>
          {isLoggedIn && (
            <button onClick={addWeapon} className="bg-brand-800 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-brand-700 transition-all shadow-sm">
              <Plus size={18} /> Add Weapon
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {weapons.map(weapon => (
            <div key={weapon.id} className="bg-white p-6 rounded-3xl border-2 border-brand-100 shadow-sm space-y-4 relative group hover:border-brand-300 transition-all">
              {isLoggedIn && (
                <button 
                  onClick={() => removeWeapon(weapon.id)}
                  className="absolute top-4 right-4 text-brand-200 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Trash2 size={18} />
                </button>
              )}
              <div className="flex flex-col gap-6">
                {/* Weapon Image */}
                {weapon.imageUrl && (
                  <div className="w-full h-48 md:h-64 bg-brand-50 rounded-2xl overflow-hidden shrink-0 border border-brand-100 relative group/img">
                    <img 
                      src={weapon.imageUrl} 
                      alt={weapon.name} 
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.className = "w-full h-full flex flex-col items-center justify-center text-brand-300 p-2 text-center bg-brand-50";
                          fallback.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          `;
                          parent.appendChild(fallback);
                        }
                      }}
                    />
                  </div>
                )}

                <div className="flex-1 space-y-4">
                  <div className="flex flex-col gap-1">
                    <DebouncedInput
                      placeholder="Weapon Name"
                      value={weapon.name}
                      onChange={(val) => updateWeapon(weapon.id, { name: val })}
                      readOnly={!isLoggedIn}
                      className="w-full text-xl font-bold bg-transparent focus:outline-none placeholder:text-brand-200"
                    />
                    {isLoggedIn && (
                      <div className="flex items-center gap-1 opacity-60 focus-within:opacity-100 transition-opacity">
                        <ImageIcon size={10} className="text-brand-400" />
                        <DebouncedInput
                          placeholder="Image URL"
                          value={weapon.imageUrl || ''}
                          onChange={(val) => updateWeapon(weapon.id, { imageUrl: val })}
                          className="text-[9px] bg-transparent border-none focus:outline-none text-brand-400 w-full"
                        />
                      </div>
                    )}
                  </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Rarity</label>
                  <div className="flex flex-wrap gap-2">
                    {(['Common', 'Rare', 'Super Rare', 'Legendary', 'Mythical'] as const).map(rarity => (
                      <button
                        key={rarity}
                        onClick={() => updateWeapon(weapon.id, { rarity: rarity })}
                        disabled={!isLoggedIn}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase transition-all",
                          weapon.rarity === rarity 
                            ? "bg-brand-800 text-white shadow-md shadow-brand-200" 
                            : "bg-brand-50 text-brand-400 hover:bg-brand-100"
                        )}
                      >
                        {rarity}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-brand-400 uppercase tracking-wider">Description & History</label>
                  <DebouncedTextarea
                    placeholder="Who forged it? What are its unique properties?"
                    value={weapon.description}
                    onChange={(val) => updateWeapon(weapon.id, { description: val })}
                    readOnly={!isLoggedIn}
                    className="w-full text-xs bg-brand-50 rounded-xl p-3 focus:outline-none focus:ring-2 ring-brand-200 resize-none h-28"
                  />
                </div>
              </div>
            </div>
          </div>
          ))}
          {weapons.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-3xl border-2 border-dashed border-brand-100 text-brand-400">
              <Sword size={40} className="mx-auto mb-4 opacity-20" />
              The armory is empty. What legendary steel will your heroes wield?
            </div>
          )}
        </div>
      </section>
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
      const modelName = "gemini-3-flash-preview";
      
      // Get previous chapters for context
      const currentChapterIndex = story.chapters.findIndex(c => c.id === currentChapter?.id);
      const previousChaptersContext = story.chapters
        .slice(0, currentChapterIndex)
        .map(c => `Chapter: ${c.title}\nContent: ${c.content.slice(0, 500)}...`)
        .join('\n\n');

      const systemInstruction = `
        You are a helpful writing assistant for a novelist named Master Fay. 
        Current Novel: "${story.title}"
        Subtitle: "${story.subtitle || 'None'}"
        Genres: ${story.genres?.join(', ') || 'None'}
        Characters: ${story.characters.map(c => `${c.name} (${c.role}): ${c.description}`).join(', ')}
        Skills: ${story.skills?.map(s => `${s.name} (${s.category}): ${s.description}`).join(', ') || 'None'}
        Weapons: ${story.weapons?.map(w => `${w.name} (${w.rarity}): ${w.description}`).join(', ') || 'None'}
        Creatures (Bestiary): ${story.creatures?.map(c => `${c.name} (${c.species}): ${c.description}`).join(', ') || 'None'}
        Locations: ${story.locations?.map(l => `${l.name} (${l.climate}): ${l.description}`).join(', ') || 'None'}
        Factions: ${story.factions?.map(f => `${f.name} (Leader: ${f.leader}, Influence: ${f.influence}): ${f.description}`).join(', ') || 'None'}
        
        CONTEXT OF PREVIOUS CHAPTERS:
        ${previousChaptersContext || 'This is the first chapter.'}
        
        CURRENT CHAPTER TITLE: "${currentChapter?.title || 'Untitled'}"
        CURRENT CHAPTER PLOT POINTS: ${currentChapter?.plotPoints.map(p => p.title).join(', ') || 'None'}
        CURRENT CHAPTER CONTENT: ${currentChapter?.content || 'Empty'}
        
        The user might ask questions about their own novel, characters, or plot.
        Be friendly, encouraging, and specific to their story context. Use the previous chapters to ensure consistency.
        Always address the user as "Master Fay" or "Master".
      `;

      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          { role: 'user', parts: [{ text: userMsg }] }
        ],
        config: {
          systemInstruction: systemInstruction.trim()
        }
      });

      if (response && response.text) {
        setMessages(prev => [...prev, { role: 'ai', text: response.text }]);
      } else {
        throw new Error("Empty response from AI");
      }
    } catch (error) {
      console.error("AiMuse error:", error);
      setMessages(prev => [...prev, { role: 'ai', text: "Forgive me, Master. My connection to the higher realms was momentarily severed. Perhaps try again? (" + (error instanceof Error ? error.message : "Internal Error") + ")" }]);
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
