import { expect, test } from '@playwright/test';

function capturePageErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    return errors;
}

async function startGame(page) {
    await page.goto('/');
    await expect(page.locator('#setup-screen')).toBeVisible();
    await expect(page.locator('[data-option="players"].selected')).toHaveAttribute('data-value', '3');
    await page.getByRole('button', { name: 'Start Game!' }).click();
    await expect(page.locator('#game-screen')).toHaveClass(/\bactive\b/);
    await expect(page.locator('#turn-info')).toContainText("Red's Turn");
}

test('starts a game on the 3D board and draws a card', async ({ page }) => {
    const pageErrors = capturePageErrors(page);
    await page.addInitScript(() => {
        Math.random = () => 0.999999;
    });

    await startGame(page);

    const board = page.locator('#board');
    await expect(board).toHaveClass(/\bboard-3d\b/);
    await expect(board.locator('canvas')).toBeVisible();
    await expect(board.locator('canvas')).toHaveAttribute(
        'aria-label',
        /Arrow keys navigate tiles/
    );

    await page.getByRole('button', { name: 'Draw a card' }).click();
    await expect(page.locator('#deck-count')).toHaveText('35');
    await expect(page.locator('#end-turn-timer-wrap')).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('falls back to the accessible flat board without WebGL2', async ({ page }) => {
    const pageErrors = capturePageErrors(page);
    await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
    });

    await startGame(page);

    const cells = page.locator('#board .cell');
    await expect(cells).toHaveCount(64);
    await expect(cells.first()).toHaveAttribute('aria-label', 'Row 1, column 1');
    await expect(page.locator('#camera-hint')).toHaveText(
        '3D unavailable on this device — playing in flat-board mode.'
    );
    expect(pageErrors).toEqual([]);
});
