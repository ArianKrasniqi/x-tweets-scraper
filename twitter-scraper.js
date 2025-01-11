import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

// Configure puppeteer stealth
puppeteer.use(StealthPlugin());

// Load environment variables
dotenv.config();

const COOKIES_PATH = path.join(process.cwd(), 'cookies', 'twitter_cookies.json');

async function initBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setViewport({
    width: 1280,
    height: 800
  });

  return { browser, page };
}

async function loadCookies(page) {
  try {
    const cookiesString = await fs.readFile(COOKIES_PATH);
    const cookies = JSON.parse(cookiesString);
    await page.setCookie(...cookies);
    return true;
  } catch (error) {
    console.log('No saved cookies found');
    return false;
  }
}

async function saveCookies(page) {
  const cookies = await page.cookies();
  await fs.mkdir(path.dirname(COOKIES_PATH), { recursive: true });
  await fs.writeFile(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

async function login(page) {
  try {
    await page.goto('https://x.com/login', {
      waitUntil: 'networkidle0'
    });

    await page.waitForSelector('input[autocomplete="username"]');
    await page.type('input[autocomplete="username"]', process.env.TWITTER_USERNAME);
    
    await page.click('div[role="button"]:not([aria-label])');
    
    await page.waitForSelector('input[type="password"]');
    await page.type('input[type="password"]', process.env.TWITTER_PASSWORD);
    
    await page.click('div[role="button"][data-testid="LoginButton"]');
    
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    
    await saveCookies(page);
    
    console.log('Successfully logged in to Twitter');
    return true;
  } catch (error) {
    console.error('Login failed:', error);
    return false;
  }
}

async function scrapeTweets(page, username, maxTweets = 10) {
  try {
    // Go to user's profile and wait for tweets to load
    await page.goto(`https://x.com/${username}`, {
      waitUntil: 'networkidle0'
    });

    // Wait for tweets to be visible
    await page.waitForSelector('article[data-testid="tweet"]');

    // Scroll to top to ensure we start from the newest tweets
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    await page.waitForTimeout(1000); // Wait for any dynamic content to load

    const tweets = new Set();
    let lastTweetsCount = 0;
    let stuckCounter = 0;
    
    while (tweets.size < maxTweets && stuckCounter < 5) {
      const newTweets = await page.evaluate(() => {
        const tweetElements = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
        return tweetElements.map(tweet => {
          const text = tweet.querySelector('div[lang]')?.textContent || '';
          const time = tweet.querySelector('time')?.getAttribute('datetime');
          const likes = tweet.querySelector('div[data-testid="like"]')?.textContent;
          const retweets = tweet.querySelector('div[data-testid="retweet"]')?.textContent;
          const tweetId = tweet.querySelector('a[href*="/status/"]')?.href?.split('/status/')?.[1];
          
          return {
            id: tweetId,
            text,
            time,
            likes,
            retweets,
            url: tweet.querySelector('a[href*="/status/"]')?.href
          };
        });
      });

      // Sort tweets by time to ensure we get the newest first
      newTweets.sort((a, b) => new Date(b.time) - new Date(a.time));

      newTweets.forEach(tweet => {
        if (tweet.text && tweet.time) {
          tweets.add(JSON.stringify(tweet));
        }
      });

      // Check if we're stuck (no new tweets being added)
      if (tweets.size === lastTweetsCount) {
        stuckCounter++;
      } else {
        stuckCounter = 0;
      }
      lastTweetsCount = tweets.size;

      // Scroll down to load more tweets
      await page.evaluate(() => {
        window.scrollBy(0, 500); // Smaller scroll for more precise loading
      });
      
      await page.waitForTimeout(2000); // Increased wait time for better loading

      console.log(`Collected ${tweets.size} tweets...`);
    }

    // Convert Set back to array and sort by date
    const sortedTweets = Array.from(tweets)
      .map(t => JSON.parse(t))
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    return sortedTweets.slice(0, maxTweets);
  } catch (error) {
    console.error('Error scraping tweets:', error);
    return [];
  }
}

async function main() {
  const targetUsername = process.argv[2];
  if (!targetUsername) {
    console.error('Please provide a username to scrape. Usage: node twitter-scraper.js <username>');
    process.exit(1);
  }

  let browser;
  try {
    const { browser: initializedBrowser, page } = await initBrowser();
    browser = initializedBrowser;
    
    await loadCookies(page);
    await login(page);
    
    console.log(`Starting to scrape tweets from @${targetUsername}...`);
    const tweets = await scrapeTweets(page, targetUsername, 10);
    console.log('Scraped tweets:', tweets);
    
    const filename = `${targetUsername}_tweets.json`;
    await fs.writeFile(
      filename,
      JSON.stringify(tweets, null, 2)
    );
    console.log(`Tweets saved to ${filename}`);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main(); 