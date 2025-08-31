document.addEventListener('DOMContentLoaded', async () => {
  // --- 要素の取得 ---
  const summarizeBtn = document.getElementById('summarize-btn');
  const summaryDiv = document.getElementById('summary');
  const statusP = document.getElementById('status');
  const modelInfoP = document.getElementById('model-info');
  const ttsStatusP = document.getElementById('tts-status');
  const ttsControls = document.getElementById('tts-controls');
  const playBtn = document.getElementById('play-btn');
  const stopBtn = document.getElementById('stop-btn');
  // const slackBtn = document.getElementById('slack-btn');
  const slackStatusP = document.getElementById('slack-status');
  
  const converter = new showdown.Converter();

  // --- 関数定義 ---
  // TTSステータス表示関数
  function showTTSStatus(message, type = 'info') {
    if (!ttsStatusP) return;
    
    ttsStatusP.textContent = message;
    ttsStatusP.className = `tts-status ${type}`;
    ttsStatusP.style.display = 'block';
    
    // 成功メッセージは3秒後に自動で消す
    if (type === 'success') {
      setTimeout(() => {
        ttsStatusP.style.display = 'none';
      }, 3000);
    }
  }
  
  function hideTTSStatus() {
    if (ttsStatusP) {
      ttsStatusP.style.display = 'none';
    }
  }
  // 要約開始処理をまとめた関数
  const startSummarization = () => {
    summaryDiv.innerHTML = '';
    statusP.textContent = 'ページのテキストを取得中...';
    modelInfoP.textContent = '';
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = '要約中...';
    // ★ボタン類をすべて非表示にする
    ttsControls.style.display = 'none';
    chrome.runtime.sendMessage({ action: 'summarize' });
  };

  // --- 初期化処理 ---
  // まず要約処理を実行（既存の処理）
  
  // まずは保存された要約があるか確認（選択要約からの起動にも対応）
  const summaryText = await chrome.runtime.sendMessage({ type: 'get-summary' });
  const selFlag = await chrome.storage.session.get(['selection-pending']);
  const fromSelection = !!selFlag['selection-pending'];
  if (summaryText) {
    summaryDiv.innerHTML = converter.makeHtml(summaryText);
    statusP.textContent = fromSelection ? '選択範囲の要約結果です。' : '前回の要約結果を表示しています。';
    ttsControls.style.display = 'flex';
  } else if (!fromSelection) {
    // 選択要約起点 (#selection) でない場合のみ自動要約
    startSummarization();
  } else {
    statusP.textContent = '選択範囲の要約を待機中...';
  }

  // --- メッセージリスナー ---
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'displaySummary') {
      summaryDiv.innerHTML = converter.makeHtml(message.summary);
      statusP.textContent = '要約が完了し、読み上げを開始します。';
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = 'このページを再度要約する';
      
      // ★要約完了時に、すべてのコントロールを表示する
      ttsControls.style.display = 'flex';
      playBtn.style.display = 'none';
      stopBtn.style.display = 'block';

    } else if (message.action === 'updateStatus') {
      // TTSメッセージかチェック
      if (message.status && (
        message.status.includes('読み上げ') || 
        message.status.includes('AIVIS') || 
        message.status.includes('音声') ||
        message.status.includes('TTS')
      )) {
        if (message.status.includes('エラー')) {
          showTTSStatus(message.status, 'error');
        } else if (message.status.includes('完了') || message.status.includes('再生中')) {
          showTTSStatus(message.status, 'success');
        } else {
          showTTSStatus(message.status, 'info');
        }
      } else {
        statusP.textContent = message.status;
      }
    } else if (message.action === 'modelInfo') {
      const modelLabel = message.model ? ` ${message.model}` : '';
      modelInfoP.textContent = `使用モデル: ${message.provider}${modelLabel}`;
    } else if (message.type === 'tts-finished') {
      playBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      hideTTSStatus();
    } else if (message.action === 'slackStatus') {
      slackStatusP.textContent = message.status;
      setTimeout(() => { slackStatusP.textContent = ''; }, 3000);
    }
  });

  // --- イベントリスナー ---
  summarizeBtn.addEventListener('click', startSummarization);

  playBtn.addEventListener('click', () => {
    const textToRead = summaryDiv.innerText;
    console.log('POPUP: Play button clicked. Sending start-tts message with text:', textToRead);
    chrome.runtime.sendMessage({ type: 'start-tts', text: textToRead });
    playBtn.style.display = 'none';
    stopBtn.style.display = 'block';
  });

  stopBtn.addEventListener('click', () => {
    console.log('POPUP: Stop button clicked. Sending stop-tts message.');
    chrome.runtime.sendMessage({ type: 'stop-tts' });
  });
  
  // slackBtn.addEventListener('click', () => {
  //   const summaryText = summaryDiv.innerText;
  //   if (summaryText) {
  //     slackStatusP.textContent = 'Slackに送信中...';
  //     chrome.runtime.sendMessage({ action: 'sendToSlack', summary: summaryText });
  //   }
  // });

  // --- チャット機能の要素取得 ---
  const summaryTab = document.getElementById('summary-tab');
  const chatTab = document.getElementById('chat-tab');
  const summaryContent = document.getElementById('summary-content');
  const chatContent = document.getElementById('chat-content');
  const chatMessages = document.getElementById('chat-messages');
  const chatInput = document.getElementById('chat-input');
  const chatSend = document.getElementById('chat-send');
  const detachBtn = document.getElementById('detach-btn');

  // --- タブ切り替え機能 ---
  summaryTab.addEventListener('click', () => {
    switchTab('summary');
  });

  chatTab.addEventListener('click', () => {
    switchTab('chat');
  });

  function switchTab(tabName) {
    try {
      // 要素が存在するか確認
      if (!summaryTab || !chatTab || !summaryContent || !chatContent) {
        console.error('タブ切り替え用の要素が見つかりません');
        return;
      }
      
      // タブボタンの状態を切り替え
      if (tabName === 'summary') {
        summaryTab.classList.add('active');
        chatTab.classList.remove('active');
        summaryContent.classList.add('active');
        chatContent.classList.remove('active');
      } else {
        summaryTab.classList.remove('active');
        chatTab.classList.add('active');
        summaryContent.classList.remove('active');
        chatContent.classList.add('active');
      }
      
      // 状態をbackgroundに保存
      chrome.runtime.sendMessage({
        action: 'saveTabState',
        activeTab: tabName
      });
    } catch (error) {
      console.error('タブ切り替えエラー:', error);
    }
  }

  // --- チャット機能 ---
  function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;

    // ユーザーメッセージを表示
    addChatMessage(message, 'user');
    chatInput.value = '';

    // アシスタントの応答待ち表示
    const loadingMsg = addChatMessage('回答を生成中...', 'assistant');

    // バックグラウンドにメッセージを送信
    chrome.runtime.sendMessage({ 
      action: 'chat', 
      message: message 
    });
  }

  function addChatMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;
    messageDiv.textContent = text;
    
    // AIメッセージの場合、再生ボタンを追加
    if (sender === 'assistant') {
      const ttsBtn = document.createElement('button');
      ttsBtn.className = 'message-tts-btn';
      ttsBtn.innerHTML = '🔊';
      ttsBtn.title = 'このメッセージを読み上げ';
      ttsBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: 'playMessageTTS',
          text: text
        });
      });
      messageDiv.appendChild(ttsBtn);
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return messageDiv;
  }

  chatSend.addEventListener('click', sendChatMessage);
  
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // --- 状態復元処理（要素取得完了後に実行）---
  async function restoreState() {
    try {
      // ポップアップ状態を復元
      const popupState = await chrome.runtime.sendMessage({ action: 'getPopupState' });
      const chatHistoryData = await chrome.runtime.sendMessage({ action: 'getChatHistory' });
      
      // 前回のタブ状態を復元
      if (popupState && popupState.activeTab === 'chat') {
        switchTab('chat');
      }
      
      // チャット履歴を復元
      if (chatHistoryData && chatHistoryData.length > 0) {
        // デフォルトメッセージをクリア
        chatMessages.innerHTML = '';
        
        // 履歴を表示
        chatHistoryData.forEach(msg => {
          addChatMessage(msg.content, msg.role === 'user' ? 'user' : 'assistant');
        });
      }
    } catch (error) {
      console.error('状態復元エラー:', error);
    }
  }

  // 状態復元を実行
  restoreState();

  // --- リサイズ機能 ---
  const resizeHandle = document.querySelector('.resize-handle');
  let isResizing = false;
  let startX, startY, startWidth, startHeight;

  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseInt(document.defaultView.getComputedStyle(document.body).width, 10);
      startHeight = parseInt(document.defaultView.getComputedStyle(document.body).height, 10);
      
      // マウス移動とマウスアップのイベントリスナーを追加
      document.addEventListener('mousemove', handleResize);
      document.addEventListener('mouseup', stopResize);
      
      // テキスト選択を防ぐ
      e.preventDefault();
    });
  }

  function handleResize(e) {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;
    
    const newWidth = Math.max(800, Math.min(1400, startWidth + deltaX));
    const newHeight = Math.max(600, Math.min(1000, startHeight + deltaY));
    
    document.body.style.width = newWidth + 'px';
    document.body.style.height = newHeight + 'px';
    document.documentElement.style.width = newWidth + 'px';
    document.documentElement.style.height = newHeight + 'px';

    // サイズを保存
    chrome.storage.local.set({ 
      popupWidth: newWidth, 
      popupHeight: newHeight 
    });
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
  }

  // 保存されたサイズを復元
  chrome.storage.local.get(['popupWidth', 'popupHeight'], (result) => {
    if (result.popupWidth && result.popupHeight) {
      document.body.style.width = result.popupWidth + 'px';
      document.body.style.height = result.popupHeight + 'px';
      document.documentElement.style.width = result.popupWidth + 'px';
      document.documentElement.style.height = result.popupHeight + 'px';
    }
  });

  // --- デタッチウィンドウ機能 ---
  if (detachBtn) {
    detachBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openDetachedWindow' });
    });
  }

  // --- チャット応答のメッセージリスナー ---
  chrome.runtime.onMessage.addListener((message) => {
    try {
      if (message.action === 'chatResponse') {
        // 「処理中...」メッセージを削除
        if (chatMessages) {
          const loadingMessages = chatMessages.querySelectorAll('.chat-message.assistant');
          const lastMessage = loadingMessages[loadingMessages.length - 1];
          if (lastMessage && (lastMessage.textContent.includes('中...') || lastMessage.textContent.includes('生成中...'))) {
            lastMessage.remove();
          }

          if (message.error) {
            addChatMessage(`エラー: ${message.error}`, 'assistant');
          } else {
            addChatMessage(message.response, 'assistant');
          }
        }
      } else if (message.action === 'chatStatus') {
        // ステータスメッセージを表示
        if (chatMessages) {
          const loadingMessages = chatMessages.querySelectorAll('.chat-message.assistant');
          const lastMessage = loadingMessages[loadingMessages.length - 1];
          if (lastMessage && lastMessage.textContent.includes('中...')) {
            lastMessage.textContent = message.status;
          } else {
            addChatMessage(message.status, 'assistant');
          }
        }
      } else if (message.action === 'showTTSControls') {
        // TTSコントロールを表示
        if (ttsControls) {
          ttsControls.style.display = 'flex';
        }
      }
    } catch (error) {
      console.error('メッセージ処理エラー:', error);
    }
  });
});