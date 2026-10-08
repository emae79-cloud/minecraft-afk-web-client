const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Bot Ayarları - Bağlanmak istediğin sunucunun IP'sini yaz
const bot = mineflayer.createBot({
  host: 'play.mc4fun.net', // Buraya girmek istediğin MC sunucu IP'sini yaz
  username: 'nusretyasir',    // Botun oyundaki adı
  version: false          // Sunucu sürümünü otomatik algılar
});

// Oyundan gelen sohbeti web arayüzüne ilet
bot.on('chat', (username, message) => {
  io.emit('chatMessage', { user: username, text: message });
});

bot.on('kicked', (reason) => console.log('Bot sunucudan atıldı:', reason));
bot.on('error', (err) => console.log('Hata oluştu:', err));

// Web panelinden yazılan mesajı oyuna gönder
io.on('connection', (socket) => {
  socket.on('sendChat', (msg) => {
    bot.chat(msg);
  });
});

server.listen(3000, () => {
  console.log('Web paneli hazır! Adres: http://localhost:3000');
});