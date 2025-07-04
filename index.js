const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// Конфигурация
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// Создаем Express приложение для webhook
const app = express();
app.use(express.json());

// Создаем бота
const bot = new TelegramBot(BOT_TOKEN);

// Хранилище пользователей и их настроек
const users = new Map();
const priceHistory = new Map();

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  alerts: true,
  priceChangeThreshold: 5, // процент изменения для уведомления
  checkInterval: 60000, // интервал проверки в миллисекундах (1 минута)
};

// Функция получения цены $MORI
async function getMoriPrice() {
  try {
    // Используем CoinGecko API для получения цены
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=mori-coin&vs_currencies=usd&include_24hr_change=true'
    );
    
    if (response.data && response.data.mori) {
      return {
        price: response.data.mori.usd,
        change24h: response.data.mori.usd_24h_change || 0
      };
    }
    
    // Альтернативно можно использовать DEXScreener API
    const dexResponse = await axios.get(
      'https://api.dexscreener.com/latest/dex/search/?q=MORI'
    );
    
    if (dexResponse.data && dexResponse.data.pairs && dexResponse.data.pairs.length > 0) {
      const pair = dexResponse.data.pairs[0];
      return {
        price: parseFloat(pair.priceUsd),
        change24h: parseFloat(pair.priceChange.h24) || 0
      };
    }
    
    throw new Error('No price data found');
  } catch (error) {
    console.error('Error fetching MORI price:', error.message);
    return null;
  }
}

// Функция отправки уведомления о цене
async function sendPriceAlert(chatId, priceData, changePercent) {
  const emoji = changePercent > 0 ? '🚀' : '📉';
  const changeText = changePercent > 0 ? 'выросла' : 'упала';
  
  const message = `
${emoji} *$MORI Сигнал!*

💰 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
⚡ Изменение: ${changeText} на ${Math.abs(changePercent).toFixed(2)}%

#MORI #memecoin #crypto
  `;
  
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Функция мониторинга цены
async function monitorPrice() {
  const priceData = await getMoriPrice();
  
  if (!priceData) {
    return;
  }
  
  const currentPrice = priceData.price;
  const lastPrice = priceHistory.get('lastPrice');
  
  if (lastPrice) {
    const changePercent = ((currentPrice - lastPrice) / lastPrice) * 100;
    
    // Отправляем уведомления пользователям
    for (const [chatId, settings] of users.entries()) {
      if (settings.alerts && Math.abs(changePercent) >= settings.priceChangeThreshold) {
        await sendPriceAlert(chatId, priceData, changePercent);
      }
    }
  }
  
  priceHistory.set('lastPrice', currentPrice);
  priceHistory.set('lastUpdate', Date.now());
}

// Команды бота
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const welcomeMessage = `
🤖 *Добро пожаловать в $MORI Bot!*

Я буду отслеживать цену мемкоина $MORI и отправлять вам сигналы при значительных изменениях.

📋 *Доступные команды:*
/price - Текущая цена $MORI
/settings - Настройки уведомлений
/alerts on/off - Включить/выключить уведомления
/threshold [число] - Установить порог уведомлений (%)
/help - Помощь

🚀 Начинаем мониторинг!
  `;
  
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(chatId, '⏳ Получаю актуальную цену...');
  
  const priceData = await getMoriPrice();
  
  if (priceData) {
    const message = `
💰 *$MORI Цена*

🔸 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
⏰ Обновлено: ${new Date().toLocaleString('ru-RU')}

${priceData.change24h > 0 ? '🚀' : '📉'} ${priceData.change24h > 0 ? 'Рост' : 'Падение'}
    `;
    
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } else {
    await bot.sendMessage(chatId, '❌ Не удалось получить данные о цене. Попробуйте позже.');
  }
});

bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  const settings = users.get(chatId) || { ...DEFAULT_SETTINGS };
  
  const message = `
⚙️ *Настройки уведомлений*

🔔 Уведомления: ${settings.alerts ? 'Включены ✅' : 'Выключены ❌'}
📊 Порог уведомлений: ${settings.priceChangeThreshold}%
⏱️ Интервал проверки: ${settings.checkInterval / 1000} сек

*Команды для изменения:*
/alerts on - Включить уведомления
/alerts off - Выключить уведомления
/threshold [число] - Изменить порог (например: /threshold 10)
  `;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/alerts (on|off)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const action = match[1];
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.alerts = action === 'on';
  users.set(chatId, settings);
  
  const message = action === 'on' 
    ? '🔔 Уведомления включены!' 
    : '🔕 Уведомления выключены!';
  
  await bot.sendMessage(chatId, message);
});

bot.onText(/\/threshold (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const threshold = parseInt(match[1]);
  
  if (threshold < 1 || threshold > 100) {
    await bot.sendMessage(chatId, '❌ Порог должен быть от 1 до 100%');
    return;
  }
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.priceChangeThreshold = threshold;
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, `✅ Порог уведомлений установлен: ${threshold}%`);
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
🆘 *Помощь по $MORI Bot*

📋 *Команды:*
/start - Запуск бота
/price - Текущая цена $MORI
/settings - Просмотр настроек
/alerts on/off - Управление уведомлениями
/threshold [число] - Порог уведомлений (1-100%)
/help - Эта справка

🔧 *Как настроить:*
1. Используйте /threshold [число] для установки порога
2. Включите уведомления: /alerts on
3. Бот будет отправлять сигналы при изменении цены

💡 *Примеры:*
\`/threshold 5\` - уведомления при изменении на 5%
\`/alerts off\` - отключить все уведомления

🤖 Бот автоматически проверяет цену каждую минуту
  `;
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Webhook endpoint для Telegram
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Health check endpoint
app.get('/', (req, res) => {
  res.send('$MORI Telegram Bot is running! 🚀');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    users: users.size,
    lastPriceUpdate: priceHistory.get('lastUpdate')
  });
});

// Запуск мониторинга цены
setInterval(monitorPrice, 60000); // каждую минуту

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // Установка webhook (для production)
  if (process.env.NODE_ENV === 'production') {
    const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
    bot.setWebHook(webhookUrl);
    console.log(`Webhook set to: ${webhookUrl}`);
  }
  
  // Первая проверка цены
  monitorPrice();
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});
