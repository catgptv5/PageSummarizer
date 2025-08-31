// =================================================================
// グローバル変数
// =================================================================
let targetTabId = null; // アイコンがクリックされたタブのIDを保持
let creating; // Offscreen Document作成中のプロミスを管理

const LMSTUDIO_API_URL = 'http://127.0.0.1:1234/v1/chat/completions'; // LM StudioのAPIエンドポイント
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const CONTEXT_MENU_ID_SUMMARIZE_SELECTION = 'summarize-selection';


// =================================================================
// Offscreen Document管理
// =================================================================
// Offscreen Documentが存在しない場合にセットアップする関数
async function setupOffscreenDocument(path) {
  try {
    // 既存のOffscreen Documentコンテキストを検索
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT']
    });
    
    // 既に目的のOffscreen Documentが存在すれば何もしない
    if (existingContexts.find(c => c.documentURL === offscreenUrl)) {
      console.log('BG: Offscreen document already exists:', offscreenUrl);
      return;
    }
    
    // 既存のOffscreen Documentが存在する場合（別のURL）も何もしない
    if (existingContexts.length > 0) {
      console.log('BG: Different offscreen document exists, skipping creation');
      return;
    }

    // 他の処理で作成中の場合は、それが終わるのを待つ
    if (creating) {
      console.log('BG: Waiting for existing creation process');
      await creating;
      return;
    }
    
    // 新しくOffscreen Documentを作成
    console.log('BG: Creating new offscreen document:', path);
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Text-to-speech audio playback is required.',
    });
    await creating;
    creating = null; // 作成完了後、プロミスをリセット
    console.log('BG: Offscreen document created successfully');
    
  } catch (error) {
    creating = null; // エラー時もプロミスをリセット
    console.error('BG: Offscreen document setup failed:', error);
    throw error;
  }
}

// =================================================================
// イベントリスナー
// =================================================================

// 拡張機能のアイコンがクリックされたときの処理
// chrome.action.onClicked.addListener((tab) => {
//   targetTabId = tab.id; // クリックされたタブのIDを保存
//   // 新しいウィンドウとしてUIを開く
//   chrome.windows.create({
//     url: 'popup.html',
//     type: 'popup',
//     width: 400,
//     height: 550, // 読み上げボタンの分、少し高さを増やす
//   });
// });

