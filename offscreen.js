// モデルUUIDはbackground.jsから渡される

const API_URL = 'https://api.aivis-project.com/v1/tts/synthesize';
let audio = null;
let heartbeatInterval;

function startHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'heartbeat' });
  }, 15000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// 再生が終了または停止したときにUIを更新するための通知を送る
function notifyUIPlaybackFinished() {
    chrome.runtime.sendMessage({ type: 'tts-finished' });
}

// グローバル変数として保持
let currentText = null;

chrome.runtime.onMessage.addListener((message) => {
  // ターゲットが自分自身であることを確認
  if (message.target !== 'offscreen-doc') {
    console.log('OFFSCREEN: Message not for offscreen-doc, ignoring:', message.type);
    return;
  }

  console.log('OFFSCREEN: Received message:', message);

  if (message.type === 'start') {
    console.log('OFFSCREEN: Start command received. Text length:', message.data ? message.data.length : 'null');
    currentText = message.data; // テキストを保存
    console.log('OFFSCREEN: Starting streaming process...');
    startStreaming(); // APIキーのリクエストを開始
  } else if (message.type === 'stop') {
    console.log('OFFSCREEN: Stop command received.');
    stopHeartbeat();
    if (audio) {
      console.log('OFFSCREEN: Stopping audio playback.');
      audio.pause();
      audio.src = ""; // リソースを解放
      audio = null;
    }
    notifyUIPlaybackFinished(); // UIに停止を通知
  } else if (message.type === 'aivis-config-response') {
    console.log('OFFSCREEN: Received AIVIS config.');
    console.log('OFFSCREEN: API Key present:', !!message.key);
    console.log('OFFSCREEN: Model UUID:', message.uuid || 'using default');
    const apiKey = message.key;
    // 値が設定されていなければデフォルトのモデルを使用
    const modelUuid = message.uuid || 'f5017410-fbb5-49e1-97cb-e785f42e15f5';

    if (!apiKey) {
      console.error('OFFSCREEN: AIVIS APIキーが設定されていません');
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: 'エラー: AIVIS APIキーが設定されていません。設定ページで設定してください。' 
      });
      notifyUIPlaybackFinished();
      return;
    }
    
    if (!currentText) {
      console.error('OFFSCREEN: 読み上げテキストがありません');
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: 'エラー: 読み上げるテキストが見つかりません。' 
      });
      notifyUIPlaybackFinished();
      return;
    }
    
    console.log('OFFSCREEN: Calling fetchAndPlayAudio with text length:', currentText.length);
    fetchAndPlayAudio(apiKey, modelUuid, currentText);
  }
});

// 1. 設定情報のリクエストを開始する関数
function startStreaming() {
  console.log('OFFSCREEN: Requesting AIVIS config from background script.');
  stopHeartbeat();
  if (audio) {
    console.log('OFFSCREEN: An existing audio instance is being paused.');
    audio.pause();
  }
  startHeartbeat();

  // background.jsに設定情報を要求
  chrome.runtime.sendMessage({ type: 'get-aivis-config' });
}

// 2. 設定情報を受け取ってから実行する関数
async function fetchAndPlayAudio(apiKey, modelUuid, text) {
  try {
    console.log(`OFFSCREEN: Calling AIVIS TTS API with model ${modelUuid}.`);
    chrome.runtime.sendMessage({ 
      action: 'updateStatus', 
      status: 'AIVIS APIに音声生成を依頼中...' 
    });
    
    const requestBody = { model_uuid: modelUuid, text: text.substring(0, 3000), output_format: 'mp3' };
    console.log('OFFSCREEN: Making API request with body:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    console.log('OFFSCREEN: API response received. Status:', response.status);
    console.log('OFFSCREEN: Response headers:', response.headers);

    if (!response.ok) {
      let errorMessage = 'AIVIS APIエラーが発生しました。';
      if (response.status === 401) {
        errorMessage = 'AIVIS APIキーが無効です。設定を確認してください。';
      } else if (response.status === 429) {
        errorMessage = 'AIVIS APIの利用制限に達しました。しばらく待ってから再試行してください。';
      } else if (response.status >= 500) {
        errorMessage = 'AIVIS APIサーバーでエラーが発生しています。しばらく待ってから再試行してください。';
      } else if (response.status === 404) {
        errorMessage = '指定されたAIVISモデルが見つかりません。設定を確認してください。';
      }
      
      console.error('OFFSCREEN: API request failed. Status:', response.status);
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: `エラー: ${errorMessage} (HTTP ${response.status})` 
      });
      throw new Error(errorMessage);
    }
    
    if (!response.body) {
      console.error('OFFSCREEN: API response has no body.');
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: 'エラー: AIVIS APIからの応答が不正です。' 
      });
      throw new Error('API応答エラー');
    }
    
    chrome.runtime.sendMessage({ 
      action: 'updateStatus', 
      status: '音声を再生しています...' 
    });

    const mediaSource = new MediaSource();
    const mediaSourceUrl = URL.createObjectURL(mediaSource);
    audio = new Audio(mediaSourceUrl);
    console.log('OFFSCREEN: Audio element created.');

    const cleanup = () => {
      console.log('OFFSCREEN: Cleanup function called.');
      stopHeartbeat();
      if (mediaSourceUrl) URL.revokeObjectURL(mediaSourceUrl);
      audio = null;
      notifyUIPlaybackFinished();
    };
    audio.addEventListener('ended', () => {
      console.log('OFFSCREEN: Audio playback ended.');
      cleanup();
    });
    audio.addEventListener('error', (e) => {
      console.error('OFFSCREEN: Audio element error:', e);
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: 'エラー: 音声の再生に失敗しました。' 
      });
      cleanup();
    });

    audio.play().then(() => {
      console.log('OFFSCREEN: Audio playback started.');
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: '読み上げ中...' 
      });
    }).catch(e => {
      console.error('OFFSCREEN: Audio play() failed:', e);
      chrome.runtime.sendMessage({ 
        action: 'updateStatus', 
        status: 'エラー: ブラウザでの音声再生に失敗しました。' 
      });
      cleanup();
    });

    mediaSource.addEventListener('sourceopen', async () => {
      const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
      const reader = response.body.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (sourceBuffer.updating) {
            await new Promise(resolve => sourceBuffer.addEventListener('updateend', resolve, { once: true }));
          }
          sourceBuffer.appendBuffer(value);
        }
      } catch (err) {
        console.error("OFFSCREEN: Stream reading error:", err);
        chrome.runtime.sendMessage({ 
          action: 'updateStatus', 
          status: 'エラー: 音声データの読み込みに失敗しました。' 
        });
        cleanup();
        return;
      }
      
      if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
        mediaSource.endOfStream();
      }
    });
  } catch (error) {
    console.error('OFFSCREEN: Error in fetchAndPlayAudio:', error);
    
    let userMessage = 'TTS機能でエラーが発生しました。';
    if (error.message.includes('network') || error.message.includes('fetch')) {
      userMessage = 'ネットワーク接続を確認してください。';
    } else if (error.message.includes('API')) {
      userMessage = 'AIVIS APIの設定を確認してください。';
    } else if (error.message.includes('401') || error.message.includes('unauthorized')) {
      userMessage = 'AIVIS APIキーが無効です。設定を確認してください。';
    }
    
    chrome.runtime.sendMessage({ 
      action: 'updateStatus', 
      status: `エラー: ${userMessage}` 
    });
    
    stopHeartbeat();
    notifyUIPlaybackFinished(); // UIにエラーを通知
  }
}