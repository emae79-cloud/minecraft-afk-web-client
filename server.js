const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));

// Maksimum 5 Bot Yapısı
const MAX_BOTS = 5;
const bots = {}; // botId: { instance, options, reconnectTimeout, manualStop }

for (let i = 1; i <= MAX_BOTS; i++) {
  bots[i] = {
    instance: null,
    options: {
      host: 'play.mc4fun.net',
      port: 25565,
      username: `bot_${i}`,
      password: '',
      autoSkyblock: false,
      autoReconnect: true,
      cmdDelay: 3000
    },
    reconnectTimeout: null,
    manualStop: false
  };
}

function cleanupBot(botId) {
  const b = bots[botId];
  if (b && b.instance) {
    try {
      b.instance.removeAllListeners();
      b.instance.end();
    } catch (e) {}
    b.instance = null;
  }
}

function sendStats(botId) {
  const b = bots[botId];
  if (b && b.instance && b.instance.entity) {
    const stats = {
      botId: botId,
      health: b.instance.health || 0,
      food: b.instance.food || 0,
      pos: {
        x: Math.round(b.instance.position.x),
        y: Math.round(b.instance.position.y),
        z: Math.round(b.instance.position.z)
      }
    };
    io.emit('statsUpdate', stats);
  }
}

function sendInventory(botId) {
  const b = bots[botId];
  if (!b || !b.instance || !b.instance.inventory) return;
  const items = b.instance.inventory.items().map(item => ({
    slot: item.slot,
    name: item.name,
    count: item.count,
    displayName: item.displayName
  }));
  io.emit('inventoryUpdate', { botId, items });
}

function sendWindowData(botId, window) {
  if (!window) return;
  const slots = window.slots.map((item, index) => {
    if (!item) return { slot: index, empty: true };
    
    let lore = [];
    try {
      if (item.nbt && item.nbt.value && item.nbt.value.display && item.nbt.value.display.value.Lore) {
        lore = item.nbt.value.display.value.Lore.value.value;
      }
    } catch (e) {}

    return {
      slot: index,
      name: item.name,
      count: item.count,
      displayName: item.displayName || item.name,
      lore: lore
    };
  });

  let titleText = 'Menü / Sandık';
  try {
    if (window.title) {
      const parsed = typeof window.title === 'string' ? JSON.parse(window.title) : window.title;
      titleText = parsed.text || parsed.translate || 'Menü';
    }
  } catch (e) {
    titleText = 'Menü';
  }

  io.emit('openWindow', {
    botId: botId,
    title: titleText,
    slots: slots
  });
}

function createBot(botId) {
  cleanupBot(botId);
  const b = bots[botId];
  b.manualStop = false;

  io.emit('status', { botId, status: 'connecting' });
  io.emit('chat', { botId, msg: `[SİSTEM] ${b.options.username} adıyla sunucuya bağlanılıyor...` });

  b.instance = mineflayer.createBot({
    host: b.options.host,
    port: b.options.port,
    username: b.options.username,
    version: false
  });

  const botObj = b.instance;

  botObj.on('health', () => sendStats(botId));
  botObj.on('move', () => sendStats(botId));

  botObj.on('spawn', () => {
    io.emit('status', { botId, status: 'online' });
    io.emit('chat', { botId, msg: `[SİSTEM] Bot (${b.options.username}) başarıyla bağlandı!` });
    sendStats(botId);
    sendInventory(botId);

    if (b.options.autoSkyblock) {
      setTimeout(() => {
        if (b.instance) {
          b.instance.chat('/skyblock');
          io.emit('chat', { botId, msg: '[SİZ]: /skyblock' });
        }
      }, b.options.cmdDelay || 3000);
    }
  });

  botObj.on('windowOpen', (window) => {
    sendWindowData(botId, window);
    window.on('updateSlot', () => sendWindowData(botId, window));
    window.on('close', () => io.emit('closeWindow', { botId }));
  });

  botObj.on('chat', (username, message) => {
    io.emit('chat', { botId, msg: `${username}: ${message}` });
  });

  botObj.on('messagestr', (message) => {
    if (message.trim()) {
      io.emit('chat', { botId, msg: message });
    }
  });

  botObj.on('kicked', (reason) => {
    const reasonText = typeof reason === 'object' ? JSON.stringify(reason) : reason;
    io.emit('status', { botId, status: 'offline' });
    io.emit('chat', { botId, msg: `[SİSTEM] Sunucudan atıldı: ${reasonText}` });
    cleanupBot(botId);
    handleReconnect(botId);
  });

  botObj.on('error', (err) => {
    io.emit('status', { botId, status: 'offline' });
    io.emit('chat', { botId, msg: `[SİSTEM] Hata: ${err.message}` });
    cleanupBot(botId);
    handleReconnect(botId);
  });

  botObj.on('end', () => {
    io.emit('status', { botId, status: 'offline' });
    io.emit('chat', { botId, msg: '[SİSTEM] Sunucu bağlantısı koptu.' });
    cleanupBot(botId);
    handleReconnect(botId);
  });
}

