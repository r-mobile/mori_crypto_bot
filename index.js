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
  
  const alertKeyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Обновить цену', callback_data: 'price' },
        { text: '⚙️ Настройки', callback_data: 'settings' }
      ],
      [
        { text: '🔕 Выключить алерты', callback_data: 'alerts_menu' }
      ]
    ]
  };
  
  try {
    await bot.sendMessage(chatId, message, { 
      parse_mode: 'Markdown',
      reply_markup: alertKeyboard
    });
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

// Функция создания основного меню
function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '💰 Цена $MORI', callback_data: 'price' },
        { text: '⚙️ Настройки', callback_data: 'settings' }
      ],
      [
        { text: '🔔 Уведомления', callback_data: 'alerts_menu' },
        { text: '📊 Установить порог', callback_data: 'threshold_menu' }
      ],
      [
        { text: '⚡ Быстрые действия', callback_data: 'quick_actions' }
      ],
      [
        { text: '❓ Помощь', callback_data: 'help' },
        { text: '🔄 Обновить', callback_data: 'refresh' }
      ]
    ]
  };
}

// Функция создания меню уведомлений
function getAlertsMenuKeyboard(alertsEnabled) {
  return {
    inline_keyboard: [
      [
        { text: alertsEnabled ? '🔕 Выключить' : '🔔 Включить', callback_data: 'toggle_alerts' }
      ],
      [
        { text: '◀️ Назад', callback_data: 'back_to_main' }
      ]
    ]
  };
}

// Функция создания меню порогов
function getThresholdMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '1%', callback_data: 'threshold_1' },
        { text: '3%', callback_data: 'threshold_3' },
        { text: '5%', callback_data: 'threshold_5' }
      ],
      [
        { text: '10%', callback_data: 'threshold_10' },
        { text: '15%', callback_data: 'threshold_15' },
        { text: '20%', callback_data: 'threshold_20' }
      ],
      [
        { text: '◀️ Назад', callback_data: 'back_to_main' }
      ]
    ]
  };
}

// Функция создания меню быстрых действий
function getQuickActionsKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔔 Вкл уведомления + 5%', callback_data: 'quick_alerts_5' },
        { text: '🔔 Вкл уведомления + 10%', callback_data: 'quick_alerts_10' }
      ],
      [
        { text: '🔕 Выключить все', callback_data: 'quick_disable_all' },
        { text: '⚡ Супер режим (1%)', callback_data: 'quick_super_mode' }
      ],
      [
        { text: '◀️ Назад', callback_data: 'back_to_main' }
      ]
    ]
  };
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

Используйте кнопки ниже для управления ботом:

🚀 *Начинаем мониторинг!*
  `;
  
  await bot.sendMessage(chatId, welcomeMessage, { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
});

// Обработчик callback запросов (нажатий кнопок)
bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const chatId = msg.chat.id;
  const messageId = msg.message_id;
  const data = callbackQuery.data;
  
  // Подтверждаем получение callback
  await bot.answerCallbackQuery(callbackQuery.id);
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  
  switch(data) {
    case 'price':
      await handlePriceButton(chatId, messageId);
      break;
      
    case 'settings':
      await handleSettingsButton(chatId, messageId, settings);
      break;
      
    case 'alerts_menu':
      await handleAlertsMenuButton(chatId, messageId, settings);
      break;
      
    case 'threshold_menu':
      await handleThresholdMenuButton(chatId, messageId);
      break;
      
    case 'toggle_alerts':
      await handleToggleAlertsButton(chatId, messageId, settings);
      break;
      
    case 'help':
      await handleHelpButton(chatId, messageId);
      break;
      
    case 'refresh':
      await handleRefreshButton(chatId, messageId);
      break;
      
    case 'quick_actions':
      await handleQuickActionsButton(chatId, messageId);
      break;
      
    case 'quick_alerts_5':
      await handleQuickAlertsButton(chatId, messageId, 5);
      break;
      
    case 'quick_alerts_10':
      await handleQuickAlertsButton(chatId, messageId, 10);
      break;
      
    case 'quick_disable_all':
      await handleQuickDisableAllButton(chatId, messageId);
      break;
      
    case 'quick_super_mode':
      await handleQuickSuperModeButton(chatId, messageId);
      break;
      
    case 'back_to_main':
      await handleBackToMainButton(chatId, messageId);
      break;
      
    default:
      // Обработка порогов
      if (data.startsWith('threshold_')) {
        const threshold = parseInt(data.replace('threshold_', ''));
        await handleThresholdButton(chatId, messageId, threshold, settings);
      }
      break;
  }
});

// Функции обработки кнопок
async function handlePriceButton(chatId, messageId) {
  // Показываем индикатор загрузки
  await bot.editMessageText('⏳ Получаю актуальную цену...', {
    chat_id: chatId,
    message_id: messageId
  });
  
  const priceData = await getMoriPrice();
  
  if (priceData) {
    const message = `
