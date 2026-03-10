import { t, i18n, SUPPORTED_LOCALES, type Locale } from '../lib/i18n.js';
import { configManager } from '../lib/config.js';
import { uiRenderer } from '../lib/wizard/ui/ui-renderer.js';
import { runLanguageFlow } from '../lib/wizard/flows/language-flow.js';

// lang show - 显示当前语言
export function langShowCommand(): void {
  i18n.init();
  uiRenderer.renderSuccess(t('language_current', { lang: configManager.getLang() }));
}

// lang set <locale> - 设置语言
export function langSetCommand(locale: string): void {
  if (!SUPPORTED_LOCALES.includes(locale as Locale)) {
    uiRenderer.renderError(`Unsupported locale: ${locale}. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
    return;
  }
  i18n.setLocale(locale as Locale);
  uiRenderer.renderSuccess(t('language_set', { lang: locale }));
}

// lang（无参数）- 交互式选择语言
export async function langInteractiveCommand(): Promise<void> {
  i18n.init();
  await runLanguageFlow();
}
