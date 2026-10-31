import { menuPrompt } from '../ui/prompts.js';
import { t, i18n, SUPPORTED_LOCALES, type Locale } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer } from '../ui/ui-renderer.js';

// 语言选择流程
export async function runLanguageFlow(): Promise<boolean> {
  uiRenderer.renderHeader();
  const { value: locale, action } = await menuPrompt({ message: t('language_prompt'), escape: true, items: [{ label: '中文', value: 'zh_CN' }, { label: 'English', value: 'en_US' }] });
  if (action === 'escape') return false;

  i18n.setLocale(locale as Locale);
  uiRenderer.renderSuccess(t('language_set', { lang: locale }));
  return true;
}