💰 *$MORI Цена*

🔸 Текущая цена: $${priceData.price.toFixed(8)}
📊 Изменение за 24ч: ${priceData.change24h.toFixed(2)}%
⏰ Обновлено: ${new Date().toLocaleString('ru-RU')}

${priceData.change24h > 0 ? '🚀 Рост' : '📉 Падение'}
    `;
    
    await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: getMainMenuKeyboard()
    });
  } else {
    await bot.editMessageText('❌ Не удалось получить данные о цене. Попробуйте позже.', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: getMainMenuKeyboard()
    });
  }
}

async function handleSettingsButton(chatId, messageId, settings) {
  const message = `
⚙️ *Настройки уведомлений*

🔔 Уведомления: ${settings.alerts ? 'Включены ✅' : 'Выключены ❌'}
📊 Порог уведомлений: ${settings.priceChangeThreshold}%
⏱️ Интервал проверки: ${settings.checkInterval / 1000} сек

Используйте кнопки для изменения настроек.
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleAlertsMenuButton(chatId, messageId, settings) {
  const message = `
🔔 *Управление уведомлениями*

Текущий статус: ${settings.alerts ? 'Включены ✅' : 'Выключены ❌'}

Нажмите кнопку ниже для изменения:
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getAlertsMenuKeyboard(settings.alerts)
  });
}

async function handleThresholdMenuButton(chatId, messageId) {
  const message = `
📊 *Установка порога уведомлений*

Выберите процент изменения цены, при котором вы хотите получать уведомления:

Чем меньше процент - тем чаще уведомления.
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getThresholdMenuKeyboard()
  });
}

async function handleToggleAlertsButton(chatId, messageId, settings) {
  settings.alerts = !settings.alerts;
  users.set(chatId, settings);
  
  const message = settings.alerts 
    ? '🔔 Уведомления включены!' 
    : '🔕 Уведомления выключены!';
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: getAlertsMenuKeyboard(settings.alerts)
  });
}

