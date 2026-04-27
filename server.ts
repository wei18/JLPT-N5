import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cookieParser());

const getOAuth2Client = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in environment variables.');
  }

  return new OAuth2Client(
    clientId,
    clientSecret,
    `${appUrl}/auth/callback`
  );
};

// API Routes
app.get('/api/auth/url', (req, res) => {
  try {
    const client = getOAuth2Client();
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/forms.body',
        'https://www.googleapis.com/auth/forms.responses.readonly',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      prompt: 'consent',
    });
    res.json({ url });
  } catch (error) {
    console.error('Auth URL error:', error);
    return res.status(500).json({ 
      error: 'Google OAuth 尚未設定。請在 AI Studio 的 Secrets 面板中設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET。',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

const isGoogleNotFoundError = (error: any) => {
  if (!error) return false;
  
  const check = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    
    // Check various common Google SDK error formats
    const code = obj.code || obj.status || obj.response?.status || obj.response?.data?.error?.code || obj.error?.code;
    const status = obj.status || obj.error?.status || obj.response?.data?.error?.status;
    
    if (code === 404 || code === '404' || status === 'NOT_FOUND') return true;
    
    // Recursively check response or error properties
    if (obj.error && typeof obj.error === 'object' && obj.error !== obj) return check(obj.error);
    if (obj.response && typeof obj.response === 'object') return check(obj.response);
    if (obj.data && typeof obj.data === 'object') return check(obj.data);
    
    return false;
  };
  
  if (check(error)) return true;
  
  const message = String(error.message || error || '').toUpperCase();
  return message.includes('NOT_FOUND') || message.includes('404');
};

// Helper for parallel execution with limit
const concurrentMap = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
};

// 分析試算表中的錯誤單字與排行榜
app.post('/api/analyze', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) return res.json({ mistakes: [], leaderboard: null });

  console.time('Analysis');
  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });
    const formsApi = google.forms({ version: 'v1', auth: client });

    // 1. 從 Master Registry 讀取最近的表單紀錄
    let registryRows: any[] = [];
    try {
      const registryRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Forms List!A2:E',
      });
      registryRows = registryRes.data.values || [];
    } catch (error: any) {
      if (isGoogleNotFoundError(error)) {
        console.warn('Master Registry spreadsheet not found:', spreadsheetId);
        return res.json({ mistakes: [], leaderboard: null, error: 'REGISTRY_NOT_FOUND' });
      }
      console.error('Registry fetch error:', error);
      return res.status(500).json({ error: 'Failed to access Master Registry' });
    }

    if (registryRows.length === 0) {
      console.timeEnd('Analysis');
      return res.json({ mistakes: [], leaderboard: null });
    }

    // 取得最近 30 個表單進行分析
    const recentForms = registryRows.slice(-30).reverse();
    const allMistakeCounts: { [key: string]: number } = {};
    const hallOfFame: { [email: string]: { first: number, second: number, third: number } } = {};
    const allScores: { email: string, score: number, date: string }[] = [];

    // 2. 平行化分析表單，限制併發數為 3 以防觸發 Rate Limit
    await concurrentMap(recentForms, 3, async (row) => {
      const formId = row[0];
      const sessionDate = row.length === 5 ? row[4] : row[3];
      
      try {
        // 並行取得表單結構與回覆
        const [formMetadata, formsRes] = await Promise.all([
          formsApi.forms.get({ formId }),
          formsApi.forms.responses.list({ formId })
        ]);

        const questions = formMetadata.data.items || [];
        const questionMap = new Map();
        questions.forEach(item => {
          if (item.questionItem?.question) {
            const q = item.questionItem.question;
            const correctAnswers = q.grading?.correctAnswers?.answers?.map(a => a.value) || [];
            const title = item.title || '';
            const cleanTitle = title.replace(/^\d+\.\s*/, '');
            const wordMatch = cleanTitle.match(/^(.+?)\s*\(/);
            const word = wordMatch ? wordMatch[1] : (cleanTitle.includes(' ') ? cleanTitle.split(' ')[0] : cleanTitle);

            questionMap.set(q.questionId, { word, correctAnswers });
          }
        });

        const responses = (formsRes.data.responses || []).filter(r => r.respondentEmail && r.respondentEmail !== 'anonymous');
        
        // 處理單份表單的名次
        if (responses.length > 0) {
          // 找出這份考卷的 1, 2, 3 名分數
          const scores = Array.from(new Set(responses.map(r => r.totalScore || 0))).sort((a, b) => b - a);
          const firstScore = scores[0];
          const secondScore = scores[1]; // 可能 undefined
          const thirdScore = scores[2]; // 可能 undefined

          responses.forEach(resp => {
            const email = resp.respondentEmail!;
            const score = resp.totalScore || 0;
            
            if (!hallOfFame[email]) {
              hallOfFame[email] = { first: 0, second: 0, third: 0 };
            }

            if (score === firstScore) hallOfFame[email].first++;
            else if (secondScore !== undefined && score === secondScore) hallOfFame[email].second++;
            else if (thirdScore !== undefined && score === thirdScore) hallOfFame[email].third++;

            allScores.push({ email, score, date: sessionDate });

            // 錯誤單字統計
            Object.entries(resp.answers || {}).forEach(([qId, answerObj]: [string, any]) => {
              const qInfo = questionMap.get(qId);
              if (qInfo) {
                const userAnswers = answerObj.textAnswers?.answers?.map((a: any) => a.value) || [];
                const isCorrect = qInfo.correctAnswers.some((ca: string) => 
                  userAnswers.some(ua => ua && ua.trim() === ca.trim())
                );
                if (!isCorrect) {
                  allMistakeCounts[qInfo.word] = (allMistakeCounts[qInfo.word] || 0) + 1;
                }
              }
            });
          });
        }
      } catch (e: any) {
        if (isGoogleNotFoundError(e)) {
          console.warn(`Form ${formId} not found, skipping analysis.`);
        } else {
          console.error(`Failed to analyze form ${formId}:`, e);
        }
      }
    });

    // 3. 找出前 50 名錯誤單字
    const mistakes = Object.entries(allMistakeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word]) => word);

    // 4. 計算排行榜
    let leaderboard = null;
    if (allScores.length > 0) {
      const maxScore = Math.max(...allScores.map(s => s.score));
      const minScore = Math.min(...allScores.map(s => s.score));
      
      // 將用戶依總獎盃數排序 (積分權重: 1st=3, 2nd=2, 3rd=1)
      const rankedHallOfFame = Object.entries(hallOfFame)
        .map(([email, counts]) => ({
          email,
          ...counts,
          totalPoints: counts.first * 3 + counts.second * 2 + counts.third * 1
        }))
        .sort((a, b) => b.totalPoints - a.totalPoints || b.first - a.first)
        .slice(0, 10);

      leaderboard = {
        champions: Array.from(new Set(allScores.filter(s => s.score === maxScore).map(s => s.email))),
        lowests: Array.from(new Set(allScores.filter(s => s.score === minScore).map(s => s.email))),
        maxScore,
        minScore,
        hallOfFame: rankedHallOfFame
      };
    }

    console.timeEnd('Analysis');
    return res.json({ mistakes, leaderboard });
  } catch (error) {
    console.timeEnd('Analysis');
    console.error('Analysis error:', error);
    return res.status(500).json({ error: 'Failed to analyze spreadsheet' });
  }
});

