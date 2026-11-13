const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const outputDir = path.join(__dirname, '..', 'output', 'play-screenshots');
const baseUrl = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  console.log('Launching browser for Play Store screenshots...');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  
  // 432 x 768 at 2.5x scale yields exactly 1080 x 1920 px (9:16 aspect ratio)
  const context = await browser.newContext({
    viewport: { width: 432, height: 768 },
    deviceScaleFactor: 2.5,
    isMobile: true,
    hasTouch: true,
  });

  const page = await context.newPage();

  // Screen 1: Public Race Landing (Hero)
  console.log('Navigating to Public Landing...');
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const acceptBtn = page.locator('button:has-text("Accept All")');
  if (await acceptBtn.count() > 0) {
    await acceptBtn.click();
    await page.waitForTimeout(600);
  }

  await page.waitForTimeout(1500);
  const screen1Path = path.join(outputDir, '1_public_landing.png');
  await page.screenshot({ path: screen1Path });
  console.log('Captured:', screen1Path);

  // Screen 2: Public Landing - Upcoming Races List (scrolled down cleanly)
  console.log('Scrolling to upcoming races...');
  const upcomingHeader = page.locator('h2:has-text("Upcoming races"), h3:has-text("Upcoming races")').first();
  if (await upcomingHeader.count() > 0) {
    await upcomingHeader.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'start' }));
    await page.waitForTimeout(1500);
    const screen2Path = path.join(outputDir, '2_upcoming_races.png');
    await page.screenshot({ path: screen2Path });
    console.log('Captured:', screen2Path);
  }

  // Screen 3: Sign In / Auth Screen
  console.log('Navigating to Login...');
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const screen3Path = path.join(outputDir, '3_sign_in.png');
  await page.screenshot({ path: screen3Path });
  console.log('Captured:', screen3Path);

  // Perform Sign In as demo.runner
  console.log('Signing in as demo.runner...');
  await page.fill('#loginEmail', 'demo.runner@racepulseph.com');
  await page.fill('#loginPassword', 'RunnerDemo#2026!');
  await page.click('button[type="submit"]');

  // Wait for Authorized Runner Workspace to mount and finish loading
  console.log('Waiting for runner dashboard to fully mount...');
  await page.waitForSelector('text=WELCOME, DEMO RUNNER', { timeout: 20000 });
  await page.waitForTimeout(3000);

  const mobileNav = page.locator('nav[data-workspace-nav="mobile"]');
  await mobileNav.waitFor({ state: 'visible', timeout: 10000 });

  // Screen 4: Runner Events Tab
  console.log('Capturing Runner Events tab...');
  const screen4Path = path.join(outputDir, '4_runner_portal.png');
  await page.screenshot({ path: screen4Path });
  console.log('Captured:', screen4Path);

  // Screen 5: My Races Tab
  console.log('Switching to My Races tab...');
  const myRacesBtn = mobileNav.locator('button[aria-label="My Races"]');
  if (await myRacesBtn.count() > 0) {
    await myRacesBtn.click();
    await page.waitForTimeout(2000);
    const screen5Path = path.join(outputDir, '5_my_races.png');
    await page.screenshot({ path: screen5Path });
    console.log('Captured:', screen5Path);
  }

  // Screen 6: Friends Tab
  console.log('Switching to Friends tab...');
  const friendsBtn = mobileNav.locator('button[aria-label="Friends"]');
  if (await friendsBtn.count() > 0) {
    await friendsBtn.click();
    await page.waitForTimeout(2000);
    const screen6Path = path.join(outputDir, '6_friends.png');
    await page.screenshot({ path: screen6Path });
    console.log('Captured:', screen6Path);
  }

  await browser.close();
  console.log('Done capturing all final screenshots in:', outputDir);
  process.exit(0);
})().catch(err => {
  console.error('Error capturing screenshots:', err);
  process.exit(1);
});
