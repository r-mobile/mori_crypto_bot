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
  priceAlerts: {
    max: null, // максимальная цена для уведомления
    min: null, // минимальная цена для уведомления
    maxTriggered: false, // флаг срабатывания max alert
    minTriggered: false  // флаг срабатывания min alert
  }
};

// Функция получения цены $MORI
async function getMoriPrice() {
  try {
    // Используем CoinGecko API для получения цены
    // Замените 'mori' на правильный ID токена в CoinGecko
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=mori-coin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true'
    );
    
    if (response.data && response.data["mori-coin"]) {
      const mc = response.data["mori-coin"];
      return {
        price: mc.usd,
        change24h: mc.usd_24h_change || 0,
        capital: parseInt(mc.usd_market_cap) || 0
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
        change24h: parseFloat(pair.priceChange.h24) || 0,
        capital: parseInt(pair.marketCap) || 0
      };
    }
    
    throw new Error('No price data found');
  } catch (error) {
    console.error('Error fetching MORI price:', error.message);
    return null;
  }
}

// Функция отправки ценового алерта
async function sendPriceTargetAlert(chatId, priceData, alertType, targetPrice) {
  const emoji = alertType === 'max' ? '🚀' : '⚠️';
  const direction = alertType === 'max' ? 'выше' : 'ниже';
  const title = alertType === 'max' ? 'ЦЕНА ПРОБИЛА МАКСИМУМ!' : 'ЦЕНА УПАЛА НИЖЕ МИНИМУМА!';
  
  const message = `
${emoji} ${title}

🎯 Целевая цена: $${targetPrice}
💰 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
🐳 Капитализация: $${priceData.capital}

⚡ Цена стала ${direction} установленного уровня!
`;
  
  try {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error sending price target alert:', error);
  }
}