function handleReconnect(botId) {
  const b = bots[botId];
  // Eğer kullanıcı web'den "Durdur" butonuna basmadıysa tekrar bağlanır
  if (b.options.autoReconnect && !b.manualStop) {
    if (b.reconnectTimeout) clearTimeout(b.reconnectTimeout);
    io.emit('chat', { botId, msg: '[SİSTEM] 10 saniye içinde otomatik tekrar bağlanılacak...' });
    b.reconnectTimeout = setTimeout(() => {
      createBot(botId);
    }, 10000);
  }
}

io.on('connection', (socket) => {
  // Tüm botların durumlarını gönder
  for (let i = 1; i <= MAX_BOTS; i++) {
    const b = bots[i];
    socket.emit('status', { 
      botId: i, 
      status: (b.instance && b.instance.entity) ? 'online' : 'offline' 
    });
    sendStats(i);
  }

  socket.on('startBot', (data) => {
    const botId = data.botId || 1;
    const b = bots[botId];

    b.options.host = data.host || 'play.mc4fun.net';
    b.options.port = parseInt(data.port) || 25565;
    b.options.username = data.username && data.username.trim() !== '' ? data.username.trim() : `bot_${botId}`;
    b.options.password = data.password || '';
    b.options.autoSkyblock = data.autoSkyblock !== undefined ? data.autoSkyblock : false;
    b.options.autoReconnect = data.autoReconnect !== undefined ? data.autoReconnect : true;
    b.options.cmdDelay = parseInt(data.cmdDelay) || 3000;
    
    if (b.reconnectTimeout) clearTimeout(b.reconnectTimeout);
    createBot(botId);
  });

  // Oyundan Manuel Çıkarma / Bağlantı Kesme
  socket.on('stopBot', (botId) => {
    const b = bots[botId];
    if (b) {
      b.manualStop = true; // Otomatik tekrar bağlanmayı engelle
      if (b.reconnectTimeout) clearTimeout(b.reconnectTimeout);
      cleanupBot(botId);
      io.emit('status', { botId, status: 'offline' });
      io.emit('chat', { botId, msg: '[SİSTEM] Bağlantı web üzerinden manuel olarak kesildi. Oyuna rahatça girebilirsiniz.' });
    }
  });

  socket.on('reconnectBot', (botId) => {
    const b = bots[botId];
    if (b && b.reconnectTimeout) clearTimeout(b.reconnectTimeout);
    createBot(botId);
  });

  socket.on('sendLogin', (data) => {
    const { botId, password } = data;
    const b = bots[botId];
    const passToSend = password || (b ? b.options.password : '');
    if (b && b.instance) {
      if (passToSend && passToSend.trim() !== '') {
        b.instance.chat(`/login ${passToSend}`);
        io.emit('chat', { botId, msg: '[SİZ]: /login ********' });
      } else {
        io.emit('chat', { botId, msg: '[SİSTEM] Şifre alanı boş!' });
      }
    } else {
      io.emit('chat', { botId, msg: '[SİSTEM] Bot oyunda değil!' });
    }
  });

  socket.on('sendCmd', (data) => {
    const { botId, cmd } = data;
    const b = bots[botId];
    if (b && b.instance) {
      b.instance.chat(cmd);
      io.emit('chat', { botId, msg: `[SİZ]: ${cmd}` });
    }
  });

  socket.on('sendMessage', (data) => {
    const { botId, msg } = data;
    const b = bots[botId];
    if (b && b.instance) {
      b.instance.chat(msg);
      io.emit('chat', { botId, msg: `[SİZ]: ${msg}` });
    }
  });

  socket.on('clickSlot', (data) => {
    const { botId, slotIndex } = data;
    const b = bots[botId];
    if (b && b.instance && b.instance.currentWindow) {
      try {
        b.instance.clickWindow(slotIndex, 0, 0);
      } catch (e) {}
    }
  });

  socket.on('closeCurrentWindow', (botId) => {
    const b = bots[botId];
    if (b && b.instance && b.instance.currentWindow) {
      try {
        b.instance.closeWindow(b.instance.currentWindow);
      } catch (e) {}
    }
  });
});

// Render Uyanık Tutma (Self-Ping)
setInterval(() => {
  if (process.env.RENDER_EXTERNAL_URL) {
    http.get(process.env.RENDER_EXTERNAL_URL, () => {}).on('error', () => {});
  }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor`);
});