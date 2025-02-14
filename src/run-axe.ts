import axe from 'axe-core';
import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:9000'); // Replace with your local server URL

  const results = await page.evaluate(async () => {
    return await axe.run();
  });

  console.log(results.violations);
  await browser.close();
})();