// Функция отправки уведомления о цене
async function sendPriceAlert(chatId, priceData, changePercent) {
  const emoji = changePercent > 0 ? '🚀' : '⚠️';
  const changeText = changePercent > 0 ? 'выросла' : 'упала';
  
  const message = `
${emoji} *Сигнал!*

💰 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
🐳 Капитализация: $${priceData.capital}
⚡ Изменение: ${changeText} на ${Math.abs(changePercent).toFixed(2)}%
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
  
  // Проверяем ценовые алерты для всех пользователей
  for (const [chatId, settings] of users.entries()) {
    if (!settings.alerts) continue;
    
    // Проверяем изменение цены в процентах
    if (lastPrice) {
      const changePercent = ((currentPrice - lastPrice) / lastPrice) * 100;
      
      if (Math.abs(changePercent) >= settings.priceChangeThreshold) {
        await sendPriceAlert(chatId, priceData, changePercent);
      }
    }
    
    // Проверяем ценовые цели
    const priceAlerts = settings.priceAlerts;
    
    // Проверяем максимальную цену
    if (priceAlerts.max && !priceAlerts.maxTriggered && currentPrice >= priceAlerts.max) {
      await sendPriceTargetAlert(chatId, priceData, 'max', priceAlerts.max);
      priceAlerts.maxTriggered = true;
    }
    
    // Проверяем минимальную цену
    if (priceAlerts.min && !priceAlerts.minTriggered && currentPrice <= priceAlerts.min) {
      await sendPriceTargetAlert(chatId, priceData, 'min', priceAlerts.min);
      priceAlerts.minTriggered = true;
    }
    
    // Сбрасываем флаги если цена вернулась в нормальный диапазон
    if (priceAlerts.max && priceAlerts.maxTriggered && currentPrice < priceAlerts.max * 0.95) {
      priceAlerts.maxTriggered = false;
    }
    
    if (priceAlerts.min && priceAlerts.minTriggered && currentPrice > priceAlerts.min * 1.05) {
      priceAlerts.minTriggered = false;
    }
    
    // Обновляем настройки пользователя
    users.set(chatId, settings);
  }
  
  priceHistory.set('lastPrice', currentPrice);
  priceHistory.set('lastUpdate', Date.now());
}

// Функция установки команд меню
async function setMenuCommands() {
  const commands = [
    { command: 'price', description: '💰 Текущая цена' },
    { command: 'targets', description: '🎯 Целевые значения' },
    { command: 'settings', description: '⚙️ Настройки уведомлений' },
    { command: 'alerts', description: '🔔 Управление уведомлениями' },
    { command: 'help', description: '❓ Помощь' }
  ];
  
  try {
    await bot.setMyCommands(commands);
    console.log('Menu commands set successfully');
  } catch (error) {
    console.error('Error setting menu commands:', error);
  }
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

📋 *Основные команды:*
• /price - Текущая цена $MORI
• /settings - Настройки уведомлений
• /targets - Ваши ценовые цели
• /alerts - Управление уведомлениями
• /help - Подробная помощь
`;
  
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(chatId, '⏳ Получаю актуальную цену...');
  
  const priceData = await getMoriPrice();
  
  if (priceData) {
    const message = `
💰 *$Цена*

🔸 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
🐳 Капитализация: $${priceData.capital}
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
  const priceAlerts = settings.priceAlerts || { max: null, min: null };
  
  const message = `
⚙️ *Настройки уведомлений*

🔔 Уведомления: ${settings.alerts ? 'Включены ✅' : 'Выключены ❌'}
📊 Порог уведомлений: ${settings.priceChangeThreshold}%
⏱️ Интервал проверки: ${settings.checkInterval / 1000} сек

🎯 *Ценовые цели:*
📈 Максимум: ${priceAlerts.max ? `$${priceAlerts.max}` : 'Не установлен'}
📉 Минимум: ${priceAlerts.min ? `$${priceAlerts.min}` : 'Не установлен'}

*Команды для изменения:*
• /alerts on/off - включить/выключить уведомления
• /threshold [число] - изменить порог (например: /threshold 10)
• /pmax [цена] - установить максимум (например: /pmax 0.1745)
• /pmin [цена] - установить минимум (например: /pmin 0.15)
• /targets - подробный просмотр целей
  `;
  
  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/alerts$/, async (msg) => {
  const chatId = msg.chat.id;
  const settings = users.get(chatId) || { ...DEFAULT_SETTINGS };
  
  const message = `
🔔 *Управление уведомлениями*

Текущий статус: ${settings.alerts ? 'Включены ✅' : 'Выключены ❌'}

*Команды:*
• /alerts on - включить уведомления
• /alerts off - выключить уведомления
• /threshold [число] - установить порог изменения (1-100%)

*Примеры:*
• /alerts on
• /threshold 5 - уведомления при изменении на 5%
• /threshold 15 - уведомления при изменении на 15%

💡 Когда уведомления включены, вы получите сигнал при изменении цены на установленный процент.
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
    ? '🔔 Уведомления включены! Вы будете получать сигналы при изменении цены.' 
    : '🔕 Уведомления выключены. Используйте /alerts on для включения.';
  
  await bot.sendMessage(chatId, message);
});

bot.onText(/\/threshold (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const threshold = parseInt(match[1]);
  
  if (threshold < 1 || threshold > 100) {
    await bot.sendMessage(chatId, '❌ Порог должен быть от 1 до 100%\n\nПример: /threshold 5');
    return;
  }
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.priceChangeThreshold = threshold;
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, `✅ Порог уведомлений установлен: ${threshold}%\n\nТеперь вы получите уведомление при изменении цены на ${threshold}% или больше.`);
});

// Команда установки максимальной цены
bot.onText(/\/pmax ([0-9]*\.?[0-9]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const maxPrice = parseFloat(match[1]);
  
  if (isNaN(maxPrice) || maxPrice <= 0) {
    await bot.sendMessage(chatId, '❌ Неверный формат цены.\n\nПример: /pmax 0.1745');
    return;
  }
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  if (!settings.priceAlerts) {
    settings.priceAlerts = { max: null, min: null, maxTriggered: false, minTriggered: false };
  }
  
  settings.priceAlerts.max = maxPrice;
  settings.priceAlerts.maxTriggered = false; // Сбрасываем флаг
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, `🎯 Максимальная цена установлена: $${maxPrice}

💡 Вы получите уведомление, когда цена $MORI поднимется выше этого уровня.`);
});

