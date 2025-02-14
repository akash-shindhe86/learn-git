import { AxePuppeteer } from '@axe-core/puppeteer';
import puppeteer, { Page } from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import React from 'react';
import ReactDOMServer from 'react-dom/server';
import stylelint from 'stylelint';
import babel from '@babel/core';
import os from 'os';
import { buildSync } from 'esbuild';

// Polyfill for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  console.log("Starting script...");

  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  let hasViolations = false;

  // Function to scan a page with axe-core
  const scanPage = async (page: Page, file: string) => {
    console.log(`Scanning page: ${file}`);
    const results = await new AxePuppeteer(page).analyze();
    console.log(`Results for ${file}:`, results.violations);

    if (results.violations.length > 0) {
      hasViolations = true;
    }
  };

  // Function to scan directories recursively
  const scanDirectory = async (dir: string) => {
    console.log(`Scanning directory: ${dir}`);
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        await scanDirectory(filePath);
      } else if (file.endsWith('.html')) {
        console.log(`Processing HTML file: ${filePath}`);
        const page = await browser.newPage();
        await page.goto(`file://${filePath}`);
        await scanPage(page, file);
        await page.close();
      } else if (file.endsWith('.tsx') || file.endsWith('.jsx') || file.endsWith('.js')) {
        console.log(`Processing JS/TSX/JSX file: ${filePath}`);
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
          const tempFilePath = path.join(os.tmpdir(), `${path.basename(filePath)}.mjs`);
          fs.writeFileSync(tempFilePath, script);

          try {
            console.log(`Bundling module from: ${tempFilePath}`);
            const bundledFilePath = path.join(os.tmpdir(), `${path.basename(filePath)}.bundle.mjs`);
            buildSync({
              entryPoints: [tempFilePath],
              bundle: true,
              outfile: bundledFilePath,
              format: 'esm',
              platform: 'node',
              external: ['react', 'react-dom']
            });

            console.log(`Importing bundled module from: ${bundledFilePath}`);
            const { default: Component } = await import(pathToFileURL(bundledFilePath).href);
            const html = ReactDOMServer.renderToString(React.createElement(Component));
            const page = await browser.newPage();
            await page.setContent(html);
            await scanPage(page, file);
            await page.close();

            // Clean up the temporary files
            fs.unlinkSync(tempFilePath);
            fs.unlinkSync(bundledFilePath);
          } catch (err) {
            console.error(`Error importing module from ${tempFilePath}:`, err);
          }
        } else {
          console.error(`Error transforming ${filePath}`);
        }
      } else if (file.endsWith('.css') || file.endsWith('.scss')) {
        console.log(`Processing CSS/SCSS file: ${filePath}`);
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

  // Scan all files and folders under the project root src directory
  await scanDirectory(path.resolve(__dirname, '../src'));

  await browser.close();

  if (hasViolations) {
    console.log("Accessibility violations found.");
    process.exit(1); // Exit with error if there are violations
  } else {
    console.log("No accessibility violations found.");
  }
})();