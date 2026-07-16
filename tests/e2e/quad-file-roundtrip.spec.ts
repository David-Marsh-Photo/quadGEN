import { expect, test } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const indexUrl = pathToFileURL(resolve('index.html')).href;

test('a generated .quad file re-imports and re-exports bit-for-bit', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(indexUrl);
  await page.waitForFunction(
    () => {
      const scope = window as any;
      return typeof scope.buildFile === 'function'
        && typeof scope.parseQuadFile === 'function'
        && scope.elements?.rows?.children?.length > 0;
    },
    undefined,
    { timeout: 15000 }
  );

  const first = await page.evaluate(() => {
    const scope = window as any;
    const content = scope.buildFile();
    const parsed = scope.parseQuadFile(content);
    return { content, parsed };
  });

  expect(first.parsed.valid).toBe(true);
  expect(first.parsed.channels).toHaveLength(10);
  expect(first.parsed.channels.every((channel: string) => first.parsed.curves[channel].length === 256)).toBe(true);

  await page.setInputFiles('#quadFile', {
    name: 'generated-roundtrip.quad',
    mimeType: 'text/plain',
    buffer: Buffer.from(first.content)
  });
  await page.waitForFunction(
    () => (window as any).loadedQuadData?.filename === 'generated-roundtrip.quad',
    undefined,
    { timeout: 15000 }
  );
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
  }));

  const second = await page.evaluate(() => {
    const scope = window as any;
    const content = scope.buildFile();
    const parsed = scope.parseQuadFile(content);
    return { content, parsed };
  });

  expect(second.parsed.valid).toBe(true);
  expect(second.parsed.channels).toEqual(first.parsed.channels);
  expect(second.parsed.curves).toEqual(first.parsed.curves);
  expect(second.content).toBe(first.content);
  expect(errors).toEqual([]);
});