app.post('/api/forms/create', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });

  const { title, vocabulary, spreadsheetId } = req.body;

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const forms = google.forms({ version: 'v1', auth: client });
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 1. 建立表單 (僅設定標題)
    // 雖然不使用 Drive API，但 Forms API 的 info.title 就可以決定其報表抬頭。
    // 在大部分情況下，這也會同步更新 Google Drive 上的檔案名稱。
    const displayTitle = title ? (title.length > 255 ? title.substring(0, 252) + "..." : title) : "N5 Vocabulary Quiz";
    const timestampedTitle = `${displayTitle} (${new Date().getTime()})`;
    
    console.log('Creating Google Form with title:', timestampedTitle);
    
    const newForm = await forms.forms.create({
      requestBody: { 
        info: { title: timestampedTitle } 
      }
    });
    
    const formId = newForm.data.formId!;
    const formUrl = newForm.data.responderUri;
    console.log('Form created with ID:', formId);

    // 2. 設定為測驗、收集 Email 並加入考前說明
    const validVocabulary = (vocabulary || []).filter((v: any) => v && v.word && v.reading && v.meaning);
    
    if (validVocabulary.length === 0) {
      console.warn('No valid vocabulary items found to create form');
      return res.status(400).json({ error: '單字表內容不完整，無法建立表單。' });
    }

    // Google Forms 描述上限約 4096 字元，需進行截斷以防 400 錯誤
    let description = "📚 N5 單字表 (考前預習):\n\n";
    for (let i = 0; i < validVocabulary.length; i++) {
        const v = validVocabulary[i];
        let itemText = `${i + 1}. ${v.word} (${v.reading}) - ${v.meaning}`;
        if (v.example) itemText += `\n   例句：${v.example}`;
        itemText += '\n\n';
        
        if ((description + itemText).length > 4000) {
            description += "...(餘下單字請見測驗題目內容)";
            break;
        }
        description += itemText;
    }

    const requests: any[] = [
      {
        updateSettings: {
          settings: { 
            quizSettings: { isQuiz: true },
            emailCollectionType: 'VERIFIED'
          },
          updateMask: 'quizSettings.isQuiz,emailCollectionType'
        }
      },
      {
        updateFormInfo: {
          info: {
            title: timestampedTitle,
            description
          },
          updateMask: 'title,description'
        }
      }
    ];

    // 3. 加入題目 (混合題型: 90% RADIO, 10% TEXT)
    validVocabulary.forEach((item: any, index: number) => {
      const questionNumber = index + 1;
      const pointValue = 2;
      
      const isShortAnswer = false; // 用戶要求不要填空題 (這裡指打字題)

      // 分配題型：讀音檢測 (40%), 意思檢測 (40%), 漢字檢測 (20%)
      const rand = Math.random();
      
      if (rand < 0.4) {
          // 題型 1: 漢字 -> 讀音 (読み)
          // 優先使用 AI 提供的干擾項 (通常是相似音)，但若包含漢字則過濾掉
          const aiDistractors = (item.distractors || []).filter(d => !/[\u4e00-\u9faf]/.test(d));
          let distractors = aiDistractors;
          
          // 如果 AI 提供的干擾項不足，則從其他單字抓取讀音補足
          if (distractors.length < 3) {
            const otherReadings = validVocabulary
              .filter((v: any) => v.word !== item.word)
              .map((v: any) => v.reading);
            distractors = [...distractors, ...otherReadings].slice(0, 3);
          }

          const options = [item.reading, ...distractors].slice(0, 4).sort(() => 0.5 - Math.random());
          requests.push({
            createItem: {
              item: {
                title: `${questionNumber}. 「${item.word}」的正確讀音是什麼？`,
                questionItem: {
                  question: {
                    required: true,
                    grading: { 
                      pointValue, 
                      correctAnswers: { answers: [{ value: item.reading }] } 
                    },
                    choiceQuestion: {
                      type: 'RADIO',
                      options: options.map(o => ({ value: o }))
                    }
                  }
                }
              },
              location: { index }
            }
          } as any);
        } else if (rand < 0.8) {
          // 題型 2: 讀音 -> 意思 (意味)
          const otherWords = validVocabulary.filter((v: any) => v.word !== item.word);
          const distractors = otherWords.sort(() => 0.5 - Math.random()).slice(0, 3).map((v: any) => v.meaning);
          const options = [item.meaning, ...distractors].sort(() => 0.5 - Math.random());
          requests.push({
            createItem: {
              item: {
                title: `${questionNumber}. 「${item.reading}」的中文意思是什麼？`,
                questionItem: {
                  question: {
                    required: true,
                    grading: { 
                      pointValue, 
                      correctAnswers: { answers: [{ value: item.meaning }] } 
                    },
                    choiceQuestion: {
                      type: 'RADIO',
                      options: options.map(o => ({ value: o }))
                    }
                  }
                }
              },
              location: { index }
            }
          } as any);
        } else {
          // 題型 3: 讀音 -> 漢字 (漢字表現) - 對華人較有鑑別度
          const otherWords = validVocabulary.filter((v: any) => v.word !== item.word);
          const distractors = otherWords.sort(() => 0.5 - Math.random()).slice(0, 3).map((v: any) => v.word);
          const options = [item.word, ...distractors].sort(() => 0.5 - Math.random());
          requests.push({
            createItem: {
              item: {
                title: `${questionNumber}. 讀音為「${item.reading}」的正確漢字是哪一個？`,
                questionItem: {
                  question: {
                    required: true,
                    grading: { 
                      pointValue, 
                      correctAnswers: { answers: [{ value: item.word }] } 
                    },
                    choiceQuestion: {
                      type: 'RADIO',
                      options: options.map(o => ({ value: o }))
                    }
                  }
                }
              },
              location: { index }
            }
          } as any);
        }
      });

    console.log('Sending batchUpdate with requests count:', requests.length);
    try {
      await forms.forms.batchUpdate({
        formId: formId!,
        requestBody: { requests }
      });
      console.log('batchUpdate successful');
    } catch (batchError: any) {
      const errorMsg = JSON.stringify(batchError.response?.data || batchError);
      console.error('batchUpdate failed. Specific error:', errorMsg);

      // 如果失敗，嘗試降級設定（例如某些帳號不支援 VERIFIED + ALWAYS）
      console.log('Attempting fallback: Removing restrictive settings...');
      const fallbackRequests = requests.map(r => {
        if (r.updateSettings) {
          return {
            updateSettings: {
              settings: { 
                quizSettings: { isQuiz: true },
                // 降級：不強制驗證，由用戶手動決定
              },
              updateMask: 'quizSettings.isQuiz'
            }
          };
        }
        return r;
      });

      await forms.forms.batchUpdate({
        formId: formId!,
        requestBody: { requests: fallbackRequests }
      });
      console.log('Fallback batchUpdate successful');
    }

    // 4. 建立專屬試算表並記錄到 Master Registry
    if (spreadsheetId) {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      
      // 讀取 Master Registry 獲取當日 Index
      let rows: any[] = [];
      try {
        const registryRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Forms List!A:E',
        });
        rows = registryRes.data.values || [];
      } catch (error: any) {
        if (isGoogleNotFoundError(error)) {
          console.warn('Master Registry not found during form creation:', spreadsheetId);
          return res.status(404).json({ error: 'REGISTRY_NOT_FOUND' });
        }
        console.error('Registry access error during creation:', error);
        return res.status(500).json({ error: 'Failed to access Master Registry' });
      }

      const todayPrefix = now.toISOString().split('T')[0];
      const todayCount = rows.filter(row => {
        const dateStr = row.length === 5 ? row[4] : row[3];
        return dateStr && dateStr.startsWith(todayPrefix);
      }).length;
      const index = todayCount + 1;
      const sessionSheetName = `N5_Quiz_${dateStr}_${index}`;

      // 建立新試算表
      const newSheet = await sheets.spreadsheets.create({
        requestBody: {
          properties: { title: sessionSheetName },
          sheets: [
            { properties: { title: 'Vocabulary' } },
            { properties: { title: 'Form Responses 1' } }
          ]
        }
      });
      const sessionSheetId = newSheet.data.spreadsheetId!;

      // 寫入單字表到新試算表
      const vocabValues = [
        ['Word', 'Reading', 'Meaning', 'Example'],
        ...validVocabulary.map((v: any) => [v.word, v.reading, v.meaning, v.example])
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId: sessionSheetId,
        range: 'Vocabulary!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: vocabValues }
      });

      // 記錄到 Master Registry
      const formUrl = `https://docs.google.com/forms/d/${formId}/viewform`;
      const date = now.toISOString();
      const formRecord = [[formId, title, formUrl, sessionSheetId, date]];
      
      // 同時記錄單字使用量，以便日後排除重複
      const vocabLogEntries = validVocabulary.map((v: any) => [v.word, formId]);

      await Promise.all([
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Forms List!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: formRecord }
        }),
        sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Vocabulary Registry!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: vocabLogEntries }
        })
      ]);

      res.json({ 
        success: true, 
        formUrl, 
        formId,
        sessionSheetId
      });
    }
  } catch (error: any) {
    console.error('Error creating form - full details:', JSON.stringify(error, null, 2));
    if (error.response && error.response.data) {
      console.error('Google API Error Data:', JSON.stringify(error.response.data, null, 2));
    }

    return res.status(500).json({ 
      error: 'Failed to create form', 
      details: error.message || String(error) 
    });
  }
});

