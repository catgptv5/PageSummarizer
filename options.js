// DOM要素を取得
const openaiKeyInput = document.getElementById('openai-key');
const aivisKeyInput = document.getElementById('aivis-key');
const slackUrlInput = document.getElementById('slack-url');
const slackAutoInput = document.getElementById('slack-auto');
const autoTtsChatInput = document.getElementById('auto-tts-chat');
const openaiModelInput = document.getElementById('openai-model');
const aivisModelInput = document.getElementById('aivis-model');
const saveBtn = document.getElementById('save-btn');
const statusDiv = document.getElementById('status');

// 保存ボタンがクリックされたときの処理
saveBtn.addEventListener('click', () => {
  const settings = {
    openai_api_key: openaiKeyInput.value,
    aivis_api_key: aivisKeyInput.value,
    slack_webhook_url: slackUrlInput.value,
    slack_auto_send: !!slackAutoInput.checked,
    auto_tts_chat: !!autoTtsChatInput.checked,
    openai_model: openaiModelInput.value,
    aivis_model_uuid: aivisModelInput.value
  };

  chrome.storage.local.set(settings, () => {
    // 保存が完了したらステータスメッセージを表示
    statusDiv.textContent = '設定を保存しました。';
    // 1.5秒後にメッセージを消す
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 1500);
  });
});

// ページが読み込まれたときに、保存されている設定値を読み込む
document.addEventListener('DOMContentLoaded', () => {
  const keysToGet = [
    'openai_api_key',
    'aivis_api_key',
    'slack_webhook_url',
    'slack_auto_send',
    'auto_tts_chat',
    'openai_model',
    'aivis_model_uuid'
  ];
  chrome.storage.local.get(keysToGet, (result) => {
    if (result.openai_api_key) {
      openaiKeyInput.value = result.openai_api_key;
    }
    if (result.aivis_api_key) {
      aivisKeyInput.value = result.aivis_api_key;
    }
    if (result.slack_webhook_url) {
      slackUrlInput.value = result.slack_webhook_url;
    }
    if (typeof result.slack_auto_send !== 'undefined') {
      slackAutoInput.checked = !!result.slack_auto_send;
    } else {
      slackAutoInput.checked = false; // デフォルトはOFF
    }
    if (typeof result.auto_tts_chat !== 'undefined') {
      autoTtsChatInput.checked = !!result.auto_tts_chat;
    } else {
      autoTtsChatInput.checked = true; // デフォルトはON
    }
    if (result.openai_model) {
      openaiModelInput.value = result.openai_model;
    } else {
      // デフォルトモデル
      openaiModelInput.value = 'gpt-5-mini-2025-08-07';
    }
    if (result.aivis_model_uuid) {
      aivisModelInput.value = result.aivis_model_uuid;
    }
  });
});