// 各コンポーネント（popup, offscreen）からのメッセージを中継・処理
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('BG: Received message:', request); // ★ ログ追加

  (async () => {
    // ポップアップから「要約開始」
    if (request.action === 'summarize') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await summarizePage(tab.id);
      }
    }

    // TTS開始（自動または手動）
    else if (request.type === 'start-tts') {
      console.log('BG: Handling start-tts. Ensuring offscreen document is ready.');
      await setupOffscreenDocument('offscreen.html');

      console.log('BG: Forwarding start-tts message to offscreen document.');
      // ★ オフスクリーンに直接メッセージを送信
      await chrome.runtime.sendMessage({ type: 'start', target: 'offscreen-doc', data: request.text });
    }
    
    // TTS停止
    else if (request.type === 'stop-tts') {
      console.log('BG: Handling stop-tts. Forwarding to offscreen document.');
      // ★ オフスクリーンに直接メッセージを送信
      await chrome.runtime.sendMessage({ type: 'stop', target: 'offscreen-doc' });
    }
    
    // Offscreenから「再生完了/停止」
    else if (request.type === 'tts-finished') {
      console.log('BG: Handling tts-finished. Forwarding to popup.');
      // ★ ポップアップに直接メッセージを送信（ブロードキャストでOK）
      await chrome.runtime.sendMessage({ type: 'tts-finished' });
    }
    
    // Offscreenから「ハートビート」
    else if (request.type === 'heartbeat') {
      // console.log('BG: Heartbeat received.'); // 必要ならログ追加
    }

    // OffscreenからAIVIS設定（APIキーとモデルUUID）のリクエスト
    else if (request.type === 'get-aivis-config') {
      console.log('BG: Received request for AIVIS config from offscreen.');
      const result = await chrome.storage.local.get(['aivis_api_key', 'aivis_model_uuid']);
      await chrome.runtime.sendMessage({
        type: 'aivis-config-response',
        target: 'offscreen-doc',
        key: result.aivis_api_key,
        uuid: result.aivis_model_uuid
      });
      console.log('BG: Sent AIVIS config to offscreen.');
    }
    
    // Offscreenからの旧メッセージ互換: APIキーのみのリクエスト
    else if (request.type === 'get-aivis-key') {
      console.log('BG: Received request for AIVIS API key from offscreen.');
      const result = await chrome.storage.local.get(['aivis_api_key']);
      await chrome.runtime.sendMessage({
        type: 'aivis-key-response',
        target: 'offscreen-doc',
        key: result.aivis_api_key
      });
      console.log('BG: Sent AIVIS API key to offscreen.');
    }
    
    // ポップアップから「保存された要約の取得」
    else if (request.type === 'get-summary') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let summary = null;
      if (tab) {
        const key = `summary-${tab.id}`;
        const result = await chrome.storage.session.get([key, 'summary-latest']);
        summary = result[key] || result['summary-latest'] || null;
      } else {
        const result = await chrome.storage.session.get(['summary-latest']);
        summary = result['summary-latest'] || null;
      }
      sendResponse(summary);
      return; // 非同期sendResponseのため

    // ポップアップから手動で「Slack送信」
    } else if (request.action === 'sendToSlack') {
      if (request.summary && targetTabId) {
        const tab = await chrome.tabs.get(targetTabId);
        await sendToSlack(request.summary, tab.url);
      }
    }
    
    // チャット機能
    else if (request.action === 'chat') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await handleChatRequest(request.message, tab.id);
      } else {
        chrome.runtime.sendMessage({
          action: 'chatResponse',
          error: '現在のタブを取得できませんでした。'
        });
      }
    }
    
    // ページコンテキストの取得
    else if (request.action === 'getPageContext') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const pageContext = await getPageContext(tab.id);
        sendResponse(pageContext);
      } else {
        sendResponse(null);
      }
      return;
    }
    
    // ポップアップ状態の取得
    else if (request.action === 'getPopupState') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const state = await getPopupState(tab.id);
        sendResponse(state);
      } else {
        sendResponse({ activeTab: 'summary', timestamp: 0 });
      }
      return;
    }
    
    // チャット履歴の取得
    else if (request.action === 'getChatHistory') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        const history = await getChatHistory(tab.id);
        sendResponse(history);
      } else {
        sendResponse([]);
      }
      return;
    }
    
    // タブ切り替え状態の保存
    else if (request.action === 'saveTabState') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && request.activeTab) {
        await savePopupState(tab.id, request.activeTab);
      }
    }
    
    // デタッチウィンドウを開く
    else if (request.action === 'openDetachedWindow') {
      try {
        const window = await chrome.windows.create({
          url: 'detached.html',
          type: 'popup',
          width: 1200,
          height: 900,
          left: 50,
          top: 50
        });
        console.log('BG: デタッチウィンドウ作成完了:', window.id);
      } catch (error) {
        console.error('デタッチウィンドウ作成エラー:', error);
      }
    }
    
    // チャットメッセージの個別再生
    else if (request.action === 'playMessageTTS') {
      if (request.text) {
        await startTTS(request.text);
      }
    }

  })();
  return true;
});

// =================================================================
// コンテキストメニュー（選択範囲の要約）
// =================================================================

function registerContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID_SUMMARIZE_SELECTION,
        title: '選択範囲を要約',
        contexts: ['selection']
      });
    });
  } catch (e) {
    console.warn('Context menu registration failed:', e);
  }
}

// インストール時・起動時にコンテキストメニューを作成
chrome.runtime.onInstalled.addListener(registerContextMenus);
chrome.runtime.onStartup.addListener(registerContextMenus);

