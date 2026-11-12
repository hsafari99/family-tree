import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { readZip } from '../../apps/api/test/zip-reader';
import { PROD_LOCAL, statePath } from '../support/env';
import { treeUrl } from '../support/fixture';
import { GPS_JPEG } from '../support/fixtures';
import { card, clearPhotos, closeSection, openSection } from '../support/ui';

test.skip(PROD_LOCAL, 'dev stack only');
test.use({ storageState: statePath('owner.json') });

// This test adds a photo to the shared sample tree; leave it as found, even when retried.
test.beforeEach(async ({ page }) => clearPhotos(page, 'Margaret Hale', treeUrl()));
test.afterEach(async ({ page }) => clearPhotos(page, 'Margaret Hale', treeUrl()));

test('the owner downloads one ZIP with GEDCOM 5.5.1, JSON and photos', async ({ page }) => {
  await page.goto(treeUrl());
  // A photo of its own, so the archive has one whatever ran before; removed again at the end.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full' }).click();
  await card(page, 'Margaret Hale').click();
  await openSection(page, 'Photos');
  await page.locator('input[type="file"]').setInputFiles(GPS_JPEG);
  await page.getByRole('button', { name: 'Use the whole photo' }).click();
  await expect(page.getByText('Photo added')).toBeVisible();
  await closeSection(page);

  const section = page.getByRole('region', { name: 'Export' });
  // The download is a navigation (preflight, then a one-time ticket), so use the download event.
  const download = page.waitForEvent('download');
  await section.getByRole('button', { name: 'Download export' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^family-tree-\d{4}-\d{2}-\d{2}\.zip$/);
  const entries = readZip(readFileSync((await file.path())!));
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  expect([...byName.keys()]).toEqual(expect.arrayContaining(['tree.ged', 'tree.json']));
  for (const name of byName.keys()) {
    expect(name).toMatch(/^(tree\.(ged|json)|photos\/I\d+-\d+\.webp)$/);
  }
  expect([...byName.keys()].some((n) => n.startsWith('photos/'))).toBe(true);

  const ged = byName.get('tree.ged')!.toString('utf8');
  expect(ged.startsWith('﻿0 HEAD\r\n')).toBe(true);
  expect(ged).toContain('\r\n2 VERS 5.5.1\r\n');
  expect(ged).toContain('\r\n1 CHAR UTF-8\r\n');
  expect(ged).toContain('\r\n2 SURN Ellis\r\n2 TYPE maiden\r\n');
  expect(ged.endsWith('\r\n0 TRLR\r\n')).toBe(true);

  const json = JSON.parse(byName.get('tree.json')!.toString('utf8'));
  expect(json).toMatchObject({ format: 'family-tree-export', version: 1 });
  expect(json.persons.length).toBeGreaterThanOrEqual(10);
  await expect(section.getByText('Your export is downloading.')).toBeVisible();
});