async function handleThresholdButton(chatId, messageId, threshold, settings) {
  settings.priceChangeThreshold = threshold;
  users.set(chatId, settings);
  
  const message = `✅ Порог уведомлений установлен: ${threshold}%
  
Теперь вы будете получать уведомления при изменении цены $MORI на ${threshold}% или более.`;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleHelpButton(chatId, messageId) {
  const helpMessage = `
🆘 *Помощь по $MORI Bot*

🤖 *Что умеет бот:*
• Отслеживает цену $MORI в реальном времени
• Отправляет уведомления при изменении цены
• Позволяет настраивать пороги уведомлений
• Показывает текущую цену и изменения за 24ч

🔧 *Как использовать:*
1. Нажмите "💰 Цена $MORI" для получения актуальной цены
2. Используйте "⚙️ Настройки" для просмотра текущих параметров
3. В "🔔 Уведомления" включите/выключите алерты
4. В "📊 Установить порог" выберите процент для уведомлений

💡 *Рекомендации:*
• Для мемкоинов оптимальный порог 5-10%
• Слишком низкий порог = много уведомлений
• Слишком высокий порог = можете пропустить движение

🤖 Бот автоматически проверяет цену каждую минуту
  `;
  
  await bot.editMessageText(helpMessage, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleRefreshButton(chatId, messageId) {
  const message = `
🔄 *Меню обновлено*

Выберите действие:
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleBackToMainButton(chatId, messageId) {
  const message = `
🤖 *$MORI Bot - Главное меню*

Выберите действие:
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

// Функции для быстрых действий
async function handleQuickActionsButton(chatId, messageId) {
  const message = `
⚡ *Быстрые действия*

Выберите готовую настройку:

🔔 *Включить уведомления + порог* - быстрая настройка
🔕 *Выключить все* - отключить все уведомления
⚡ *Супер режим* - максимальная чувствительность (1%)
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getQuickActionsKeyboard()
  });
}

async function handleQuickAlertsButton(chatId, messageId, threshold) {
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.alerts = true;
  settings.priceChangeThreshold = threshold;
  users.set(chatId, settings);
  
  const message = `
✅ *Быстрая настройка применена!*

🔔 Уведомления: Включены
📊 Порог: ${threshold}%

Теперь вы будете получать уведомления при изменении цены $MORI на ${threshold}% или более.
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleQuickDisableAllButton(chatId, messageId) {
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.alerts = false;
  users.set(chatId, settings);
  
  const message = `
🔕 *Все уведомления выключены*

Вы больше не будете получать уведомления о изменении цены $MORI.

Для включения используйте кнопку "🔔 Уведомления" в главном меню.
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

async function handleQuickSuperModeButton(chatId, messageId) {
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.alerts = true;
  settings.priceChangeThreshold = 1;
  users.set(chatId, settings);
  
  const message = `
⚡ *Супер режим активирован!*

🔔 Уведомления: Включены
📊 Порог: 1% (максимальная чувствительность)

⚠️ *Внимание:* В этом режиме вы будете получать много уведомлений, так как мемкоины очень волатильны.

Рекомендуется для активных трейдеров.
  `;
  
  await bot.editMessageText(message, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard()
  });
}

// Команды для совместимости (короткие версии)
bot.onText(/\/price/, async (msg) => {
  const chatId = msg.chat.id;
  const priceData = await getMoriPrice();
  
  if (priceData) {
    const message = `💰 $${priceData.price.toFixed(8)} (${priceData.change24h.toFixed(2)}%)`;
    await bot.sendMessage(chatId, message, { reply_markup: getMainMenuKeyboard() });
  } else {
    await bot.sendMessage(chatId, '❌ Ошибка получения цены', { reply_markup: getMainMenuKeyboard() });
  }
});

bot.onText(/\/menu/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '🤖 *Главное меню*', { 
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard() 
  });
});

// Старые команды для совместимости
bot.onText(/\/settings/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '⚙️ Используйте кнопки для настройки:', { 
    reply_markup: getMainMenuKeyboard() 
  });
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
  
  await bot.sendMessage(chatId, message, { reply_markup: getMainMenuKeyboard() });
});

bot.onText(/\/threshold (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const threshold = parseInt(match[1]);
  
  if (threshold < 1 || threshold > 100) {
    await bot.sendMessage(chatId, '❌ Порог должен быть от 1 до 100%', { 
      reply_markup: getMainMenuKeyboard() 
    });
    return;
  }
  
  if (!users.has(chatId)) {
    users.set(chatId, { ...DEFAULT_SETTINGS });
  }
  
  const settings = users.get(chatId);
  settings.priceChangeThreshold = threshold;
  users.set(chatId, settings);
  
  await bot.sendMessage(chatId, `✅ Порог установлен: ${threshold}%`, { 
    reply_markup: getMainMenuKeyboard() 
  });
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, '❓ Используйте кнопки для управления ботом:', { 
    reply_markup: getMainMenuKeyboard() 
  });
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