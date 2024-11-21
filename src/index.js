import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { handleYoutubeUrl } from './services/messageHandler.js';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is required in .env file');
    process.exit(1);
}

// Create a bot instance with long polling
const bot = new TelegramBot(token, {
    polling: {
        interval: 300, // How often to poll in ms (default is 300)
        autoStart: true, // Start polling automatically
        params: {
            timeout: 10 // Long-polling timeout in seconds
        }
    }
});

console.log('Bot is running with long polling...');

// Handle polling errors
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Handle connection errors
bot.on('error', (error) => {
    console.error('Bot error:', error);
    // Try to restart polling after a delay
    setTimeout(() => {
        bot.stopPolling().then(() => {
            console.log('Restarting polling...');
            bot.startPolling();
        });
    }, 5000);
});

// Handle incoming messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) {
        bot.sendMessage(chatId, 'Please send a YouTube URL');
        return;
    }

    if (text === '/start') {
        bot.sendMessage(chatId, 'Welcome! Send me a YouTube video URL and I will generate a PDF transcript for you.');
        return;
    }

    if (text.includes('youtube.com') || text.includes('youtu.be')) {
        try {
            await handleYoutubeUrl(bot, chatId, text);
        } catch (error) {
            console.error('Error handling YouTube URL:', error);
            bot.sendMessage(chatId, 'Sorry, there was an error processing your request. Please try again later.');
        }
        return;
    }

    bot.sendMessage(chatId, 'Please send a valid YouTube URL');
});