app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
  const { code } = req.query;
  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code as string);
    
    // Store tokens in a secure cookie
    res.cookie('google_tokens', JSON.stringify(tokens), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    return res.status(500).send('Authentication failed');
  }
});

app.get('/api/user', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    try {
      const userInfo = await oauth2.userinfo.get();
      if (!userInfo || !userInfo.data) {
        throw new Error('No user data returned from Google');
      }
      res.json(userInfo.data);
    } catch (err) {
      console.error('User info fetch error:', err);
      return res.status(401).json({ error: 'Invalid tokens' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Invalid tokens' });
  }
});

app.get('/api/forms/list', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });
  const { spreadsheetId } = req.query;
  if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });
    const formsApi = google.forms({ version: 'v1', auth: client });

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetId as string,
        range: 'Forms List!A2:E',
      });

      const values = response.data.values || [];
      
      // 根據日期排序（第 5 欄或第 4 欄是日期），最新的在最前面
      const sortedRows = [...values].sort((a, b) => {
        const getDate = (row: any) => {
          const raw = row.length === 5 ? row[4] : row[3];
          if (!raw) return 0;
          const parsed = new Date(raw);
          return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        };
        return getDate(b) - getDate(a);
      });

      const formsApi = google.forms({ version: 'v1', auth: client });

      const formsResults = await Promise.all(sortedRows.slice(0, 30).map(async row => {
        const id = row[0];
        let sessionSheetId = null;
        let date = 'Unknown';
        
        // 判斷資料格式：舊版 4 欄 [ID, Title, URL, Date] / 新版 5 欄 [ID, Title, URL, SheetID, Date]
        if (row.length === 5) {
          sessionSheetId = row[3];
          date = row[4];
        } else if (row.length === 4) {
          date = row[3];
        }

        // --- 強化：自動找回消失的試算表按鈕 (本邏輯需 Drive API，若無則跳過) ---
        // 如果註冊表沒紀錄 sessionSheetId，則無按鈕

        let responseCount = 0;
        let averageScore = 0;
        let weakWords: { word: string, count: number }[] = [];
        let isStale = false;

        try {
          // 取得表單結構（為了知道正確答案與問題對應的單字）
          const formMetadata = await formsApi.forms.get({ formId: id });
          const questions = formMetadata.data.items || [];
          const questionMap = new Map();
          
          questions.forEach(item => {
            if (item.questionItem?.question) {
              const q = item.questionItem.question;
              const correctAnswers = q.grading?.correctAnswers?.answers?.map(a => a.value) || [];
              const title = item.title || '';
              const cleanTitle = title.replace(/^\d+\.\s*/, '');
              const wordMatch = cleanTitle.match(/^(.+?)\s*\(/);
              const word = wordMatch ? wordMatch[1] : cleanTitle.split(' ')[0];

              questionMap.set(q.questionId, { word, correctAnswers });
            }
          });

          // 直接從 Forms API 讀取回覆 (這是最準確的，且不依賴試算表是否連結)
          const formsRes = await formsApi.forms.responses.list({ formId: id });
          // 過濾掉匿名回覆 (測試資料)
          const validResponses = (formsRes.data.responses || []).filter(r => r.respondentEmail && r.respondentEmail !== 'anonymous');
          responseCount = validResponses.length;
          
          if (responseCount > 0) {
            const scores = validResponses.map(r => r.totalScore || 0);
            averageScore = scores.reduce((a, b) => a + b, 0) / responseCount;

            // 計算該表單的錯誤單字
            const mistakeCounts: { [key: string]: number } = {};
            validResponses.forEach(resp => {
              Object.entries(resp.answers || {}).forEach(([qId, answerObj]: [string, any]) => {
                const qInfo = questionMap.get(qId);
                if (qInfo) {
                  const userAnswers = answerObj.textAnswers?.answers?.map((a: any) => a.value) || [];
                  const isCorrect = qInfo.correctAnswers.some((ca: string) => userAnswers.includes(ca));
                  if (!isCorrect) {
                    mistakeCounts[qInfo.word] = (mistakeCounts[qInfo.word] || 0) + 1;
                  }
                }
              });
            });

            // 轉為陣列並排序取前 10
            weakWords = Object.entries(mistakeCounts)
              .map(([word, count]) => ({ word, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 10);
          }
        } catch (e: any) {
          // 如果表單被刪除，我們依然回傳基本資訊，讓用戶能在儀表板點擊「刪除」來清理 Registry 紀錄
          isStale = true;
          if (isGoogleNotFoundError(e)) {
            console.warn(`Form ${id} not found in Drive, fallback to registry info.`);
          } else {
            console.error(`Failed to fetch info for form ${id}:`, e);
          }
        }

        return {
          id,
          title: row[1] || 'Untitled',
          url: row[2] || '',
          date,
          sessionSheetId,
          responseCount,
          averageScore: Math.round(averageScore),
          weakWords,
          isStale
        };
      }));

      const formsRaw = formsResults.filter(f => f !== null && f !== undefined);
      
      // 根據您的需求：如果已經在雲端刪除（isStale），就不要出現在歷史列表標題中。
      const forms = formsRaw.filter(f => !f.isStale);
      
      // 二次排序確保回傳給前端的順序也是正確的
      forms.sort((a: any, b: any) => {
        const timeA = new Date(a.date).getTime();
        const timeB = new Date(b.date).getTime();
        return (isNaN(timeB) ? 0 : timeB) - (isNaN(timeA) ? 0 : timeA);
      });
      res.json({ forms });
    } catch (error: any) {
      // If the error is because the sheet doesn't exist yet or was deleted
      if (isGoogleNotFoundError(error)) {
        return res.json({ forms: [], error: 'REGISTRY_NOT_FOUND' });
      }
      if (error.message && error.message.includes('Unable to parse range')) {
        return res.json({ forms: [] });
      }
      console.error('Forms list outer error:', error);
      return res.status(500).json({ error: 'Failed to fetch forms list' });
    }
  } catch (error) {
    console.error('Error fetching forms list:', error);
    res.json({ forms: [] });
  }
});

