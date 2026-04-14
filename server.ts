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
        'https://www.googleapis.com/auth/drive.file',
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
    const formsApi = google.forms({ version: 'v1', auth: client });

    // 1. 從 Master Registry 讀取最近的表單紀錄
    const registryRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Forms List!A2:E',
    });
    const registryRows = registryRes.data.values || [];
    if (registryRows.length === 0) {
      return res.json({ mistakes: [], leaderboard: null });
    }

    // 取得最近 10 個表單
    const recentForms = registryRows
      .slice(-10)
      .reverse();

    const allMistakeCounts: { [key: string]: number } = {};
    const allScores: { email: string, score: number, date: string }[] = [];

    // 2. 遍歷每個表單，直接從 Forms API 讀取回覆
    for (const row of recentForms) {
      const formId = row[0];
      const sessionDate = row[4];
      
      try {
        // 取得表單結構（為了知道正確答案）
        const formMetadata = await formsApi.forms.get({ formId });
        const questions = formMetadata.data.items || [];
        
        // 建立問題 ID 到正確答案與單字的對照表
        const questionMap = new Map();
        questions.forEach(item => {
          if (item.questionItem?.question) {
            const q = item.questionItem.question;
            const correctAnswers = q.grading?.correctAnswers?.answers?.map(a => a.value) || [];
            
            // 從標題提取單字 (例如 "1. 單字 (讀音) 的意思是什麼？" -> "單字")
            const title = item.title || '';
            const cleanTitle = title.replace(/^\d+\.\s*/, '');
            const wordMatch = cleanTitle.match(/^(.+?)\s*\(/);
            const word = wordMatch ? wordMatch[1] : cleanTitle.split(' ')[0];

            questionMap.set(item.questionItem.question.questionId, {
              word,
              correctAnswers
            });
          }
        });

        // 讀取該表單的所有回覆
        const responsesRes = await formsApi.forms.responses.list({ formId });
        const responses = responsesRes.data.responses || [];

        responses.forEach(resp => {
          // 記錄分數
          const totalScore = resp.totalScore || 0;
          // 嘗試取得 Email (如果表單有收集)
          const email = resp.respondentEmail || 'anonymous';
          allScores.push({ email, score: totalScore, date: sessionDate });

          // 檢查答案找出錯誤
          Object.entries(resp.answers || {}).forEach(([qId, answerObj]: [string, any]) => {
            const qInfo = questionMap.get(qId);
            if (qInfo) {
              const userAnswers = answerObj.textAnswers?.answers?.map((a: any) => a.value) || [];
              const isCorrect = qInfo.correctAnswers.some((ca: string) => userAnswers.includes(ca));
              
              if (!isCorrect) {
                allMistakeCounts[qInfo.word] = (allMistakeCounts[qInfo.word] || 0) + 1;
              }
            }
          });
        });
      } catch (e) {
        console.error(`Failed to analyze form ${formId}:`, e);
      }
    }

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
      
      leaderboard = {
        champions: Array.from(new Set(allScores.filter(s => s.score === maxScore).map(s => s.email))),
        lowests: Array.from(new Set(allScores.filter(s => s.score === minScore).map(s => s.email))),
        maxScore,
        minScore
      };
    }

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
    const description = "📚 N5 單字表 (考前預習):\n\n" + 
      vocabulary.map((v: any, i: number) => {
        let text = `${i + 1}. ${v.word} (${v.reading}) - ${v.meaning}`;
        if (v.example) text += `\n   例句：${v.example}`;
        return text;
      }).join('\n\n');

    const requests = [
      {
        updateSettings: {
          settings: { 
            quizSettings: { isQuiz: true },
            emailCollectionType: 'VERIFIED',
            responseSettings: {
              sendResponseCopy: 'ALWAYS'
            }
          },
          updateMask: 'quizSettings.isQuiz,emailCollectionType,responseSettings.sendResponseCopy'
        }
      },
      {
        updateFormInfo: {
          info: {
            title: title,
            description
          },
          updateMask: 'title,description'
        }
      }
    ];

    // 3. 加入題目 (混合題型)
    // 10% 填空題 (Short Answer), 80% 選擇題 (Multiple Choice), 10% (5題) N5 考試題型
    vocabulary.forEach((item: any, index: number) => {
      const questionNumber = index + 1;
      
      if (item.isExamStyle && item.examQuestionText) {
        // N5 考試題型：填充句子
        const options = [item.word, ...item.distractors].sort(() => 0.5 - Math.random());
        requests.push({
          createItem: {
            item: {
              title: `${questionNumber}. 請選擇最適合填入空格的單字：\n\n${item.examQuestionText}`,
              questionItem: {
                question: {
                  required: true,
                  grading: { 
                    pointValue: 2, 
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
      } else {
        const isShortAnswer = Math.random() < 0.1;

        if (isShortAnswer) {
          requests.push({
            createItem: {
              item: {
                title: `${questionNumber}. ${item.word} (${item.meaning}) 的假名是什麼？`,
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
                title: `${questionNumber}. ${item.word} (${item.reading}) 的意思是什麼？`,
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
      }
    });

    await forms.forms.batchUpdate({
      formId: formId!,
      requestBody: { requests }
    });

    // 4. 建立專屬試算表並記錄到 Master Registry
    if (spreadsheetId) {
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
      
      // 讀取 Master Registry 獲取當日 Index
      const registryRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Forms List!A:E',
      });
      const rows = registryRes.data.values || [];
      const todayCount = rows.filter(row => row[4] && row[4].startsWith(now.toISOString().split('T')[0])).length;
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
        ...vocabulary.map((v: any) => [v.word, v.reading, v.meaning, v.example])
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
      
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'Forms List!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: formRecord }
      });

      res.json({ 
        success: true, 
        formUrl, 
        formId,
        sessionSheetId
      });
    }
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
        range: 'Forms List!A2:E',
      });

      const forms = await Promise.all((response.data.values || []).slice(0, 20).map(async row => {
        const id = row[0];
        const sessionSheetId = row[3];
        let responseCount = 0;
        let averageScore = 0;

        try {
          // 直接從 Forms API 讀取回覆
          const formsRes = await formsApi.forms.responses.list({ formId: id });
          const responses = formsRes.data.responses || [];
          responseCount = responses.length;
          
          if (responseCount > 0) {
            const scores = responses.map(r => r.totalScore || 0);
            averageScore = scores.reduce((a, b) => a + b, 0) / responseCount;
          }
        } catch (e) {
          console.error(`Failed to fetch basic info for form ${id}:`, e);
        }

        return {
          id,
          title: row[1],
          url: row[2],
          date: row[4],
          sessionSheetId,
          responseCount,
          averageScore: Math.round(averageScore)
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
    const drive = google.drive({ version: 'v3', auth: client });

    // 1. 從 Google Drive 刪除表單檔案
    try {
      await drive.files.delete({ fileId: formId });
    } catch (e) {
      console.error('Failed to delete file from Drive:', e);
      // 即使 Drive 刪除失敗（例如檔案已被手動刪除），我們仍繼續清理試算表紀錄
    }

    // 2. 讀取所有表單紀錄並找出對應的試算表 ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Forms List!A:E',
    });

    const values = response.data.values || [];
    const targetRow = values.find(row => row[0] === formId);
    const sessionSheetId = targetRow ? targetRow[3] : null;

    // 3. 從 Google Drive 刪除專屬試算表
    if (sessionSheetId) {
      try {
        await drive.files.delete({ fileId: sessionSheetId });
      } catch (e) {
        console.error('Failed to delete session sheet from Drive:', e);
      }
    }

    const newValues = values.filter(row => row[0] !== formId);

    // 4. 覆寫 Master Registry
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: 'Forms List!A:E',
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
      properties: { title: 'N5 Vocabulary Master - Master Registry' },
      sheets: [
        { properties: { title: 'Forms List' } }
      ]
    };
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: resource,
      fields: 'spreadsheetId',
    });

    // 初始化表頭
    await sheets.spreadsheets.values.update({
      spreadsheetId: spreadsheet.data.spreadsheetId!,
      range: 'Forms List!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [['Form ID', 'Title', 'Form URL', 'Spreadsheet ID', 'Date']]
      }
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