// 右クリックメニューからのクリックを処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID_SUMMARIZE_SELECTION) return;
  if (!tab || !tab.id) return;
  const selectedText = (info.selectionText || '').trim();
  if (!selectedText) return;

  // アクションポップアップを開く（アイコン押下と同様のUI）
  try {
    await chrome.storage.session.set({ 'selection-pending': true });
    await chrome.action.openPopup();
  } catch (e) {
    // openPopupが許可されない環境でも処理は継続
  }

  // ポップアップにステータス（開いていれば表示される）
  chrome.runtime.sendMessage({ action: 'updateStatus', status: '選択範囲を要約中...' });

  try {
    await summarizeSelectedText(selectedText, tab.id);
  } catch (e) {
    console.error('Failed to summarize selected text:', e);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `エラー: ${e.message}` });
  }
});
// =================================================================
// 要約機能
// =================================================================

// ページ内容を取得し、要約を実行するメイン関数
async function summarizePage(tabId) {
  // ポップアップにステータスを通知
    console.log('BG: summarizePage開始。まずOffscreenを準備します。');

  chrome.runtime.sendMessage({ action: 'updateStatus', status: 'ページのテキストを抽出中...' });

  let results;
  try {
    // まずReadability.jsをページに注入
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["Readability.js"],
    });

    // 次に、注入したReadabilityを使って本文を抽出する関数を実行
    results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // ページのDOMのコピーをReadabilityに渡す
        const documentClone = document.cloneNode(true);
        const article = new Readability(documentClone).parse();
         if (article && article.textContent) {
          let text = article.textContent;

          // ★★★ここからが追加・修正部分★★★
          
          // 1. 削除したい文字列のリストを定義
          const unwantedStrings = [
            "キーボードショートカットを表示するには、はてなマークを押してください。",
            "キーボードショートカットを表示",
            "ポスト会話"
            // 他にも削除したい定型文があれば、ここに追加
          ];

          // 2. 各文字列を空文字に置換して削除
          unwantedStrings.forEach(str => {
            // 'g'フラグを使って、文書内の全ての出現箇所を置換
            text = text.replace(new RegExp(str, 'g'), '');
          });

          // 3. 場合によっては、余分な改行や空白を整理する
          // 複数の改行を2つにまとめる
          text = text.replace(/\n\s*\n/g, '\n\n');
          // 先頭と末尾の空白を削除
          text = text.trim(); 
          
          return text;

          // ★★★ここまで★★★
        }

        return null; // articleがない、またはtextContentが空の場合はnullを返す

      },
    });

  } catch (e) {
    console.error("Failed to inject script or parse with Readability:", e);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `エラー: ${e.message}` });
    return;
  }

  const pageText = results[0].result;
  if (!pageText || pageText.trim() === '') {
    chrome.runtime.sendMessage({ action: 'updateStatus', status: 'このページから本文を抽出できませんでした。' });
    return;
  }

  // チャット用にもページコンテキストを保存（URL含む）
  const tab = await chrome.tabs.get(tabId);
  const url = new URL(tab.url);
  const urlKey = `${url.hostname}${url.pathname}`;
  const contextKey = `context-${tabId}-${urlKey}`;
  
  await chrome.storage.session.set({ [contextKey]: pageText });
  console.log('BG: 要約機能でチャット用コンテキストを保存:', contextKey, pageText.length, '文字');

  console.log("---Readabilityで抽出した本文---");
  console.log(pageText);
  console.log("--------------------------------");

   console.log('BG: スリープ防止のため、Offscreenをセットアップします');
  await setupOffscreenDocument('offscreen.html');
  
  // 2. LLM APIを呼び出して要約
  console.log('BG: LLM API呼び出し開始');
  chrome.runtime.sendMessage({ action: 'updateStatus', status: 'AIモデルに接続中...' });
  
  try {
    const summary = await callLLM(pageText);

 // ポップアップ表示など
    await chrome.storage.session.set({ [`summary-${tabId}`]: summary, 'summary-latest': summary });
    chrome.runtime.sendMessage({ action: 'displaySummary', summary: summary });

    // Offscreenに再生指示
    console.log('BG: Summarization complete. Sending start-tts message to offscreen document.');
    chrome.runtime.sendMessage({ type: 'start', target: 'offscreen-doc', data: summary });
    
    // Slack送信
    const tab = await chrome.tabs.get(tabId);
    await sendToSlack(summary, tab.url);

  } catch (error) {
    console.error('LLM API or subsequent error:', error);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `エラー: ${error.message}` });
  }
}

