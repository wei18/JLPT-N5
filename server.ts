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
    res.status(500).json({ 
      error: 'Google OAuth 尚未設定。請在 AI Studio 的 Secrets 面板中設定 GOOGLE_CLIENT_ID 與 GOOGLE_CLIENT_SECRET。',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 分析試算表中的錯誤單字與排行榜
app.post('/api/analyze', async (req, res) => {
  const tokensStr = req.cookies.google_tokens;
  if (!tokensStr) return res.status(401).json({ error: 'Not authenticated' });

  const { spreadsheetId } = req.body;
  if (!spreadsheetId) return res.json({ mistakes: [], leaderboard: null });

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 1. 讀取單字表 (假設在 'Vocabulary' 分頁)
    const vocabRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Vocabulary!A:B', // A: Word, B: Reading
    });
    const vocabMap = new Map();
    vocabRes.data.values?.slice(1).forEach(row => {
      vocabMap.set(row[0], row[1]); // Word -> Correct Reading
    });

    // 2. 讀取表單回覆 (假設在 'Form Responses 1' 分頁)
    const responsesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Form Responses 1!A:ZZ',
    });

    const rows = responsesRes.data.values;
    if (!rows || rows.length <= 1) {
      return res.json({ mistakes: [], leaderboard: null });
    }

    const headers = rows[0];
    const emailIdx = headers.findIndex(h => h.toLowerCase().includes('email'));
    const scoreIdx = headers.findIndex(h => h.toLowerCase().includes('score'));
    
    const mistakeCounts: { [key: string]: number } = {};
    const scores: { email: string, score: number }[] = [];

    rows.slice(1).forEach(row => {
      // 處理分數 (格式通常是 "40 / 100")
      const scoreStr = row[scoreIdx] || "0";
      const actualScore = parseInt(scoreStr.split('/')[0].trim());
      scores.push({ email: row[emailIdx], score: actualScore });

      // 檢查每一題
      headers.forEach((header, i) => {
        // 題目格式通常是 "單字 (讀音) 的意思是什麼？" 或直接是單字
        // 我們比對單字是否在 vocabMap 中
        const wordMatch = header.match(/^(.+?)\s*\(/);
        const word = wordMatch ? wordMatch[1] : header;
        
        if (vocabMap.has(word)) {
          const correctAnswer = vocabMap.get(word);
          const userAnswer = row[i]?.trim();
          if (userAnswer !== correctAnswer) {
            mistakeCounts[word] = (mistakeCounts[word] || 0) + 1;
          }
        }
      });
    });

    // 找出前 10 名錯誤單字
    const mistakes = Object.entries(mistakeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // 計算排行榜
    const maxScore = Math.max(...scores.map(s => s.score));
    const minScore = Math.min(...scores.map(s => s.score));
    
    const leaderboard = {
      champions: scores.filter(s => s.score === maxScore).map(s => s.email),
      lowests: scores.filter(s => s.score === minScore).map(s => s.email),
      maxScore,
      minScore
    };

    res.json({ mistakes, leaderboard });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze spreadsheet' });
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
    // 使用時間戳記確保 Google Drive 上的檔名不重複
    const uniqueTitle = `${title} (${new Date().getTime()})`;
    const newForm = await forms.forms.create({
      requestBody: { 
        info: { 
          title: uniqueTitle
        } 
      }
    });
    const formId = newForm.data.formId;

    // 2. 設定為測驗、收集 Email 並加入考前說明
    const description = "📚 本週 N5 單字表 (考前預習):\n\n" + 
      vocabulary.map((v: any, i: number) => `${i + 1}. ${v.word} (${v.reading}) - ${v.meaning}`).join('\n');

    const requests = [
      {
        updateSettings: {
          settings: { 
            quizSettings: { isQuiz: true },
          },
          updateMask: 'quizSettings.isQuiz'
        }
      },
      {
        updateFormInfo: {
          info: {
            title: title, // 顯示給學生的標題保持簡潔
            description
          },
          updateMask: 'title,description'
        }
      }
    ];

    // 3. 加入題目 (混合題型)
    // 10% 填空題 (Short Answer), 90% 選擇題 (Multiple Choice)
    vocabulary.forEach((item: any, index: number) => {
      const isShortAnswer = Math.random() < 0.1;

      if (isShortAnswer) {
        requests.push({
          createItem: {
            item: {
              title: `${item.word} (${item.meaning}) 的假名是什麼？`,
              questionItem: {
                question: {
                  required: true,
                  grading: { 
                    pointValue: 2, 
                    correctAnswers: { answers: [{ value: item.reading }] } 
                  },
                  textQuestion: {} // 簡答題
                }
              }
            },
            location: { index }
          }
        } as any);
      } else {
        // 選擇題：隨機選取 3 個錯誤選項
        const otherWords = vocabulary.filter((v: any) => v.word !== item.word);
        const distractors = otherWords
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map((v: any) => v.meaning);
        
        const options = [item.meaning, ...distractors].sort(() => 0.5 - Math.random());

        requests.push({
          createItem: {
            item: {
              title: `${item.word} (${item.reading}) 的意思是什麼？`,
              questionItem: {
                question: {
                  required: true,
                  grading: { 
                    pointValue: 2, 
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
      }
    });

    await forms.forms.batchUpdate({
      formId: formId!,
      requestBody: { requests }
    });

    // 4. 更新 Vocabulary Sheet 並記錄表單到 Forms List
    if (spreadsheetId) {
      const vocabValues = [
        ['Word', 'Reading', 'Meaning', 'Example'],
        ...vocabulary.map((v: any) => [v.word, v.reading, v.meaning, v.example])
      ];
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: 'Vocabulary!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: vocabValues }
      });

      // 記錄到 Forms List
      const formUrl = `https://docs.google.com/forms/d/${formId}/viewform`;
      const date = new Date().toISOString();
      const formRecord = [[formId, title, formUrl, date]];
      
      try {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: 'Forms List!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: formRecord }
        });
      } catch (e) {
        // 如果 Forms List 分頁不存在，先建立它
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: 'Forms List' } } }]
          }
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Forms List!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['ID', 'Title', 'URL', 'Date'], ...formRecord] }
        });
      }
    }

    res.json({ 
      success: true, 
      formUrl: `https://docs.google.com/forms/d/${formId}/viewform`, 
      formId 
    });
  } catch (error) {
    console.error('Error creating form:', error);
    res.status(500).json({ error: 'Failed to create form' });
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
    res.status(500).send('Authentication failed');
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
    const userInfo = await oauth2.userinfo.get();
    res.json(userInfo.data);
  } catch (error) {
    res.status(401).json({ error: 'Invalid tokens' });
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
        range: 'Forms List!A2:D',
      });

      const forms = await Promise.all((response.data.values || []).map(async row => {
        const id = row[0];
        let responseCount = 0;
        try {
          const responses = await formsApi.forms.responses.list({ formId: id });
          responseCount = responses.data.responses?.length || 0;
        } catch (e) {
          // Ignore errors for individual forms (e.g. if deleted)
        }

        return {
          id,
          title: row[1],
          url: row[2],
          date: row[3],
          responseCount
        };
      }));

      res.json({ forms });
    } catch (error: any) {
      // If the error is because the sheet doesn't exist yet, return an empty list instead of crashing
      if (error.message && error.message.includes('Unable to parse range')) {
        return res.json({ forms: [] });
      }
      throw error;
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

  try {
    const client = getOAuth2Client();
    const tokens = JSON.parse(tokensStr);
    client.setCredentials(tokens);
    const sheets = google.sheets({ version: 'v4', auth: client });

    // 讀取所有表單
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Forms List!A:D',
    });

    const values = response.data.values || [];
    const newValues = values.filter(row => row[0] !== formId);

    // 覆寫試算表
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Forms List!A:D',
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Forms List!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: newValues }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting form:', error);
    res.status(500).json({ error: 'Failed to delete form' });
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
      properties: { title: 'N5 Vocabulary Master - Study Log' },
      sheets: [
        { properties: { title: 'Vocabulary' } },
        { properties: { title: 'Form Responses 1' } }
      ]
    };
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: resource,
      fields: 'spreadsheetId',
    });
    
    res.json({ spreadsheetId: spreadsheet.data.spreadsheetId });
  } catch (error) {
    console.error('Error creating spreadsheet:', error);
    res.status(500).json({ error: 'Failed to create spreadsheet' });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
