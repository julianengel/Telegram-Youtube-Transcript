import { extractVideoId, getTranscript, validateYoutubeUrl } from '../utils/youtube.js';
import fs from 'fs';

export async function handleMessage(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) {
    await handleInvalidInput(bot, chatId);
    return;
  }

  try {
    if (text.includes('youtube.com') || text.includes('youtu.be')) {
      await handleYoutubeUrl(bot, chatId, text);
    } else if (text === '/start') {
      await handleStart(bot, chatId);
    } else {
      await handleInvalidInput(bot, chatId);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    await handleError(bot, chatId);
  }
}

async function handleYoutubeUrl(bot, chatId, url) {
  try {
    console.log('Processing YouTube URL:', url);
    const videoId = extractVideoId(url);
    
    if (!videoId) {
      console.log('Invalid video ID from URL:', url);
      await bot.sendMessage(chatId, 'Invalid YouTube URL. Please provide a valid YouTube video link.');
      return;
    }

    console.log('Extracted video ID:', videoId);
    const isValidVideo = await validateYoutubeUrl(videoId);
    if (!isValidVideo) {
      console.log('Video not accessible:', videoId);
      await bot.sendMessage(chatId, 'This video does not exist or is not accessible.');
      return;
    }

    console.log('Video is valid, fetching transcript...');
    const statusMessage = await bot.sendMessage(chatId, 'Processing transcript... This may take a moment.');
    
    try {
      const { pdfPath, videoTitle } = await getTranscript(videoId);
      console.log('Successfully generated PDF:', pdfPath);
      await bot.deleteMessage(chatId, statusMessage.message_id);
      
      if (!pdfPath) {
        console.error('No PDF path returned');
        await bot.sendMessage(chatId, 'Failed to generate transcript PDF.');
        return;
      }

      // Send the PDF
      console.log('Sending PDF to user...');
      await bot.sendDocument(chatId, pdfPath, {
        caption: `Transcript for: ${videoTitle}`
      });

      // Clean up the PDF file
      try {
        fs.unlinkSync(pdfPath);
        console.log('Cleaned up PDF file');
      } catch (err) {
        console.error('Error deleting PDF file:', err);
      }
    } catch (error) {
      console.error('Error in transcript processing:', error);
      await bot.deleteMessage(chatId, statusMessage.message_id);
      
      if (error.message === 'TRANSCRIPT_DISABLED') {
        await bot.sendMessage(chatId, 'Sorry, captions are disabled for this video. Please try a video that has captions enabled.');
      } else if (error.message === 'NO_TRANSCRIPT') {
        await bot.sendMessage(chatId, 'Sorry, no transcript is available for this video. Please try another video.');
      } else {
        console.error('Unexpected error:', error);
        await bot.sendMessage(chatId, 'Sorry, there was an error processing the transcript. Please try again later.');
      }
    }
  } catch (error) {
    console.error('Error processing YouTube URL:', error);
    await bot.sendMessage(chatId, 'Sorry, there was an error processing your request. Please try again later.');
  }
}

async function sendLongMessage(bot, chatId, text) {
  try {
    const maxLength = 4000; // Telegram's message length limit
    const chunks = [];
    
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.slice(i, i + maxLength));
    }

    for (const chunk of chunks) {
      await bot.sendMessage(chatId, chunk);
      // Small delay to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

async function handleStart(bot, chatId) {
  const welcomeMessage = `
Welcome to YouTube Transcript Bot! 🎥

Send me a YouTube video URL, and I'll fetch its transcript for you.

Example URLs I can handle:
- https://www.youtube.com/watch?v=VIDEO_ID
- https://youtu.be/VIDEO_ID

Note: The video must have captions available.`;

  await bot.sendMessage(chatId, welcomeMessage);
}

async function handleInvalidInput(bot, chatId) {
  await bot.sendMessage(
    chatId, 
    'Please send a valid YouTube video URL. Use /start to see examples of supported URL formats.'
  );
}

async function handleError(bot, chatId) {
  await bot.sendMessage(
    chatId,
    'Sorry, something went wrong. Please try again later or contact support if the issue persists.'
  );
}