// 選択テキストを要約する関数
async function summarizeSelectedText(text, tabId) {
  // Offscreenの準備（スリープ防止）
  await setupOffscreenDocument('offscreen.html');

  // LLMで要約
  chrome.runtime.sendMessage({ action: 'updateStatus', status: 'AIモデルに接続中...' });
  try {
    const summary = await callLLM(text);

    // セッションストレージに保存（ポップアップ再取得用）
    await chrome.storage.session.set({ [`summary-${tabId}`]: summary, 'summary-latest': summary });

    // ポップアップへ表示指示（開いていれば反映）
    chrome.runtime.sendMessage({ action: 'displaySummary', summary });

    // 読み上げ開始
    chrome.runtime.sendMessage({ type: 'start', target: 'offscreen-doc', data: summary });

    // Slack送信
    const tab = await chrome.tabs.get(tabId);
    await sendToSlack(summary, tab.url);
    try { await chrome.storage.session.remove('selection-pending'); } catch (_) {}
  } catch (error) {
    console.error('LLM API or subsequent error (selection):', error);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `エラー: ${error.message}` });
  }
}

// ★★★ ここからが新しいAPI呼び出しロジック ★★★
// LLMを呼び出す汎用関数
async function callLLM(text) {
  try {
    // 1. まずLM Studioを試す
    chrome.runtime.sendMessage({ action: 'updateStatus', status: 'LM Studioに接続中...' });
    chrome.runtime.sendMessage({ action: 'modelInfo', provider: 'LM Studio', model: '(local)' });
    const summary = await callApi(LMSTUDIO_API_URL, null, text);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: 'LM Studioで要約を生成中...' });
    return summary;
  } catch (error) {
    console.warn('LM Studioへの接続に失敗しました。OpenAIに切り替えます。', error);
    
    // 2. LM Studioが失敗したらOpenAIを試す
    const result = await chrome.storage.local.get(['openai_api_key', 'openai_model']);
    const openaiApiKey = result.openai_api_key;
    // 値が設定されていなければデフォルトのモデルを使用
    const openaiModel = result.openai_model || 'gpt-5-mini-2025-08-07';

    if (!openaiApiKey) {
        throw new Error('LM Studioに接続できず、OpenAIのAPIキーも設定されていません。拡張機能のオプションページで設定してください。');
    }
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `OpenAI API (${openaiModel}) に接続中...` });
    chrome.runtime.sendMessage({ action: 'modelInfo', provider: 'OpenAI', model: openaiModel });
    const summary = await callApi(OPENAI_API_URL, openaiApiKey, text, openaiModel);
    chrome.runtime.sendMessage({ action: 'updateStatus', status: `OpenAI (${openaiModel}) で要約を生成中...` });
    return summary;
  }
}

// 実際のAPIリクエストを行う共通関数
async function callApi(apiUrl, apiKey, text, model = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const requestBody = {
    messages: [
      { role: 'system', content: 'あなたは文章を要約する優秀なアシスタントです。以下の文章を日本語で簡潔に、重要なポイントを3〜5点にまとめてください。' },
      { role: 'user', content: text }
    ],
    stream: false
  };
  
  // OpenAIの場合のみモデルを指定
  if (model) {
    requestBody.model = model;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // 接続拒否などのネットワークエラーを区別するために、エラーを再スロー
    throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  } else {
    throw new Error('予期せぬAPIレスポンス形式です。');
  }
}

