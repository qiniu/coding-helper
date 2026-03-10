import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configManager } from './config.js';

// 支持的语言列表
export const SUPPORTED_LOCALES = ['zh_CN', 'en_US'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

// 翻译字典类型
type TranslationDict = Record<string, string>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 国际化单例
class I18n {
  private locale: Locale = 'zh_CN';
  private translations: TranslationDict = {};
  private fallback: TranslationDict = {};
  private loaded = false;

  // 加载翻译文件
  private loadTranslations(locale: string): TranslationDict {
    try {
      const filePath = path.resolve(__dirname, '..', 'locales', `${locale}.json`);
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as TranslationDict;
    } catch {
      return {};
    }
  }

  // 初始化
  init(locale?: string): void {
    if (locale) {
      this.locale = SUPPORTED_LOCALES.includes(locale as Locale) ? (locale as Locale) : 'en_US';
    } else {
      // 从配置读取，或自动检测系统语言
      const configLang = configManager.getLang();
      if (configLang && SUPPORTED_LOCALES.includes(configLang as Locale)) {
        this.locale = configLang as Locale;
      } else {
        this.locale = this.detectSystemLocale();
      }
    }

    this.translations = this.loadTranslations(this.locale);
    this.fallback = this.locale !== 'en_US' ? this.loadTranslations('en_US') : {};
    this.loaded = true;
  }

  // 自动检测系统语言
  private detectSystemLocale(): Locale {
    const env = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
    if (env.startsWith('zh')) {
      return 'zh_CN';
    }
    return 'en_US';
  }

  // 获取翻译文本
  t(key: string, params?: Record<string, string>): string {
    if (!this.loaded) this.init();

    let text = this.translations[key] || this.fallback[key] || key;

    // 替换模板参数 {{param}}
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      }
    }

    return text;
  }

  // 获取当前语言
  getLocale(): Locale {
    if (!this.loaded) this.init();
    return this.locale;
  }

  // 设置语言
  setLocale(locale: Locale): void {
    this.locale = locale;
    this.translations = this.loadTranslations(locale);
    this.fallback = locale !== 'en_US' ? this.loadTranslations('en_US') : {};
    configManager.setLang(locale);
  }
}

// 导出单例
export const i18n = new I18n();

// 便捷方法
export function t(key: string, params?: Record<string, string>): string {
  return i18n.t(key, params);
}