app.post('/api/forms/delete', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });
  const { spreadsheetId, formId } = req.body;

  if (!spreadsheetId || !formId) {
    return res.status(400).json({ error: 'Missing spreadsheetId or formId' });
  }

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });

    console.log(`Deleting form ${formId} from registry ${spreadsheetId}`);

    // 1. (已移除 Drive API 刪除檔案邏輯，僅清理註冊表)

    // 2. 讀取所有表單紀錄
    let values: any[] = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Forms List!A:E',
      });
      values = response.data.values || [];
    } catch (error: any) {
      if (isGoogleNotFoundError(error)) {
        console.warn('Master Registry not found during form deletion:', spreadsheetId);
        return res.json({ success: true, warning: 'REGISTRY_NOT_FOUND' });
      }
      console.error('Registry access error during deletion:', error);
      return res.status(500).json({ error: 'Failed to access Master Registry' });
    }

    // 找出對應的紀錄列 (更寬鬆的匹配，防止欄位偏移或格式問題)
    const targetRowIndex = values.findIndex(row => {
      if (!Array.isArray(row)) return false;
      // 只要該行任一欄位完全等於 formId 就認定為目標
      return row.some(cell => String(cell || '').trim() === String(formId).trim());
    });
    
    if (targetRowIndex !== -1) {
      const targetRow = values[targetRowIndex];
      // 嘗試從該列中找出寬度大於 20 的 ID（通常就是試算表 ID）
      const sessionSheetId = targetRow.find((cell: any) => String(cell).length > 20 && String(cell) !== String(formId));

      // 3. (已移除 Drive API 刪除檔案邏輯)

      // 過濾掉該紀錄
      const newValues = values.filter((_, idx) => idx !== targetRowIndex);

      // 4. 使用更加徹底的方式刷新 Registry
      // 清除內容
      await sheets.spreadsheets.values.clear({
        spreadsheetId,
        range: 'Forms List!A1:E2000',
      });

      // 寫回新資料
      if (newValues.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Forms List!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: newValues }
        });
      }

      // 5. 同時清理 Vocabulary Registry
      try {
        const vocabRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: 'Vocabulary Registry!A:B',
        });
        const vocabValues = vocabRes.data.values || [];
        if (vocabValues.length > 0) {
          const newVocabValues = vocabValues.filter(row => row[1] !== formId);
          await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: 'Vocabulary Registry!A1:B5000',
          });
          if (newVocabValues.length > 0) {
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: 'Vocabulary Registry!A1',
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: newVocabValues }
            });
          }
        }
      } catch (vocabError) {
        console.error('Error cleaning up Vocabulary Registry:', vocabError);
      }

      console.log(`Successfully removed form ${formId} from registry.`);
    } else {
      console.warn(`Form ID ${formId} not found in registry rows.`);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error during form deletion:', error);
    res.status(500).json({ error: 'Failed to delete form record', details: error.message });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('google_tokens');
  res.json({ success: true });
});

