import { menuPrompt } from '../ui/prompts.js';
import { t, i18n, SUPPORTED_LOCALES, type Locale } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';

// 欢迎页用卡片标题，不重复显示语言页标题，为七牛品牌标志留出空间。
// 进度 2 + 欢迎卡片 7 + 语言选项 4 + 操作提示 1
const WELCOME_BODY_ROWS = 14;

// 语言选择流程
export async function runLanguageFlow(step?: StepInfo): Promise<boolean> {
  if (step) {
    // 首次欢迎页在短终端使用紧凑牛头，按整页行数判断，保证语言选项与提示都在一屏内。
    const welcome = step.current === 1;
    if (welcome) {
      uiRenderer.renderHeader({ bodyRows: WELCOME_BODY_ROWS, brandMark: true });
      uiRenderer.renderSteps(step);
      uiRenderer.renderWelcome(t('welcome'), t('welcome_description'), t('privacy_notice'));
    } else uiRenderer.renderPage(t('page_language'), step);
  } else uiRenderer.renderHeader();
  const { value: locale, action } = await menuPrompt({ message: t('language_prompt'), escape: true, items: [{ label: '中文', value: 'zh_CN' }, { label: 'English', value: 'en_US' }] });
  if (action === 'escape') return false;

  i18n.setLocale(locale as Locale);
  uiRenderer.renderSuccess(t('language_set', { lang: locale }));
  return true;
}
