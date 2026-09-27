import { expect, test } from '@playwright/test';

test('CART-01 removes a line and recalculates the checkout total', async ({ page }) => {
  await page.goto('/');

  const checkout = page.getByRole('region', { name: 'Checkout' });
  const toteButton = page.getByRole('button', { name: 'Add Canvas Tote to cart' });

  await expect(checkout.getByText('Your cart is ready for something lovely.')).toBeVisible();
  await expect(checkout.getByRole('button', { name: 'Place order' })).toBeDisabled();

  await toteButton.click();
  await expect(checkout.getByRole('heading', { name: 'Canvas Tote' })).toBeVisible();
  await expect(checkout.locator('.total-row strong')).toHaveText('$24.00');
  await expect(checkout.getByRole('button', { name: 'Place order' })).toBeEnabled();

  await checkout.getByRole('button', { name: 'Remove Canvas Tote from checkout' }).click();
  await expect(checkout.getByText('Your cart is ready for something lovely.')).toBeVisible();
  await expect(checkout.locator('.total-row strong')).toHaveText('$0.00');
  await expect(checkout.getByRole('button', { name: 'Place order' })).toBeDisabled();

  await expect(toteButton).toBeVisible();
  await toteButton.click();
  await expect(checkout.getByRole('heading', { name: 'Canvas Tote' })).toBeVisible();
  await expect(checkout.locator('.total-row strong')).toHaveText('$24.00');
});
