import { YoutubeTranscript } from 'youtube-transcript';
import axios from 'axios';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { NlpManager } from 'node-nlp';

// Initialize NLP manager
const manager = new NlpManager({ languages: ['en'] });

function cleanText(text) {
  return text
    // Remove HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Remove bracketed content like [Music], [Applause], etc.
    .replace(/\[[^\]]*\]/g, '')
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Remove special characters but keep basic punctuation
    .replace(/[^\w\s.,!?'"()-]/g, '')
    .trim();
}

function improveGrammar(text) {
  // Add periods if missing at the end of sentences
  text = text.replace(/([a-z])\s+([A-Z])/g, '$1. $2');
  
  // Add commas in common patterns
  text = text
    // Before coordinating conjunctions in compound sentences
    .replace(/(\w+)\s+(and|or|but|nor|for|yet|so)\s+/g, '$1, $2 ')
    
    // After introductory phrases
    .replace(/(^|\. )(well|now|yes|moreover|furthermore|however|meanwhile|finally|then|today|yesterday|tomorrow|here|there)\s+/g, '$1$2, ')
    
    // Between city and state/country
    .replace(/([A-Za-z]+)\s+([A-Z]{2}|USA|UK|US|U\.S\.|U\.K\.)/g, '$1, $2')
    
    // Before quotes
    .replace(/(\w)\s*"/g, '$1, "')
    
    // In lists of three or more
    .replace(/(\w+)\s+(\w+)\s+and\s+(\w+)/g, '$1, $2, and $3')
    
    // After dependent clauses
    .replace(/(because|although|though|unless|when|if|while)\s+([^,]+?)\s+([^,]+?[.!?])/g, '$1 $2, $3');

  // Fix spacing around punctuation
  text = text
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/([.,!?])(?![\s"]|$)/g, '$1 ');

  // Capitalize first letter of sentences
  text = text.replace(/(^|\. )([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());

  return text;
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-z0-9]/gi, '_') // Replace non-alphanumeric chars with underscore
    .replace(/_+/g, '_')         // Replace multiple underscores with single
    .replace(/^_|_$/g, '')       // Remove leading/trailing underscores
    .toLowerCase()
    .substring(0, 50);           // Limit length
}

function processTranscriptText(transcriptArray) {
  let processedText = '';
  let currentSentence = '';
  
  transcriptArray.forEach(item => {
    const cleanedText = cleanText(item.text);
    if (!cleanedText) return;

    // Add the cleaned text to current sentence
    currentSentence += ' ' + cleanedText;

    // Check if this chunk ends with sentence-ending punctuation
    if (currentSentence.match(/[.!?]$/)) {
      // Apply grammar improvements
      const improvedSentence = improveGrammar(currentSentence.trim());
      processedText += improvedSentence + '\n\n';
      currentSentence = '';
    }
  });

  // Add any remaining text
  if (currentSentence.trim()) {
    const improvedSentence = improveGrammar(currentSentence.trim());
    processedText += improvedSentence + '.\n\n';
  }

  // Final pass of grammar improvement on the entire text
  return improveGrammar(processedText.trim());
}

export function extractVideoId(url) {
  try {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : false;
  } catch (error) {
    console.error('Error extracting video ID:', error);
    return false;
  }
}

export async function validateYoutubeUrl(videoId) {
  try {
    const response = await axios.get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`);
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

export async function getTranscript(videoId) {
  try {
    let transcriptArray;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        attempts++;
        console.log(`Attempt ${attempts} to fetch transcript for video ${videoId}`);
        
        // Try different approaches
        if (attempts === 1) {
          transcriptArray = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en',
            country: 'US'
          });
        } else if (attempts === 2) {
          transcriptArray = await YoutubeTranscript.fetchTranscript(videoId);
        } else {
          // Last attempt: try with different options
          transcriptArray = await YoutubeTranscript.fetchTranscript(videoId, {
            lang: 'en-US'
          });
        }

        if (transcriptArray && transcriptArray.length > 0) {
          console.log('Successfully fetched transcript');
          break;
        }
      } catch (error) {
        console.error(`Attempt ${attempts} failed:`, error.message);
        
        if (error.message && error.message.includes('Transcript is disabled')) {
          if (attempts === maxAttempts) {
            throw new Error('TRANSCRIPT_DISABLED');
          }
        } else if (attempts === maxAttempts) {
          throw error;
        }
      }
    }
    
    if (!transcriptArray || transcriptArray.length === 0) {
      throw new Error('NO_TRANSCRIPT');
    }

    // Get video details
    const response = await axios.get(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`);
    const videoTitle = cleanText(response.data.title);
    const safeFileName = sanitizeFilename(videoTitle);

    // Create PDF
    const pdfPath = path.join(process.cwd(), 'temp', `${safeFileName}.pdf`);
    await ensureDirectoryExists(path.join(process.cwd(), 'temp'));
    
    const doc = new PDFDocument({
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      }
    });
    const writeStream = fs.createWriteStream(pdfPath);
    
    doc.pipe(writeStream);

    // Add title
    doc.font('Helvetica-Bold')
       .fontSize(20)
       .text(videoTitle, {
         align: 'center',
         underline: true
       });
    doc.moveDown();

    // Add video info
    doc.font('Helvetica')
       .fontSize(12)
       .text(`Video ID: ${videoId}`, {
         align: 'center',
         color: 'gray'
       });
    doc.moveDown(2);

    // Process transcript text into properly formatted paragraphs
    const processedText = processTranscriptText(transcriptArray);
    const paragraphs = processedText.split('\n\n');

    // Add the formatted text
    let currentPage = 1;
    doc.font('Helvetica')
       .fontSize(12);

    paragraphs.forEach((paragraph, index) => {
      // Add page numbers
      if (currentPage !== doc.bufferedPageRange().count) {
        currentPage = doc.bufferedPageRange().count;
        doc.text(`- ${currentPage} -`, {
          align: 'center',
          color: 'gray'
        });
        doc.moveDown();
      }

      // Add paragraph
      if (paragraph.trim()) {
        doc.text(paragraph.trim(), {
          align: 'left',
          lineGap: 5,
          indent: 20,
          continued: false
        });

        // Add spacing between paragraphs
        if (index < paragraphs.length - 1) {
          doc.moveDown(1);
        }
      }
    });

    // Add final page number if needed
    if (currentPage !== doc.bufferedPageRange().count) {
      doc.text(`- ${doc.bufferedPageRange().count} -`, {
        align: 'center',
        color: 'gray'
      });
    }

    doc.end();

    // Wait for PDF to finish writing
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    return {
      pdfPath,
      videoTitle
    };
  } catch (error) {
    console.error('Error processing transcript:', error);
    if (error.message === 'TRANSCRIPT_DISABLED') {
      throw new Error('TRANSCRIPT_DISABLED');
    }
    if (error.message === 'NO_TRANSCRIPT') {
      throw new Error('NO_TRANSCRIPT');
    }
    throw new Error('PROCESSING_ERROR');
  }
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}