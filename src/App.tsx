import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BookOpen, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  LogOut, 
  Settings, 
  History, 
  Play, 
  Loader2,
  FileSpreadsheet,
  Award,
  AlertCircle,
  Trash2,
  ExternalLink,
  Clock,
  Code
} from 'lucide-react';
import { generateWeeklyVocabulary, VocabularyItem, VOCAB_PROMPT_TEMPLATE } from './services/gemini';

// --- Types ---
interface User {
  id: string;
  email: string;
  name: string;
  picture: string;
}

interface QuizState {
  currentIndex: number;
  score: number;
  mistakes: VocabularyItem[];
  isFinished: boolean;
  answers: { word: string; correct: boolean }[];
}

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, icon: Icon }: any) => {
  const variants: any = {
    primary: 'bg-stone-800 text-stone-50 hover:bg-stone-700',
    secondary: 'bg-stone-100 text-stone-800 hover:bg-stone-200 border border-stone-200',
    outline: 'bg-transparent border border-stone-300 text-stone-600 hover:bg-stone-50',
    ghost: 'bg-transparent text-stone-500 hover:text-stone-800 hover:bg-stone-100',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-100'
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {Icon && <Icon size={18} />}
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-white rounded-3xl shadow-sm border border-stone-100 p-8 ${className}`}>
    {children}
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [view, setView] = useState<'dashboard'>('dashboard');
  const [generating, setGenerating] = useState(false);
  const [formUrl, setFormUrl] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<any>(null);
  const [formsHistory, setFormsHistory] = useState<any[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(localStorage.getItem('spreadsheetId'));
  const [showPrompt, setShowPrompt] = useState(false);

  // --- Auth ---
  useEffect(() => {
    fetchUser();
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        fetchUser();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const fetchUser = async (retries = 3) => {
    try {
      const res = await fetch('/api/user');
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        if (spreadsheetId) {
          analyzeSpreadsheet();
          fetchFormsHistory();
        }
        setLoading(false);
      } else {
        if (res.status === 401) setUser(null);
        setLoading(false);
      }
    } catch (e) {
      console.error("Fetch user failed", e);
      if (retries > 0) {
        console.log(`Retrying fetchUser... (${retries} left)`);
        setTimeout(() => fetchUser(retries - 1), 2000);
      } else {
        setLoading(false);
      }
    }
  };

  const analyzeSpreadsheet = async () => {
    if (!spreadsheetId) return;
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId })
      });
      const data = await res.json();
      
      if (data.error === 'REGISTRY_NOT_FOUND') {
        handleStaleRegistry();
        return [];
      }

      setLeaderboard(data.leaderboard);
      return data.mistakes;
    } catch (e) {
      console.error("Analysis failed", e);
      return [];
    }
  };

  const login = async () => {
    const res = await fetch('/api/auth/url');
    const { url } = await res.json();
    window.open(url, 'google_auth', 'width=600,height=700');
  };

  const logout = async () => {
    await fetch('/api/logout', { method: 'POST' });
    setUser(null);
    setView('dashboard');
  };

  const fetchFormsHistory = async () => {
    if (!spreadsheetId) return;
    try {
      const res = await fetch(`/api/forms/list?spreadsheetId=${spreadsheetId}`);
      const data = await res.json();

      if (data.error === 'REGISTRY_NOT_FOUND') {
        handleStaleRegistry();
        return;
      }

      setFormsHistory(data.forms || []);
    } catch (e) {
      console.error("Fetch history failed", e);
    }
  };

  const handleStaleRegistry = () => {
    console.warn("Master Registry not found. Clearing stale ID.");
    localStorage.removeItem('spreadsheetId');
    setSpreadsheetId(null);
    setLeaderboard(null);
    setFormsHistory([]);
  };

  const deleteForm = async (formId: string) => {
    if (!confirm('確定要刪除此表單記錄嗎？')) return;
    try {
      const res = await fetch('/api/forms/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spreadsheetId, formId })
      });
      const data = await res.json();
      if (res.ok) {
        setFormsHistory(prev => prev.filter(f => f.id !== formId));
      } else if (data.warning === 'REGISTRY_NOT_FOUND') {
        handleStaleRegistry();
      }
    } catch (e) {
      console.error("Failed to delete form", e);
    }
  };

  // --- Logic ---
  const generateWeeklyForm = async () => {
    setGenerating(true);
    setFormUrl(null);
    try {
      // 1. Init spreadsheet if needed
      let currentId = spreadsheetId;
      if (!currentId) {
        const initRes = await fetch('/api/sheets/init', { method: 'POST' });
        const initData = await initRes.json();
        if (initData.spreadsheetId) {
          currentId = initData.spreadsheetId;
          setSpreadsheetId(currentId);
          localStorage.setItem('spreadsheetId', currentId!);
        } else {
          throw new Error('無法初始化試算表');
        }
      }

      // 2. Analyze mistakes
      const mistakes = await analyzeSpreadsheet();

      // 3. Generate vocabulary with AI
      const words = await generateWeeklyVocabulary(mistakes || []);
      setVocabulary(words);

      // 4. Create Google Form
      const res = await fetch('/api/forms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `N5 Vocabulary Quiz - ${new Date().toLocaleDateString()}`,
          vocabulary: words,
          spreadsheetId: currentId
        })
      });
      const data = await res.json();
      if (data.error === 'REGISTRY_NOT_FOUND') {
        handleStaleRegistry();
        alert('主控試算表已遺失，系統已自動重置。請再次點擊「生成」以重新初始化。');
        return;
      }

      if (data.formUrl) {
        setFormUrl(data.formUrl);
        fetchFormsHistory();
        alert('Google 表單建立成功！網址已顯示在下方。');
      } else {
        alert('建立失敗：' + (data.error || '未知錯誤'));
      }
    } catch (e) {
      console.error(e);
      alert('生成失敗，請確認是否已授權 Google 權限或 API 是否已開啟。');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-stone-400" size={48} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-8">
          <div className="space-y-4">
            <div className="w-20 h-20 bg-stone-800 rounded-3xl flex items-center justify-center mx-auto shadow-xl rotate-3">
              <BookOpen className="text-stone-50" size={40} />
            </div>
            <h1 className="text-4xl font-serif font-bold text-stone-900">N5 Vocabulary Master</h1>
            <p className="text-stone-500 leading-relaxed">
              50 個單字，AI 根據你的近期錯誤自動調整學習路徑。
              連結 Google Sheets 記錄你的成長。
            </p>
          </div>
          <Button onClick={login} className="w-full py-4 text-lg" icon={FileSpreadsheet}>
            使用 Google 帳號登入
          </Button>
          <p className="text-xs text-stone-400 uppercase tracking-widest">JLPT N5 Study Tool</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-stone-100 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setView('dashboard')}>
            <div className="w-10 h-10 bg-stone-800 rounded-xl flex items-center justify-center">
              <BookOpen className="text-stone-50" size={20} />
            </div>
            <span className="font-serif font-bold text-xl tracking-tight">N5 Master</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-sm font-medium">{user.name}</span>
              <span className="text-xs text-stone-400">{user.email}</span>
            </div>
            <img src={user.picture} className="w-10 h-10 rounded-full border-2 border-stone-100" />
            <Button onClick={logout} variant="ghost" className="p-2 min-w-0">
              <LogOut size={20} />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 md:p-12">
        <AnimatePresence mode="wait">
          {user && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="grid md:grid-cols-2 gap-8">
                <Card className="flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center">
                      <Play className="text-amber-600" size={24} />
                    </div>
                    <h2 className="text-2xl font-serif font-bold">生成測驗</h2>
                    <p className="text-stone-500">
                      AI 將分析近期錯誤並生成 50 個單字，直接為你建立 Google 表單測驗。
                    </p>
                    {formUrl && (
                      <div className="mt-4 p-4 bg-amber-50 border border-amber-100 rounded-xl">
                        <p className="text-sm font-bold text-amber-900 mb-2">✨ 本週表單已準備好：</p>
                        <a 
                          href={formUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="text-amber-700 text-sm break-all hover:underline font-medium"
                        >
                          {formUrl}
                        </a>
                      </div>
                    )}
                  </div>
                  <Button 
                    onClick={generateWeeklyForm} 
                    className="mt-8" 
                    disabled={generating}
                    icon={generating ? Loader2 : FileSpreadsheet}
                  >
                    {generating ? '生成中 (分析+AI+建立表單)...' : '生成 Google 表單'}
                  </Button>
                </Card>

                <Card className="flex flex-col justify-between">
                  <div className="space-y-4">
                    <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                      <History className="text-blue-600" size={24} />
                    </div>
                    <h2 className="text-2xl font-serif font-bold">學習記錄與排行榜</h2>
                    <p className="text-stone-500">
                      所有朋友的測驗結果都會自動彙整，並在此顯示排行榜。
                    </p>
                  </div>
                  <div className="mt-8 grid grid-cols-2 gap-2">
                    <div className="bg-stone-50 rounded-xl p-4 text-center">
                      <span className="block text-xs text-stone-400 uppercase tracking-widest mb-1">本週冠軍 🏆</span>
                      <div className="flex flex-col gap-1">
                        {leaderboard?.champions?.length > 0 ? (
                          leaderboard.champions.map((email: string) => (
                            <span key={email} className="text-sm font-bold truncate" title={email}>
                              {email.split('@')[0]}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm font-bold text-stone-300">尚無資料</span>
                        )}
                      </div>
                      {leaderboard?.maxScore !== undefined && (
                        <span className="text-[10px] text-stone-400">{leaderboard.maxScore} 分</span>
                      )}
                    </div>
                    <div className="bg-stone-50 rounded-xl p-4 text-center">
                      <span className="block text-xs text-stone-400 uppercase tracking-widest mb-1">本週墊底 🐢</span>
                      <div className="flex flex-col gap-1">
                        {leaderboard?.lowests?.length > 0 ? (
                          leaderboard.lowests.map((email: string) => (
                            <span key={email} className="text-sm font-bold truncate" title={email}>
                              {email.split('@')[0]}
                            </span>
                          ))
                        ) : (
                          <span className="text-sm font-bold text-stone-300">尚無資料</span>
                        )}
                      </div>
                      {leaderboard?.minScore !== undefined && (
                        <span className="text-[10px] text-stone-400">{leaderboard.minScore} 分</span>
                      )}
                    </div>
                  </div>
                </Card>
              </div>

              {/* Forms History List */}
              <Card>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-stone-100 rounded-xl flex items-center justify-center text-stone-600">
                      <Clock size={20} />
                    </div>
                    <div>
                      <h2 className="text-xl font-serif font-bold">歷史測驗表單</h2>
                      <p className="text-xs text-stone-400">管理過去生成的 Google 表單</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden border border-stone-100 rounded-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-stone-50 text-stone-400 text-[10px] uppercase tracking-widest">
                        <th className="px-6 py-4 font-medium">標題</th>
                        <th className="px-6 py-4 font-medium">日期</th>
                        <th className="px-6 py-4 font-medium">已考人數</th>
                        <th className="px-6 py-4 font-medium">平均分數</th>
                        <th className="px-6 py-4 font-medium">常錯單字 (Top 10)</th>
                        <th className="px-6 py-4 font-medium text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-50">
                      {formsHistory.length > 0 ? (
                        formsHistory.map((form) => (
                          <tr key={form.id} className="hover:bg-stone-50/50 transition-colors group">
                            <td className="px-6 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium text-stone-900">{form.title}</span>
                                <span className="text-[10px] text-stone-400 font-mono truncate max-w-[200px]">{form.id}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-xs text-stone-500">
                                {form.date && form.date !== 'Unknown' 
                                  ? new Date(form.date).toLocaleDateString() 
                                  : '未知日期'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${form.responseCount > 0 ? 'bg-green-50 text-green-600' : 'bg-stone-100 text-stone-400'}`}>
                                  {form.responseCount} 人
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-xs font-medium text-stone-600">
                                {form.responseCount > 0 ? `${form.averageScore} 分` : '-'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1 max-w-[300px]">
                                {form.weakWords && form.weakWords.length > 0 ? (
                                  form.weakWords.map((item: any, i: number) => (
                                    <span 
                                      key={i} 
                                      className="px-1.5 py-0.5 bg-red-50 text-red-600 rounded text-[10px] whitespace-nowrap"
                                      title={`共錯 ${item.count} 次`}
                                    >
                                      {item.word}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[10px] text-stone-300">無錯誤紀錄</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <a 
                                  href={form.url} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  className="p-2 text-stone-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                  title="開啟表單"
                                >
                                  <ExternalLink size={16} />
                                </a>
                                {form.sessionSheetId && (
                                  <a 
                                    href={`https://docs.google.com/spreadsheets/d/${form.sessionSheetId}`} 
                                    target="_blank" 
                                    rel="noreferrer"
                                    className="p-2 text-stone-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                    title="開啟對應試算表"
                                  >
                                    <FileSpreadsheet size={16} />
                                  </a>
                                )}
                                <button 
                                  onClick={() => deleteForm(form.id)}
                                  className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                  title="刪除記錄"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={3} className="px-6 py-12 text-center text-stone-400 text-sm italic">
                            尚無生成記錄
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>

              {/* AI Prompt Section */}
              <div className="pt-4">
                <button
                  onClick={() => setShowPrompt(!showPrompt)}
                  className="flex items-center gap-2 text-stone-400 hover:text-stone-600 transition-colors text-xs uppercase tracking-widest font-bold"
                >
                  <Code size={14} />
                  {showPrompt ? '隱藏 AI 提示指令' : '查看 AI 提示指令'}
                </button>
                
                <AnimatePresence>
                  {showPrompt && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 p-6 bg-stone-100 rounded-3xl border border-stone-200 font-mono text-[11px] text-stone-600 whitespace-pre-wrap leading-relaxed relative group">
                        <div className="absolute top-4 right-4 text-stone-300 group-hover:text-stone-400 transition-colors">
                          <Code size={16} />
                        </div>
                        {VOCAB_PROMPT_TEMPLATE.trim()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
