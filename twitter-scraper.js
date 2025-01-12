import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";

// Configure puppeteer stealth
puppeteer.use(StealthPlugin());

// Load environment variables
dotenv.config();

const COOKIES_PATH = path.join(
  process.cwd(),
  "cookies",
  "twitter_cookies.json"
);

async function initBrowser() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 1280,
    height: 800,
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
    console.log("No saved cookies found");
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
    await page.goto("https://x.com/login", {
      waitUntil: "networkidle0",
    });

    // Check if we're already logged in
    const isAlreadyLoggedIn = await page
      .waitForSelector('a[data-testid="AppTabBar_Profile_Link"]', {
        timeout: 3000,
      })
      .then(() => true)
      .catch(() => false);

    if (isAlreadyLoggedIn) {
      console.log("Already logged in!");
      return true;
    }

    // If not logged in, proceed with login using email
    const usernameInput = await page.waitForSelector(
      'input[autocomplete="username"]'
    );
    await usernameInput.type(process.env.TWITTER_EMAIL);

    const nextButton = await page.waitForSelector("text=Next");
    await nextButton.click();

    const passwordInput = await page.waitForSelector('input[type="password"]');
    await passwordInput.type(process.env.TWITTER_PASSWORD);

    const loginButton = await page.waitForSelector("text=Log in");
    await loginButton.click();

    // Wait for login to complete with shorter timeout
    const isLoggedIn = await page
      .waitForSelector('a[data-testid="AppTabBar_Profile_Link"]', {
        timeout: 3000,
      })
      .then(() => true)
      .catch(() => false);

    if (isLoggedIn) {
      console.log("Successfully logged in to X");
      await saveCookies(page);
      return true;
    } else {
      console.error("Login verification failed");
      return false;
    }
  } catch (error) {
    console.error("Login failed:", error);
    return false;
  }
}

async function scrapeTweets(page, username, maxTweets = 10) {
  try {
    // Go to user's profile with navigation timeout
    await page.goto(`https://x.com/${username}`, {
      timeout: 5000,
      waitUntil: 'domcontentloaded' // Changed from networkidle0 for faster loading
    });
    
    // Quick check for redirect completion
    const quickCheck = await page
      .waitForSelector('article[data-testid="tweet"]', {
        timeout: 2000,
      })
      .then(() => true)
      .catch(() => false);

    if (!quickCheck) {
      // If tweets aren't immediately visible, wait a bit longer
      await page.waitForSelector('article[data-testid="tweet"]', {
        timeout: 3000,
      });
    }

    // Verify we're on the right page
    const currentUrl = page.url();
    if (!currentUrl.includes(username)) {
      throw new Error('Failed to load user profile');
    }

    const tweets = new Set();
    let lastTweetsCount = 0;
    let stuckCounter = 0;

    while (tweets.size < maxTweets && stuckCounter < 5) {
      const newTweets = await page.evaluate(() => {
        const tweetElements = Array.from(
          document.querySelectorAll('article[data-testid="tweet"]')
        );
        return tweetElements.map((tweet) => {
          const text = tweet.querySelector("div[lang]")?.textContent || "";
          const time = tweet.querySelector("time")?.getAttribute("datetime");
          const likes = tweet.querySelector('div[data-testid="like"]')?.textContent;
          const retweets = tweet.querySelector('div[data-testid="retweet"]')?.textContent;
          const tweetId = tweet.querySelector('a[href*="/status/"]')?.href?.split("/status/")?.[1];

          return {
            id: tweetId,
            text,
            time,
            likes,
            retweets,
            url: tweet.querySelector('a[href*="/status/"]')?.href,
          };
        });
      });

      newTweets.forEach((tweet) => {
        if (tweet.text && tweet.time) {
          tweets.add(JSON.stringify(tweet));
        }
      });

      if (tweets.size === lastTweetsCount) {
        stuckCounter++;
        console.log(`No new tweets found (attempt ${stuckCounter}/5)`);
      } else {
        stuckCounter = 0;
      }
      lastTweetsCount = tweets.size;

      await page.evaluate(() => {
        window.scrollBy({
          top: 500,
          behavior: 'smooth'
        });
      });

      // Reduced wait time between scrolls
      await page.waitForTimeout(1000);
      console.log(`Collected ${tweets.size} tweets...`);
    }

    const sortedTweets = Array.from(tweets)
      .map((t) => JSON.parse(t))
      .sort((a, b) => new Date(b.time) - new Date(a.time));

    return sortedTweets.slice(0, maxTweets);
  } catch (error) {
    console.error("Error scraping tweets:", error);
    throw error;
  }
}

async function main() {
  const targetUsername = process.argv[2];
  if (!targetUsername) {
    console.error(
      "Please provide a username to scrape. Usage: node twitter-scraper.js <username>"
    );
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
    console.log("Scraped tweets:", tweets);

    const filename = `${targetUsername}_tweets.json`;
    await fs.writeFile(filename, JSON.stringify(tweets, null, 2));
    console.log(`Tweets saved to ${filename}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main();