// =================================================================
// チャット機能
// =================================================================
async function handleChatRequest(message, tabId) {
  try {
    // ページコンテキストを取得
    chrome.runtime.sendMessage({
      action: 'chatStatus',
      status: 'ページ内容を分析中...'
    });
    
    const pageContext = await getPageContext(tabId);
    
    if (!pageContext) {
      chrome.runtime.sendMessage({
        action: 'chatResponse',
        error: 'このページからコンテンツを抽出できませんでした。PDFやログインが必要なページではチャット機能をご利用いただけません。'
      });
      return;
    }
    
    // チャット履歴を取得
    const chatHistory = await getChatHistory(tabId);
    
    // システムプロンプト + ページコンテキスト + チャット履歴 + 新しいメッセージ
    const systemPrompt = `あなたは親切なアシスタントです。以下のウェブページの内容について、日本語で質問に答えてください。

ページの内容:
${pageContext}

上記のページ内容を参考に、ユーザーの質問に答えてください。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: message }
    ];

    // LLMに送信（チャット用のAPI呼び出し）
    const response = await callChatLLM(messages);
    
    // チャット履歴を更新
    await updateChatHistory(tabId, message, response);
    
    chrome.runtime.sendMessage({
      action: 'chatResponse',
      response: response
    });
    
    // チャット回答を自動で読み上げ（設定に応じて）
    const settings = await chrome.storage.local.get(['auto_tts_chat']);
    if (settings.auto_tts_chat !== false) { // デフォルトはtrue
      await startTTS(response);
    }
    
  } catch (error) {
    console.error('チャットエラー:', error);
    chrome.runtime.sendMessage({
      action: 'chatResponse',
      error: `エラーが発生しました: ${error.message}`
    });
  }
}

async function getPageContext(tabId) {
  try {
    console.log('BG: getPageContext called with tabId:', tabId);
    
    // 現在のページURLを取得してキーに含める
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    const urlKey = `${url.hostname}${url.pathname}`;
    const contextKey = `context-${tabId}-${urlKey}`;
    
    console.log('BG: ページコンテキストキー:', contextKey);
    
    // 既にコンテキストが保存されている場合はそれを使用
    const result = await chrome.storage.session.get([contextKey]);
    if (result[contextKey]) {
      console.log('BG: 既存のコンテキストを使用:', result[contextKey].length, '文字');
      return result[contextKey];
    }
    
    // ページから新たにコンテンツを抽出
    console.log('BG: チャット用にページコンテンツを抽出中... tabId:', tabId);
    let results;
    try {
      // まずReadability.jsをページに注入
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ["Readability.js"],
      });

      // 次に、注入したReadabilityを使って本文を抽出する関数を実行
      results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          try {
            // ページのDOMのコピーをReadabilityに渡す
            const documentClone = document.cloneNode(true);
            const article = new Readability(documentClone).parse();
            if (article && article.textContent) {
              let text = article.textContent;
              
              // 不要な文字列を削除
              const unwantedStrings = [
                "キーボードショートカットを表示するには、はてなマークを押してください。",
                "キーボードショートカットを表示",
                "ポスト会話"
              ];
              
              unwantedStrings.forEach(str => {
                text = text.replace(new RegExp(str, 'g'), '');
              });
              
              // 余分な改行や空白を整理
              text = text.replace(/\n\s*\n/g, '\n\n');
              text = text.trim();
              
              return text;
            }
            return null;
          } catch (e) {
            console.error('Readability抽出エラー:', e);
            return null;
          }
        },
      });

      const pageText = results[0].result;
      console.log('BG: 抽出結果:', pageText ? pageText.length + '文字' : 'null');
      
      if (pageText && pageText.trim() !== '') {
        // コンテキストを保存
        await chrome.storage.session.set({ [contextKey]: pageText });
        console.log('BG: ページコンテンツ抽出完了:', pageText.length, '文字');
        return pageText;
      } else {
        console.log('BG: ページテキストが空またはnull');
      }
    } catch (e) {
      console.error('BG: ページコンテンツ抽出失敗:', e);
    }
    
    return null;
  } catch (error) {
    console.error('ページコンテキスト取得エラー:', error);
    return null;
  }
}

async function getChatHistory(tabId) {
  try {
    // 現在のページURLを取得してキーに含める
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    const urlKey = `${url.hostname}${url.pathname}`;
    const key = `chat-${tabId}-${urlKey}`;
    
    console.log('BG: チャット履歴取得:', key);
    
    // chrome.storage.localを使用して永続化（ポップアップが閉じても保持される）
    const result = await chrome.storage.local.get([key]);
    return result[key] || [];
  } catch (error) {
    console.error('チャット履歴取得エラー:', error);
    return [];
  }
}

async function updateChatHistory(tabId, userMessage, assistantResponse) {
  try {
    // 現在のページURLを取得してキーに含める
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    const urlKey = `${url.hostname}${url.pathname}`;
    const key = `chat-${tabId}-${urlKey}`;
    
    console.log('BG: チャット履歴更新:', key);
    
    const chatHistory = await getChatHistory(tabId);
    
    // 新しいメッセージを追加
    chatHistory.push({ role: 'user', content: userMessage });
    chatHistory.push({ role: 'assistant', content: assistantResponse });
    
    // 履歴が長くなりすぎないよう、最新の20件に制限
    const limitedHistory = chatHistory.slice(-20);
    
    // chrome.storage.localを使用して永続化
    await chrome.storage.local.set({ [key]: limitedHistory });
    
    // UIにも履歴を反映させるため、ポップアップ状態も保存
    await savePopupState(tabId, 'chat');
  } catch (error) {
    console.error('チャット履歴更新エラー:', error);
  }
}

// ポップアップ状態の管理
async function savePopupState(tabId, activeTab) {
  try {
    // 現在のページURLを取得してキーに含める
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    const urlKey = `${url.hostname}${url.pathname}`;
    const key = `popup-state-${tabId}-${urlKey}`;
    
    await chrome.storage.local.set({ 
      [key]: { 
        activeTab: activeTab,
        timestamp: Date.now(),
        url: tab.url
      }
    });
    console.log('BG: ポップアップ状態保存:', key, activeTab);
  } catch (error) {
    console.error('ポップアップ状態保存エラー:', error);
  }
}

async function getPopupState(tabId) {
  try {
    // 現在のページURLを取得してキーに含める
    const tab = await chrome.tabs.get(tabId);
    const url = new URL(tab.url);
    const urlKey = `${url.hostname}${url.pathname}`;
    const key = `popup-state-${tabId}-${urlKey}`;
    
    const result = await chrome.storage.local.get([key]);
    const state = result[key] || { activeTab: 'summary', timestamp: 0 };
    
    console.log('BG: ポップアップ状態取得:', key, state.activeTab);
    return state;
  } catch (error) {
    console.error('ポップアップ状態取得エラー:', error);
    return { activeTab: 'summary', timestamp: 0 };
  }
}

// TTS開始関数（チャット回答用）
async function startTTS(text) {
  try {
    console.log('BG: TTS開始処理を開始します...');
    
    // AIVIS APIキーの確認
    const settings = await chrome.storage.local.get(['aivis_api_key']);
    if (!settings.aivis_api_key) {
      const errorMsg = '読み上げ機能を使用するには、設定ページでAIVIS APIキーを設定してください。';
      console.error('BG: AIVIS APIキーが未設定');
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: `エラー: ${errorMsg}` 
      });
      return;
    }
    
    // Offscreenの準備
    console.log('BG: Offscreen Documentを準備中...');
    await setupOffscreenDocument('offscreen.html');
    
    console.log('BG: チャット回答のTTS開始:', text.substring(0, 50) + '...');
    chrome.runtime.sendMessage({ 
      action: 'updateStatus', 
      status: '読み上げ音声を生成中...' 
    });
    
    // Offscreenに再生指示
    chrome.runtime.sendMessage({ 
      type: 'start', 
      target: 'offscreen-doc', 
      data: text 
    });
    
    // UIにTTSコントロール表示を指示
    chrome.runtime.sendMessage({ 
      action: 'showTTSControls' 
    });
    
  } catch (error) {
    console.error('BG: TTS開始エラー:', error);
    let userMessage = 'TTS機能でエラーが発生しました。';
    
    if (error.message.includes('Only a single offscreen document')) {
      userMessage = '読み上げシステムの初期化エラーです。拡張機能を再読み込みしてください。';
    } else if (error.message.includes('network')) {
      userMessage = 'ネットワーク接続を確認してください。';
    } else if (error.message.includes('API')) {
      userMessage = 'AIVIS APIの設定を確認してください。';
    }
    
    chrome.runtime.sendMessage({ 
      action: 'updateStatus', 
      status: `エラー: ${userMessage}` 
    });
  }
}

// チャット用のLLM呼び出し関数
async function callChatLLM(messages) {
  try {
    // 1. まずLM Studioを試す
    try {
      console.log('BG: LM Studioでチャット処理中...');
      const response = await callChatApi(LMSTUDIO_API_URL, null, messages);
      return response;
    } catch (error) {
      console.warn('LM Studioへの接続に失敗しました。OpenAIに切り替えます。', error);
      
      // 2. LM Studioが失敗したらOpenAIを試す
      const result = await chrome.storage.local.get(['openai_api_key', 'openai_model']);
      const openaiApiKey = result.openai_api_key;
      const openaiModel = result.openai_model || 'gpt-5-mini-2025-08-07';

      if (!openaiApiKey) {
        throw new Error('LM Studioに接続できず、OpenAIのAPIキーも設定されていません。拡張機能のオプションページで設定してください。');
      }

      console.log('BG: OpenAIでチャット処理中...');
      const response = await callChatApi(OPENAI_API_URL, openaiApiKey, messages, openaiModel);
      return response;
    }
  } catch (error) {
    console.error('チャットLLM呼び出しエラー:', error);
    throw error;
  }
}

// チャット用のAPI呼び出し関数
async function callChatApi(apiUrl, apiKey, messages, model = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const requestBody = {
    messages: messages,
    stream: false
  };
  
  // OpenAIの場合のみモデルを指定
  if (model) {
    requestBody.model = model;
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Chat API request failed with status ${response.status}: ${errorBody}`);
  }

  const data = await response.json();

  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content;
  } else {
    throw new Error('予期せぬチャットAPIレスポンス形式です。');
  }
}

