# Twitter Scraper

A Node.js script to scrape tweets from Twitter/X profiles using Puppeteer.

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file by copying `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Update the `.env` file with your Twitter credentials:
   ```
   TWITTER_USERNAME=your_username
   TWITTER_PASSWORD=your_password
   ```

## Usage

To scrape tweets from a Twitter profile, run:
```bash
node twitter-scraper.js <username>
```

Replace `<username>` with the Twitter username you want to scrape.

The script will save the scraped tweets to a JSON file named `tweets.json`.