app.post('/api/sheets/init', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });

    const resource = {
      properties: { title: 'N5 Vocabulary Master - Master Registry' },
      sheets: [
        { properties: { title: 'Forms List' } },
        { properties: { title: 'Vocabulary Registry' } }
      ]
    };
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: resource,
      fields: 'spreadsheetId',
    });

    // 初始化表頭
    await Promise.all([
      sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.data.spreadsheetId!,
        range: 'Forms List!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Form ID', 'Title', 'Form URL', 'Spreadsheet ID', 'Date']]
        }
      }),
      sheets.spreadsheets.values.update({
        spreadsheetId: spreadsheet.data.spreadsheetId!,
        range: 'Vocabulary Registry!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['Word', 'Form ID']]
        }
      })
    ]);
    
    res.json({ spreadsheetId: spreadsheet.data.spreadsheetId });
  } catch (error) {
    console.error('Error creating spreadsheet:', error);
    return res.status(500).json({ error: 'Failed to create spreadsheet' });
  }
});

app.get('/api/vocab/used', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });
  const { spreadsheetId } = req.query;
  if (!spreadsheetId) return res.status(400).json({ error: 'Spreadsheet ID required' });

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });
    const formsApi = google.forms({ version: 'v1', auth: client });

    // 1. 讀取目前的表單列表與已使用單字
    const [formsRes, vocabRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId as string, range: 'Forms List!A:E' }),
      sheets.spreadsheets.values.get({ spreadsheetId: spreadsheetId as string, range: 'Vocabulary Registry!A:B' })
    ]);

    const formsRows = formsRes.data.values || [];
    const vocabRows = vocabRes.data.values || [];
    
    if (formsRows.length <= 1) return res.json({ usedWords: [] });

    const header = formsRows[0];
    const dataRows = formsRows.slice(1);
    const activeFormIds: string[] = [];
    const formsToPrune: string[] = [];

    // 2. 驗證表單是否依然存在於雲端 (分批並行)
    await concurrentMap(dataRows, 5, async (row) => {
      const formId = row[0];
      try {
        await formsApi.forms.get({ formId });
        activeFormIds.push(formId);
      } catch (e: any) {
        if (isGoogleNotFoundError(e)) {
          formsToPrune.push(formId);
        }
      }
    });

    // 3. 如果有單字需要清理 (同步更新兩個 Sheets)
    if (formsToPrune.length > 0) {
      console.log('Pruning deleted forms from registry:', formsToPrune);
      const remainingForms = [header, ...dataRows.filter(r => !formsToPrune.includes(r[0]))];
      const remainingVocab = vocabRows.filter(r => r[1] === 'Form ID' || activeFormIds.includes(r[1]));

      await Promise.all([
        sheets.spreadsheets.values.clear({ spreadsheetId: spreadsheetId as string, range: 'Forms List!A1:E5000' }),
        sheets.spreadsheets.values.clear({ spreadsheetId: spreadsheetId as string, range: 'Vocabulary Registry!A1:B10000' })
      ]);

      await Promise.all([
        sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId as string,
          range: 'Forms List!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: remainingForms }
        }),
        sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId as string,
          range: 'Vocabulary Registry!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: remainingVocab }
        })
      ]);
      
      const words = remainingVocab.slice(1).map(r => r[0]);
      return res.json({ usedWords: Array.from(new Set(words)) });
    }

    const words = vocabRows.slice(1).map(r => r[0]);
    return res.json({ usedWords: Array.from(new Set(words)) });
  } catch (error) {
    console.error('Error fetching used vocab:', error);
    res.json({ usedWords: [] });
  }
});

// Vite middleware
if (process.env.NODE_ENV !== 'production') {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
