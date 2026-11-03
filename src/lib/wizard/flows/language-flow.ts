import { menuPrompt } from '../ui/prompts.js';
import { t, i18n, SUPPORTED_LOCALES, type Locale } from '../../i18n.js';
import { promptHelper } from '../ui/prompt-helper.js';
import { uiRenderer, type StepInfo } from '../ui/ui-renderer.js';

// 欢迎页在页头与状态栏之下的行数：进度 2 + 标题 2 + 欢迎卡片 7 + 语言选项 4 + 操作提示 1
const WELCOME_BODY_ROWS = 16;

// 语言选择流程
export async function runLanguageFlow(step?: StepInfo): Promise<boolean> {
  if (step) {
    // 首次向导首页：终端够高时用完整像素 Logo 作页头，否则退回一行标题，保证进度、欢迎卡片和选项都在一屏内。
    // 后续步骤保持一行标题，把空间留给表单内容
    const welcome = step.current === 1;
    uiRenderer.renderPage(t('page_language'), step, undefined, undefined, { full: welcome && uiRenderer.logoFits(WELCOME_BODY_ROWS) });
    // 首次向导第一页：欢迎卡片
    if (welcome) uiRenderer.renderWelcome(t('welcome'), t('welcome_description'), t('privacy_notice'));
  } else uiRenderer.renderHeader();
  const { value: locale, action } = await menuPrompt({ message: t('language_prompt'), escape: true, items: [{ label: '中文', value: 'zh_CN' }, { label: 'English', value: 'en_US' }] });
  if (action === 'escape') return false;

  i18n.setLocale(locale as Locale);
  uiRenderer.renderSuccess(t('language_set', { lang: locale }));
  return true;
}
