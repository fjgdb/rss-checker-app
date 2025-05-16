// /public/main.js（修正版）

const explorer = document.getElementById('explorer');
const explorerContainer = document.getElementById('explorer-container');
const speech = document.getElementById('speech-bubble');
const feed = document.getElementById('feed');
const frames = ['/explorer/1.png', '/explorer/2.png', '/explorer/3.png'];
const swingFrames = [
  '/explorer/swing1.png',
  '/explorer/swing2.png',
  '/explorer/swing3.png',
  '/explorer/swing4.png',
  '/explorer/swing5.png',
];

let frameIndex = 0;
let walkTimer = null;
let moveTimer = null;
let pos = { x: 100, y: 100 };
let target = getRandomPosition();
let isLocked = false;

function getRandomPosition() {
  const padding = 10;
  const width = 80;
  const height = 80;
  return {
    x: Math.random() * (window.innerWidth - width - padding * 2) + padding,
    y: Math.random() * (window.innerHeight - height - padding * 2) + padding,
  };
}

function updateExplorerPosition() {
  if (isLocked) return;
  const speed = 0.5;
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < speed) {
    target = getRandomPosition();
    return;
  }
  pos.x += (dx / dist) * speed;
  pos.y += (dy / dist) * speed;
  explorer.style.transform = dx < 0 ? 'scaleX(-1)' : 'scaleX(1)';
  explorerContainer.style.left = `${pos.x}px`;
  explorerContainer.style.top = `${pos.y}px`;
  updateSpeechBubblePosition();
}

function updateSpeechBubblePosition() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const bubbleRect = speech.getBoundingClientRect();
      const containerRect = explorerContainer.getBoundingClientRect();
      let newLeft = containerRect.width / 2 - bubbleRect.width / 2;

      if (containerRect.left + newLeft < 10) {
        newLeft = 10 - containerRect.left;
      }
      const maxRight = window.innerWidth - 10;
      if (containerRect.left + newLeft + bubbleRect.width > maxRight) {
        newLeft = maxRight - containerRect.left - bubbleRect.width;
      }

      speech.style.left = `${newLeft}px`;
      speech.style.transform = 'none';
    });
  });
}

function setSpeech(message) {
  speech.innerHTML = message;
  updateSpeechBubblePosition();
}

function startWalkAnimation() {
  frameIndex = 0;
  explorer.style.display = 'block';
  walkTimer = setInterval(() => {
    explorer.src = frames[frameIndex];
    frameIndex = (frameIndex + 1) % frames.length;
  }, 200);
  moveTimer = setInterval(updateExplorerPosition, 20);
}

function stopExplorer() {
  clearInterval(walkTimer);
  clearInterval(moveTimer);
  walkTimer = null;
  moveTimer = null;
}

function lockExplorerToButton(state, message, iconPath) {
  const btn = document.getElementById('trackBtn');
  const rect = btn.getBoundingClientRect();
  stopExplorer();
  isLocked = true;
  explorer.style.display = 'block';
  explorer.src = iconPath;
  explorerContainer.style.top = `${rect.bottom + window.scrollY + 10}px`;
  explorerContainer.style.left = `${rect.left + rect.width / 2}px`;
  explorerContainer.style.transform = 'translateX(-50%)';
  setSpeech(message);
}

function checkRSS() {
  stopExplorer();
  isLocked = false;
  explorer.src = frames[0];
  explorer.style.display = 'block';
  frameIndex = 0;
  feed.innerHTML = '';
  setSpeech('🧭 探索を開始...');
  const url = document.getElementById('urlInput').value;
  const evtSource = new EventSource(`/api/generate-rss?url=${encodeURIComponent(url)}`);

  startWalkAnimation();

  evtSource.onmessage = (e) => {
    if (e.data === '[SSE-END]') {
      evtSource.close();
      stopExplorer();
      return;
    }
    try {
      const parsed = JSON.parse(e.data);
      if (parsed.status === 'success') {
        lockExplorerToButton('success', `✅ RSSフィード発見：<br><a href="${parsed.rssUrl}" target="_blank">${parsed.rssUrl}</a>`, '/explorer/success.png');
        evtSource.close();
      }
    } catch {
      setSpeech(e.data);
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    lockExplorerToButton('error', '⚠️ 通信に問題発生。探検を継続できません。', '/explorer/error.png');
  };
}

document.getElementById('trackBtn').addEventListener('click', checkRSS);

setInterval(() => {
  if (!isLocked && Math.random() < 0.1) {
    clearInterval(walkTimer);
    let i = 0;
    const swing = setInterval(() => {
      if (!explorer) return;
      explorer.src = swingFrames[i];
      explorer.style.display = 'block';
      i++;
      if (i >= swingFrames.length) {
        clearInterval(swing);
        startWalkAnimation();
      }
    }, 200);
  }
}, 5000);
