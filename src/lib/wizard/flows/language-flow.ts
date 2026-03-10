import { t, i18n, SUPPORTED_LOCALES, type Locale } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 语言选择流程
export async function runLanguageFlow(): Promise<void> {
  uiRenderer.renderHeader();
  const locale = await promptHelper.select<string>(t('language_prompt'), [
    { name: '中文', value: 'zh_CN' },
    { name: 'English', value: 'en_US' },
  ]);

  i18n.setLocale(locale as Locale);
  uiRenderer.renderSuccess(t('language_set', { lang: locale }));
}