// =================================================================
// Slack送信機能
// =================================================================
async function sendToSlack(summaryText, pageUrl) {
  const result = await chrome.storage.local.get(['slack_webhook_url']);
  const slackWebhookUrl = result.slack_webhook_url;

  if (!slackWebhookUrl) {
    const errorMessage = 'Slack Webhook URLが設定されていません。拡張機能のオプションページで設定してください。';
    console.error(errorMessage);
    chrome.runtime.sendMessage({ action: 'slackStatus', status: `エラー: URL未設定` });
    return;
  }

  // Slackに送信するメッセージをBlock Kit形式で作成
  const payload = {
    blocks: [
      {
        "type": "header",
        "text": {
          "type": "plain_text",
          "text": "📝 ページ要約",
          "emoji": true
        }
      },
      {
        "type": "section",
        "text": {
          "type": "mrkdwn",
          // SlackのMarkdown形式に変換（**太字** -> *太字* など）
          "text": summaryText.replace(/\*\*(.*?)\*\*/g, '*$1*')
        }
      },
      {
        "type": "divider"
      },
      {
        "type": "context",
        "elements": [
          {
            "type": "mrkdwn",
            "text": `元のページ: <${pageUrl}|${pageUrl}>`
          }
        ]
      }
    ]
  };

  try {
    const response = await fetch(slackWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok || (await response.text()) !== 'ok') {
      throw new Error(`Slackへの送信に失敗しました。Status: ${response.status}`);
    }

    // ポップアップに成功を通知
    chrome.runtime.sendMessage({ action: 'slackStatus', status: 'Slackに送信しました！' });

  } catch (error) {
    console.error('Slack送信エラー:', error);
    chrome.runtime.sendMessage({ action: 'slackStatus', status: `エラー: ${error.message}` });
  }
}