// Команда установки минимальной цены
bot.onText(/\/pmin ([0-9]*\.?[0-9]+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const minPrice = parseFloat(match[1]);
  
  if (isNaN(minPrice) || minPrice <= 0) {
    await bot.sendMessage(chatId, '❌ Неверный формат цены.\n\nПример: /pmin 0.15');
    return;
  }
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  if (!settings.priceAlerts) {
    settings.priceAlerts = { max: null, min: null, maxTriggered: false, minTriggered: false };
  }
  
  settings.priceAlerts.min = minPrice;
  settings.priceAlerts.minTriggered = false; // Сбрасываем флаг
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, `🎯 Минимальная цена установлена: $${minPrice}

💡 Вы получите уведомление, когда цена $MORI упадет ниже этого уровня.`);
});

// Команда просмотра ценовых целей
bot.onText(/\/targets/, async (msg) => {
  const chatId = msg.chat.id;
  const settings = users.get(chatId) || { ...DEFAULT_SETTINGS };
  const priceAlerts = settings.priceAlerts || { max: null, min: null };
  
  // Получаем текущую цену для сравнения
  const priceData = await getMoriPrice();
  const currentPriceText = priceData ? `$${priceData.price.toFixed(8)}` : 'Недоступна';
  
  let targetsText = '🎯 *Целевые значения*\n\n';
  targetsText += `💰 Текущая цена: ${currentPriceText}\n\n`;
  
  if (priceAlerts.max) {
    const distance = priceData ? ((priceAlerts.max - priceData.price) / priceData.price * 100).toFixed(2) : '—';
    targetsText += `📈 Максимум: $${priceAlerts.max}\n`;
    targetsText += `   ${distance !== '—' ? (distance > 0 ? `↗️ До цели: +${distance}%` : `✅ Цель достигнута`) : ''}\n\n`;
  } else {
    targetsText += '📈 Максимум: Не установлен\n\n';
  }
  
  if (priceAlerts.min) {
    const distance = priceData ? ((priceAlerts.min - priceData.price) / priceData.price * 100).toFixed(2) : '—';
    targetsText += `📉 Минимум: $${priceAlerts.min}\n`;
    targetsText += `   ${distance !== '—' ? (distance < 0 ? `↘️ До цели: ${distance}%` : `✅ Цель достигнута`) : ''}\n\n`;
  } else {
    targetsText += '📉 Минимум: Не установлен\n\n';
  }
  
  targetsText += '*Команды управления:*\n';
  targetsText += '• /pmax [цена] - установить максимум\n';
  targetsText += '• /pmin [цена] - установить минимум\n'; 
  
  await bot.sendMessage(chatId, targetsText, { parse_mode: 'Markdown' });
});

// Команды для отключения ценовых целей
bot.onText(/\/pmax -1/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  if (!settings.priceAlerts) {
    settings.priceAlerts = { max: null, min: null, maxTriggered: false, minTriggered: false };
  }
  
  settings.priceAlerts.max = null;
  settings.priceAlerts.maxTriggered = false;
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, '🚫 Максимальная цена отключена\n\nИспользуйте /targets для просмотра оставшихся целей.');
});

bot.onText(/\/pmin- 1/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  if (!settings.priceAlerts) {
    settings.priceAlerts = { max: null, min: null, maxTriggered: false, minTriggered: false };
  }
  
  settings.priceAlerts.min = null;
  settings.priceAlerts.minTriggered = false;
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, '🚫 Минимальная цена отключена\n\nИспользуйте /targets для просмотра оставшихся целей.');
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
🆘 *Помощь по $MORI Bot*

📋 *Основные команды:*
• /start - запуск бота
• /price - текущая цена $MORI
• /settings - просмотр всех настроек
• /targets - ваши ценовые цели
• /alerts - управление уведомлениями
• /help - эта справка

🔔 *Управление уведомлениями:*
• /alerts on - включить уведомления
• /alerts off - выключить уведомления

🎯 *Ценовые цели:*
• /threshold [число] - порог уведомлений (1-100%)
• /pmax [цена] - уведомление когда цена выше (-1 откл)
• /pmin [цена] - уведомление когда цена ниже (-1 откл)
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
  
  // Установка команд меню
  setMenuCommands();
  
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