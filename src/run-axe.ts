import { AxePuppeteer } from '@axe-core/puppeteer';
import puppeteer, { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, URL } from 'url';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import stylelint from 'stylelint';
import babel from '@babel/core';

// Polyfill for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let hasViolations = false;

  // Function to scan a page with axe-core
  const scanPage = async (page: Page, file: string) => {
    const results = await new AxePuppeteer(page).analyze();
    console.log(`Results for ${file}:`, results.violations);

    if (results.violations.length > 0) {
      hasViolations = true;
    }
  };

  // Function to scan directories recursively
  const scanDirectory = async (dir: string) => {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        await scanDirectory(filePath);
      } else if (file.endsWith('.html')) {
        const page = await browser.newPage();
        await page.goto(`file://${filePath}`);
        await scanPage(page, file);
        await page.close();
      } else if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
        const code = fs.readFileSync(filePath, 'utf8');
        const transformed = babel.transformSync(code, {
          filename: filePath,
          presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript']
        });

        if (transformed && transformed.code) {
          const script = `
            import React from 'react';
            import ReactDOMServer from 'react-dom/server';
            ${transformed.code}
            export default Component;
          `;
          let moduleUrl;
          try {
            moduleUrl = new URL(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
          } catch (err) {
            if (err instanceof Error) {
              console.error("Invalid URL:", err.message);
            } else {
              console.error("An unexpected error occurred:", err);
            }
            return;
          }
          const { default: Component } = await import(moduleUrl.href);
          const html = ReactDOMServer.renderToString(React.createElement(Component));
          const page = await browser.newPage();
          await page.setContent(html);
          await scanPage(page, file);
          await page.close();
        } else {
          console.error(`Error transforming ${filePath}`);
        }
      } else if (file.endsWith('.css') || file.endsWith('.scss')) {
        const cssContent = fs.readFileSync(filePath, 'utf8');
        const lintResults = await stylelint.lint({
          code: cssContent,
          configFile: path.resolve(__dirname, '.stylelintrc.json')
        });

        if (lintResults.errored) {
          console.log(`CSS issues in ${file}:`, lintResults.output);
          hasViolations = true;
        }
      }
    }
  };

  // Scan HTML files in ada/html directory
  const htmlDir = path.resolve(__dirname, 'ada/html'); // Adjust the relative path accordingly
  const htmlFiles = fs.readdirSync(htmlDir).filter(file => file.endsWith('.html'));

  for (const file of htmlFiles) {
    const filePath = path.join(htmlDir, file);
    const page = await browser.newPage();
    await page.goto(`file://${filePath}`);

    await scanPage(page, file);
    await page.close();
  }

  // Scan all files and folders under src
  await scanDirectory(path.resolve(__dirname, 'src'));

  await browser.close();

  if (hasViolations) {
    process.exit(1); // Exit with error if there are violations
  }
})();